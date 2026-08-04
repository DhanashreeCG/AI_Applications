import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PipelineExecutionStatus,
  PipelineStageStatus,
  Prisma,
} from '@generated/prisma/client';
import {
  AiInvocationCompletedPayload,
  AiInvocationStartedPayload,
  ImageSearchCompletedPayload,
  ImageSearchStartedPayload,
  PipelineGenericEventPayload,
  PipelineStartedPayload,
  PipelineTerminalPayload,
  StageLifecyclePayload,
} from '../../../common/events/pipeline-tracker.events';
import { getErrorMessage } from '../../../common/utils/error-message';
import { StructuredLoggerService } from '../../observability/structured-logger.service';
import { resolvePipelineTrackerConfig } from '../config/pipeline-tracker.config';
import {
  OTEL_ADAPTER,
  SENTRY_ADAPTER,
} from '../pipeline-tracker.constants';
import type {
  OtelAdapter,
  PipelineTrackerPort,
  SentryAdapter,
} from '../interfaces/pipeline-tracker.interface';
import { PipelineTrackerRepository } from '../repository/pipeline-tracker.repository';
import { PipelineTrackerMetricsService } from './pipeline-tracker-metrics.service';

@Injectable()
export class PipelineTrackerService implements PipelineTrackerPort {
  private readonly enabled: boolean;
  private readonly storeAiPayload: boolean;
  private readonly logger: StructuredLoggerService;
  private readonly queues = new Map<string, Promise<void>>();

