import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';
import { StorageModule } from './modules/storage/storage.module';
import { DriveModule } from './modules/drive/drive.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    StorageModule,
    DriveModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
