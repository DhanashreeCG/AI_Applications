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

@Injectable()
export class IngestionJobService {
  private readonly logger = new Logger(IngestionJobService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sqsQueue: SqsQueueService,
    private readonly driveAdapter: GoogleDriveAdapterService,
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

        // Dispatch SQS message for downstream processing
        const payload: IngestionProcessMessage = {
          jobId,
          ingestionFileId: ingestionFile.id,
          driveFileId: file.id,
          stage: AssetState.DISCOVERED,
          attempt: 1,
          timestamp: new Date().toISOString(),
        };

        await this.sqsQueue.sendMessage('ingestion', payload);
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
}
