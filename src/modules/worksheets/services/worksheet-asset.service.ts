import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import { SearchService } from '../../search/search.service';
import type { SearchAssetsResponse } from '../../search/interfaces/search-result.interface';
import {
  PIPELINE_STAGES,
  PipelineTelemetryContext,
} from '../../../common/events/pipeline-tracker.events';
import {
  mapWithConcurrency,
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
  private readonly emitter: WorksheetPipelineEmitter;

  constructor(
    private readonly searchService: SearchService,
    private readonly configService: ConfigService,
    eventEmitter: EventEmitter2,
  ) {
    this.concurrency =
      this.configService.get<number>('worksheets.imageConcurrency') ?? 3;
    this.searchLimit =
      this.configService.get<number>('worksheets.imageSearchLimit') ?? 1;
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
      if (!slot.assetId) {
        continue;
      }
      if (slot.path === '') {
        next = { ...next, assetId: slot.assetId };
      } else {
        next = setValueAtPath(next, `${slot.path}.assetId`, slot.assetId);
      }
    }

    return { structure: next, slots };
  }

  public async resolveSlot(
    imageQuery: string,
    path: string,
    options?: { grades?: string[]; ageGroups?: string[] },
    telemetry?: PipelineTelemetryContext,
  ): Promise<ResolvedAssetSlot> {
    const query = imageQuery.trim();
    if (!query) {
      return { path, imageQuery: query, assetId: null };
    }

    const searchId = randomUUID();
    const startedAt = Date.now();
    const filters = {
      grades: options?.grades,
      ageGroups: options?.ageGroups,
    };

    if (telemetry) {
      this.emitter.emitImageSearchStarted({
        ...telemetry,
        searchId,
        stageName: PIPELINE_STAGES.IMAGE_RETRIEVAL,
        query,
        filters,
      });
    }

    try {
      const response = await this.searchService.search({
        query,
        limit: this.searchLimit,
        filters,
      });
      this.emitEmbeddingUsage(telemetry, query, response);
      const assetId = response.results[0]?.assetId ?? null;
      if (!assetId) {
        this.logger.warn(`No asset found for imageQuery "${query}" at ${path}`);
      }
      if (telemetry) {
        this.emitter.emitImageSearchCompleted({
          ...telemetry,
          searchId,
          stageName: PIPELINE_STAGES.IMAGE_RETRIEVAL,
          query,
          filters,
          resultCount: response.results.length,
          selectedAssetId: assetId,
          cacheHit: response.fromCache === true,
          failed: false,
          durationMs: Date.now() - startedAt,
        });
      }
      return { path, imageQuery: query, assetId };
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
          filters,
          resultCount: 0,
          selectedAssetId: null,
          failed: true,
          errorMessage: 'Asset search failed',
          durationMs: Date.now() - startedAt,
        });
      }
      return { path, imageQuery: query, assetId: null };
    }
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
