import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import { getErrorMessage } from '../../../common/utils/error-message';
import {
  PIPELINE_STAGES,
  PipelineTelemetryContext,
} from '../../../common/events/pipeline-tracker.events';
import { SearchService } from '../../search/search.service';
import type {
  SearchAssetsResponse,
  SearchResultItem,
} from '../../search/interfaces/search-result.interface';
import { S3StorageService } from '../../storage/s3-storage.service';
import {
  DEFAULT_IMAGE_CONCURRENCY,
  DEFAULT_IMAGE_SEARCH_LIMIT,
  DEFAULT_SIGNED_URL_TTL_SECONDS,
  FLASHCARD_ASSET_IMAGE_PATH,
  FLASHCARD_IMAGE_SEARCH_EMBEDDING_PURPOSE,
} from '../constants/flashcard.constants';
import {
  AssetReference,
  ImageRetrievalStatus,
  ImageSearchQuery,
} from '../interfaces/flashcard.interfaces';
import {
  FlashcardPipelineEmitter,
  hashPayload,
} from '../telemetry/flashcard-pipeline.events';

interface RetrieveImagesInput {
  queries: Array<ImageSearchQuery | string>;
  topic?: string;
  ageMin: number | null;
  ageMax: number | null;
  usedAssetIds?: Set<string>;
}

@Injectable()
export class FlashcardImageRetrievalService {
  private readonly logger = new Logger(FlashcardImageRetrievalService.name);
  private readonly concurrency: number;
  private readonly signedUrlTtlSeconds: number;
  private readonly searchLimit: number;
  private readonly emitter: FlashcardPipelineEmitter;

  constructor(
    private readonly searchService: SearchService,
    private readonly s3StorageService: S3StorageService,
    private readonly configService: ConfigService,
    eventEmitter: EventEmitter2,
  ) {
    this.concurrency =
      this.configService.get<number>('flashcards.imageConcurrency') ??
      DEFAULT_IMAGE_CONCURRENCY;
    this.signedUrlTtlSeconds =
      this.configService.get<number>('flashcards.signedUrlTtlSeconds') ??
      DEFAULT_SIGNED_URL_TTL_SECONDS;
    this.searchLimit =
      this.configService.get<number>('flashcards.imageSearchLimit') ??
      DEFAULT_IMAGE_SEARCH_LIMIT;
    this.emitter = new FlashcardPipelineEmitter(eventEmitter);
  }

  public getConcurrency(): number {
    return this.concurrency;
  }

  public async retrieveForCard(
    input: RetrieveImagesInput,
    telemetry?: PipelineTelemetryContext,
  ): Promise<AssetReference> {
    const primary = this.normalizeQuery(input.queries[0]);
    const cascade = this.buildCascadeQueries(primary, input.topic);
    const attempts: string[] = [];

    if (!cascade.length) {
      return this.emptyReference('', attempts, 'IMAGE_NOT_FOUND');
    }

    for (const attempt of cascade) {
      attempts.push(attempt.label);
      const hit = await this.searchOnce(
        attempt.query,
        input,
        telemetry,
        attempts,
      );
      if (hit) {
        return hit;
      }
    }

    return this.emptyReference(
      cascade[0]?.query ?? '',
      attempts,
      'IMAGE_NOT_FOUND',
    );
  }

  public async mapWithConcurrency<T, R>(
    items: T[],
    mapper: (item: T, index: number) => Promise<R>,
  ): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let nextIndex = 0;

    const workers = Array.from(
      { length: Math.min(this.concurrency, items.length) },
      async () => {
        while (nextIndex < items.length) {
          const current = nextIndex;
          nextIndex += 1;
          results[current] = await mapper(items[current], current);
        }
      },
    );

