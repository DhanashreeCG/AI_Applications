import { Module } from '@nestjs/common';
import { NoopOtelAdapter } from './adapters/otel.adapter';
import { NoopSentryAdapter } from './adapters/sentry.adapter';
import { PipelineTrackerController } from './controllers/pipeline-tracker.controller';
import { PipelineTrackerListener } from './listeners/pipeline-tracker.listener';
import {
  OTEL_ADAPTER,
  SENTRY_ADAPTER,
} from './pipeline-tracker.constants';
import { PipelineTrackerRepository } from './repository/pipeline-tracker.repository';
import { PipelineTrackerMetricsService } from './services/pipeline-tracker-metrics.service';
import { PipelineTrackerService } from './services/pipeline-tracker.service';

/**
 * Removable observability plugin for workflow pipelines (flashcards first).
 * Business modules must not import this module's services — only emit events.
 */
@Module({
  controllers: [PipelineTrackerController],
  providers: [
    PipelineTrackerRepository,
    PipelineTrackerMetricsService,
    PipelineTrackerService,
    PipelineTrackerListener,
    { provide: OTEL_ADAPTER, useClass: NoopOtelAdapter },
    { provide: SENTRY_ADAPTER, useClass: NoopSentryAdapter },
  ],
  exports: [PipelineTrackerService],
})
export class PipelineTrackerModule {}
