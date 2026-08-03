import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AssetState } from '../../../common/enums/asset-state.enum';
import { PrismaService } from '../../database/prisma.service';
import { BullmqQueueService } from '../../queue/bullmq/bullmq-queue.service';
import { PipelineRetryService } from './pipeline-retry.service';
import { PipelineMetricsService } from '../../observability/pipeline-metrics.service';

describe('PipelineRetryService', () => {
  let service: PipelineRetryService;

  const mockMetrics = {
    incrementRetries: jest.fn(),
    incrementDlq: jest.fn(),
    incrementFailed: jest.fn(),
  };

  const mockPrisma = {
    processingAttempt: { create: jest.fn() },
    asset: { update: jest.fn(), findUnique: jest.fn() },
    ingestionFile: { update: jest.fn(), findUnique: jest.fn() },
    ingestionJob: { update: jest.fn() },
    assetMetadata: { findUnique: jest.fn() },
  };

  const mockQueue = {
    sendMessage: jest.fn(),
    dispatchToDlq: jest.fn(),
    dispatchIngestion: jest.fn(),
    dispatchS3Upload: jest.fn(),
    dispatchAiMetadata: jest.fn(),
    dispatchEmbedding: jest.fn(),
  };

  const baseMessage = {
    jobId: 'job-001',
    ingestionFileId: 'file-001',
    assetId: 'asset-001',
    attempt: 1,
    timestamp: '2026-07-30T00:00:00.000Z',
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PipelineRetryService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: BullmqQueueService, useValue: mockQueue },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'pipeline.maxAttempts') return 3;
              if (key === 'pipeline.backoffBaseSeconds') return 30;
              if (key === 'pipeline.backoffMaxSeconds') return 900;
              return undefined;
            }),
          },
        },
        { provide: PipelineMetricsService, useValue: mockMetrics },
      ],
    }).compile();

    service = module.get<PipelineRetryService>(PipelineRetryService);
  });

  it('should schedule a delayed retry for transient failures', async () => {
    mockQueue.sendMessage.mockResolvedValue('retry-msg-001');

    await service.handleFailure({
      stage: AssetState.GENERATING_METADATA,
      message: baseMessage,
      error: new Error('HTTP 503 Service Unavailable'),
    });

    expect(mockQueue.sendMessage).toHaveBeenCalledWith(
      'aiMetadata',
      expect.objectContaining({ attempt: 2 }),
      expect.objectContaining({ delaySeconds: expect.any(Number) }),
    );
    expect(mockPrisma.asset.update).toHaveBeenCalledWith({
      where: { id: 'asset-001' },
      data: { status: 'RETRY_PENDING' },
    });
    expect(mockQueue.dispatchToDlq).not.toHaveBeenCalled();
    expect(mockMetrics.incrementRetries).toHaveBeenCalled();
  });

  it('should move non-retryable failures to the DLQ', async () => {
    await service.handleFailure({
      stage: AssetState.VALIDATING,
      message: baseMessage,
      error: new Error('Corrupted or invalid image file'),
    });

    expect(mockQueue.dispatchToDlq).toHaveBeenCalledWith(
      expect.objectContaining({
        failedStage: AssetState.VALIDATING,
        errorCode: 'VALIDATION_ERROR',
      }),
    );
    expect(mockPrisma.asset.update).toHaveBeenCalledWith({
      where: { id: 'asset-001' },
      data: { status: 'DEAD_LETTER' },
    });
    expect(mockMetrics.incrementDlq).toHaveBeenCalled();
    expect(mockMetrics.incrementFailed).toHaveBeenCalled();
  });

  it('should replay DLQ messages back to the original stage queue', async () => {
    mockPrisma.ingestionFile.findUnique.mockResolvedValue({
      id: 'file-001',
      driveFileId: 'drive-001',
    });
    mockPrisma.asset.findUnique.mockResolvedValue({
      id: 'asset-001',
      contentHash: 'hash-123',
      s3ObjectKey: 'assets/asset-001/original/cat.png',
    });
    mockQueue.dispatchIngestion.mockResolvedValue('replay-msg-001');

    const messageId = await service.replayFromDlq({
      ...baseMessage,
      failedStage: AssetState.DISCOVERED,
      errorCode: 'TRANSIENT_ERROR',
      errorMessage: 'Temporary outage',
    });

    expect(mockQueue.dispatchIngestion).toHaveBeenCalledWith(
      expect.objectContaining({
        driveFileId: 'drive-001',
        attempt: 1,
      }),
    );
    expect(messageId).toBe('replay-msg-001');
  });

  it('should replay VALIDATING stage failures to the ingestion queue', async () => {
    mockPrisma.ingestionFile.findUnique.mockResolvedValue({
      id: 'file-001',
      driveFileId: 'drive-001',
    });
    mockPrisma.asset.findUnique.mockResolvedValue({
      id: 'asset-001',
      contentHash: 'hash-123',
      s3ObjectKey: 'assets/asset-001/original/cat.png',
    });
    mockQueue.dispatchIngestion.mockResolvedValue('replay-msg-002');

    const messageId = await service.replayFromDlq({
      ...baseMessage,
      failedStage: AssetState.VALIDATING,
      errorCode: 'NON_RETRYABLE_ERROR',
      errorMessage: 'Corrupted image',
    });

    expect(mockQueue.dispatchIngestion).toHaveBeenCalledWith(
      expect.objectContaining({
        driveFileId: 'drive-001',
        stage: AssetState.DOWNLOADING,
      }),
    );
    expect(messageId).toBe('replay-msg-002');
  });
});
