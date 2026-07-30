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
import { IngestionJobService } from './ingestion-job.service';
import { CreateIngestionJobDto } from './dto/create-ingestion-job.dto';
import { getErrorMessage } from '../../common/utils/error-message';

@Controller('asset-ingestion')
export class IngestionController {
  private readonly logger = new Logger(IngestionController.name);

  constructor(private readonly ingestionJobService: IngestionJobService) {}

  @Post('jobs')
  @HttpCode(HttpStatus.CREATED)
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
      message: 'Ingestion job started',
    };
  }

  @Get('jobs')
  async listJobs() {
    return this.ingestionJobService.listJobs();
  }

  @Get('jobs/:id')
  async getJob(@Param('id') id: string) {
    const job = await this.ingestionJobService.getJob(id);
    if (!job) {
      throw new NotFoundException(`Job ${id} not found`);
    }
    return job;
  }
}
