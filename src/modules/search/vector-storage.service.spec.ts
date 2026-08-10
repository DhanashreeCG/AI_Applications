import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../database/prisma.service';
import { OPENAI_EMBEDDING_DIMENSIONS } from '../ai/constants/embedding.constants';
import { VectorStorageService } from './vector-storage.service';

describe('VectorStorageService', () => {
  let service: VectorStorageService;

  const sampleVector = Array.from(
    { length: OPENAI_EMBEDDING_DIMENSIONS },
    (_, index) => index / OPENAI_EMBEDDING_DIMENSIONS,
  );

  const mockPrisma = {
    assetEmbedding: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    $executeRawUnsafe: jest.fn(),
    $queryRawUnsafe: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VectorStorageService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<VectorStorageService>(VectorStorageService);
  });

  it('should store a new embedding and write the pgvector column', async () => {
    mockPrisma.assetEmbedding.findFirst.mockResolvedValue(null);
    mockPrisma.assetEmbedding.create.mockResolvedValue({
      id: 'embedding-001',
      assetId: 'asset-001',
      provider: 'openai',
      model: 'text-embedding-3-small',
      dimensions: 1536,
      sourceTextHash: 'hash-123',
      embeddingVersion: 1,
    });
    mockPrisma.$executeRawUnsafe.mockResolvedValue(1);

    const result = await service.storeEmbedding({
      assetId: 'asset-001',
      embedding: sampleVector,
      provider: 'openai',
      model: 'text-embedding-3-small',
      sourceTextHash: 'hash-123',
    });

    expect(mockPrisma.assetEmbedding.create).toHaveBeenCalled();
    expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE "AssetEmbedding"'),
      expect.stringContaining('['),
      'embedding-001',
    );
    expect(result.embeddingVersion).toBe(1);
  });

  it('should reuse an existing embedding when source text hash matches', async () => {
    mockPrisma.assetEmbedding.findFirst.mockResolvedValue({
      id: 'embedding-001',
      assetId: 'asset-001',
      provider: 'openai',
      model: 'text-embedding-3-small',
      dimensions: 1536,
      sourceTextHash: 'hash-123',
      embeddingVersion: 1,
    });
    mockPrisma.$queryRawUnsafe.mockResolvedValue([{ hasVector: true }]);

    const result = await service.storeEmbedding({
      assetId: 'asset-001',
      embedding: sampleVector,
      provider: 'openai',
      model: 'text-embedding-3-small',
      sourceTextHash: 'hash-123',
    });

    expect(mockPrisma.assetEmbedding.create).not.toHaveBeenCalled();
    expect(mockPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(result.id).toBe('embedding-001');
  });

  it('should increment embeddingVersion when source text hash changes', async () => {
    mockPrisma.assetEmbedding.findFirst.mockResolvedValue({
      id: 'embedding-001',
      assetId: 'asset-001',
      provider: 'openai',
      model: 'text-embedding-3-small',
      dimensions: 1536,
      sourceTextHash: 'hash-old',
      embeddingVersion: 1,
    });
    mockPrisma.$queryRawUnsafe.mockResolvedValue([{ hasVector: true }]);
    mockPrisma.assetEmbedding.update.mockResolvedValue({
      id: 'embedding-001',
      assetId: 'asset-001',
      provider: 'openai',
      model: 'text-embedding-3-small',
      dimensions: 1536,
      sourceTextHash: 'hash-new',
      embeddingVersion: 2,
    });
    mockPrisma.$executeRawUnsafe.mockResolvedValue(1);

    const result = await service.storeEmbedding({
      assetId: 'asset-001',
      embedding: sampleVector,
      provider: 'openai',
      model: 'text-embedding-3-small',
      sourceTextHash: 'hash-new',
    });

    expect(mockPrisma.assetEmbedding.update).toHaveBeenCalledWith({
      where: { id: 'embedding-001' },
      data: expect.objectContaining({
        sourceTextHash: 'hash-new',
        embeddingVersion: 2,
      }),
    });
    expect(result.embeddingVersion).toBe(2);
  });

  it('should return top-k assets ordered by cosine distance', async () => {
    mockPrisma.$queryRawUnsafe.mockResolvedValue([
      {
        assetId: 'asset-001',
        embeddingId: 'embedding-001',
        distance: 0.1,
        similarity: 0.9,
      },
      {
        assetId: 'asset-002',
        embeddingId: 'embedding-002',
        distance: 0.3,
        similarity: 0.7,
      },
    ]);

    const results = await service.searchSimilar(sampleVector, 2);

    expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('vector <=> $1::vector'),
      expect.any(String),
      2,
    );
    expect(results).toEqual([
      {
        assetId: 'asset-001',
        embeddingId: 'embedding-001',
        distance: 0.1,
        similarity: 0.9,
      },
      {
        assetId: 'asset-002',
        embeddingId: 'embedding-002',
        distance: 0.3,
        similarity: 0.7,
      },
    ]);
  });

  it('should reject invalid vector dimensions', async () => {
    await expect(
      service.storeEmbedding({
        assetId: 'asset-001',
        embedding: [0.1, 0.2],
        provider: 'openai',
        model: 'text-embedding-3-small',
        sourceTextHash: 'hash-123',
      }),
    ).rejects.toThrow('Expected 1536-dim vector, received 2');
  });

  it('should throw when deleting a missing embedding', async () => {
    mockPrisma.assetEmbedding.findFirst.mockResolvedValue(null);

    await expect(service.deleteEmbedding('missing-asset')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
