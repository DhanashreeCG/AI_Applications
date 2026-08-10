import { Global, Module } from '@nestjs/common';
import { StructuredLoggerService } from './structured-logger.service';
import { PipelineMetricsService } from './pipeline-metrics.service';
import { LoggingInterceptor } from './interceptors/logging.interceptor';
import { MetricsController } from './metrics.controller';

@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    StructuredLoggerService,
    PipelineMetricsService,
    LoggingInterceptor,
  ],
  exports: [StructuredLoggerService, PipelineMetricsService, LoggingInterceptor],
})
export class ObservabilityModule {}
