import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssetState as DatabaseAssetState } from '@generated/prisma/client';
import { AssetState } from '../../../common/enums/asset-state.enum';
import { BaseSqsMessage, DlqMessage } from '../../../common/interfaces/sqs-messages.interface';
import { PrismaService } from '../../database/prisma.service';
import { SqsQueueService } from '../../queue/sqs-queue.service';
import { getQueueForStage } from '../../queue/queue-topology.constants';
import {
  DEFAULT_BACKOFF_BASE_SECONDS,
  DEFAULT_BACKOFF_MAX_SECONDS,
  DEFAULT_PIPELINE_MAX_ATTEMPTS,
} from '../constants/pipeline.constants';
import { classifyProcessingError } from '../utils/error-classifier.util';
import { calculateRetryDelaySeconds } from '../utils/retry-backoff.util';
import { getErrorMessage } from '../../../common/utils/error-message';
import { StructuredLoggerService } from '../../observability/structured-logger.service';
import { PipelineMetricsService } from '../../observability/pipeline-metrics.service';
import { buildPipelineLogFields } from '../../observability/utils/pipeline-log-fields.util';

export interface PipelineFailureContext {
  stage: AssetState;
  message: BaseSqsMessage;
  error: unknown;
  sqsMessageId?: string;
  durationMs?: number;
}

