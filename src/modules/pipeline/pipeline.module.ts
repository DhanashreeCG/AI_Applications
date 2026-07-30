import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { DriveModule } from '../drive/drive.module';
import { ImageModule } from '../image/image.module';
import { StorageModule } from '../storage/storage.module';
import { AiModule } from '../ai/ai.module';
import { SearchModule } from '../search/search.module';
import { AssetPipelineService } from './services/asset-pipeline.service';
import { PipelineRetryService } from './services/pipeline-retry.service';
import { PipelineController } from './pipeline.controller';
import { SqsWorkerService } from '../queue/sqs-worker.service';

@Module({
  imports: [
    QueueModule,
    DriveModule,
    ImageModule,
    StorageModule,
    AiModule,
    SearchModule,
  ],
  controllers: [PipelineController],
  providers: [AssetPipelineService, PipelineRetryService, SqsWorkerService],
  exports: [AssetPipelineService, PipelineRetryService, SqsWorkerService],
})
export class PipelineModule {}
