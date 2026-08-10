import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../queue-topology.constants';
import { BullmqQueueService } from './bullmq-queue.service';

const QUEUE_REGISTRATIONS = [
  QUEUE_NAMES.ingestion,
  QUEUE_NAMES.s3Upload,
  QUEUE_NAMES.aiMetadata,
  QUEUE_NAMES.embedding,
  QUEUE_NAMES.dlq,
].map((name) => BullModule.registerQueue({ name }));

@Module({
  imports: [
    ConfigModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const password = configService.get<string>('redis.password');
        return {
          prefix: configService.get<string>('queueWorker.prefix') || 'asset-ingestion',
          connection: {
            host: configService.get<string>('redis.host') || 'localhost',
            port: configService.get<number>('redis.port') || 6379,
            password: password || undefined,
            maxRetriesPerRequest: null,
          },
        };
      },
    }),
    ...QUEUE_REGISTRATIONS,
  ],
  providers: [BullmqQueueService],
  exports: [BullmqQueueService, BullModule],
})
export class BullmqQueueModule {}
