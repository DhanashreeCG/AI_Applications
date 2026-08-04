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
} from '../interfaces/flashcard.interfaces';
import {
  FlashcardPipelineEmitter,
  hashPayload,
} from '../telemetry/flashcard-pipeline.events';

interface RetrieveImagesInput {
  queries: string[];
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
    const primaryQuery = input.queries[0] ?? '';
    const attemptLabel = 'semantic';

    if (!primaryQuery.trim()) {
      return {
        assetId: null,
        s3ObjectKey: null,
        signedUrl: null,
        imageUrl: null,
        caption: null,
        similarity: null,
        mimeType: null,
        status: 'not_found',
        queryUsed: primaryQuery,
        attempts: [],
      };
    }

    const searchId = randomUUID();
    const startedAt = Date.now();

    if (telemetry) {
      this.emitter.emitImageSearchStarted({
        ...telemetry,
        searchId,
        stageName: PIPELINE_STAGES.IMAGE_SEARCH,
        query: primaryQuery,
      });
    }

    try {
      // Embedding search only — do not hard-filter ageGroups. Asset age labels
      // rarely equal the flashcard age band exactly, so filters were zeroing
      // out hits that the Search API returns for the same query.
      const response = await this.searchService.search({
        query: primaryQuery,
        limit: this.searchLimit,
      });

      this.emitEmbeddingUsage(telemetry, primaryQuery, response);

      const candidate = this.selectCandidate(
        response.results,
        input.ageMin,
        input.ageMax,
        input.usedAssetIds,
      );

      if (!candidate) {
        if (telemetry) {
          this.emitter.emitImageSearchCompleted({
            ...telemetry,
            searchId,
            stageName: PIPELINE_STAGES.IMAGE_SEARCH,
            query: primaryQuery,
            resultCount: response.results.length,
            selectedAssetId: null,
            cacheHit: response.fromCache === true,
            failed: false,
            durationMs: Date.now() - startedAt,
          });
        }

        return {
          assetId: null,
          s3ObjectKey: null,
          signedUrl: null,
          imageUrl: null,
          caption: null,
          similarity: null,
          mimeType: null,
          status: 'not_found',
          queryUsed: primaryQuery,
          attempts: [attemptLabel],
        };
      }

      // Claim before signed-URL await so concurrent cards don't race the same hit.
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
          stageName: PIPELINE_STAGES.IMAGE_SEARCH,
          query: primaryQuery,
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
        queryUsed: primaryQuery,
        attempts: [attemptLabel],
      };
    } catch (error) {
      const message = getErrorMessage(error);
      const status: ImageRetrievalStatus = /timeout/i.test(message)
        ? 'timeout'
        : 'error';
      this.logger.warn(`Image search failed: ${message}`);
      if (telemetry) {
        this.emitter.emitImageSearchCompleted({
          ...telemetry,
          searchId,
          stageName: PIPELINE_STAGES.IMAGE_SEARCH,
          query: primaryQuery,
          resultCount: 0,
          selectedAssetId: null,
          failed: true,
          errorMessage: message,
          durationMs: Date.now() - startedAt,
        });
      }

      return {
        assetId: null,
        s3ObjectKey: null,
        signedUrl: null,
        imageUrl: null,
        caption: null,
        similarity: null,
        mimeType: null,
        status,
        queryUsed: primaryQuery,
        attempts: [attemptLabel],
      };
    }
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

  /**
   * Prefer unused hits whose age band overlaps the request; otherwise any
   * unused nearby embedding hit; otherwise the top hit (still attach an image).
   */
  private selectCandidate(
    results: SearchResultItem[],
    ageMin: number | null,
    ageMax: number | null,
    usedAssetIds?: Set<string>,
  ): SearchResultItem | null {
    if (!results.length) {
      return null;
    }

    const ranked = this.rankByAgePreference(results, ageMin, ageMax);
    const unused = ranked.find((item) => !usedAssetIds?.has(item.assetId));
    return unused ?? ranked[0] ?? null;
  }

  private rankByAgePreference(
    results: SearchResultItem[],
    ageMin: number | null,
    ageMax: number | null,
  ): SearchResultItem[] {
    if (ageMin === null || ageMax === null) {
      return results;
    }

    const overlapping: SearchResultItem[] = [];
    const rest: SearchResultItem[] = [];
    for (const item of results) {
      if (this.ageGroupsOverlap(item.ageGroups, ageMin, ageMax)) {
        overlapping.push(item);
      } else {
        rest.push(item);
      }
    }
    return overlapping.length ? [...overlapping, ...rest] : results;
  }

  private ageGroupsOverlap(
    ageGroups: string[] | undefined,
    ageMin: number,
    ageMax: number,
  ): boolean {
    if (!ageGroups?.length) {
      return false;
    }
    for (const group of ageGroups) {
      const match = group.match(/(\d+)\s*-\s*(\d+)/);
      if (!match) {
        continue;
      }
      const groupMin = Number(match[1]);
      const groupMax = Number(match[2]);
      if (groupMin <= ageMax && groupMax >= ageMin) {
        return true;
      }
    }
    return false;
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
      stageName: PIPELINE_STAGES.IMAGE_SEARCH,
      provider: 'openai',
      model,
      purpose: FLASHCARD_IMAGE_SEARCH_EMBEDDING_PURPOSE,
      promptHash: hashPayload(query),
    });
    this.emitter.emitAiCompleted({
      ...telemetry,
      invocationId,
      stageName: PIPELINE_STAGES.IMAGE_SEARCH,
      status: 'success',
      inputTokens: response.usage.inputTokens,
      totalTokens: response.usage.totalTokens,
      durationMs: response.usage.latencyMs,
    });
  }
}
