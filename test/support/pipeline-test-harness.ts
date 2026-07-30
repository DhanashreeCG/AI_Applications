import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import request from 'supertest';
import { App } from 'supertest/types';
import configuration from '../../src/config/configuration';
import { DatabaseModule } from '../../src/modules/database/database.module';
import { ObservabilityModule } from '../../src/modules/observability/observability.module';
import { ImageModule } from '../../src/modules/image/image.module';
import { IngestionModule } from '../../src/modules/ingestion/ingestion.module';
import { PipelineModule } from '../../src/modules/pipeline/pipeline.module';
import { SearchModule } from '../../src/modules/search/search.module';
import { AiModule } from '../../src/modules/ai/ai.module';
import { PrismaService } from '../../src/modules/database/prisma.service';
import { SqsQueueService } from '../../src/modules/queue/sqs-queue.service';
import { GoogleDriveAdapterService } from '../../src/modules/drive/google-drive-adapter.service';
import { S3StorageService } from '../../src/modules/storage/s3-storage.service';
import { GeminiVisionProvider } from '../../src/modules/ai/providers/gemini-vision.provider';
import { OpenAiEmbeddingProvider } from '../../src/modules/ai/providers/openai-embedding.provider';
import { RedisCacheService } from '../../src/modules/cache/redis-cache.service';
import { VectorStorageService } from '../../src/modules/search/vector-storage.service';
import { QueueName } from '../../src/modules/queue/queue-topology.constants';
import { AssetPipelineService } from '../../src/modules/pipeline/services/asset-pipeline.service';
import { IngestionJobService } from '../../src/modules/ingestion/ingestion-job.service';
import { InMemoryDatabase } from './in-memory-database';
import { TestPrismaService } from './test-prisma.service';
import { MockSqsQueueService } from './mock-sqs-queue.service';
import {
  MockGeminiVisionProvider,
  MockGoogleDriveAdapterService,
  MockOpenAiEmbeddingProvider,
  MockRedisCacheService,
  MockS3StorageService,
} from './mock-external-services';
import { InMemoryVectorStorageService } from './in-memory-vector-storage.service';
import { TEST_DRIVE_FOLDER_ID } from './fixtures/pipeline-data.fixture';

const PROCESSING_QUEUE_ORDER: QueueName[] = [
  'ingestion',
  's3Upload',
  'aiMetadata',
  'embedding',
];

export class PipelineTestHarness {
  private app!: INestApplication<App>;

  public readonly db = new InMemoryDatabase();
  public readonly mockSqs = new MockSqsQueueService();
  public readonly mockRedis = new MockRedisCacheService();
  public readonly testPrisma = new TestPrismaService(this.db);

  public pipelineService!: AssetPipelineService;
  public ingestionService!: IngestionJobService;
  public moduleRef!: TestingModule;

  public async init(): Promise<void> {
    this.db.reset();
    this.mockSqs.reset();
    this.mockRedis.reset();

    this.moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [configuration],
        }),
        DatabaseModule,
        ObservabilityModule,
        ImageModule,
        AiModule,
        IngestionModule,
        PipelineModule,
        SearchModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(this.testPrisma)
      .overrideProvider(SqsQueueService)
      .useValue(this.mockSqs)
      .overrideProvider(GoogleDriveAdapterService)
      .useValue(new MockGoogleDriveAdapterService())
      .overrideProvider(S3StorageService)
      .useValue(new MockS3StorageService())
      .overrideProvider(GeminiVisionProvider)
      .useValue(new MockGeminiVisionProvider())
      .overrideProvider(OpenAiEmbeddingProvider)
      .useValue(new MockOpenAiEmbeddingProvider())
      .overrideProvider(RedisCacheService)
      .useValue(this.mockRedis)
      .overrideProvider(VectorStorageService)
      .useValue(new InMemoryVectorStorageService(this.testPrisma))
      .compile();

    this.app = this.moduleRef.createNestApplication();
    await this.app.init();

    this.pipelineService = this.moduleRef.get(AssetPipelineService);
    this.ingestionService = this.moduleRef.get(IngestionJobService);
  }

  public async close(): Promise<void> {
    await this.app.close();
  }

  public getHttpServer() {
    return this.app.getHttpServer();
  }

  public async createAndDiscoverJob(useHttp = false) {
    if (useHttp) {
      const createResponse = await request(this.getHttpServer())
        .post('/asset-ingestion/jobs')
        .send({
          sourceType: 'GOOGLE_DRIVE',
          rootFolderId: TEST_DRIVE_FOLDER_ID,
        })
        .expect(201);

      const jobId = createResponse.body.jobId as string;
      await this.waitForJobDiscovery(jobId);
      return jobId;
    }

    const job = await this.ingestionService.createJob({
      sourceType: 'GOOGLE_DRIVE',
      rootFolderId: TEST_DRIVE_FOLDER_ID,
    });
    await this.ingestionService.startJobDiscovery(job.id);
    return job.id;
  }

  private async waitForJobDiscovery(jobId: string): Promise<void> {
    for (let attempt = 0; attempt < 50; attempt++) {
      const job = await this.ingestionService.getJob(jobId);
      if (job?.status === 'PROCESSING' || job?.status === 'FAILED') {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    throw new Error(`Timed out waiting for discovery on job ${jobId}`);
  }

  public async processAllQueuedMessages(): Promise<void> {
    for (const queueName of PROCESSING_QUEUE_ORDER) {
      let message = this.mockSqs.dequeue(queueName);

      while (message) {
        await this.pipelineService.processQueueMessage(
          queueName,
          message.body as never,
          message.messageId,
        );
        message = this.mockSqs.dequeue(queueName);
      }
    }
  }

  public async runFullPipeline() {
    const jobId = await this.createAndDiscoverJob();
    await this.processAllQueuedMessages();
    return jobId;
  }
}
