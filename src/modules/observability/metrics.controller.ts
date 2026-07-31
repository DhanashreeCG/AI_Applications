import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PipelineMetricsService } from './pipeline-metrics.service';

@ApiTags('observability')
@Controller('observability')
export class MetricsController {
  constructor(private readonly metrics: PipelineMetricsService) {}

  @Get('metrics')
  @ApiOperation({ summary: 'Pipeline metrics snapshot' })
  public getMetrics() {
    return this.metrics.getSnapshot();
  }
}
