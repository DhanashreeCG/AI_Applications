import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
import { SearchModule } from './modules/search/search.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    DatabaseModule,
    StorageModule,
    DriveModule,
    ImageModule,
    QueueModule,
    AiModule,
    SearchModule,
    IngestionModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
