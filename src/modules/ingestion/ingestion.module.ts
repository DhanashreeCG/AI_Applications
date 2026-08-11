import { Module } from '@nestjs/common';
import { DriveModule } from '../drive/drive.module';
import { QueueModule } from '../queue/queue.module';
import { ImageModule } from '../image/image.module';
import { IngestionJobService } from './ingestion-job.service';
import { IngestionController } from './ingestion.controller';
import { CostEstimatorService } from './services/cost-estimator.service';

@Module({
  imports: [DriveModule, QueueModule, ImageModule],
  providers: [IngestionJobService, CostEstimatorService],
  controllers: [IngestionController],
  exports: [IngestionJobService, CostEstimatorService],
})
export class IngestionModule {}
