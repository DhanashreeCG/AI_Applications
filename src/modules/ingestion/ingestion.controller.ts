import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IngestionJobService } from './ingestion-job.service';
import { CreateIngestionJobDto } from './dto/create-ingestion-job.dto';
import { CleanupByFolderDto } from './dto/cleanup-by-folder.dto';
import { getErrorMessage } from '../../common/utils/error-message';

@ApiTags('asset-ingestion')
@Controller('asset-ingestion')
export class IngestionController {
  private readonly logger = new Logger(IngestionController.name);

  constructor(private readonly ingestionJobService: IngestionJobService) {}

  @Post('jobs')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create ingestion job (FULL or DRY_RUN)' })
  async createJob(@Body() dto: CreateIngestionJobDto) {
    const job = await this.ingestionJobService.createJob(dto);
    // Trigger discovery asynchronously (fire-and-forget)
    this.ingestionJobService
      .startJobDiscovery(job.id)
      .catch((error: unknown) => {
        this.logger.error(
          `Background discovery failed for job ${job.id}: ${getErrorMessage(error)}`,
        );
      });
    return {
      jobId: job.id,
      status: job.status,
      mode: job.mode,
      message:
        job.mode === 'DRY_RUN'
          ? 'Dry-run ingestion job started'
          : 'Ingestion job started',
    };
  }

  @Post('cleanup/by-folder')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Delete DB assets ingested from a Drive rootFolderId (keeps AiUsage + S3)',
  })
  @ApiBody({ type: CleanupByFolderDto })
  async cleanupByFolder(@Body() dto: CleanupByFolderDto) {
    return this.ingestionJobService.cleanupByFolder(dto);
  }

  @Get('jobs')
  @ApiOperation({ summary: 'List ingestion jobs' })
  async listJobs() {
    return this.ingestionJobService.listJobs();
  }

  @Get('jobs/:id')
  @ApiOperation({ summary: 'Get ingestion job by id' })
  async getJob(@Param('id') id: string) {
    const job = await this.ingestionJobService.getJob(id);
    if (!job) {
      throw new NotFoundException(`Job ${id} not found`);
    }
    return job;
  }

  @Get('jobs/:id/estimate')
  @ApiOperation({ summary: 'Get cost estimate for a job' })
  async estimateJob(@Param('id') id: string) {
    return this.ingestionJobService.estimateJob(id);
  }
}
