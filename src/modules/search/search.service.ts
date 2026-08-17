import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { OpenAiEmbeddingProvider } from '../ai/providers/openai-embedding.provider';
import { RedisCacheService } from '../cache/redis-cache.service';
import {
  buildAssetMetadataCacheKey,
  buildSearchCacheKey,
} from '../cache/utils/cache-key.util';
import { VectorStorageService } from './vector-storage.service';
import { SearchAssetsDto } from './dto/search-assets.dto';
import {
  SearchAssetsResponse,
  SearchResultItem,
} from './interfaces/search-result.interface';
import { matchesMetadataFilters } from './utils/metadata-filter.util';
import { LetterQueryDetectorService } from './letter-query-detector.service';
import { canonicalObjectStrings } from './letter-object-mapper';

/** Vector window used before in-memory `objects` letter filtering. */
export const LETTER_CANDIDATE_K = 75;

type AssetWithMetadata = Prisma.AssetGetPayload<{ include: { metadata: true } }>;
type AssetMetadataRecord = NonNullable<AssetWithMetadata['metadata']>;

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);
  private readonly defaultLimit = 10;
  private readonly candidateMultiplier = 5;
  private readonly minimumCandidates = 50;

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingProvider: OpenAiEmbeddingProvider,
    private readonly vectorStorage: VectorStorageService,
    private readonly redisCache: RedisCacheService,
    private readonly letterDetector: LetterQueryDetectorService,
  ) {}

  public async search(dto: SearchAssetsDto): Promise<SearchAssetsResponse> {
    const query = dto.query?.trim();
    if (!query) {
      throw new BadRequestException('Search query cannot be empty');
    }

    const limit = dto.limit ?? this.defaultLimit;
    if (limit <= 0) {
      throw new BadRequestException('limit must be greater than 0');
    }

    const cacheKey = buildSearchCacheKey({ ...dto, query });
    if (!dto.bypassCache) {
      const cached = await this.redisCache.get<SearchAssetsResponse>(cacheKey);
      if (cached) {
        this.logger.debug(`Search cache hit for query "${query}"`);
        return {
          ...cached,
          fromCache: true,
          usage: {
            inputTokens: 0,
            totalTokens: 0,
            latencyMs: 0,
            model: cached.usage?.model,
            fromCache: true,
          },
        };
      }
    }

    const response = await this.executeSearch(query, limit, dto);

    await this.redisCache.set(
      cacheKey,
      response,
      this.redisCache.getSearchCacheTtlSeconds(),
    );

    return response;
  }

  public async flushCache(
    scope: 'search' | 'asset-metadata' | 'all' = 'all',
  ): Promise<{ deleted: number; scope: string }> {
    let deleted = 0;

    if (scope === 'search' || scope === 'all') {
      deleted += await this.redisCache.flushSearchCache();
    }

    if (scope === 'asset-metadata' || scope === 'all') {
      deleted += await this.redisCache.flushAssetMetadataCache();
    }

    this.logger.log(`Flushed ${deleted} Redis cache entries (${scope})`);
    return { deleted, scope };
  }

  private async executeSearch(
    query: string,
    limit: number,
    dto: SearchAssetsDto,
  ): Promise<SearchAssetsResponse> {
    const entity = this.letterDetector.detect(query);
    const candidateLimit = entity
      ? Math.max(
          limit * this.candidateMultiplier,
          LETTER_CANDIDATE_K,
        )
      : Math.max(limit * this.candidateMultiplier, this.minimumCandidates);

    this.logger.log(`Searching assets for query: "${query}"`);

    const embedding = await this.embeddingProvider.generateEmbedding(query);
    const embeddingUsage = this.embeddingProvider.getLastUsage();
    const usage = {
      inputTokens: embeddingUsage?.inputTokens,
      totalTokens: embeddingUsage?.totalTokens,
      latencyMs: embeddingUsage?.latencyMs,
      model: this.embeddingProvider.modelName,
      fromCache: false as const,
    };

    const vectorResults = await this.vectorStorage.searchSimilar(
      embedding.embedding,
      candidateLimit,
    );

    if (vectorResults.length === 0 && !entity) {
      return {
        query,
        total: 0,
        results: [],
        usage,
      };
    }

    const assetIds = vectorResults.map((result) => result.assetId);
    const assets = await this.loadAssetsWithMetadata(assetIds);
    const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
    const rankedResults: SearchResultItem[] = [];

    for (const vectorResult of vectorResults) {
      const asset = assetMap.get(vectorResult.assetId);
      if (!asset?.metadata) {
        continue;
      }

      if (!matchesMetadataFilters(asset.metadata, dto.filters)) {
        continue;
      }

      rankedResults.push(
        this.toSearchResult(asset, asset.metadata, {
          similarity: vectorResult.similarity,
          distance: vectorResult.distance,
        }),
      );
    }

    let finalResults = rankedResults;

    if (entity) {
      const targets = canonicalObjectStrings(entity).map((s) => s.toLowerCase());
      const letterFiltered = rankedResults.filter((item) => {
        const objs = (item.objects ?? []).map((o) => o.toLowerCase());
        return targets.some((t) => objs.includes(t));
      });

      if (letterFiltered.length > 0) {
        finalResults = letterFiltered;
      } else {
        this.logger.warn(
          `Letter filter empty for "${query}" (${targets.join(', ')}); falling back to objects lookup`,
        );
        finalResults = await this.findByCanonicalObjects(targets, dto, limit);
      }
    }

    const sliced = finalResults.slice(0, limit);

    return {
      query,
      total: sliced.length,
      results: sliced,
      usage,
    };
  }

  private async findByCanonicalObjects(
    targets: string[],
    dto: SearchAssetsDto,
    limit: number,
  ): Promise<SearchResultItem[]> {
    const rows = await this.prisma.assetMetadata.findMany({
      where: {
        objects: { hasSome: targets },
      },
      include: { asset: true },
      take: Math.max(limit * 5, 20),
    });

    const results: SearchResultItem[] = [];
    for (const row of rows) {
      if (!matchesMetadataFilters(row, dto.filters)) {
        continue;
      }
      const objs = row.objects.map((o) => o.toLowerCase());
      if (!targets.some((t) => objs.includes(t))) {
        continue;
      }
      results.push(
        this.toSearchResult(row.asset, row, { similarity: 1, distance: 0 }),
      );
      if (results.length >= limit) {
        break;
      }
    }

    return results;
  }

  private toSearchResult(
    asset: Pick<AssetWithMetadata, 'id' | 's3ObjectKey' | 'mimeType'>,
    metadata: AssetMetadataRecord,
    scores: { similarity: number; distance: number },
  ): SearchResultItem {
    return {
      assetId: asset.id,
      similarity: scores.similarity,
      distance: scores.distance,
      caption: metadata.caption,
      orientation: metadata.orientation,
      colors: metadata.colors,
      styles: metadata.styles,
      objects: metadata.objects,
      actions: metadata.actions,
      ageGroups: metadata.ageGroups,
      grades: metadata.grades,
      searchDescription: metadata.searchDescription,
      s3ObjectKey: asset.s3ObjectKey,
      mimeType: asset.mimeType,
    };
  }

  private async loadAssetsWithMetadata(assetIds: string[]) {
    if (assetIds.length === 0) {
      return [];
    }

    const assets = await this.prisma.asset.findMany({
      where: {
        id: { in: assetIds },
        metadata: { isNot: null },
      },
      include: { metadata: true },
    });

    await Promise.all(
      assets.map(async (asset) => {
        if (!asset.metadata) {
          return;
        }

        await this.redisCache.set(
          buildAssetMetadataCacheKey(asset.id),
          asset.metadata,
          this.redisCache.getAssetMetadataCacheTtlSeconds(),
        );
      }),
    );

    return assets;
  }
}
