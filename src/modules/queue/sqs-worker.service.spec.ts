import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AssetPipelineService } from '../pipeline/services/asset-pipeline.service';
import { SqsWorkerService } from './sqs-worker.service';
import { SqsQueueService } from './sqs-queue.service';

describe('SqsWorkerService', () => {
  let service: SqsWorkerService;

  const mockPipeline = {
    processQueueMessage: jest.fn(),
  };

  const mockSqsQueue = {
    getProcessingQueues: jest.fn().mockReturnValue(['ingestion']),
    receiveMessages: jest.fn(),
    deleteMessage: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SqsWorkerService,
        { provide: SqsQueueService, useValue: mockSqsQueue },
        { provide: AssetPipelineService, useValue: mockPipeline },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'sqsWorker.enabled') return false;
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<SqsWorkerService>(SqsWorkerService);
  });

  it('should not start when disabled', async () => {
    await service.onModuleInit();
    expect(service.isRunning()).toBe(false);
    expect(mockSqsQueue.receiveMessages).not.toHaveBeenCalled();
  });

  it('deletes message after successful processing when enabled', async () => {
    const enabledService = await createEnabledService();
    mockSqsQueue.receiveMessages
      .mockResolvedValueOnce([
        {
          messageId: 'msg-001',
          receiptHandle: 'receipt-001',
          body: {
            jobId: 'job-001',
            ingestionFileId: 'file-001',
            assetId: 'asset-001',
            attempt: 1,
            timestamp: '2026-07-30T00:00:00.000Z',
            driveFileId: 'drive-001',
            stage: 'DOWNLOADING',
          },
          attributes: {},
        },
      ])
      .mockImplementation(async () => {
        await enabledService.onModuleDestroy();
        return [];
      });

    mockPipeline.processQueueMessage.mockResolvedValue(undefined);

    await enabledService.onModuleInit();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockPipeline.processQueueMessage).toHaveBeenCalledWith(
      'ingestion',
      expect.objectContaining({ jobId: 'job-001' }),
      'msg-001',
    );
    expect(mockSqsQueue.deleteMessage).toHaveBeenCalledWith(
      'ingestion',
      'receipt-001',
    );
  });

  it('deletes message after failure because retry/DLQ uses new messages', async () => {
    const enabledService = await createEnabledService();
    mockSqsQueue.receiveMessages
      .mockResolvedValueOnce([
        {
          messageId: 'msg-002',
          receiptHandle: 'receipt-002',
          body: {
            jobId: 'job-001',
            ingestionFileId: 'file-001',
            assetId: 'asset-001',
            attempt: 1,
            timestamp: '2026-07-30T00:00:00.000Z',
            driveFileId: 'drive-001',
            stage: 'DOWNLOADING',
          },
          attributes: {},
        },
      ])
      .mockImplementation(async () => {
        await enabledService.onModuleDestroy();
        return [];
      });

    mockPipeline.processQueueMessage.mockRejectedValue(new Error('boom'));

    await enabledService.onModuleInit();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockSqsQueue.deleteMessage).toHaveBeenCalledWith(
      'ingestion',
      'receipt-002',
    );
  });

  async function createEnabledService(): Promise<SqsWorkerService> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SqsWorkerService,
        { provide: SqsQueueService, useValue: mockSqsQueue },
        { provide: AssetPipelineService, useValue: mockPipeline },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'sqsWorker.enabled') return true;
              if (key === 'sqsWorker.pollWaitSeconds') return 0;
              if (key === 'sqsWorker.concurrency') return 1;
              if (key === 'sqsWorker.shutdownTimeoutMs') return 1000;
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    return module.get<SqsWorkerService>(SqsWorkerService);
  }
});