  constructor(
    private readonly configService: ConfigService,
    private readonly repository: PipelineTrackerRepository,
    private readonly metrics: PipelineTrackerMetricsService,
    structuredLogger: StructuredLoggerService,
    @Inject(OTEL_ADAPTER) private readonly otel: OtelAdapter,
    @Inject(SENTRY_ADAPTER) private readonly sentry: SentryAdapter,
  ) {
    const config = resolvePipelineTrackerConfig({
      enabled: this.configService.get<boolean>('pipelineTracking.enabled'),
      storeAiPayload: this.configService.get<boolean>(
        'pipelineTracking.storeAiPayload',
      ),
      workflowDefault: this.configService.get<string>(
        'pipelineTracking.workflowDefault',
      ),
    });
    this.enabled = config.enabled;
    this.storeAiPayload = config.storeAiPayload;
    this.logger = structuredLogger.child('PipelineTracker');
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public async startPipeline(payload: PipelineStartedPayload): Promise<void> {
    if (!this.enabled) return;
    await this.safe(payload.executionId, async () => {
      await this.repository.createExecution({
        id: payload.executionId,
        requestId: payload.requestId,
        correlationId: payload.correlationId,
        workflowType: payload.workflowType,
        metadata: payload.metadata as Prisma.InputJsonValue | undefined,
      });
      this.metrics.onPipelineStarted();
      this.otel.attachContext(payload.executionId, payload.correlationId);
      this.sentry.setContext({
        executionId: payload.executionId,
        requestId: payload.requestId,
        topic: payload.metadata?.topic as string | undefined,
        ageGroup: payload.metadata?.ageGroup as string | undefined,
        templateId: payload.metadata?.templateId as string | undefined,
      });
      this.logger.log('Pipeline started', this.baseFields(payload));
    });
  }

  public async completePipeline(
    payload: PipelineTerminalPayload,
  ): Promise<void> {
    if (!this.enabled) return;
    await this.safe(payload.executionId, async () => {
      const rollups = await this.repository.getExecutionUsageRollups(
        payload.executionId,
      );
      const updated = await this.repository.finishExecution({
        id: payload.executionId,
        status: PipelineExecutionStatus.completed,
        currentStage: 'completed',
        metadata: {
          ...(payload.metadata ?? {}),
          ...rollups,
        } as Prisma.InputJsonValue,
      });
      this.metrics.onPipelineCompleted(updated.totalDurationMs ?? 0);
      if (payload.metadata?.templateId) {
        this.metrics.onTemplateUsed(String(payload.metadata.templateId));
      }
      this.logger.log('Pipeline completed', {
        ...this.baseFields(payload),
        duration_ms: updated.totalDurationMs ?? undefined,
        status: 'completed',
      });
    });
  }

  public async failPipeline(payload: PipelineTerminalPayload): Promise<void> {
    if (!this.enabled) return;
    await this.safe(payload.executionId, async () => {
      const updated = await this.repository.finishExecution({
        id: payload.executionId,
        status: PipelineExecutionStatus.failed,
        currentStage: 'failed',
        metadata: {
          ...(payload.metadata ?? {}),
          errorMessage: payload.errorMessage,
        } as Prisma.InputJsonValue,
      });
      this.metrics.onPipelineFailed(updated.totalDurationMs ?? undefined);
      this.logger.error('Pipeline failed', {
        ...this.baseFields(payload),
        duration_ms: updated.totalDurationMs ?? undefined,
        status: 'failed',
        error_message: payload.errorMessage,
      });
    });
  }

  public async startStage(payload: StageLifecyclePayload): Promise<void> {
    if (!this.enabled) return;
    await this.safe(payload.executionId, async () => {
      const sequence = await this.repository.nextSequence(payload.executionId);
      await this.repository.createStage({
        executionId: payload.executionId,
        stageName: payload.stageName,
        sequence,
        status: PipelineStageStatus.running,
        metadata: payload.metadata as Prisma.InputJsonValue | undefined,
        retryCount: payload.retryCount,
      });
      await this.repository.setCurrentStage(
        payload.executionId,
        payload.stageName,
      );
      this.sentry.setContext({
        executionId: payload.executionId,
        requestId: payload.requestId,
        stage: payload.stageName,
      });
      this.logger.log('Stage started', {
        ...this.baseFields(payload),
        stage: payload.stageName,
        status: 'running',
      });
    });
  }

  public async completeStage(payload: StageLifecyclePayload): Promise<void> {
    if (!this.enabled) return;
    await this.safe(payload.executionId, async () => {
      const stage = await this.repository.findLatestOpenStage(
        payload.executionId,
        payload.stageName,
      );
      if (!stage) {
        const sequence = await this.repository.nextSequence(payload.executionId);
        const created = await this.repository.createStage({
          executionId: payload.executionId,
          stageName: payload.stageName,
          sequence,
          status: PipelineStageStatus.running,
          metadata: payload.metadata as Prisma.InputJsonValue | undefined,
        });
        const updated = await this.repository.completeStage({
          id: created.id,
          status: PipelineStageStatus.completed,
          metadata: payload.metadata as Prisma.InputJsonValue | undefined,
        });
        if (typeof updated.durationMs === 'number') {
          this.metrics.onStageCompleted(payload.stageName, updated.durationMs);
        }
        return;
      }
      const updated = await this.repository.completeStage({
        id: stage.id,
        status: PipelineStageStatus.completed,
        metadata: payload.metadata as Prisma.InputJsonValue | undefined,
      });
      if (typeof updated.durationMs === 'number') {
        this.metrics.onStageCompleted(payload.stageName, updated.durationMs);
      }
      this.logger.log('Stage completed', {
        ...this.baseFields(payload),
        stage: payload.stageName,
        duration_ms: updated.durationMs ?? undefined,
        status: 'completed',
      });
    });
  }

  public async failStage(payload: StageLifecyclePayload): Promise<void> {
    if (!this.enabled) return;
    await this.safe(payload.executionId, async () => {
      const stage = await this.repository.findLatestOpenStage(
        payload.executionId,
        payload.stageName,
      );
      if (!stage) {
        const sequence = await this.repository.nextSequence(payload.executionId);
        await this.repository.createStage({
          executionId: payload.executionId,
          stageName: payload.stageName,
          sequence,
          status: PipelineStageStatus.failed,
          metadata: {
            ...(payload.metadata ?? {}),
            errorMessage: payload.errorMessage,
          } as Prisma.InputJsonValue,
          retryCount: payload.retryCount,
        });
      } else {
        await this.repository.completeStage({
          id: stage.id,
          status: PipelineStageStatus.failed,
          metadata: payload.metadata as Prisma.InputJsonValue | undefined,
          errorMessage: payload.errorMessage,
        });
      }
      this.metrics.onPipelineFailed();
      if (payload.retryCount) {
        this.metrics.onRetry(payload.retryCount);
      }
      this.logger.warn('Stage failed', {
        ...this.baseFields(payload),
        stage: payload.stageName,
        status: 'failed',
        error_message: payload.errorMessage,
      });
    });
  }

  public async skipStage(payload: StageLifecyclePayload): Promise<void> {
    if (!this.enabled) return;
    await this.safe(payload.executionId, async () => {
      const sequence = await this.repository.nextSequence(payload.executionId);
      await this.repository.createStage({
        executionId: payload.executionId,
        stageName: payload.stageName,
        sequence,
        status: PipelineStageStatus.skipped,
        metadata: payload.metadata as Prisma.InputJsonValue | undefined,
      });
      this.logger.log('Stage skipped', {
        ...this.baseFields(payload),
        stage: payload.stageName,
        status: 'skipped',
      });
    });
  }

  public async recordAiInvocationStart(
    payload: AiInvocationStartedPayload,
  ): Promise<void> {
    if (!this.enabled) return;
    await this.safe(payload.executionId, async () => {
      const stage = payload.stageName
        ? await this.repository.findLatestOpenStage(
            payload.executionId,
            payload.stageName,
          )
        : null;
      await this.repository.createAiInvocation({
        id: payload.invocationId,
        executionId: payload.executionId,
        stageExecutionId: stage?.id,
        provider: payload.provider,
        model: payload.model,
        purpose: payload.purpose,
        promptHash: payload.promptHash,
        promptPayload: this.storeAiPayload
          ? (payload.promptPayload as Prisma.InputJsonValue | undefined)
          : undefined,
        retryCount: payload.retryCount,
      });
      this.logger.log('AI invocation started', {
        ...this.baseFields(payload),
        stage: payload.stageName,
        provider: payload.provider,
        model: payload.model,
        status: 'running',
      });
    });
  }

  public async recordAiInvocationComplete(
    payload: AiInvocationCompletedPayload,
  ): Promise<void> {
    if (!this.enabled) return;
    await this.safe(payload.executionId, async () => {
      const updated = await this.repository.finishAiInvocation({
        id: payload.invocationId,
        status: payload.status,
        responseHash: payload.responseHash,
        // Always persist response payloads (e.g. flashcard JSON); prompts stay gated.
        responsePayload: payload.responsePayload as
          | Prisma.InputJsonValue
          | undefined,
        inputTokens: payload.inputTokens,
        outputTokens: payload.outputTokens,
        totalTokens: payload.totalTokens,
        estimatedCost: payload.estimatedCost,
        durationMs: payload.durationMs,
      });
      if (updated.purpose === 'flashcard_image_search_embedding') {
        this.metrics.onEmbeddingCall(updated.durationMs ?? undefined);
      } else {
        this.metrics.onAiCall(updated.durationMs ?? undefined);
      }
      this.logger.log('AI invocation completed', {
        ...this.baseFields(payload),
        stage: payload.stageName,
        duration_ms: updated.durationMs ?? undefined,
        status: payload.status,
      });
    });
  }

  public async recordImageSearchStart(
    payload: ImageSearchStartedPayload,
  ): Promise<void> {
    if (!this.enabled) return;
    await this.safe(payload.executionId, async () => {
      const stage = payload.stageName
        ? await this.repository.findLatestOpenStage(
            payload.executionId,
            payload.stageName,
          )
        : null;
      await this.repository.createImageSearch({
        id: payload.searchId,
        executionId: payload.executionId,
        stageExecutionId: stage?.id,
        query: payload.query,
        filters: payload.filters as Prisma.InputJsonValue | undefined,
      });
    });
  }

  public async recordImageSearchComplete(
    payload: ImageSearchCompletedPayload,
  ): Promise<void> {
    if (!this.enabled) return;
    await this.safe(payload.executionId, async () => {
      await this.repository.completeImageSearch({
        id: payload.searchId,
        resultCount: payload.resultCount,
        selectedAssetId: payload.selectedAssetId,
        cacheHit: payload.cacheHit,
        failed: payload.failed,
        errorMessage: payload.errorMessage,
        durationMs: payload.durationMs,
      });
      this.metrics.onImageSearch(payload.durationMs);
      this.logger.log('Image search completed', {
        ...this.baseFields(payload),
        stage: payload.stageName,
        duration_ms: payload.durationMs,
        status: payload.failed ? 'failed' : 'completed',
      });
    });
  }

  public async recordEvent(payload: PipelineGenericEventPayload): Promise<void> {
    if (!this.enabled) return;
    await this.safe(payload.executionId, async () => {
      this.logger.log('Pipeline event', {
        ...this.baseFields(payload),
        event_name: payload.name,
        status: 'recorded',
      });
    });
  }

  public getMetricsSnapshot() {
    return this.metrics.getSnapshot();
  }

  public findExecutionById(id: string) {
    return this.repository.findExecutionById(id);
  }

  public findExecutionsByRequestId(requestId: string) {
    return this.repository.findExecutionsByRequestId(requestId);
  }

  public findRecentExecutions(input: {
    limit?: number;
    status?: string;
    workflowType?: string;
  }) {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    return this.repository.findRecentExecutions({
      limit,
      status: input.status?.trim() || undefined,
      workflowType: input.workflowType?.trim() || undefined,
    });
  }

  private baseFields(payload: {
    executionId: string;
    requestId: string;
    correlationId: string;
    workflowType: string;
  }) {
    return {
      execution_id: payload.executionId,
      request_id: payload.requestId,
      correlation_id: payload.correlationId,
      workflow_type: payload.workflowType,
    };
  }

  private async safe(
    executionId: string,
    work: () => Promise<void>,
  ): Promise<void> {
    const previous = this.queues.get(executionId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        try {
          await work();
        } catch (error) {
          this.logger.error(
            'Pipeline tracker operation failed',
            {
              execution_id: executionId,
              status: 'tracker_error',
            },
            error,
          );
          void getErrorMessage(error);
        }
      });
    this.queues.set(executionId, next);
    await next;
    if (this.queues.get(executionId) === next) {
      this.queues.delete(executionId);
    }
  }
}
