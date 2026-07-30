import {
  ConflictException,
  Injectable,
  Logger,
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
import { CreateIngestionJobDto } from './dto/create-ingestion-job.dto';
import { IngestionProcessMessage } from '../../common/interfaces/sqs-messages.interface';
import { getErrorMessage } from '../../common/utils/error-message';
import { ImageProcessorService } from '../image/image-processor.service';
import { S3StorageService } from '../storage/s3-storage.service';
import { Readable } from 'stream';
import { DriveFileItem } from '../drive/interfaces/drive-file.interface';
import { randomUUID } from 'crypto';

@Injectable()
export class IngestionJobService {
  private readonly logger = new Logger(IngestionJobService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sqsQueue: SqsQueueService,
    private readonly driveAdapter: GoogleDriveAdapterService,
    private readonly imageProcessor: ImageProcessorService,
    private readonly storageService: S3StorageService,
  ) {}

  async createJob(dto: CreateIngestionJobDto) {
    const job = await this.prisma.ingestionJob.create({
      data: {
        sourceType: dto.sourceType,
        rootFolderId: dto.rootFolderId,
        status: DatabaseJobState.CREATED,
      },
    });

    this.logger.log(
      `Created ingestion job ${job.id} for folder ${dto.rootFolderId}`,
    );
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

    await this.prisma.ingestionJob.update({
      where: { id: jobId },
      data: {
        status: DatabaseJobState.SCANNING,
        startedAt: new Date(),
        errorMessage: null,
      },
    });

    this.logger.log(`Job ${jobId}: scanning Drive folder ${job.rootFolderId}`);

    let totalDiscovered = 0;
    try {
      const driveFiles = await this.driveAdapter.listFilesInFolderRecursive(
        job.rootFolderId,
      );

      for (const file of driveFiles) {
        // Preserve the record when a failed discovery is retried.
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

        await this.processDiscoveredFile(jobId, ingestionFile.id, file);
        totalDiscovered++;
      }

      await this.prisma.ingestionJob.update({
        where: { id: jobId },
        data: {
          status: DatabaseJobState.PROCESSING,
          totalDiscovered,
        },
      });

      this.logger.log(
        `Job ${jobId}: discovered and queued ${totalDiscovered} files`,
      );
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      await this.prisma.ingestionJob.update({
        where: { id: jobId },
        data: { status: DatabaseJobState.FAILED, errorMessage },
      });
      this.logger.error(
        `Job ${jobId} failed during discovery: ${errorMessage}`,
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

  private async processDiscoveredFile(
    jobId: string,
    ingestionFileId: string,
    file: DriveFileItem,
  ): Promise<void> {
    const downloadStream = await this.driveAdapter.downloadFileStream(file.id);
    const buffer = await this.streamToBuffer(downloadStream);
    const validation = await this.imageProcessor.validateImage(buffer);

    if (!validation.isValid) {
      throw new Error(
        `Invalid image for Drive file ${file.id}: ${validation.error || 'Unknown validation error'}`.trim(),
      );
    }

    const contentHash = await this.imageProcessor.calculateSha256(buffer);
    const existingAsset = await this.prisma.asset.findUnique({
      where: { contentHash },
    });

    if (existingAsset) {
      await this.attachToExistingAsset({
        jobId,
        ingestionFileId,
        assetId: existingAsset.id,
        contentHash,
        file,
      });
      return;
    }

    const assetId = randomUUID();
    const bucket = this.storageService.getDefaultBucket();
    const objectKey = this.storageService.generateCanonicalKey(assetId, file.name);

    const asset = await this.prisma.$transaction(async (tx) => {
      const createdAsset = await tx.asset.create({
        data: {
          id: assetId,
          contentHash,
          mimeType: validation.mimeType || file.mimeType,
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
          assetId: createdAsset.id,
          ingestionFileId,
          sourceType: 'GOOGLE_DRIVE',
          externalId: file.id,
          folderPath: file.folderPath || null,
          filename: file.name,
        },
      });

      await tx.ingestionFile.update({
        where: { id: ingestionFileId },
        data: { assetId: createdAsset.id, status: DatabaseAssetState.UPLOADING_TO_S3 },
      });

      return createdAsset;
    }).catch(async (error: any) => {
      if (error?.code !== 'P2002') {
        throw error;
      }

      const existing = await this.prisma.asset.findUnique({ where: { contentHash } });
      if (!existing) {
        throw error;
      }

      await this.attachToExistingAsset({
        jobId,
        ingestionFileId,
        assetId: existing.id,
        contentHash,
        file,
      });
      return existing;
    });

    const payload: IngestionProcessMessage = {
      jobId,
      ingestionFileId,
      assetId: asset.id,
      driveFileId: file.id,
      stage: AssetState.DISCOVERED,
      attempt: 1,
      timestamp: new Date().toISOString(),
    };

    await this.sqsQueue.sendMessage('ingestion', payload);
  }

  private async attachToExistingAsset(params: {
    jobId: string;
    ingestionFileId: string;
    assetId: string;
    contentHash: string;
    file: DriveFileItem;
  }): Promise<void> {
    const { jobId, ingestionFileId, assetId, file } = params;

    await this.prisma.$transaction(async (tx) => {
      await tx.assetSource.create({
        data: {
          assetId,
          ingestionFileId,
          sourceType: 'GOOGLE_DRIVE',
          externalId: file.id,
          folderPath: file.folderPath || null,
          filename: file.name,
        },
      });

      await tx.ingestionFile.update({
        where: { id: ingestionFileId },
        data: {
          assetId,
          status: DatabaseAssetState.COMPLETED,
        },
      });

      await tx.ingestionJob.update({
        where: { id: jobId },
        data: { totalDuplicate: { increment: 1 } },
      });
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
