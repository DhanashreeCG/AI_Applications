import { BadRequestException, Injectable, Logger } from '@nestjs/common';
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
    const candidateLimit = Math.max(
      limit * this.candidateMultiplier,
      this.minimumCandidates,
    );

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

    if (vectorResults.length === 0) {
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
    const filteredResults: SearchResultItem[] = [];

    for (const vectorResult of vectorResults) {
      const asset = assetMap.get(vectorResult.assetId);
      if (!asset?.metadata) {
        continue;
      }

      if (!matchesMetadataFilters(asset.metadata, dto.filters)) {
        continue;
      }

      filteredResults.push({
        assetId: asset.id,
        similarity: vectorResult.similarity,
        distance: vectorResult.distance,
        caption: asset.metadata.caption,
        orientation: asset.metadata.orientation,
        colors: asset.metadata.colors,
        styles: asset.metadata.styles,
        objects: asset.metadata.objects,
        actions: asset.metadata.actions,
        ageGroups: asset.metadata.ageGroups,
        grades: asset.metadata.grades,
        searchDescription: asset.metadata.searchDescription,
        s3ObjectKey: asset.s3ObjectKey,
        mimeType: asset.mimeType,
      });

      if (filteredResults.length >= limit) {
        break;
      }
    }

    return {
      query,
      total: filteredResults.length,
      results: filteredResults,
      usage,
    };
  }

  private async loadAssetsWithMetadata(assetIds: string[]) {
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
