import { Test, TestingModule } from '@nestjs/testing';
import { IngestionJobService } from './ingestion-job.service';
import { PrismaService } from '../database/prisma.service';
import { SqsQueueService } from '../queue/sqs-queue.service';
import { GoogleDriveAdapterService } from '../drive/google-drive-adapter.service';
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
    },
  };

  const mockSqsQueue = {
    sendMessage: jest.fn().mockResolvedValue('sqs-msg-id-123'),
  };

  const mockDriveAdapter = {
    listFilesInFolderRecursive: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IngestionJobService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SqsQueueService, useValue: mockSqsQueue },
        { provide: GoogleDriveAdapterService, useValue: mockDriveAdapter },
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
    const mockJob = { id: 'job-001', status: JobState.CREATED, ...dto };
    mockPrisma.ingestionJob.create.mockResolvedValue(mockJob);

    const result = await service.createJob(dto);
    expect(result.id).toBe('job-001');
    expect(mockPrisma.ingestionJob.create).toHaveBeenCalledWith({
      data: {
        sourceType: 'GOOGLE_DRIVE',
        rootFolderId: 'folder-abc',
        status: JobState.CREATED,
      },
    });
  });

  it('should discover files and dispatch SQS messages', async () => {
    const jobId = 'job-001';
    const mockJob = {
      id: jobId,
      rootFolderId: 'folder-abc',
      status: JobState.CREATED,
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
    expect(mockSqsQueue.sendMessage).toHaveBeenCalledWith(
      'ingestion',
      expect.objectContaining({
        jobId,
        driveFileId: 'file-001',
        stage: AssetState.DISCOVERED,
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