    await Promise.all(workers);
    return results;
  }

  private normalizeQuery(
    raw: ImageSearchQuery | string | undefined,
  ): ImageSearchQuery | null {
    if (!raw) return null;
    if (typeof raw === 'string') {
      const searchQuery = raw.trim();
      if (!searchQuery) return null;
      return { searchQuery, expectedObjects: [] };
    }
    if (!raw.searchQuery?.trim()) return null;
    return raw;
  }

  /**
   * Search priority when the primary LLM query misses:
   * primary semantic → enriched → expected object → object name → topic
   */
  private buildCascadeQueries(
    primary: ImageSearchQuery | null,
    topic?: string,
  ): Array<{ label: string; query: string }> {
    const cascade: Array<{ label: string; query: string }> = [];
    const seen = new Set<string>();

    const push = (label: string, query: string | undefined) => {
      const trimmed = query?.trim();
      if (!trimmed) return;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      cascade.push({ label, query: trimmed });
    };

    if (primary) {
      push('semantic', primary.searchQuery);

      const enriched = [
        primary.searchQuery,
        primary.preferredStyle,
        primary.preferredBackground
          ? `${primary.preferredBackground} background`
          : undefined,
      ]
        .filter(Boolean)
        .join(' ');
      push('semantic_enriched', enriched);

      if (primary.expectedObjects.length) {
        push('expected_objects', primary.expectedObjects.join(' '));
        push('object_name', primary.expectedObjects[0]);
      }
    }

    push('topic', topic);
    push('unfiltered', primary?.expectedObjects[0] || primary?.searchQuery);

    return cascade;
  }

  private async searchOnce(
    query: string,
    input: RetrieveImagesInput,
    telemetry: PipelineTelemetryContext | undefined,
    attempts: string[],
  ): Promise<AssetReference | null> {
    const searchId = randomUUID();
    const startedAt = Date.now();

    if (telemetry) {
      this.emitter.emitImageSearchStarted({
        ...telemetry,
        searchId,
        stageName: PIPELINE_STAGES.IMAGE_RETRIEVAL,
        query,
      });
    }

    try {
      // Single top match only — highest similarity / least distance.
      const response = await this.searchService.search({
        query,
        limit: this.searchLimit,
      });

      this.emitEmbeddingUsage(telemetry, query, response);

      const candidate = this.selectTopSimilarityHit(
        response.results,
        input.usedAssetIds,
      );

      if (!candidate) {
        if (telemetry) {
          this.emitter.emitImageSearchCompleted({
            ...telemetry,
            searchId,
            stageName: PIPELINE_STAGES.IMAGE_RETRIEVAL,
            query,
            resultCount: response.results.length,
            selectedAssetId: null,
            cacheHit: response.fromCache === true,
            failed: false,
            durationMs: Date.now() - startedAt,
          });
        }
        return null;
      }

      input.usedAssetIds?.add(candidate.assetId);

      let signedUrl: string | null = null;
      try {
        signedUrl = await this.s3StorageService.getSignedUrl(
          candidate.s3ObjectKey,
          this.signedUrlTtlSeconds,
        );
      } catch (error) {
        this.logger.warn(
          `Signed URL failed for ${candidate.assetId}: ${getErrorMessage(error)}`,
        );
      }

      if (telemetry) {
        this.emitter.emitImageSearchCompleted({
          ...telemetry,
          searchId,
          stageName: PIPELINE_STAGES.IMAGE_RETRIEVAL,
          query,
          resultCount: response.results.length,
          selectedAssetId: candidate.assetId,
          cacheHit: response.fromCache === true,
          failed: false,
          durationMs: Date.now() - startedAt,
        });
      }

      return {
        assetId: candidate.assetId,
        s3ObjectKey: candidate.s3ObjectKey,
        signedUrl,
        imageUrl: `${FLASHCARD_ASSET_IMAGE_PATH}/${candidate.assetId}/image`,
        caption: candidate.caption,
        similarity: candidate.similarity,
        mimeType: candidate.mimeType,
        status: 'found',
        queryUsed: query,
        attempts: [...attempts],
      };
    } catch (error) {
      const message = getErrorMessage(error);
      this.logger.warn(`Image search failed for "${query}": ${message}`);
      if (telemetry) {
        this.emitter.emitImageSearchCompleted({
          ...telemetry,
          searchId,
          stageName: PIPELINE_STAGES.IMAGE_RETRIEVAL,
          query,
          resultCount: 0,
          selectedAssetId: null,
          failed: true,
          errorMessage: message,
          durationMs: Date.now() - startedAt,
        });
      }
      return null;
    }
  }

  private emptyReference(
    queryUsed: string,
    attempts: string[],
    status: ImageRetrievalStatus,
  ): AssetReference {
    return {
      assetId: null,
      s3ObjectKey: null,
      signedUrl: null,
      imageUrl: null,
      caption: null,
      similarity: null,
      mimeType: null,
      status,
      queryUsed,
      attempts,
    };
  }

  /**
   * Pick exactly the top semantic hit (highest similarity / least distance).
   * No random rotation. If that asset was already used in this set, treat as a
   * miss so the cascade can try the next LLM-derived query.
   * When the only hit is already used and this is the sole result, still return
   * it so the card is not left blank after all attempts.
   */
  private selectTopSimilarityHit(
    results: SearchResultItem[],
    usedAssetIds?: Set<string>,
  ): SearchResultItem | null {
    if (!results.length) {
      return null;
    }

    const ranked = [...results].sort(
      (left, right) => (right.similarity ?? 0) - (left.similarity ?? 0),
    );
    const top = ranked[0];

    if (!usedAssetIds?.has(top.assetId)) {
      return top;
    }

    // Top hit already used — only fall through to a lower-ranked unused hit
    // when the search returned more than one (should not happen with limit=1).
    const unused = ranked.find((item) => !usedAssetIds.has(item.assetId));
    return unused ?? top;
  }

  private emitEmbeddingUsage(
    telemetry: PipelineTelemetryContext | undefined,
    query: string,
    response: SearchAssetsResponse,
  ): void {
    if (!telemetry || !response.usage || response.usage.fromCache) {
      return;
    }

    const invocationId = randomUUID();
    const model = response.usage.model || 'text-embedding-3-small';
    this.emitter.emitAiStarted({
      ...telemetry,
      invocationId,
      stageName: PIPELINE_STAGES.IMAGE_RETRIEVAL,
      provider: 'openai',
      model,
      purpose: FLASHCARD_IMAGE_SEARCH_EMBEDDING_PURPOSE,
      promptHash: hashPayload(query),
    });
    this.emitter.emitAiCompleted({
      ...telemetry,
      invocationId,
      stageName: PIPELINE_STAGES.IMAGE_RETRIEVAL,
      status: 'success',
      inputTokens: response.usage.inputTokens,
      totalTokens: response.usage.totalTokens,
      durationMs: response.usage.latencyMs,
    });
  }
}
