import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import { SearchService } from '../../search/search.service';
import type { SearchAssetsResponse } from '../../search/interfaces/search-result.interface';
import { S3StorageService } from '../../storage/s3-storage.service';
import {
  PIPELINE_STAGES,
  PipelineTelemetryContext,
} from '../../../common/events/pipeline-tracker.events';
import {
  mapWithConcurrency,
  WORKSHEET_ASSET_IMAGE_PATH,
  WORKSHEET_IMAGE_SEARCH_EMBEDDING_PURPOSE,
} from '../constants/worksheet.constants';
import { ResolvedAssetSlot } from '../types/worksheet.types';
import { collectImageQueries, setValueAtPath } from '../utils/structure.util';
import {
  WorksheetPipelineEmitter,
  hashPayload,
} from '../telemetry/worksheet-pipeline.events';

@Injectable()
export class WorksheetAssetService {
  private readonly logger = new Logger(WorksheetAssetService.name);
  private readonly concurrency: number;
  private readonly searchLimit: number;
  private readonly signedUrlTtlSeconds: number;
  private readonly apiBaseUrl: string;
  private readonly emitter: WorksheetPipelineEmitter;

  constructor(
    private readonly searchService: SearchService,
    private readonly s3StorageService: S3StorageService,
    private readonly configService: ConfigService,
    eventEmitter: EventEmitter2,
  ) {
    this.concurrency =
      this.configService.get<number>('worksheets.imageConcurrency') ?? 3;
    this.searchLimit =
      this.configService.get<number>('worksheets.imageSearchLimit') ?? 1;
    this.signedUrlTtlSeconds =
      this.configService.get<number>('worksheets.signedUrlTtlSeconds') ?? 3600;
    this.apiBaseUrl = (
      this.configService.get<string>('worksheets.renderer.apiBaseUrl') ??
      'http://localhost:3000'
    ).replace(/\/$/, '');
    this.emitter = new WorksheetPipelineEmitter(eventEmitter);
  }

  public async attachAssets(
    structure: Record<string, unknown>,
    options?: { grades?: string[]; ageGroups?: string[] },
    telemetry?: PipelineTelemetryContext,
  ): Promise<{ structure: Record<string, unknown>; slots: ResolvedAssetSlot[] }> {
    const queries = collectImageQueries(structure);
    const uniqueParents = new Map<string, { path: string; query: string }>();
    for (const item of queries) {
      uniqueParents.set(item.parentPath, {
        path: item.parentPath,
        query: item.query,
      });
    }

    const slots = await mapWithConcurrency(
      [...uniqueParents.values()],
      this.concurrency,
      async (item) => this.resolveSlot(item.query, item.path, options, telemetry),
    );

    let next = structure;
    for (const slot of slots) {
      next = this.applySlot(next, slot);
    }

    return { structure: next, slots };
  }

  public applySlot(
    structure: Record<string, unknown>,
    slot: ResolvedAssetSlot,
  ): Record<string, unknown> {
    const fields: Record<string, string> = {};
    if (slot.assetId) fields.assetId = slot.assetId;
    if (slot.imageUrl) fields.imageUrl = slot.imageUrl;
    if (slot.assetUrl) fields.assetUrl = slot.assetUrl;
    if (slot.signedUrl) fields.signedUrl = slot.signedUrl;
    if (!Object.keys(fields).length) {
      return structure;
    }

    let next = structure;
    for (const [key, value] of Object.entries(fields)) {
      if (slot.path === '') {
        next = { ...next, [key]: value };
      } else {
        next = setValueAtPath(next, `${slot.path}.${key}`, value);
      }
    }
    return next;
  }

  public async resolveSlot(
    imageQuery: string,
    path: string,
    options?: { grades?: string[]; ageGroups?: string[] },
    telemetry?: PipelineTelemetryContext,
  ): Promise<ResolvedAssetSlot> {
    const query = imageQuery.trim();
    if (!query) {
      return this.emptySlot(path, query);
    }

    const searchId = randomUUID();
    const startedAt = Date.now();
    const filters = {
      grades: options?.grades?.filter(Boolean),
      ageGroups: options?.ageGroups?.filter(Boolean),
    };
    const hasFilters = Boolean(filters.grades?.length || filters.ageGroups?.length);

    if (telemetry) {
      this.emitter.emitImageSearchStarted({
        ...telemetry,
        searchId,
        stageName: PIPELINE_STAGES.IMAGE_RETRIEVAL,
        query,
        filters: hasFilters ? filters : undefined,
      });
    }

    try {
      let response = await this.searchService.search({
        query,
        limit: this.searchLimit,
        filters: hasFilters ? filters : undefined,
      });
      this.emitEmbeddingUsage(telemetry, query, response);

      if (!response.results.length && hasFilters) {
        this.logger.warn(
          `No filtered asset for "${query}" at ${path}; retrying without grade/age filters`,
        );
        response = await this.searchService.search({
          query,
          limit: this.searchLimit,
        });
        this.emitEmbeddingUsage(telemetry, query, response);
      }

      const hit = response.results[0];
      const slot = hit
        ? await this.toResolvedSlot(path, query, hit)
        : this.emptySlot(path, query);

      if (!slot.assetId) {
        this.logger.warn(`No asset found for imageQuery "${query}" at ${path}`);
      }

      if (telemetry) {
        this.emitter.emitImageSearchCompleted({
          ...telemetry,
          searchId,
          stageName: PIPELINE_STAGES.IMAGE_RETRIEVAL,
          query,
          filters: hasFilters ? filters : undefined,
          resultCount: response.results.length,
          selectedAssetId: slot.assetId,
          cacheHit: response.fromCache === true,
          failed: false,
          durationMs: Date.now() - startedAt,
        });
      }
      return slot;
    } catch (error) {
      this.logger.warn(
        `Asset search failed for imageQuery "${query}" at ${path}`,
      );
      if (telemetry) {
        this.emitter.emitImageSearchCompleted({
          ...telemetry,
          searchId,
          stageName: PIPELINE_STAGES.IMAGE_RETRIEVAL,
          query,
          filters: hasFilters ? filters : undefined,
          resultCount: 0,
          selectedAssetId: null,
          failed: true,
          errorMessage: 'Asset search failed',
          durationMs: Date.now() - startedAt,
        });
      }
      return this.emptySlot(path, query);
    }
  }

  private async toResolvedSlot(
    path: string,
    imageQuery: string,
    hit: { assetId: string; s3ObjectKey?: string },
  ): Promise<ResolvedAssetSlot> {
    const imageUrl = `${this.apiBaseUrl}${WORKSHEET_ASSET_IMAGE_PATH}/${hit.assetId}/image`;
    let signedUrl: string | null = null;
    if (hit.s3ObjectKey) {
      try {
        signedUrl = await this.s3StorageService.getSignedUrl(
          hit.s3ObjectKey,
          this.signedUrlTtlSeconds,
        );
      } catch (error) {
        this.logger.warn(
          `Signed URL failed for worksheet asset ${hit.assetId}`,
        );
      }
    }

    return {
      path,
      imageQuery,
      assetId: hit.assetId,
      imageUrl,
      assetUrl: imageUrl,
      signedUrl,
    };
  }

  private emptySlot(path: string, imageQuery: string): ResolvedAssetSlot {
    return {
      path,
      imageQuery,
      assetId: null,
      imageUrl: null,
      assetUrl: null,
      signedUrl: null,
    };
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
      purpose: WORKSHEET_IMAGE_SEARCH_EMBEDDING_PURPOSE,
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
