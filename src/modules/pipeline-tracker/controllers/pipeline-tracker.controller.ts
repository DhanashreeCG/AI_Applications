import {
  Controller,
  Get,
  HttpStatus,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PipelineTrackerService } from '../services/pipeline-tracker.service';

@ApiTags('pipeline-tracker')
@Controller()
export class PipelineTrackerController {
  constructor(private readonly tracker: PipelineTrackerService) {}

  @Get('observability/pipeline-tracker/metrics')
  @ApiOperation({ summary: 'In-memory flashcard pipeline tracker metrics' })
  getMetrics() {
    this.ensureEnabled();
    return this.tracker.getMetricsSnapshot();
  }

  @Get('pipeline-tracker/executions/recent')
  @ApiOperation({ summary: 'List recent pipeline executions' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'workflowType', required: false })
  async listRecent(
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('workflowType') workflowType?: string,
  ) {
    this.ensureEnabled();
    const parsedLimit = limit ? parseInt(limit, 10) : 50;
    return this.tracker.findRecentExecutions({
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 50,
      status,
      workflowType,
    });
  }

  @Get('pipeline-tracker/executions')
  @ApiOperation({ summary: 'Lookup pipeline executions by requestId' })
  @ApiQuery({ name: 'requestId', required: true })
  async getByRequestId(@Query('requestId') requestId?: string) {
    this.ensureEnabled();
    if (!requestId?.trim()) {
      return [];
    }
    return this.tracker.findExecutionsByRequestId(requestId.trim());
  }

  @Get('pipeline-tracker/executions/:id')
  @ApiOperation({ summary: 'Get a pipeline execution by id' })
  async getById(@Param('id') id: string) {
    this.ensureEnabled();
    const execution = await this.tracker.findExecutionById(id);
    if (!execution) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        message: `Pipeline execution ${id} not found`,
      });
    }
    return execution;
  }

  private ensureEnabled(): void {
    if (!this.tracker.isEnabled()) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        message: 'Pipeline tracking is disabled',
      });
    }
  }
}
