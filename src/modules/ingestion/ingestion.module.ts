import { Module } from '@nestjs/common';
import { DriveModule } from '../drive/drive.module';
import { QueueModule } from '../queue/queue.module';
import { ImageModule } from '../image/image.module';
import { StorageModule } from '../storage/storage.module';
import { IngestionJobService } from './ingestion-job.service';
import { IngestionController } from './ingestion.controller';

@Module({
  imports: [DriveModule, QueueModule, ImageModule, StorageModule],
  providers: [IngestionJobService],
  controllers: [IngestionController],
  exports: [IngestionJobService],
})
export class IngestionModule {}
