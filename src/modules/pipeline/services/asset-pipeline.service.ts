import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssetState as DatabaseAssetState } from '@generated/prisma/client';
import { Readable } from 'stream';
import { randomUUID } from 'crypto';
import { AssetState } from '../../../common/enums/asset-state.enum';
import {
  AiMetadataMessage,
  BaseSqsMessage,
  EmbeddingMessage,
  IngestionProcessMessage,
  S3UploadMessage,
} from '../../../common/interfaces/pipeline-messages.interface';
import { PrismaService } from '../../database/prisma.service';
import { BullmqQueueService } from '../../queue/bullmq/bullmq-queue.service';
import { GoogleDriveAdapterService } from '../../drive/google-drive-adapter.service';
import { ImageProcessorService } from '../../image/image-processor.service';
import { S3StorageService } from '../../storage/s3-storage.service';
import { VisionMetadataService } from '../../ai/services/vision-metadata.service';
import { OpenAiEmbeddingProvider } from '../../ai/providers/openai-embedding.provider';
import { VectorStorageService } from '../../search/vector-storage.service';
import { AiUsageService } from '../../ai/services/ai-usage.service';
import { QueueName } from '../../queue/queue-topology.constants';
import { PipelineRetryService, ReplayDlqRequest } from './pipeline-retry.service';
import { StructuredLoggerService } from '../../observability/structured-logger.service';
import { PipelineMetricsService } from '../../observability/pipeline-metrics.service';
import { buildPipelineLogFields } from '../../observability/utils/pipeline-log-fields.util';
import { hashSourceText } from '../../ai/utils/source-text-hash.util';

const SHA256_MATCH = 'SHA256_MATCH';

interface PipelineExecutionContext {
  sqsMessageId?: string;
  startedAt: number;
  stageStartedAt?: number;
}

interface RunStageOptions {
  handleFailure?: boolean;
}

