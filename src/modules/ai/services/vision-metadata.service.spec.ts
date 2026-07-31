import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AssetState } from '@generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { S3StorageService } from '../../storage/s3-storage.service';
import { ImageProcessorService } from '../../image/image-processor.service';
import { GeminiVisionProvider } from '../providers/gemini-vision.provider';
import { VisionMetadataService } from './vision-metadata.service';

describe('VisionMetadataService', () => {
  let service: VisionMetadataService;

  const mockAsset = {
    id: 'asset-001',
    contentHash: 'hash-123',
    mimeType: 'image/png',
    fileSize: BigInt(1024),
    s3Bucket: 'test-bucket',
    s3ObjectKey: 'assets/asset-001/original/cat.png',
    status: AssetState.STORED_IN_S3,
    metadata: null,
  };

  const mockAnalysis = {
    metadata: {
      caption: 'A red cat on a sofa.',
      objects: ['cat', 'sofa'],
      actions: ['sitting'],
      styles: ['photo'],
      colors: ['red'],
      background: 'living room',
      composition: 'centered subject',
      orientation: 'landscape',
      age_groups: ['6-10'],
      grades: ['kids'],
      educational_uses: ['worksheets'],
      search_keywords: ['pet'],
    },
    searchDescription: 'A red cat on a sofa.\ncat, sofa\nsitting',
    rawResponse: { caption: 'A red cat on a sofa.' },
    provider: 'google-gemini',
    model: 'gemini-2.5-flash',
    modelVersion: 'gemini-2.5-flash',
    promptVersion: 'v1',
  };

  const mockSavedMetadata = {
    id: 'metadata-001',
    assetId: 'asset-001',
    caption: mockAnalysis.metadata.caption,
    objects: mockAnalysis.metadata.objects,
    actions: mockAnalysis.metadata.actions,
    styles: mockAnalysis.metadata.styles,
    colors: mockAnalysis.metadata.colors,
    background: mockAnalysis.metadata.background,
    composition: mockAnalysis.metadata.composition,
    orientation: mockAnalysis.metadata.orientation,
    ageGroups: mockAnalysis.metadata.age_groups,
    grades: mockAnalysis.metadata.grades,
    educationalUses: mockAnalysis.metadata.educational_uses,
    searchKeywords: mockAnalysis.metadata.search_keywords,
    searchDescription: mockAnalysis.searchDescription,
    searchDescriptionHash: 'search-hash-123',
    rawResponse: mockAnalysis.rawResponse,
    provider: mockAnalysis.provider,
    model: mockAnalysis.model,
    modelVersion: mockAnalysis.modelVersion,
    promptVersion: mockAnalysis.promptVersion,
    metadataVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPrisma = {
    asset: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    assetMetadata: {
      upsert: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockStorage = {
    downloadBuffer: jest.fn(),
  };

  const mockImageProcessor = {
    generateAiOptimizedRepresentation: jest.fn(),
    calculateSha256: jest.fn(),
  };

  const mockVisionProvider = {
    analyzeImage: jest.fn(),
  };

  beforeEach(async () => {
    mockPrisma.asset.findUnique.mockReset();
    mockPrisma.$transaction.mockReset();
    mockStorage.downloadBuffer.mockReset();
    mockImageProcessor.generateAiOptimizedRepresentation.mockReset();
    mockImageProcessor.calculateSha256.mockReset();
    mockVisionProvider.analyzeImage.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VisionMetadataService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: S3StorageService, useValue: mockStorage },
        { provide: ImageProcessorService, useValue: mockImageProcessor },
        { provide: GeminiVisionProvider, useValue: mockVisionProvider },
      ],
    }).compile();

    service = module.get<VisionMetadataService>(VisionMetadataService);
  });

  it('should generate and persist metadata for an asset', async () => {
    mockPrisma.asset.findUnique.mockResolvedValue(mockAsset);
    mockStorage.downloadBuffer.mockResolvedValue(Buffer.from('original-image'));
    mockImageProcessor.generateAiOptimizedRepresentation.mockResolvedValue({
      buffer: Buffer.from('optimized-image'),
      mimeType: 'image/jpeg',
    });
    mockVisionProvider.analyzeImage.mockResolvedValue(mockAnalysis);
    mockImageProcessor.calculateSha256.mockResolvedValue('search-hash-123');
    mockPrisma.$transaction.mockImplementation(async (callback) =>
      callback({
        assetMetadata: {
          upsert: jest.fn().mockResolvedValue(mockSavedMetadata),
        },
        asset: {
          update: jest.fn().mockResolvedValue({
            ...mockAsset,
            status: AssetState.METADATA_GENERATED,
          }),
        },
      }),
    );

    const result = await service.generateAndSaveForAsset('asset-001');

    expect(mockStorage.downloadBuffer).toHaveBeenCalledWith(
      'assets/asset-001/original/cat.png',
      'test-bucket',
    );
    expect(mockVisionProvider.analyzeImage).toHaveBeenCalledWith({
      imageBuffer: Buffer.from('optimized-image'),
      mimeType: 'image/jpeg',
      promptVersion: undefined,
    });
    expect(result).toEqual(mockSavedMetadata);
  });

  it('should increment metadataVersion when metadata already exists', async () => {
    mockPrisma.asset.findUnique.mockResolvedValue({
      ...mockAsset,
      metadata: { ...mockSavedMetadata, metadataVersion: 2 },
    });
    mockStorage.downloadBuffer.mockResolvedValue(Buffer.from('original-image'));
    mockImageProcessor.generateAiOptimizedRepresentation.mockResolvedValue({
      buffer: Buffer.from('optimized-image'),
      mimeType: 'image/jpeg',
    });
    mockVisionProvider.analyzeImage.mockResolvedValue(mockAnalysis);
    mockImageProcessor.calculateSha256.mockResolvedValue('search-hash-123');

    const upsert = jest.fn().mockResolvedValue({
      ...mockSavedMetadata,
      metadataVersion: 3,
    });
    const update = jest.fn().mockResolvedValue({});
    mockPrisma.$transaction.mockImplementation(async (callback) =>
      callback({
        assetMetadata: { upsert },
        asset: { update },
      }),
    );

    const result = await service.generateAndSaveForAsset('asset-001');

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          metadataVersion: 3,
          promptVersion: 'v1',
        }),
      }),
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: 'asset-001' },
      data: { status: AssetState.METADATA_GENERATED },
    });
    expect(result.metadataVersion).toBe(3);
  });

  it('should throw when asset is not found', async () => {
    mockPrisma.asset.findUnique.mockResolvedValue(null);

    await expect(
      service.generateAndSaveForAsset('missing-asset'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
