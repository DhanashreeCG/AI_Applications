import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../database/prisma.service';
import { OpenAiEmbeddingProvider } from '../ai/providers/openai-embedding.provider';
import { RedisCacheService } from '../cache/redis-cache.service';
import { VectorStorageService } from './vector-storage.service';
import { SearchService } from './search.service';
import { LetterQueryDetectorService } from './letter-query-detector.service';
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
    assetMetadata: {
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
        LetterQueryDetectorService,
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

  function letterAsset(id: string, objects: string[]) {
    return {
      id,
      s3ObjectKey: `assets/${id}/original.png`,
      mimeType: 'image/png',
      metadata: {
        caption: objects.join(', '),
        orientation: 'portrait',
        colors: ['black'],
        styles: ['line-art'],
        objects,
        actions: ['tracing'],
        ageGroups: ['3-5'],
        grades: ['LKG'],
        searchDescription: objects.join(', '),
      },
    };
  }

  it('should keep only combined Aa assets for "Letter A"', async () => {
    mockEmbeddingProvider.generateEmbedding.mockResolvedValue({
      embedding: sampleEmbedding,
      dimensions: 1536,
      provider: 'openai',
      model: 'text-embedding-3-small',
      sourceTextHash: 'query-hash',
    });
    mockVectorStorage.searchSimilar.mockResolvedValue([
      { assetId: 'letter-l', embeddingId: 'e1', distance: 0.05, similarity: 0.95 },
      { assetId: 'capital-a', embeddingId: 'e2', distance: 0.1, similarity: 0.9 },
      { assetId: 'combined-a', embeddingId: 'e3', distance: 0.2, similarity: 0.8 },
    ]);
    mockPrisma.asset.findMany.mockResolvedValue([
      letterAsset('letter-l', ['capital letter l']),
      letterAsset('capital-a', ['capital letter a']),
      letterAsset('combined-a', ['capital letter a', 'lowercase letter a']),
    ]);

    const response = await service.search({ query: 'Letter A', limit: 5 });

    expect(response.results.map((r) => r.assetId)).toEqual(['combined-a']);
  });

  it('should keep only capital-letter-a assets for "capital letter A"', async () => {
    mockEmbeddingProvider.generateEmbedding.mockResolvedValue({
      embedding: sampleEmbedding,
      dimensions: 1536,
      provider: 'openai',
      model: 'text-embedding-3-small',
      sourceTextHash: 'query-hash',
    });
    mockVectorStorage.searchSimilar.mockResolvedValue([
      { assetId: 'combined-a', embeddingId: 'e1', distance: 0.1, similarity: 0.9 },
      { assetId: 'upper-a', embeddingId: 'e2', distance: 0.2, similarity: 0.8 },
    ]);
    mockPrisma.asset.findMany.mockResolvedValue([
      letterAsset('combined-a', ['capital letter a', 'lowercase letter a']),
      letterAsset('upper-a', ['capital letter a']),
    ]);

    const response = await service.search({
      query: 'capital letter A',
      limit: 5,
    });

    expect(response.results.map((r) => r.assetId)).toEqual(['upper-a']);
  });

  it('should keep only lowercase-letter-a assets for "lowercase letter a"', async () => {
    mockEmbeddingProvider.generateEmbedding.mockResolvedValue({
      embedding: sampleEmbedding,
      dimensions: 1536,
      provider: 'openai',
      model: 'text-embedding-3-small',
      sourceTextHash: 'query-hash',
    });
    mockVectorStorage.searchSimilar.mockResolvedValue([
      { assetId: 'upper-a', embeddingId: 'e1', distance: 0.1, similarity: 0.9 },
      { assetId: 'lower-a', embeddingId: 'e2', distance: 0.2, similarity: 0.8 },
      { assetId: 'combined-a', embeddingId: 'e3', distance: 0.3, similarity: 0.7 },
    ]);
    mockPrisma.asset.findMany.mockResolvedValue([
      letterAsset('upper-a', ['capital letter a']),
      letterAsset('lower-a', ['lowercase letter a']),
      letterAsset('combined-a', ['capital letter a', 'lowercase letter a']),
    ]);

    const response = await service.search({
      query: 'lowercase letter a',
      limit: 5,
    });

    expect(response.results.map((r) => r.assetId)).toEqual(['lower-a']);
  });

  it('should not apply letter filtering for "A cat"', async () => {
    mockEmbeddingProvider.generateEmbedding.mockResolvedValue({
      embedding: sampleEmbedding,
      dimensions: 1536,
      provider: 'openai',
      model: 'text-embedding-3-small',
      sourceTextHash: 'query-hash',
    });
    mockVectorStorage.searchSimilar.mockResolvedValue([
      { assetId: 'cat', embeddingId: 'e1', distance: 0.1, similarity: 0.9 },
    ]);
    mockPrisma.asset.findMany.mockResolvedValue([
      letterAsset('cat', ['cat']),
    ]);

    const response = await service.search({ query: 'A cat', limit: 5 });

    expect(response.results[0].assetId).toBe('cat');
  });

  it('should fall back to objects lookup when the letter asset is outside the vector window', async () => {
    mockEmbeddingProvider.generateEmbedding.mockResolvedValue({
      embedding: sampleEmbedding,
      dimensions: 1536,
      provider: 'openai',
      model: 'text-embedding-3-small',
      sourceTextHash: 'query-hash',
    });
    mockVectorStorage.searchSimilar.mockResolvedValue([
      { assetId: 'wrong-1', embeddingId: 'e1', distance: 0.1, similarity: 0.9 },
      { assetId: 'wrong-2', embeddingId: 'e2', distance: 0.2, similarity: 0.8 },
      { assetId: 'wrong-3', embeddingId: 'e3', distance: 0.3, similarity: 0.7 },
    ]);
    mockPrisma.asset.findMany.mockResolvedValueOnce([
      letterAsset('wrong-1', ['capital letter l']),
      letterAsset('wrong-2', ['capital letter m']),
      letterAsset('wrong-3', ['capital letter n']),
    ]);
    const fallback = letterAsset('letter-b', ['capital letter b']);
    mockPrisma.assetMetadata.findMany.mockResolvedValueOnce([
      { ...fallback.metadata, asset: fallback },
    ]);

    const response = await service.search({
      query: 'capital B worksheet',
      limit: 5,
    });

    expect(mockPrisma.asset.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.assetMetadata.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { objects: { hasSome: ['capital letter b'] } },
      }),
    );
    expect(response.results[0].assetId).toBe('letter-b');
  });
});
