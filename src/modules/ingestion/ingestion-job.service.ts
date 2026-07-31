import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AssetState as DatabaseAssetState,
  JobState as DatabaseJobState,
} from '@generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { SqsQueueService } from '../queue/sqs-queue.service';
import { GoogleDriveAdapterService } from '../drive/google-drive-adapter.service';
import { AssetState } from '../../common/enums/asset-state.enum';
import { CreateIngestionJobDto, IngestionJobMode } from './dto/create-ingestion-job.dto';
import { IngestionProcessMessage } from '../../common/interfaces/sqs-messages.interface';
import { getErrorMessage } from '../../common/utils/error-message';
import { ImageProcessorService } from '../image/image-processor.service';
import { Readable } from 'stream';
import { DriveFileItem } from '../drive/interfaces/drive-file.interface';
import { randomUUID } from 'crypto';
import { StructuredLoggerService } from '../observability/structured-logger.service';
import { PipelineMetricsService } from '../observability/pipeline-metrics.service';
import {
  CostEstimate,
  CostEstimatorService,
} from './services/cost-estimator.service';

const SHA256_MATCH = 'SHA256_MATCH';

@Injectable()
export class IngestionJobService {
  private readonly logger = new StructuredLoggerService(IngestionJobService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sqsQueue: SqsQueueService,
    private readonly driveAdapter: GoogleDriveAdapterService,
    private readonly imageProcessor: ImageProcessorService,
    private readonly metrics: PipelineMetricsService,
    private readonly costEstimator: CostEstimatorService,
  ) {}

  async createJob(dto: CreateIngestionJobDto) {
    const mode: IngestionJobMode = dto.mode ?? 'FULL';
    const job = await this.prisma.ingestionJob.create({
      data: {
        sourceType: dto.sourceType,
        rootFolderId: dto.rootFolderId,
        mode,
        status: DatabaseJobState.CREATED,
      },
    });

    this.logger.log('Ingestion job created', {
      job_id: job.id,
      root_folder_id: dto.rootFolderId,
      mode,
      status: 'created',
    });
    return job;
  }

