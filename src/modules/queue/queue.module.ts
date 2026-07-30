import { Module } from '@nestjs/common';
import { SqsQueueService } from './sqs-queue.service';

@Module({
  providers: [SqsQueueService],
  exports: [SqsQueueService],
})
export class QueueModule {}
