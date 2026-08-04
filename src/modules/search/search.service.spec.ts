import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../database/prisma.service';
import { OpenAiEmbeddingProvider } from '../ai/providers/openai-embedding.provider';
import { RedisCacheService } from '../cache/redis-cache.service';
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
    getLastUsage: jest.fn().mockReturnValue({
      inputTokens: 3,
      totalTokens: 3,
      latencyMs: 12,
    }),
    modelName: 'text-embedding-3-small',
  };

  const mockVectorStorage = {
    searchSimilar: jest.fn(),
  };

  const mockRedisCache = {
    get: jest.fn(),
    set: jest.fn(),
    getSearchCacheTtlSeconds: jest.fn().mockReturnValue(300),
    getAssetMetadataCacheTtlSeconds: jest.fn().mockReturnValue(3600),
    flushSearchCache: jest.fn(),
    flushAssetMetadataCache: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRedisCache.get.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: OpenAiEmbeddingProvider, useValue: mockEmbeddingProvider },
        { provide: VectorStorageService, useValue: mockVectorStorage },
        { provide: RedisCacheService, useValue: mockRedisCache },
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
          ageGroups: ['6-10'],
          grades: ['kids'],
          searchDescription: 'A red cat',
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
    expect(mockRedisCache.set).toHaveBeenCalled();
    expect(response.total).toBe(1);
    expect(response.usage).toEqual(
      expect.objectContaining({
        inputTokens: 3,
        totalTokens: 3,
        latencyMs: 12,
        model: 'text-embedding-3-small',
        fromCache: false,
      }),
    );
    expect(response.results[0]).toEqual(
      expect.objectContaining({
        assetId: 'asset-001',
        similarity: 0.9,
      }),
    );
  });

  it('should return cached search results without recomputing embeddings', async () => {
    mockRedisCache.get.mockResolvedValue({
      query: 'red cat on sofa',
      total: 1,
      results: [
        {
          assetId: 'asset-001',
          similarity: 0.9,
          distance: 0.1,
          caption: 'A red cat',
          orientation: 'portrait',
          colors: ['red'],
          styles: ['photo'],
          objects: ['cat'],
          actions: ['sitting'],
          ageGroups: ['6-10'],
          grades: ['kids'],
          searchDescription: 'A red cat',
          s3ObjectKey: 'assets/asset-001/original/cat.png',
          mimeType: 'image/png',
        },
      ],
    });

    const response = await service.search({
      query: 'red cat on sofa',
      limit: 5,
    });

    expect(mockEmbeddingProvider.generateEmbedding).not.toHaveBeenCalled();
    expect(response.fromCache).toBe(true);
    expect(response.usage).toEqual(
      expect.objectContaining({
        fromCache: true,
        inputTokens: 0,
        totalTokens: 0,
      }),
    );
    expect(response.total).toBe(1);
  });

  it('should bypass cache when bypassCache is true', async () => {
    mockRedisCache.get.mockResolvedValue({
      query: 'red cat on sofa',
      total: 1,
      results: [],
    });
    mockEmbeddingProvider.generateEmbedding.mockResolvedValue({
      embedding: sampleEmbedding,
      dimensions: 1536,
      provider: 'openai',
      model: 'text-embedding-3-small',
      sourceTextHash: 'query-hash',
    });
    mockVectorStorage.searchSimilar.mockResolvedValue([]);

    await service.search({
      query: 'red cat on sofa',
      bypassCache: true,
    });

    expect(mockRedisCache.get).not.toHaveBeenCalled();
    expect(mockEmbeddingProvider.generateEmbedding).toHaveBeenCalled();
  });

  it('should reject empty search queries', async () => {
    await expect(service.search({ query: '   ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('should flush search cache entries', async () => {
    mockRedisCache.flushSearchCache.mockResolvedValue(3);

    const result = await service.flushCache('search');

    expect(result).toEqual({ deleted: 3, scope: 'search' });
  });
});