  async startJobDiscovery(jobId: string): Promise<void> {
    const job = await this.prisma.ingestionJob.findUnique({
      where: { id: jobId },
    });
    if (!job) {
      throw new NotFoundException(`Ingestion job ${jobId} not found`);
    }
    if (
      job.status !== DatabaseJobState.CREATED &&
      job.status !== DatabaseJobState.FAILED
    ) {
      throw new ConflictException(
        `Ingestion job ${jobId} cannot start discovery from ${job.status}`,
      );
    }

    const isDryRun = job.mode === 'DRY_RUN';

    await this.prisma.ingestionJob.update({
      where: { id: jobId },
      data: {
        status: DatabaseJobState.SCANNING,
        startedAt: new Date(),
        errorMessage: null,
      },
    });

    this.logger.log('Ingestion job discovery started', {
      job_id: jobId,
      root_folder_id: job.rootFolderId,
      mode: job.mode,
      status: 'scanning',
    });

    let totalDiscovered = 0;
    let totalDuplicate = 0;
    let needingMetadata = 0;
    let needingEmbedding = 0;
    let alreadyProcessed = 0;
    let totalFailed = 0;

    try {
      const driveFiles = await this.driveAdapter.listFilesInFolderRecursive(
        job.rootFolderId,
      );

      for (const file of driveFiles) {
        const ingestionFile = await this.prisma.ingestionFile.upsert({
          where: {
            jobId_driveFileId: { jobId, driveFileId: file.id },
          },
          create: {
            jobId,
            driveFileId: file.id,
            filename: file.name,
            mimeType: file.mimeType,
            fileSize: file.size ?? null,
            folderPath: file.folderPath,
            driveFileCreatedAt: file.createdAt ?? null,
            status: DatabaseAssetState.DISCOVERED,
          },
          update: {},
        });

        totalDiscovered++;

        if (isDryRun) {
          const result = await this.processDryRunFile(
            jobId,
            ingestionFile.id,
            file,
          );
          if (result === 'duplicate') {
            totalDuplicate++;
          } else if (result === 'failed') {
            totalFailed++;
          } else if (result === 'already_processed') {
            totalDuplicate++;
            alreadyProcessed++;
          } else {
            needingMetadata++;
            needingEmbedding++;
          }
        } else {
          await this.enqueueDiscoveredFile(jobId, ingestionFile.id, file);
        }
      }

      this.metrics.incrementDiscovered(totalDiscovered);

      if (isDryRun) {
        const estimate = this.costEstimator.estimateFromCounts({
          discovered: totalDiscovered,
          duplicates: totalDuplicate,
          needingMetadata,
          needingEmbedding,
          alreadyProcessed,
        });

        await this.prisma.ingestionJob.update({
          where: { id: jobId },
          data: {
            status: DatabaseJobState.COMPLETED,
            totalDiscovered,
            totalDuplicate,
            totalFailed,
            totalProcessed: totalDiscovered,
            totalSuccessful: totalDiscovered - totalFailed,
            expectedGeminiCalls: estimate.expectedGeminiCalls,
            expectedEmbeddingCalls: estimate.expectedEmbeddingCalls,
            estimatedGeminiCostUsd: estimate.estimatedGeminiCostUsd,
            estimatedOpenAiCostUsd: estimate.estimatedOpenAiCostUsd,
            estimatedTotalCostUsd: estimate.estimatedTotalCostUsd,
            completedAt: new Date(),
          },
        });

        this.logger.log('Dry-run ingestion completed', {
          job_id: jobId,
          total_discovered: totalDiscovered,
          duplicates: totalDuplicate,
          expected_gemini_calls: estimate.expectedGeminiCalls,
          expected_embedding_calls: estimate.expectedEmbeddingCalls,
          estimated_total_cost_usd: estimate.estimatedTotalCostUsd,
          status: 'completed',
        });
        return;
      }

      await this.prisma.ingestionJob.update({
        where: { id: jobId },
        data: {
          status: DatabaseJobState.PROCESSING,
          totalDiscovered,
        },
      });

      this.logger.log('Ingestion job discovery completed', {
        job_id: jobId,
        total_discovered: totalDiscovered,
        status: 'processing',
      });
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      await this.prisma.ingestionJob.update({
        where: { id: jobId },
        data: { status: DatabaseJobState.FAILED, errorMessage },
      });
      this.logger.error(
        'Ingestion job discovery failed',
        {
          job_id: jobId,
          status: 'failed',
          error_message: errorMessage,
        },
        error,
      );
      throw error;
    }
  }

  async getJob(jobId: string) {
    return this.prisma.ingestionJob.findUnique({
      where: { id: jobId },
      include: { _count: { select: { files: true } } },
    });
  }

