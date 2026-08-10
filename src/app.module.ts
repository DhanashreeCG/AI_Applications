import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';
import { DatabaseModule } from './modules/database/database.module';
import { StorageModule } from './modules/storage/storage.module';
import { DriveModule } from './modules/drive/drive.module';
import { ImageModule } from './modules/image/image.module';
import { QueueModule } from './modules/queue/queue.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';
import { AiModule } from './modules/ai/ai.module';
import { CacheModule } from './modules/cache/cache.module';
import { SearchModule } from './modules/search/search.module';
import { PipelineModule } from './modules/pipeline/pipeline.module';
import { ObservabilityModule } from './modules/observability/observability.module';
import { FlashcardsModule } from './modules/flashcards/flashcards.module';
import { PipelineTrackerModule } from './modules/pipeline-tracker/pipeline-tracker.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env'],
    }),
    EventEmitterModule.forRoot({
      wildcard: false,
      ignoreErrors: true,
    }),
    ObservabilityModule,
    DatabaseModule,
    StorageModule,
    DriveModule,
    ImageModule,
    QueueModule,
    AiModule,
    CacheModule,
    SearchModule,
    PipelineModule,
    IngestionModule,
    PipelineTrackerModule,
    FlashcardsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
