import { Test, TestingModule } from '@nestjs/testing';
import { IngestionJobService } from './ingestion-job.service';
import { PrismaService } from '../database/prisma.service';
import { BullmqQueueService } from '../queue/bullmq/bullmq-queue.service';
import { GoogleDriveAdapterService } from '../drive/google-drive-adapter.service';
import { ImageProcessorService } from '../image/image-processor.service';
import { PipelineMetricsService } from '../observability/pipeline-metrics.service';
import { CostEstimatorService } from './services/cost-estimator.service';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { JobState, AssetState } from '../../common/enums/asset-state.enum';

describe('IngestionJobService', () => {
  let service: IngestionJobService;

  const mockPrisma = {
    ingestionJob: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    ingestionFile: {
      upsert: jest.fn(),
      update: jest.fn(),
    },
    asset: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    assetSource: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(async (fn: any) => fn(mockPrisma)),
  };

  const mockQueue = {
    sendMessage: jest.fn().mockResolvedValue('queue-job-id-123'),
  };

  const mockDriveAdapter = {
    listFilesInFolderRecursive: jest.fn(),
    downloadFileStream: jest.fn(),
  };

  const mockImageProcessor = {
    validateImage: jest.fn(),
    calculateSha256: jest.fn(),
  };

  const mockMetrics = {
    incrementDiscovered: jest.fn(),
    incrementDuplicates: jest.fn(),
    incrementSuccessful: jest.fn(),
  };

  const mockCostEstimator = {
    estimateFromCounts: jest.fn().mockReturnValue({
      imagesDiscovered: 1,
      duplicates: 0,
      uniqueImages: 1,
      alreadyProcessed: 0,
      newAssets: 1,
      expectedGeminiCalls: 1,
      expectedEmbeddingCalls: 1,
      estimatedGeminiCostUsd: 0.001,
      estimatedOpenAiCostUsd: 0.00002,
      estimatedTotalCostUsd: 0.00102,
    }),
    estimateForJob: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IngestionJobService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: BullmqQueueService, useValue: mockQueue },
        { provide: GoogleDriveAdapterService, useValue: mockDriveAdapter },
        { provide: ImageProcessorService, useValue: mockImageProcessor },
        { provide: PipelineMetricsService, useValue: mockMetrics },
        { provide: CostEstimatorService, useValue: mockCostEstimator },
      ],
    }).compile();

    service = module.get<IngestionJobService>(IngestionJobService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create an ingestion job', async () => {
    const dto = {
      sourceType: 'GOOGLE_DRIVE' as const,
      rootFolderId: 'folder-abc',
    };
    const mockJob = {
      id: 'job-001',
      status: JobState.CREATED,
      mode: 'FULL',
      ...dto,
    };
    mockPrisma.ingestionJob.create.mockResolvedValue(mockJob);

    const result = await service.createJob(dto);
    expect(result.id).toBe('job-001');
    expect(mockPrisma.ingestionJob.create).toHaveBeenCalledWith({
      data: {
        sourceType: 'GOOGLE_DRIVE',
        rootFolderId: 'folder-abc',
        mode: 'FULL',
        readFileNames: false,
        status: JobState.CREATED,
      },
    });
  });

  it('should persist readFileNames when requested', async () => {
    const dto = {
      sourceType: 'GOOGLE_DRIVE' as const,
      rootFolderId: 'folder-abc',
      readFileNames: true,
    };
    mockPrisma.ingestionJob.create.mockResolvedValue({
      id: 'job-002',
      status: JobState.CREATED,
      mode: 'FULL',
      ...dto,
    });

    await service.createJob(dto);

    expect(mockPrisma.ingestionJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ readFileNames: true }),
    });
  });

  it('should discover files and enqueue without downloading', async () => {
    const jobId = 'job-001';
    const mockJob = {
      id: jobId,
      rootFolderId: 'folder-abc',
      status: JobState.CREATED,
      mode: 'FULL',
    };
    mockPrisma.ingestionJob.findUnique.mockResolvedValue(mockJob);
    mockPrisma.ingestionJob.update.mockResolvedValue({});
    mockDriveAdapter.listFilesInFolderRecursive.mockResolvedValue([
      {
        id: 'file-001',
        name: 'cat.png',
        mimeType: 'image/png',
        size: BigInt(2048),
        folderPath: 'Animals',
        createdAt: new Date(),
      },
    ]);
    mockPrisma.ingestionFile.upsert.mockResolvedValue({
      id: 'ingest-file-001',
      driveFileId: 'file-001',
      jobId,
      status: AssetState.DISCOVERED,
    });

    await service.startJobDiscovery(jobId);

    expect(mockDriveAdapter.listFilesInFolderRecursive).toHaveBeenCalledWith(
      'folder-abc',
    );
    expect(mockPrisma.ingestionFile.upsert).toHaveBeenCalledTimes(1);
    expect(mockDriveAdapter.downloadFileStream).not.toHaveBeenCalled();
    expect(mockPrisma.asset.create).not.toHaveBeenCalled();
    expect(mockQueue.sendMessage).toHaveBeenCalledWith(
      'ingestion',
      expect.objectContaining({
        jobId,
        driveFileId: 'file-001',
        stage: AssetState.DISCOVERED,
        ingestionFileId: 'ingest-file-001',
      }),
    );
    expect(mockPrisma.ingestionJob.update).toHaveBeenLastCalledWith({
      where: { id: jobId },
      data: {
        status: JobState.PROCESSING,
        totalDiscovered: 1,
      },
    });
  });

  it('should reject discovery for a missing job', async () => {
    mockPrisma.ingestionJob.findUnique.mockResolvedValue(null);

    await expect(
      service.startJobDiscovery('missing-job'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mockDriveAdapter.listFilesInFolderRecursive).not.toHaveBeenCalled();
  });

  it('should reject discovery for a job already being processed', async () => {
    mockPrisma.ingestionJob.findUnique.mockResolvedValue({
      id: 'job-001',
      rootFolderId: 'folder-abc',
      status: JobState.PROCESSING,
      mode: 'FULL',
    });

    await expect(service.startJobDiscovery('job-001')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(mockPrisma.ingestionJob.update).not.toHaveBeenCalled();
  });

  it('should mark the job failed when discovery throws', async () => {
    mockPrisma.ingestionJob.findUnique.mockResolvedValue({
      id: 'job-001',
      rootFolderId: 'folder-abc',
      status: JobState.CREATED,
      mode: 'FULL',
    });
    mockPrisma.ingestionJob.update.mockResolvedValue({});
    mockDriveAdapter.listFilesInFolderRecursive.mockRejectedValue(
      new Error('Drive unavailable'),
    );

    await expect(service.startJobDiscovery('job-001')).rejects.toThrow(
      'Drive unavailable',
    );
    expect(mockPrisma.ingestionJob.update).toHaveBeenLastCalledWith({
      where: { id: 'job-001' },
      data: { status: JobState.FAILED, errorMessage: 'Drive unavailable' },
    });
  });
});
