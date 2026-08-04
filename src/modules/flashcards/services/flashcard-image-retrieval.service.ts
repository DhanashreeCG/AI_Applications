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
import { S3StorageService } from '../../storage/s3-storage.service';
import {
  DEFAULT_IMAGE_CONCURRENCY,
  DEFAULT_SIGNED_URL_TTL_SECONDS,
  FLASHCARD_ASSET_IMAGE_PATH,
} from '../constants/flashcard.constants';
import {
  AssetReference,
  ImageRetrievalStatus,
} from '../interfaces/flashcard.interfaces';
import { FlashcardPipelineEmitter } from '../telemetry/flashcard-pipeline.events';

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
    const primary = input.queries[0] ?? '';
    const objectOnly = this.simplifyToObjectName(primary);
    const attempts: Array<{
      query: string;
      filters?: { ageGroups?: string[]; objects?: string[] };
      label: string;
    }> = [
      {
        query: primary,
        filters: this.buildAgeFilters(input.ageMin, input.ageMax),
        label: 'primary+age',
      },
      {
        query: this.simplifyQuery(primary),
        filters: this.buildAgeFilters(input.ageMin, input.ageMax),
        label: 'simplified+age',
      },
      {
        query: objectOnly,
        filters: {
          ...this.buildAgeFilters(input.ageMin, input.ageMax),
          objects: objectOnly ? [objectOnly] : undefined,
        },
        label: 'object-only',
      },
      {
        query: objectOnly || primary,
        label: 'unfiltered',
      },
    ];

    const attemptLabels: string[] = [];
    let lastStatus: ImageRetrievalStatus = 'not_found';

    for (const attempt of attempts) {
      if (!attempt.query.trim()) {
        continue;
      }
      attemptLabels.push(attempt.label);
      const searchId = randomUUID();
      const startedAt = Date.now();

      if (telemetry) {
        this.emitter.emitImageSearchStarted({
          ...telemetry,
          searchId,
          stageName: PIPELINE_STAGES.IMAGE_SEARCH,
          query: attempt.query,
          filters: attempt.filters as Record<string, unknown> | undefined,
        });
      }

      try {
        const response = await this.searchService.search({
          query: attempt.query,
          limit: 5,
          filters: attempt.filters,
        });

        const candidate = response.results.find(
          (item) => !input.usedAssetIds?.has(item.assetId),
        );
        if (!candidate) {
          lastStatus = 'not_found';
          if (telemetry) {
            this.emitter.emitImageSearchCompleted({
              ...telemetry,
              searchId,
              stageName: PIPELINE_STAGES.IMAGE_SEARCH,
              query: attempt.query,
              filters: attempt.filters as Record<string, unknown> | undefined,
              resultCount: response.results.length,
              selectedAssetId: null,
              cacheHit: response.fromCache === true,
              failed: false,
              durationMs: Date.now() - startedAt,
            });
          }
          continue;
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
            query: attempt.query,
            filters: attempt.filters as Record<string, unknown> | undefined,
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
          status:
            attempt.label === 'primary+age' ? 'found' : 'found_after_retry',
          queryUsed: attempt.query,
          attempts: attemptLabels,
        };
      } catch (error) {
        const message = getErrorMessage(error);
        lastStatus = /timeout/i.test(message) ? 'timeout' : 'error';
        this.logger.warn(
          `Image search attempt "${attempt.label}" failed: ${message}`,
        );
        if (telemetry) {
          this.emitter.emitImageSearchCompleted({
            ...telemetry,
            searchId,
            stageName: PIPELINE_STAGES.IMAGE_SEARCH,
            query: attempt.query,
            filters: attempt.filters as Record<string, unknown> | undefined,
            resultCount: 0,
            selectedAssetId: null,
            failed: true,
            errorMessage: message,
            durationMs: Date.now() - startedAt,
          });
        }
      }
    }

    return {
      assetId: null,
      s3ObjectKey: null,
      signedUrl: null,
      imageUrl: null,
      caption: null,
      similarity: null,
      mimeType: null,
      status: lastStatus,
      queryUsed: primary,
      attempts: attemptLabels,
    };
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

  private buildAgeFilters(
    ageMin: number | null,
    ageMax: number | null,
  ): { ageGroups?: string[] } | undefined {
    if (ageMin === null || ageMax === null) {
      return undefined;
    }
    return { ageGroups: [`${ageMin}-${ageMax}`] };
  }

  private simplifyQuery(query: string): string {
    return query
      .replace(/\b(cartoon|cute|simple|educational|illustration|image)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private simplifyToObjectName(query: string): string {
    const simplified = this.simplifyQuery(query);
    return simplified.split(/\s+/)[0] ?? simplified;
  }
}
