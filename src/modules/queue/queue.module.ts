import { Module } from '@nestjs/common';
import { BullmqQueueModule } from './bullmq/bullmq-queue.module';
import { BullmqQueueService } from './bullmq/bullmq-queue.service';

/**
 * Application queue module — BullMQ producer surface.
 * Workers/processors are registered in PipelineModule.
 */
@Module({
  imports: [BullmqQueueModule],
  exports: [BullmqQueueModule, BullmqQueueService],
})
export class QueueModule {}
