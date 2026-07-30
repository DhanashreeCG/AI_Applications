import { Module } from '@nestjs/common';
import { DriveModule } from '../drive/drive.module';
import { QueueModule } from '../queue/queue.module';
import { IngestionJobService } from './ingestion-job.service';
import { IngestionController } from './ingestion.controller';

@Module({
  imports: [DriveModule, QueueModule],
  providers: [IngestionJobService],
  controllers: [IngestionController],
  exports: [IngestionJobService],
})
export class IngestionModule {}
