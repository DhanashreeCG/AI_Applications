import { Test, TestingModule } from '@nestjs/testing';
import { IngestionJobService } from './ingestion-job.service';
import { PrismaService } from '../database/prisma.service';
import { SqsQueueService } from '../queue/sqs-queue.service';
import { GoogleDriveAdapterService } from '../drive/google-drive-adapter.service';
import { ImageProcessorService } from '../image/image-processor.service';
import { S3StorageService } from '../storage/s3-storage.service';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { JobState, AssetState } from '../../common/enums/asset-state.enum';
import { Readable } from 'stream';

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
    },
    $transaction: jest.fn(async (fn: any) => fn(mockPrisma)),
  };

  const mockSqsQueue = {
    sendMessage: jest.fn().mockResolvedValue('sqs-msg-id-123'),
  };

  const mockDriveAdapter = {
    listFilesInFolderRecursive: jest.fn(),
    downloadFileStream: jest.fn(),
  };

  const mockImageProcessor = {
    validateImage: jest.fn(),
    calculateSha256: jest.fn(),
  };

  const mockStorageService = {
    generateCanonicalKey: jest.fn().mockReturnValue('assets/asset-001/original/cat.png'),
    getDefaultBucket: jest.fn().mockReturnValue('ai-asset-ingestion'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IngestionJobService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SqsQueueService, useValue: mockSqsQueue },
        { provide: GoogleDriveAdapterService, useValue: mockDriveAdapter },
        { provide: ImageProcessorService, useValue: mockImageProcessor },
        { provide: S3StorageService, useValue: mockStorageService },
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
    mockDriveAdapter.downloadFileStream.mockResolvedValue(Readable.from([Buffer.from('fake-image-bytes')]));
    mockImageProcessor.validateImage.mockResolvedValue({
      isValid: true,
      mimeType: 'image/png',
      width: 1200,
      height: 900,
      size: 16,
      orientation: 'landscape',
      format: 'png',
    });
    mockImageProcessor.calculateSha256.mockResolvedValue('hash-123');
    mockPrisma.asset.findUnique.mockResolvedValue(null);
    mockPrisma.asset.create.mockResolvedValue({ id: 'asset-001' });
    mockPrisma.assetSource.create.mockResolvedValue({});
    mockPrisma.ingestionFile.update.mockResolvedValue({});

    await service.startJobDiscovery(jobId);

    expect(mockDriveAdapter.listFilesInFolderRecursive).toHaveBeenCalledWith(
      'folder-abc',
    );
    expect(mockPrisma.ingestionFile.upsert).toHaveBeenCalledTimes(1);
    expect(mockDriveAdapter.downloadFileStream).toHaveBeenCalledWith('file-001');
    expect(mockPrisma.asset.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contentHash: 'hash-123',
        mimeType: 'image/png',
        s3ObjectKey: 'assets/asset-001/original/cat.png',
      }),
    });
    expect(mockSqsQueue.sendMessage).toHaveBeenCalledWith(
      'ingestion',
      expect.objectContaining({
        jobId,
        driveFileId: 'file-001',
        stage: AssetState.DISCOVERED,
        assetId: 'asset-001',
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

  it('should reuse an existing asset when the hash already exists', async () => {
    const jobId = 'job-001';
    mockPrisma.ingestionJob.findUnique.mockResolvedValue({
      id: jobId,
      rootFolderId: 'folder-abc',
      status: JobState.CREATED,
    });
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
    mockDriveAdapter.downloadFileStream.mockResolvedValue(Readable.from([Buffer.from('fake-image-bytes')]));
    mockImageProcessor.validateImage.mockResolvedValue({
      isValid: true,
      mimeType: 'image/png',
      width: 1200,
      height: 900,
      size: 16,
      orientation: 'landscape',
      format: 'png',
    });
    mockImageProcessor.calculateSha256.mockResolvedValue('hash-123');
    mockPrisma.asset.findUnique.mockResolvedValue({ id: 'asset-existing' });
    mockPrisma.assetSource.create.mockResolvedValue({});
    mockPrisma.ingestionFile.update.mockResolvedValue({});

    await service.startJobDiscovery(jobId);

    expect(mockPrisma.asset.create).not.toHaveBeenCalled();
    expect(mockSqsQueue.sendMessage).not.toHaveBeenCalled();
    expect(mockPrisma.assetSource.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        assetId: 'asset-existing',
        ingestionFileId: 'ingest-file-001',
      }),
    });
    expect(mockPrisma.ingestionJob.update).toHaveBeenCalledWith({
      where: { id: jobId },
      data: expect.objectContaining({ totalDuplicate: { increment: 1 } }),
    });
  });
});
