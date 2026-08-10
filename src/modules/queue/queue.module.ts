import { Module } from '@nestjs/common';
import { BullmqQueueModule } from './bullmq/bullmq-queue.module';

/**
 * Application queue module — BullMQ producer surface.
 * Workers/processors are registered in PipelineModule.
 */
@Module({
  imports: [BullmqQueueModule],
  exports: [BullmqQueueModule],
})
export class QueueModule {}
