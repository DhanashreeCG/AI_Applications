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
import { IngestionProcessor } from '../queue/bullmq/processors/ingestion.processor';
import { S3UploadProcessor } from '../queue/bullmq/processors/s3-upload.processor';
import { AiMetadataProcessor } from '../queue/bullmq/processors/ai-metadata.processor';
import { EmbeddingProcessor } from '../queue/bullmq/processors/embedding.processor';

const workersEnabled =
  (process.env.QUEUE_WORKER_ENABLED ?? process.env.SQS_WORKER_ENABLED) !==
  'false';

const workerProviders = workersEnabled
  ? [
      IngestionProcessor,
      S3UploadProcessor,
      AiMetadataProcessor,
      EmbeddingProcessor,
    ]
  : [];

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
  providers: [AssetPipelineService, PipelineRetryService, ...workerProviders],
  exports: [AssetPipelineService, PipelineRetryService],
})
export class PipelineModule {}
