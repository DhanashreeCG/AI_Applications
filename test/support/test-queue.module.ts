import { Module } from '@nestjs/common';
import { BullmqQueueService } from '../../src/modules/queue/bullmq/bullmq-queue.service';
import { MockPipelineQueueService } from './mock-pipeline-queue.service';

/**
 * Test-only queue module that avoids Redis/BullMQ connections.
 */
@Module({
  providers: [
    {
      provide: BullmqQueueService,
      useClass: MockPipelineQueueService,
    },
  ],
  exports: [BullmqQueueService],
})
export class TestQueueModule {}