@Injectable()
export class PipelineRetryService {
  private readonly logger = new StructuredLoggerService(PipelineRetryService.name);
  private readonly maxAttempts: number;
  private readonly backoffBaseSeconds: number;
  private readonly backoffMaxSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sqsQueue: SqsQueueService,
    configService: ConfigService,
    private readonly metrics: PipelineMetricsService,
  ) {
    this.maxAttempts =
      configService.get<number>('pipeline.maxAttempts') ??
      DEFAULT_PIPELINE_MAX_ATTEMPTS;
    this.backoffBaseSeconds =
      configService.get<number>('pipeline.backoffBaseSeconds') ??
      DEFAULT_BACKOFF_BASE_SECONDS;
    this.backoffMaxSeconds =
      configService.get<number>('pipeline.backoffMaxSeconds') ??
      DEFAULT_BACKOFF_MAX_SECONDS;
  }

  public async handleFailure(context: PipelineFailureContext): Promise<void> {
    const classification = classifyProcessingError(context.error);
    const stackTrace =
      context.error instanceof Error ? context.error.stack : undefined;

    await this.recordAttempt({
      ...context,
      status: 'FAILED',
      errorCode: classification.errorCode,
      errorMessage: classification.errorMessage,
      stackTrace,
    });

    const shouldRetry =
      classification.retryable && context.message.attempt < this.maxAttempts;

    if (shouldRetry) {
      await this.scheduleRetry(context, classification.errorMessage);
      return;
    }

    await this.moveToDeadLetter(context, classification);
  }

  public async replayFromDlq(message: DlqMessage): Promise<string> {
    const targetQueue = getQueueForStage(message.failedStage);
    if (!targetQueue) {
      throw new Error(
        `Cannot replay DLQ message: no queue mapped for stage ${message.failedStage}`,
      );
    }

    const ingestionFile = await this.prisma.ingestionFile.findUnique({
      where: { id: message.ingestionFileId },
    });
    if (!ingestionFile) {
      throw new Error(
        `Cannot replay DLQ message: ingestion file ${message.ingestionFileId} not found`,
      );
    }

    const asset = message.assetId
      ? await this.prisma.asset.findUnique({ where: { id: message.assetId } })
      : null;

    const base = {
      jobId: message.jobId,
      ingestionFileId: message.ingestionFileId,
      assetId: message.assetId,
      traceId: message.traceId,
      attempt: 1,
      timestamp: new Date().toISOString(),
    };

    let messageId: string;

    switch (targetQueue) {
      case 'ingestion':
        messageId = await this.sqsQueue.dispatchIngestion({
          ...base,
          driveFileId: ingestionFile.driveFileId,
          stage: message.failedStage as AssetState.DISCOVERED | AssetState.DOWNLOADING,
        });
        break;
      case 's3Upload':
        if (!asset) {
          throw new Error('Cannot replay s3Upload stage without assetId');
        }
        messageId = await this.sqsQueue.dispatchS3Upload({
          ...base,
          assetId: asset.id,
          contentHash: asset.contentHash,
        });
        break;
      case 'aiMetadata':
        if (!asset) {
          throw new Error('Cannot replay aiMetadata stage without assetId');
        }
        messageId = await this.sqsQueue.dispatchAiMetadata({
          ...base,
          assetId: asset.id,
          s3ObjectKey: asset.s3ObjectKey,
          contentHash: asset.contentHash,
        });
        break;
      case 'embedding': {
        if (!asset) {
          throw new Error('Cannot replay embedding stage without assetId');
        }
        const metadata = await this.prisma.assetMetadata.findUnique({
          where: { assetId: asset.id },
        });
        if (!metadata) {
          throw new Error(
            `Cannot replay embedding stage: metadata missing for asset ${asset.id}`,
          );
        }
        messageId = await this.sqsQueue.dispatchEmbedding({
          ...base,
          assetId: asset.id,
          searchDescription: metadata.searchDescription,
          metadataVersion: metadata.metadataVersion,
        });
        break;
      }
      default:
        throw new Error(`Unsupported replay queue: ${targetQueue}`);
    }

    if (message.assetId) {
      await this.prisma.asset.update({
        where: { id: message.assetId },
        data: { status: message.failedStage as DatabaseAssetState },
      });
    }

    await this.prisma.ingestionFile.update({
      where: { id: message.ingestionFileId },
      data: {
        status: message.failedStage as DatabaseAssetState,
        errorMessage: null,
      },
    });

    this.logger.log(
      'DLQ message replayed',
      buildPipelineLogFields(message, message.failedStage, {
        status: 'replayed',
        target_queue: targetQueue,
      }),
    );

    return messageId;
  }

  private async scheduleRetry(
    context: PipelineFailureContext,
    errorMessage: string,
  ): Promise<void> {
    const nextAttempt = context.message.attempt + 1;
    const delaySeconds = calculateRetryDelaySeconds(
      nextAttempt,
      this.backoffBaseSeconds,
      this.backoffMaxSeconds,
    );
    const queueName = this.resolveRetryQueue(context.stage);

    const retryMessage = {
      ...context.message,
      attempt: nextAttempt,
      timestamp: new Date().toISOString(),
    };

    await this.sqsQueue.sendMessage(queueName, retryMessage as never, {
      delaySeconds,
    });

    if (context.message.assetId) {
      await this.prisma.asset.update({
        where: { id: context.message.assetId },
        data: { status: DatabaseAssetState.RETRY_PENDING },
      });
    }

    await this.prisma.ingestionFile.update({
      where: { id: context.message.ingestionFileId },
      data: {
        status: DatabaseAssetState.RETRY_PENDING,
        errorMessage,
      },
    });

    this.metrics.incrementRetries();

    this.logger.warn(
      'Pipeline retry scheduled',
      buildPipelineLogFields(context.message, context.stage, {
        sqs_message_id: context.sqsMessageId,
        duration_ms: context.durationMs,
        status: 'retry_scheduled',
        retry_attempt: nextAttempt,
        max_attempts: this.maxAttempts,
        delay_seconds: delaySeconds,
        error_message: errorMessage,
      }),
    );
  }

  private async moveToDeadLetter(
    context: PipelineFailureContext,
    classification: { errorCode: string; errorMessage: string },
  ): Promise<void> {
    const stackTrace =
      context.error instanceof Error ? context.error.stack : undefined;

    await this.sqsQueue.dispatchToDlq({
      jobId: context.message.jobId,
      ingestionFileId: context.message.ingestionFileId,
      assetId: context.message.assetId,
      traceId: context.message.traceId,
      failedStage: context.stage,
      errorCode: classification.errorCode,
      errorMessage: classification.errorMessage,
      stackTrace,
      attempt: context.message.attempt,
    });

    if (context.message.assetId) {
      await this.prisma.asset.update({
        where: { id: context.message.assetId },
        data: { status: DatabaseAssetState.DEAD_LETTER },
      });
    }

    await this.prisma.ingestionFile.update({
      where: { id: context.message.ingestionFileId },
      data: {
        status: DatabaseAssetState.DEAD_LETTER,
        errorMessage: classification.errorMessage,
      },
    });

    await this.prisma.ingestionJob.update({
      where: { id: context.message.jobId },
      data: { totalFailed: { increment: 1 } },
    });

    this.metrics.incrementDlq();
    this.metrics.incrementFailed();

    this.logger.error(
      'Asset moved to DLQ',
      buildPipelineLogFields(context.message, context.stage, {
        sqs_message_id: context.sqsMessageId,
        duration_ms: context.durationMs,
        status: 'dead_letter',
        error_code: classification.errorCode,
        error_message: classification.errorMessage,
      }),
      context.error,
    );
  }

  private async recordAttempt(params: {
    stage: AssetState;
    message: BaseSqsMessage;
    status: string;
    errorCode?: string;
    errorMessage?: string;
    stackTrace?: string;
    sqsMessageId?: string;
    durationMs?: number;
  }): Promise<void> {
    await this.prisma.processingAttempt.create({
      data: {
        assetId: params.message.assetId,
        ingestionFileId: params.message.ingestionFileId,
        stage: params.stage as DatabaseAssetState,
        attemptNumber: params.message.attempt,
        status: params.status,
        errorCode: params.errorCode,
        errorMessage: params.errorMessage,
        stackTrace: params.stackTrace,
        sqsMessageId: params.sqsMessageId,
        durationMs: params.durationMs,
      },
    });
  }

  public getMaxAttempts(): number {
    return this.maxAttempts;
  }

  private resolveRetryQueue(stage: AssetState) {
    const mappedQueue = getQueueForStage(stage);
    if (mappedQueue) {
      return mappedQueue;
    }

    if (
      [
        AssetState.VALIDATING,
        AssetState.HASHING,
        AssetState.DUPLICATE_CHECK,
      ].includes(stage)
    ) {
      return 'ingestion' as const;
    }

    throw new Error(`No queue configured for retry stage ${stage}`);
  }

  public getErrorMessage(error: unknown): string {
    return getErrorMessage(error);
  }
}
