import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@generated/prisma/client';
import {
  assertSearchQueryAllowed,
  resolveRequestCountryCode,
} from '../../common/content-safety/assert-user-query';
import { PrismaService } from '../database/prisma.service';
import { OpenAiEmbeddingProvider } from '../ai/providers/openai-embedding.provider';
import { RedisCacheService } from '../cache/redis-cache.service';
import {
  buildAssetMetadataCacheKey,
  buildSearchCacheKey,
} from '../cache/utils/cache-key.util';
import { AiUsageService } from '../ai/services/ai-usage.service';
import { VectorStorageService } from './vector-storage.service';
import { SearchAssetsDto } from './dto/search-assets.dto';
import {
  SearchAssetsResponse,
  SearchEmbeddingUsage,
  SearchResultItem,
} from './interfaces/search-result.interface';
import { matchesMetadataFilters } from './utils/metadata-filter.util';
import { LetterEntity, LetterQueryDetectorService } from './letter-query-detector.service';
import {
  canonicalObjectStrings,
  matchesCanonicalLetterObjects,
} from './letter-object-mapper';

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
    private readonly configService: ConfigService,
    private readonly aiUsage: AiUsageService,
  ) {}

  public async search(dto: SearchAssetsDto): Promise<SearchAssetsResponse> {
    const query = dto.query?.trim();
    if (!query) {
      throw new BadRequestException('Search query cannot be empty');
    }

    const countryCode = resolveRequestCountryCode(
      dto.countryCode,
      this.configService.get<string>('flashcards.defaultCountryCode'),
    );
    assertSearchQueryAllowed(query, countryCode);

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

  /**
   * Cache-aware batch search: one embeddings API call for all cache misses,
   * then per-query vector search.
   */
  public async searchMany(
    queries: string[],
    options: Omit<SearchAssetsDto, 'query'> & { concurrency?: number } = {},
  ): Promise<Map<string, SearchAssetsResponse>> {
    const unique = Array.from(
      new Set(queries.map((q) => q.trim()).filter(Boolean)),
    );
    const results = new Map<string, SearchAssetsResponse>();
    if (unique.length === 0) {
      return results;
    }

    const countryCode = resolveRequestCountryCode(
      options.countryCode,
      this.configService.get<string>('flashcards.defaultCountryCode'),
    );
    const limit = options.limit ?? this.defaultLimit;
    if (limit <= 0) {
      throw new BadRequestException('limit must be greater than 0');
    }

    for (const query of unique) {
      assertSearchQueryAllowed(query, countryCode);
    }

    const uncached: string[] = [];
    for (const query of unique) {
      const cacheKey = buildSearchCacheKey({ ...options, query });
      if (!options.bypassCache) {
        const cached = await this.redisCache.get<SearchAssetsResponse>(cacheKey);
        if (cached) {
          results.set(query, {
            ...cached,
            fromCache: true,
            usage: {
              inputTokens: 0,
              totalTokens: 0,
              latencyMs: 0,
              model: cached.usage?.model,
              fromCache: true,
            },
          });
          continue;
        }
      }
      uncached.push(query);
    }

    if (uncached.length === 0) {
      return results;
    }

    const embeddings = await this.embeddingProvider.generateEmbeddings(uncached);
    const embeddingUsage = this.embeddingProvider.getLastUsage();
    const batchUsage: SearchEmbeddingUsage = {
      inputTokens: embeddingUsage?.inputTokens,
      totalTokens: embeddingUsage?.totalTokens,
      latencyMs: embeddingUsage?.latencyMs,
      model: this.embeddingProvider.modelName,
      fromCache: false,
    };

    if (embeddingUsage) {
      await this.aiUsage.record({
        stage: 'search_embedding',
        provider: 'openai',
        model: this.embeddingProvider.modelName,
        startedAt: new Date(Date.now() - (embeddingUsage.latencyMs || 0)),
        completedAt: new Date(),
        latencyMs: embeddingUsage.latencyMs || 0,
        inputTokens: embeddingUsage.inputTokens,
        totalTokens: embeddingUsage.totalTokens,
        status: 'success',
      });
    }

    const dto: SearchAssetsDto = { ...options, query: '' };
    const concurrency = Math.max(1, options.concurrency ?? 6);
    await this.mapWithConcurrency(uncached, concurrency, async (query, i) => {
      const embedding = embeddings[i];
      const response = await this.executeSearch(query, limit, dto, {
        embedding: embedding.embedding,
        usage: batchUsage,
      });
      const cacheKey = buildSearchCacheKey({ ...options, query });
      await this.redisCache.set(
        cacheKey,
        response,
        this.redisCache.getSearchCacheTtlSeconds(),
      );
      results.set(query, response);
    });

    return results;
  }

  private async mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    mapper: (item: T, index: number) => Promise<R>,
  ): Promise<R[]> {
    const results = new Array<R>(items.length);
    let nextIndex = 0;
    const workerCount = Math.max(1, Math.min(concurrency, items.length));
    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (nextIndex < items.length) {
          const current = nextIndex;
          nextIndex += 1;
          results[current] = await mapper(items[current], current);
        }
      }),
    );
    return results;
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

  private resolveCandidateLimit(
    limit: number,
    dto: SearchAssetsDto,
    entity: LetterEntity | null,
  ): number {
    if (dto.candidateLimit && dto.candidateLimit > 0) {
      return dto.candidateLimit;
    }
    if (dto.retrieval) {
      return entity ? Math.max(limit, LETTER_CANDIDATE_K) : limit;
    }
    return entity
      ? Math.max(limit * this.candidateMultiplier, LETTER_CANDIDATE_K)
      : Math.max(limit * this.candidateMultiplier, this.minimumCandidates);
  }

  private async executeSearch(
    query: string,
    limit: number,
    dto: SearchAssetsDto,
    precomputed?: { embedding: number[]; usage: SearchEmbeddingUsage },
  ): Promise<SearchAssetsResponse> {
    const entity = this.letterDetector.detect(query);
    const candidateLimit = this.resolveCandidateLimit(limit, dto, entity);

    this.logger.log(`Searching assets for query: "${query}"`);

    let embeddingVector: number[];
    let usage: SearchEmbeddingUsage;

    if (precomputed) {
      embeddingVector = precomputed.embedding;
      usage = precomputed.usage;
    } else {
      const embedding = await this.embeddingProvider.generateEmbedding(query);
      const embeddingUsage = this.embeddingProvider.getLastUsage();
      usage = {
        inputTokens: embeddingUsage?.inputTokens,
        totalTokens: embeddingUsage?.totalTokens,
        latencyMs: embeddingUsage?.latencyMs,
        model: this.embeddingProvider.modelName,
        fromCache: false,
      };

      if (embeddingUsage) {
        await this.aiUsage.record({
          stage: 'search_embedding',
          provider: 'openai',
          model: this.embeddingProvider.modelName,
          startedAt: new Date(Date.now() - (embeddingUsage.latencyMs || 0)),
          completedAt: new Date(),
          latencyMs: embeddingUsage.latencyMs || 0,
          inputTokens: embeddingUsage.inputTokens,
          totalTokens: embeddingUsage.totalTokens,
          status: 'success',
        });
      }
      embeddingVector = embedding.embedding;
    }

    const vectorResults = await this.vectorStorage.searchSimilar(
      embeddingVector,
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
    const assets = await this.loadAssetsWithMetadata(assetIds, {
      writeCache: !dto.retrieval && !dto.skipMetadataCacheWrite,
    });
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
      const letterFiltered = rankedResults.filter((item) =>
        matchesCanonicalLetterObjects(item.objects, entity),
      );

      if (letterFiltered.length > 0) {
        finalResults = letterFiltered;
      } else {
        this.logger.warn(
          `Letter filter empty for "${query}" (${targets.join(', ')}); falling back to objects lookup`,
        );
        finalResults = await this.findByCanonicalObjects(entity, dto, limit);
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
    entity: LetterEntity,
    dto: SearchAssetsDto,
    limit: number,
  ): Promise<SearchResultItem[]> {
    const targets = canonicalObjectStrings(entity).map((s) => s.toLowerCase());
    const rows = await this.prisma.assetMetadata.findMany({
      where: {
        objects:
          entity.case === 'both'
            ? { hasEvery: targets }
            : { hasSome: targets },
      },
      include: { asset: true },
      take: Math.max(limit * 5, 20),
    });

    const results: SearchResultItem[] = [];
    for (const row of rows) {
      if (!matchesMetadataFilters(row, dto.filters)) {
        continue;
      }
      if (!matchesCanonicalLetterObjects(row.objects, entity)) {
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

  private async loadAssetsWithMetadata(
    assetIds: string[],
    options?: { writeCache?: boolean },
  ) {
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

    if (options?.writeCache !== false) {
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
    }

    return assets;
  }
}