@Injectable()
export class AssetPipelineService {
  private readonly logger = new StructuredLoggerService(AssetPipelineService.name);
  private readonly openaiUnitCost: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: BullmqQueueService,
    private readonly driveAdapter: GoogleDriveAdapterService,
    private readonly imageProcessor: ImageProcessorService,
    private readonly storageService: S3StorageService,
    private readonly visionMetadataService: VisionMetadataService,
    private readonly embeddingProvider: OpenAiEmbeddingProvider,
    private readonly vectorStorage: VectorStorageService,
    private readonly aiUsage: AiUsageService,
    private readonly pipelineRetry: PipelineRetryService,
    private readonly metrics: PipelineMetricsService,
    configService: ConfigService,
  ) {
    this.openaiUnitCost =
      configService.get<number>('ai.costOpenAiEmbeddingPerCallUsd') ?? 0.00002;
  }

  public async processQueueMessage(
    queueName: QueueName,
    message: BaseSqsMessage,
    sqsMessageId?: string,
  ): Promise<void> {
    const context: PipelineExecutionContext = {
      sqsMessageId,
      startedAt: Date.now(),
    };

    this.logger.log('Pipeline message received', {
      ...buildPipelineLogFields(message, this.resolveInitialStage(queueName)),
      sqs_message_id: sqsMessageId,
      queue: queueName,
      status: 'started',
    });

    switch (queueName) {
      case 'ingestion':
        await this.processIngestionStage(
          message as IngestionProcessMessage,
          context,
        );
        break;
      case 's3Upload':
        await this.processS3UploadStage(message as S3UploadMessage, context);
        break;
      case 'aiMetadata':
        await this.processAiMetadataStage(
          message as AiMetadataMessage,
          context,
        );
        break;
      case 'embedding':
        await this.processEmbeddingStage(message as EmbeddingMessage, context);
        break;
      default:
        throw new Error(`Unsupported pipeline queue: ${queueName}`);
    }
  }

  public async replayDlqMessage(request: ReplayDlqRequest): Promise<string> {
    return this.pipelineRetry.replayFromDlq(request);
  }

  public async replayStuck(request: {
    status: AssetState;
    failedStage?: AssetState;
    limit?: number;
    dryRun?: boolean;
  }) {
    return this.pipelineRetry.replayStuck(request);
  }

  /**
   * Single Drive download → validate → hash → dedup OR create Asset → S3 → AI.
   * Resume: if Asset already STORED_IN_S3+ with S3 object, skip download/upload.
   */
  private async processIngestionStage(
    message: IngestionProcessMessage,
    context: PipelineExecutionContext,
  ): Promise<void> {
    // Resume path: asset already created and stored
    if (message.assetId) {
      const existing = await this.prisma.asset.findUnique({
        where: { id: message.assetId },
        include: { metadata: true },
      });

      if (existing) {
        const s3Exists = await this.storageService.fileExists(
          existing.s3ObjectKey,
          existing.s3Bucket,
        );

        if (s3Exists) {
          await this.resumeAfterS3(message, existing, context);
          return;
        }
      }
    }

    await this.runStage(message, AssetState.DOWNLOADING, context, async () => {
      const downloadStream = await this.driveAdapter.downloadFileStream(
        message.driveFileId,
      );
      const buffer = await this.streamToBuffer(downloadStream);

      await this.runStage(
        message,
        AssetState.VALIDATING,
        context,
        async () => {
          const validation = await this.imageProcessor.validateImage(buffer);
          if (!validation.isValid) {
            throw new Error(
              validation.error || 'Corrupted or invalid image during ingestion',
            );
          }

          await this.runStage(
            message,
            AssetState.HASHING,
            context,
            async () => {
              const contentHash =
                await this.imageProcessor.calculateSha256(buffer);

              const duplicate = await this.prisma.asset.findUnique({
                where: { contentHash },
              });

              if (duplicate) {
                await this.attachToExistingAsset({
                  jobId: message.jobId,
                  ingestionFileId: message.ingestionFileId,
                  assetId: duplicate.id,
                  driveFileId: message.driveFileId,
                });
                message.assetId = duplicate.id;
                await this.recordSuccess(
                  AssetState.COMPLETED,
                  message,
                  context,
                );
                return;
              }

              await this.runStage(
                message,
                AssetState.UPLOADING_TO_S3,
                context,
                async () => {
                  const ingestionFile =
                    await this.prisma.ingestionFile.findUnique({
                      where: { id: message.ingestionFileId },
                    });
                  if (!ingestionFile) {
                    throw new NotFoundException(
                      `Ingestion file ${message.ingestionFileId} not found`,
                    );
                  }

                  const assetId = message.assetId ?? randomUUID();
                  const bucket = this.storageService.getDefaultBucket();
                  const objectKey = this.storageService.generateCanonicalKey(
                    assetId,
                    ingestionFile.filename,
                  );

                  let asset;
                  try {
                    asset = await this.prisma.$transaction(async (tx) => {
                      const created = await tx.asset.create({
                        data: {
                          id: assetId,
                          contentHash,
                          mimeType:
                            validation.mimeType ||
                            ingestionFile.mimeType ||
                            'application/octet-stream',
                          fileSize: BigInt(buffer.length),
                          width: validation.width ?? null,
                          height: validation.height ?? null,
                          s3Bucket: bucket,
                          s3ObjectKey: objectKey,
                          status: DatabaseAssetState.UPLOADING_TO_S3,
                        },
                      });

                      await tx.assetSource.create({
                        data: {
                          assetId: created.id,
                          ingestionFileId: message.ingestionFileId,
                          sourceType: 'GOOGLE_DRIVE',
                          externalId: message.driveFileId,
                          folderPath: ingestionFile.folderPath || null,
                          filename: ingestionFile.filename,
                          linkReason: null,
                        },
                      });

                      await tx.ingestionFile.update({
                        where: { id: message.ingestionFileId },
                        data: {
                          assetId: created.id,
                          status: DatabaseAssetState.UPLOADING_TO_S3,
                        },
                      });

                      return created;
                    });
                  } catch (error: unknown) {
                    const code = (error as { code?: string })?.code;
                    if (code !== 'P2002') {
                      throw error;
                    }
                    const raced = await this.prisma.asset.findUnique({
                      where: { contentHash },
                    });
                    if (!raced) {
                      throw error;
                    }
                    await this.attachToExistingAsset({
                      jobId: message.jobId,
                      ingestionFileId: message.ingestionFileId,
                      assetId: raced.id,
                      driveFileId: message.driveFileId,
                    });
                    message.assetId = raced.id;
                    await this.recordSuccess(
                      AssetState.COMPLETED,
                      message,
                      context,
                    );
                    return;
                  }

                  message.assetId = asset.id;

                  const alreadyInS3 = await this.storageService.fileExists(
                    asset.s3ObjectKey,
                    asset.s3Bucket,
                  );
                  if (!alreadyInS3) {
                    await this.storageService.uploadFile(buffer, {
                      key: asset.s3ObjectKey,
                      bucket: asset.s3Bucket,
                      contentType: asset.mimeType,
                    });
                  }

                  await this.prisma.asset.update({
                    where: { id: asset.id },
                    data: { status: DatabaseAssetState.STORED_IN_S3 },
                  });
                  await this.updateStates(message, AssetState.STORED_IN_S3);

                  await this.queue.dispatchAiMetadata({
                    jobId: message.jobId,
                    ingestionFileId: message.ingestionFileId,
                    assetId: asset.id,
                    s3ObjectKey: asset.s3ObjectKey,
                    contentHash,
                    attempt: 1,
                    traceId: message.traceId,
                  });

                  await this.recordSuccess(
                    AssetState.STORED_IN_S3,
                    message,
                    context,
                  );
                },
                { handleFailure: false },
              );
            },
            { handleFailure: false },
          );
        },
        { handleFailure: false },
      );
    });
  }

  private async resumeAfterS3(
    message: IngestionProcessMessage,
    asset: {
      id: string;
      s3ObjectKey: string;
      contentHash: string;
      metadata: { searchDescription: string; metadataVersion: number } | null;
    },
    context: PipelineExecutionContext,
  ): Promise<void> {
    message.assetId = asset.id;

    if (asset.metadata) {
      await this.queue.dispatchEmbedding({
        jobId: message.jobId,
        ingestionFileId: message.ingestionFileId,
        assetId: asset.id,
        searchDescription: asset.metadata.searchDescription,
        metadataVersion: asset.metadata.metadataVersion,
        attempt: 1,
        traceId: message.traceId,
      });
      await this.recordSuccess(AssetState.METADATA_GENERATED, message, context);
      return;
    }

    await this.prisma.asset.update({
      where: { id: asset.id },
      data: { status: DatabaseAssetState.STORED_IN_S3 },
    });
    await this.updateStates(message, AssetState.STORED_IN_S3);

    await this.queue.dispatchAiMetadata({
      jobId: message.jobId,
      ingestionFileId: message.ingestionFileId,
      assetId: asset.id,
      s3ObjectKey: asset.s3ObjectKey,
      contentHash: asset.contentHash,
      attempt: 1,
      traceId: message.traceId,
    });

    await this.recordSuccess(AssetState.STORED_IN_S3, message, context);
  }

  private async processS3UploadStage(
    message: S3UploadMessage,
    context: PipelineExecutionContext,
  ): Promise<void> {
    await this.runStage(
      message,
      AssetState.UPLOADING_TO_S3,
      context,
      async () => {
        const asset = await this.requireAsset(message.assetId);
        const exists = await this.storageService.fileExists(
          asset.s3ObjectKey,
          asset.s3Bucket,
        );

        if (!exists) {
          throw new Error(
            `S3 object missing for asset ${asset.id}: ${asset.s3ObjectKey}`,
          );
        }

        const withMeta = await this.prisma.asset.findUnique({
          where: { id: asset.id },
          include: { metadata: true },
        });

        if (withMeta?.metadata) {
          await this.queue.dispatchEmbedding({
            jobId: message.jobId,
            ingestionFileId: message.ingestionFileId,
            assetId: asset.id,
            searchDescription: withMeta.metadata.searchDescription,
            metadataVersion: withMeta.metadata.metadataVersion,
            attempt: 1,
            traceId: message.traceId,
          });
          await this.updateStates(message, AssetState.METADATA_GENERATED);
          await this.recordSuccess(
            AssetState.METADATA_GENERATED,
            message,
            context,
          );
          return;
        }

        await this.prisma.asset.update({
          where: { id: asset.id },
          data: { status: DatabaseAssetState.STORED_IN_S3 },
        });
        await this.updateStates(message, AssetState.STORED_IN_S3);

        await this.queue.dispatchAiMetadata({
          jobId: message.jobId,
          ingestionFileId: message.ingestionFileId,
          assetId: asset.id,
          s3ObjectKey: asset.s3ObjectKey,
          contentHash: message.contentHash,
          attempt: 1,
          traceId: message.traceId,
        });

        await this.recordSuccess(AssetState.STORED_IN_S3, message, context);
      },
    );
  }

  private async processAiMetadataStage(
    message: AiMetadataMessage,
    context: PipelineExecutionContext,
  ): Promise<void> {
    await this.runStage(
      message,
      AssetState.GENERATING_METADATA,
      context,
      async () => {
        const existing = await this.prisma.assetMetadata.findUnique({
          where: { assetId: message.assetId },
        });

        let metadata = existing;
        if (!metadata) {
          metadata = await this.visionMetadataService.generateAndSaveForAsset(
            message.assetId,
            { skipIfExists: true, retryCount: message.attempt - 1 },
          );
        } else {
          await this.aiUsage.record({
            assetId: message.assetId,
            stage: AssetState.GENERATING_METADATA,
            provider: 'google-gemini',
            model: 'gemini-2.5-flash',
            startedAt: new Date(),
            completedAt: new Date(),
            latencyMs: 0,
            status: 'skipped',
            retryCount: message.attempt - 1,
          });
        }

        // Persist stage status before dispatch (idempotent on replay)
        await this.prisma.$transaction(async (tx) => {
          await tx.asset.update({
            where: { id: message.assetId },
            data: { status: DatabaseAssetState.METADATA_GENERATED },
          });
          await tx.ingestionFile.update({
            where: { id: message.ingestionFileId },
            data: { status: DatabaseAssetState.METADATA_GENERATED },
          });
        });

        await this.queue.dispatchEmbedding({
          jobId: message.jobId,
          ingestionFileId: message.ingestionFileId,
          assetId: message.assetId,
          searchDescription: metadata.searchDescription,
          metadataVersion: metadata.metadataVersion,
          attempt: 1,
          traceId: message.traceId,
        });

        await this.recordSuccess(
          AssetState.METADATA_GENERATED,
          message,
          context,
        );
      },
    );
  }

  private async processEmbeddingStage(
    message: EmbeddingMessage,
    context: PipelineExecutionContext,
  ): Promise<void> {
    await this.runStage(
      message,
      AssetState.GENERATING_EMBEDDING,
      context,
      async () => {
        const sourceTextHash = hashSourceText(message.searchDescription);
        const alreadyStored = await this.vectorStorage.hasEmbeddingForHash(
          message.assetId,
          sourceTextHash,
        );

        if (!alreadyStored) {
          const startedAt = new Date();
          try {
            const embedding = await this.embeddingProvider.generateEmbedding(
              message.searchDescription,
            );
            const usage = this.embeddingProvider.getLastUsage();
            await this.aiUsage.record({
              assetId: message.assetId,
              stage: AssetState.GENERATING_EMBEDDING,
              provider: embedding.provider,
              model: embedding.model,
              requestId: usage?.requestId,
              startedAt,
              completedAt: new Date(),
              latencyMs: usage?.latencyMs ?? Date.now() - startedAt.getTime(),
              inputTokens: usage?.inputTokens,
              outputTokens: usage?.outputTokens,
              totalTokens: usage?.totalTokens,
              estimatedCost: this.openaiUnitCost,
              status: 'success',
              retryCount: message.attempt - 1,
            });
            await this.vectorStorage.storeFromEmbeddingResult(
              message.assetId,
              embedding,
            );
          } catch (error) {
            const usage = this.embeddingProvider.getLastUsage();
            await this.aiUsage.record({
              assetId: message.assetId,
              stage: AssetState.GENERATING_EMBEDDING,
              provider: this.embeddingProvider.providerName,
              model: this.embeddingProvider.modelName,
              requestId: usage?.requestId,
              startedAt,
              completedAt: new Date(),
              latencyMs: usage?.latencyMs ?? Date.now() - startedAt.getTime(),
              status: 'failed',
              retryCount: message.attempt - 1,
              errorType:
                error instanceof Error
                  ? error.name || error.message
                  : 'UnknownError',
            });
            throw error;
          }
        } else {
          await this.aiUsage.record({
            assetId: message.assetId,
            stage: AssetState.GENERATING_EMBEDDING,
            provider: this.embeddingProvider.providerName,
            model: this.embeddingProvider.modelName,
            startedAt: new Date(),
            completedAt: new Date(),
            latencyMs: 0,
            status: 'skipped',
            retryCount: message.attempt - 1,
          });
        }

        await this.prisma.$transaction(async (tx) => {
          await tx.asset.update({
            where: { id: message.assetId },
            data: { status: DatabaseAssetState.COMPLETED },
          });
          await tx.ingestionFile.update({
            where: { id: message.ingestionFileId },
            data: {
              status: DatabaseAssetState.COMPLETED,
              errorMessage: null,
            },
          });
          await tx.ingestionJob.update({
            where: { id: message.jobId },
            data: {
              totalProcessed: { increment: 1 },
              totalSuccessful: { increment: 1 },
            },
          });
        });

        await this.recordSuccess(AssetState.COMPLETED, message, context);
      },
    );
  }

  private async attachToExistingAsset(params: {
    jobId: string;
    ingestionFileId: string;
    assetId: string;
    driveFileId: string;
  }): Promise<void> {
    const ingestionFile = await this.prisma.ingestionFile.findUnique({
      where: { id: params.ingestionFileId },
    });

    await this.prisma.$transaction(async (tx) => {
      const existingSource = await tx.assetSource.findUnique({
        where: { ingestionFileId: params.ingestionFileId },
      });

      if (!existingSource) {
        await tx.assetSource.create({
          data: {
            assetId: params.assetId,
            ingestionFileId: params.ingestionFileId,
            sourceType: 'GOOGLE_DRIVE',
            externalId: params.driveFileId,
            folderPath: ingestionFile?.folderPath || null,
            filename: ingestionFile?.filename || params.driveFileId,
            linkReason: SHA256_MATCH,
          },
        });
      }

      await tx.ingestionFile.update({
        where: { id: params.ingestionFileId },
        data: {
          assetId: params.assetId,
          status: DatabaseAssetState.COMPLETED,
        },
      });

      await tx.ingestionJob.update({
        where: { id: params.jobId },
        data: {
          totalDuplicate: { increment: 1 },
          totalProcessed: { increment: 1 },
          totalSuccessful: { increment: 1 },
        },
      });
    });

    this.metrics.incrementDuplicates();
    this.metrics.incrementSuccessful();

    this.logger.log('Duplicate asset linked', {
      job_id: params.jobId,
      ingestion_file_id: params.ingestionFileId,
      asset_id: params.assetId,
      existing_asset_id: params.assetId,
      new_source: params.driveFileId,
      reason: SHA256_MATCH,
      processing_stage: AssetState.COMPLETED,
      status: 'duplicate',
    });
  }

  private async runStage(
    message: BaseSqsMessage,
    stage: AssetState,
    context: PipelineExecutionContext,
    work: () => Promise<void>,
    options: RunStageOptions = {},
  ): Promise<void> {
    const handleFailure = options.handleFailure ?? true;
    context.stageStartedAt = Date.now();

    this.logger.log('Pipeline stage started', {
      ...buildPipelineLogFields(message, stage),
      sqs_message_id: context.sqsMessageId,
      status: 'started',
    });

    try {
      await this.updateStates(message, stage);
      await work();

      const durationMs =
        Date.now() - (context.stageStartedAt ?? context.startedAt);
      this.metrics.recordStageLatency(stage, durationMs);
    } catch (error) {
      const durationMs =
        Date.now() - (context.stageStartedAt ?? context.startedAt);
      this.logger.error(
        'Pipeline stage failed',
        {
          ...buildPipelineLogFields(message, stage),
          sqs_message_id: context.sqsMessageId,
          duration_ms: durationMs,
          status: 'failed',
        },
        error,
      );

      if (handleFailure) {
        await this.pipelineRetry.handleFailure({
          stage,
          message,
          error,
          sqsMessageId: context.sqsMessageId,
          durationMs: Date.now() - context.startedAt,
        });
      }

      throw error;
    }
  }

  private async updateStates(
    message: BaseSqsMessage,
    stage: AssetState,
  ): Promise<void> {
    if (message.assetId) {
      await this.prisma.asset.update({
        where: { id: message.assetId },
        data: { status: stage as DatabaseAssetState },
      });
    }

    await this.prisma.ingestionFile.update({
      where: { id: message.ingestionFileId },
      data: { status: stage as DatabaseAssetState },
    });
  }

  private async requireAsset(assetId?: string) {
    if (!assetId) {
      throw new Error('Pipeline message is missing assetId');
    }

    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) {
      throw new NotFoundException(`Asset ${assetId} not found`);
    }

    return asset;
  }

  private async recordSuccess(
    stage: AssetState,
    message: BaseSqsMessage,
    context: PipelineExecutionContext,
  ): Promise<void> {
    const durationMs =
      Date.now() - (context.stageStartedAt ?? context.startedAt);

    await this.prisma.processingAttempt.create({
      data: {
        assetId: message.assetId,
        ingestionFileId: message.ingestionFileId,
        stage: stage as DatabaseAssetState,
        attemptNumber: message.attempt,
        status: 'SUCCESS',
        sqsMessageId: context.sqsMessageId,
        durationMs,
      },
    });

    this.metrics.incrementProcessed();

    if (stage === AssetState.COMPLETED) {
      this.metrics.incrementSuccessful();
    }

    this.logger.log('Pipeline stage completed', {
      ...buildPipelineLogFields(message, stage),
      sqs_message_id: context.sqsMessageId,
      duration_ms: durationMs,
      status: 'success',
    });
  }

  private resolveInitialStage(queueName: QueueName): AssetState {
    switch (queueName) {
      case 'ingestion':
        return AssetState.DOWNLOADING;
      case 's3Upload':
        return AssetState.UPLOADING_TO_S3;
      case 'aiMetadata':
        return AssetState.GENERATING_METADATA;
      case 'embedding':
        return AssetState.GENERATING_EMBEDDING;
      default:
        return AssetState.DISCOVERED;
    }
  }

  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}
