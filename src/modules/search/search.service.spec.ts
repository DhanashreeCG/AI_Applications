import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../database/prisma.service';
import { OpenAiEmbeddingProvider } from '../ai/providers/openai-embedding.provider';
import { VectorStorageService } from './vector-storage.service';
import { SearchService } from './search.service';
import { OPENAI_EMBEDDING_DIMENSIONS } from '../ai/constants/embedding.constants';

describe('SearchService', () => {
  let service: SearchService;

  const sampleEmbedding = Array.from(
    { length: OPENAI_EMBEDDING_DIMENSIONS },
    (_, index) => index / OPENAI_EMBEDDING_DIMENSIONS,
  );

  const mockPrisma = {
    asset: {
      findMany: jest.fn(),
    },
  };

  const mockEmbeddingProvider = {
    generateEmbedding: jest.fn(),
  };

  const mockVectorStorage = {
    searchSimilar: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: OpenAiEmbeddingProvider, useValue: mockEmbeddingProvider },
        { provide: VectorStorageService, useValue: mockVectorStorage },
      ],
    }).compile();

    service = module.get<SearchService>(SearchService);
  });

  it('should return ranked semantic results with metadata filters applied', async () => {
    mockEmbeddingProvider.generateEmbedding.mockResolvedValue({
      embedding: sampleEmbedding,
      dimensions: 1536,
      provider: 'openai',
      model: 'text-embedding-3-small',
      sourceTextHash: 'query-hash',
    });
    mockVectorStorage.searchSimilar.mockResolvedValue([
      {
        assetId: 'asset-001',
        embeddingId: 'embedding-001',
        distance: 0.1,
        similarity: 0.9,
      },
      {
        assetId: 'asset-002',
        embeddingId: 'embedding-002',
        distance: 0.2,
        similarity: 0.8,
      },
    ]);
    mockPrisma.asset.findMany.mockResolvedValue([
      {
        id: 'asset-001',
        s3ObjectKey: 'assets/asset-001/original/cat.png',
        mimeType: 'image/png',
        metadata: {
          caption: 'A red cat',
          orientation: 'portrait',
          colors: ['red'],
          styles: ['photo'],
          objects: ['cat'],
          actions: ['sitting'],
          ageGroups: ['kids'],
          searchDescription: 'A red cat',
        },
      },
      {
        id: 'asset-002',
        s3ObjectKey: 'assets/asset-002/original/dog.png',
        mimeType: 'image/png',
        metadata: {
          caption: 'A blue dog',
          orientation: 'landscape',
          colors: ['blue'],
          styles: ['photo'],
          objects: ['dog'],
          actions: ['running'],
          ageGroups: ['kids'],
          searchDescription: 'A blue dog',
        },
      },
    ]);

    const response = await service.search({
      query: 'red cat on sofa',
      limit: 5,
      filters: {
        orientation: 'portrait',
        colors: ['red'],
      },
    });

    expect(mockEmbeddingProvider.generateEmbedding).toHaveBeenCalledWith(
      'red cat on sofa',
    );
    expect(mockVectorStorage.searchSimilar).toHaveBeenCalledWith(
      sampleEmbedding,
      50,
    );
    expect(response.total).toBe(1);
    expect(response.results).toEqual([
      expect.objectContaining({
        assetId: 'asset-001',
        similarity: 0.9,
        caption: 'A red cat',
        orientation: 'portrait',
      }),
    ]);
  });

  it('should reject empty search queries', async () => {
    await expect(service.search({ query: '   ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('should return an empty result set when vector search finds nothing', async () => {
    mockEmbeddingProvider.generateEmbedding.mockResolvedValue({
      embedding: sampleEmbedding,
      dimensions: 1536,
      provider: 'openai',
      model: 'text-embedding-3-small',
      sourceTextHash: 'query-hash',
    });
    mockVectorStorage.searchSimilar.mockResolvedValue([]);

    const response = await service.search({ query: 'space rocket' });

    expect(response).toEqual({
      query: 'space rocket',
      total: 0,
      results: [],
    });
  });
});
