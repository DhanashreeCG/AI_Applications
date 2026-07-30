import { Controller, Get } from '@nestjs/common';
import { PipelineMetricsService } from './pipeline-metrics.service';

@Controller('observability')
export class MetricsController {
  constructor(private readonly metrics: PipelineMetricsService) {}

  @Get('metrics')
  public getMetrics() {
    return this.metrics.getSnapshot();
  }
}
