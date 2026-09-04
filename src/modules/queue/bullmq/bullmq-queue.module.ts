import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import {
  createRedisConnection,
  normalizeBullMqPrefix,
  readRedisConnectionSettings,
} from '../../../common/redis/redis-connection.util';
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
        const settings = readRedisConnectionSettings(configService);
        return {
          prefix: normalizeBullMqPrefix(
            configService.get<string>('queueWorker.prefix'),
          ),
          connection: createRedisConnection(settings, {
            maxRetriesPerRequest: null,
          }),
        };
      },
    }),
    ...QUEUE_REGISTRATIONS,
  ],
  providers: [BullmqQueueService],
  exports: [BullmqQueueService, BullModule],
})
export class BullmqQueueModule {}