  async listJobs(limit = 20) {
    const boundedLimit = Math.min(Math.max(limit, 1), 100);
    return this.prisma.ingestionJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: boundedLimit,
      include: { _count: { select: { files: true } } },
    });
  }

  async estimateJob(jobId: string): Promise<CostEstimate> {
    const job = await this.prisma.ingestionJob.findUnique({
      where: { id: jobId },
    });
    if (!job) {
      throw new NotFoundException(`Ingestion job ${jobId} not found`);
    }

    if (
      job.expectedGeminiCalls != null &&
      job.expectedEmbeddingCalls != null &&
      job.estimatedTotalCostUsd != null
    ) {
      return {
        imagesDiscovered: job.totalDiscovered,
        duplicates: job.totalDuplicate,
        uniqueImages: Math.max(0, job.totalDiscovered - job.totalDuplicate),
        alreadyProcessed: 0,
        newAssets: Math.max(
          0,
          job.totalDiscovered - job.totalDuplicate,
        ),
        expectedGeminiCalls: job.expectedGeminiCalls,
        expectedEmbeddingCalls: job.expectedEmbeddingCalls,
        estimatedGeminiCostUsd: job.estimatedGeminiCostUsd ?? 0,
        estimatedOpenAiCostUsd: job.estimatedOpenAiCostUsd ?? 0,
        estimatedTotalCostUsd: job.estimatedTotalCostUsd,
      };
    }

    return this.costEstimator.estimateForJob(jobId);
  }

  /**
   * Metadata-only discovery: enqueue for worker (no Drive download here).
   */
  private async enqueueDiscoveredFile(
    jobId: string,
    ingestionFileId: string,
    file: DriveFileItem,
  ): Promise<void> {
    const payload: IngestionProcessMessage = {
      jobId,
      ingestionFileId,
      driveFileId: file.id,
      stage: AssetState.DISCOVERED,
      attempt: 1,
      traceId: randomUUID(),
      timestamp: new Date().toISOString(),
    };

    await this.sqsQueue.sendMessage('ingestion', payload);

    this.logger.log('Discovered file enqueued', {
      job_id: jobId,
      ingestion_file_id: ingestionFileId,
      drive_file_id: file.id,
      status: 'enqueued',
    });
  }

  /**
   * Dry-run: download once, hash, detect duplicates / already-processed.
   * No S3 upload, Gemini, or OpenAI.
   */
  private async processDryRunFile(
    jobId: string,
    ingestionFileId: string,
    file: DriveFileItem,
  ): Promise<'unique' | 'duplicate' | 'already_processed' | 'failed'> {
    try {
      const downloadStream = await this.driveAdapter.downloadFileStream(file.id);
      const buffer = await this.streamToBuffer(downloadStream);
      const validation = await this.imageProcessor.validateImage(buffer);

      if (!validation.isValid) {
        await this.prisma.ingestionFile.update({
          where: { id: ingestionFileId },
          data: {
            status: DatabaseAssetState.FAILED,
            errorMessage: validation.error || 'Invalid image',
          },
        });
        return 'failed';
      }

      const contentHash = await this.imageProcessor.calculateSha256(buffer);
      const existingAsset = await this.prisma.asset.findUnique({
        where: { contentHash },
        include: { metadata: true, embeddings: true },
      });

      if (existingAsset) {
        await this.attachToExistingAsset({
          jobId,
          ingestionFileId,
          assetId: existingAsset.id,
          file,
        });

        const hasMetadata = Boolean(existingAsset.metadata);
        const hasEmbedding =
          Array.isArray(existingAsset.embeddings) &&
          existingAsset.embeddings.length > 0;

        if (hasMetadata && hasEmbedding) {
          return 'already_processed';
        }

        this.metrics.incrementDuplicates();
        return 'duplicate';
      }

      await this.prisma.ingestionFile.update({
        where: { id: ingestionFileId },
        data: { status: DatabaseAssetState.DISCOVERED },
      });

      return 'unique';
    } catch (error: unknown) {
      await this.prisma.ingestionFile.update({
        where: { id: ingestionFileId },
        data: {
          status: DatabaseAssetState.FAILED,
          errorMessage: getErrorMessage(error),
        },
      });
      return 'failed';
    }
  }

  private async attachToExistingAsset(params: {
    jobId: string;
    ingestionFileId: string;
    assetId: string;
    file: DriveFileItem;
  }): Promise<void> {
    const { jobId, ingestionFileId, assetId, file } = params;

    await this.prisma.$transaction(async (tx) => {
      const existingSource = await tx.assetSource.findUnique({
        where: { ingestionFileId },
      });

      if (!existingSource) {
        await tx.assetSource.create({
          data: {
            assetId,
            ingestionFileId,
            sourceType: 'GOOGLE_DRIVE',
            externalId: file.id,
            folderPath: file.folderPath || null,
            filename: file.name,
            linkReason: SHA256_MATCH,
          },
        });
      }

      await tx.ingestionFile.update({
        where: { id: ingestionFileId },
        data: {
          assetId,
          status: DatabaseAssetState.COMPLETED,
        },
      });
    });

    this.logger.log('Duplicate asset linked', {
      job_id: jobId,
      ingestion_file_id: ingestionFileId,
      asset_id: assetId,
      existing_asset_id: assetId,
      new_source: file.id,
      reason: SHA256_MATCH,
      processing_stage: AssetState.COMPLETED,
      status: 'duplicate',
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
