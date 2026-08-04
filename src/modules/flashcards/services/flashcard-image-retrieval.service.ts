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
import type { SearchAssetsResponse } from '../../search/interfaces/search-result.interface';
import { S3StorageService } from '../../storage/s3-storage.service';
import {
  DEFAULT_IMAGE_CONCURRENCY,
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
    const filters = this.buildAgeFilters(input.ageMin, input.ageMax);
    const attemptLabel = 'primary+age';

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
        filters: filters as Record<string, unknown> | undefined,
      });
    }

    try {
      const response = await this.searchService.search({
        query: primaryQuery,
        limit: 1,
        filters,
      });

      this.emitEmbeddingUsage(telemetry, primaryQuery, response);

      const top = response.results[0];
      const candidate =
        top && !input.usedAssetIds?.has(top.assetId) ? top : null;

      if (!candidate) {
        if (telemetry) {
          this.emitter.emitImageSearchCompleted({
            ...telemetry,
            searchId,
            stageName: PIPELINE_STAGES.IMAGE_SEARCH,
            query: primaryQuery,
            filters: filters as Record<string, unknown> | undefined,
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

      input.usedAssetIds?.add(candidate.assetId);

      if (telemetry) {
        this.emitter.emitImageSearchCompleted({
          ...telemetry,
          searchId,
          stageName: PIPELINE_STAGES.IMAGE_SEARCH,
          query: primaryQuery,
          filters: filters as Record<string, unknown> | undefined,
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
          filters: filters as Record<string, unknown> | undefined,
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

  private buildAgeFilters(
    ageMin: number | null,
    ageMax: number | null,
  ): { ageGroups?: string[] } | undefined {
    if (ageMin === null || ageMax === null) {
      return undefined;
    }
    return { ageGroups: [`${ageMin}-${ageMax}`] };
  }
}
