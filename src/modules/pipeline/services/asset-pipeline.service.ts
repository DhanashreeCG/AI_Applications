import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AssetState as DatabaseAssetState } from '@generated/prisma/client';
import { Readable } from 'stream';
import { AssetState } from '../../../common/enums/asset-state.enum';
import {
  AiMetadataMessage,
  BaseSqsMessage,
  DlqMessage,
  EmbeddingMessage,
  IngestionProcessMessage,
  S3UploadMessage,
} from '../../../common/interfaces/sqs-messages.interface';
import { PrismaService } from '../../database/prisma.service';
import { SqsQueueService } from '../../queue/sqs-queue.service';
import { GoogleDriveAdapterService } from '../../drive/google-drive-adapter.service';
import { ImageProcessorService } from '../../image/image-processor.service';
import { S3StorageService } from '../../storage/s3-storage.service';
import { VisionMetadataService } from '../../ai/services/vision-metadata.service';
import { OpenAiEmbeddingProvider } from '../../ai/providers/openai-embedding.provider';
import { VectorStorageService } from '../../search/vector-storage.service';
import { QueueName } from '../../queue/queue-topology.constants';
import { PipelineRetryService } from './pipeline-retry.service';

interface PipelineExecutionContext {
  sqsMessageId?: string;
  startedAt: number;
}

@Injectable()
export class AssetPipelineService {
  private readonly logger = new Logger(AssetPipelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sqsQueue: SqsQueueService,
    private readonly driveAdapter: GoogleDriveAdapterService,
    private readonly imageProcessor: ImageProcessorService,
    private readonly storageService: S3StorageService,
    private readonly visionMetadataService: VisionMetadataService,
    private readonly embeddingProvider: OpenAiEmbeddingProvider,
    private readonly vectorStorage: VectorStorageService,
    private readonly pipelineRetry: PipelineRetryService,
  ) {}

  public async processQueueMessage(
    queueName: QueueName,
    message: BaseSqsMessage,
    sqsMessageId?: string,
  ): Promise<void> {
    const context: PipelineExecutionContext = {
      sqsMessageId,
      startedAt: Date.now(),
    };

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
        await this.processAiMetadataStage(message as AiMetadataMessage, context);
        break;
      case 'embedding':
        await this.processEmbeddingStage(message as EmbeddingMessage, context);
        break;
      default:
        throw new Error(`Unsupported pipeline queue: ${queueName}`);
    }
  }

  public async replayDlqMessage(message: DlqMessage): Promise<string> {
    return this.pipelineRetry.replayFromDlq(message);
  }

  private async processIngestionStage(
    message: IngestionProcessMessage,
    context: PipelineExecutionContext,
  ): Promise<void> {
    const asset = await this.requireAsset(message.assetId);

    await this.runStage(message, AssetState.DOWNLOADING, context, async () => {
      const downloadStream = await this.driveAdapter.downloadFileStream(
        message.driveFileId,
      );
      const buffer = await this.streamToBuffer(downloadStream);

      await this.runStage(message, AssetState.VALIDATING, context, async () => {
        const validation = await this.imageProcessor.validateImage(buffer);
        if (!validation.isValid) {
          throw new Error(
            validation.error || 'Corrupted or invalid image during ingestion',
          );
        }

        await this.runStage(message, AssetState.HASHING, context, async () => {
          const contentHash = await this.imageProcessor.calculateSha256(buffer);

          await this.runStage(
            message,
            AssetState.UPLOADING_TO_S3,
            context,
            async () => {
              await this.storageService.uploadFile(buffer, {
                key: asset.s3ObjectKey,
                bucket: asset.s3Bucket,
                contentType: asset.mimeType,
              });

              await this.prisma.asset.update({
                where: { id: asset.id },
                data: {
                  contentHash,
                  fileSize: BigInt(buffer.length),
                  width: validation.width ?? null,
                  height: validation.height ?? null,
                  status: DatabaseAssetState.STORED_IN_S3,
                },
              });
              await this.updateStates(message, AssetState.STORED_IN_S3);

              await this.sqsQueue.dispatchAiMetadata({
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
          );
        });
      });
    });
  }

  private async processS3UploadStage(
    message: S3UploadMessage,
    context: PipelineExecutionContext,
  ): Promise<void> {
    await this.runStage(message, AssetState.UPLOADING_TO_S3, context, async () => {
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

      await this.prisma.asset.update({
        where: { id: asset.id },
        data: { status: DatabaseAssetState.STORED_IN_S3 },
      });
      await this.updateStates(message, AssetState.STORED_IN_S3);

      await this.sqsQueue.dispatchAiMetadata({
        jobId: message.jobId,
        ingestionFileId: message.ingestionFileId,
        assetId: asset.id,
        s3ObjectKey: asset.s3ObjectKey,
        contentHash: message.contentHash,
        attempt: 1,
        traceId: message.traceId,
      });

      await this.recordSuccess(AssetState.STORED_IN_S3, message, context);
    });
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
        const metadata = await this.visionMetadataService.generateAndSaveForAsset(
          message.assetId,
        );
        await this.updateStates(message, AssetState.METADATA_GENERATED);

        await this.sqsQueue.dispatchEmbedding({
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
        const embedding = await this.embeddingProvider.generateEmbedding(
          message.searchDescription,
        );
        await this.vectorStorage.storeFromEmbeddingResult(
          message.assetId,
          embedding,
        );

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

  private async runStage(
    message: BaseSqsMessage,
    stage: AssetState,
    context: PipelineExecutionContext,
    work: () => Promise<void>,
  ): Promise<void> {
    try {
      await this.updateStates(message, stage);
      await work();
    } catch (error) {
      await this.pipelineRetry.handleFailure({
        stage,
        message,
        error,
        sqsMessageId: context.sqsMessageId,
        durationMs: Date.now() - context.startedAt,
      });
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
    await this.prisma.processingAttempt.create({
      data: {
        assetId: message.assetId,
        ingestionFileId: message.ingestionFileId,
        stage: stage as DatabaseAssetState,
        attemptNumber: message.attempt,
        status: 'SUCCESS',
        sqsMessageId: context.sqsMessageId,
        durationMs: Date.now() - context.startedAt,
      },
    });
  }

  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}
