import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { SearchService } from '../../search/search.service';
import { S3StorageService } from '../../storage/s3-storage.service';
import { FlashcardImageRetrievalService } from './flashcard-image-retrieval.service';

describe('FlashcardImageRetrievalService', () => {
  const searchService = {
    search: jest.fn(),
  };
  const s3StorageService = {
    getSignedUrl: jest.fn(),
  };
  const configService = {
    get: (key: string) => {
      if (key === 'flashcards.imageConcurrency') return 2;
      if (key === 'flashcards.signedUrlTtlSeconds') return 3600;
      if (key === 'flashcards.imageSearchLimit') return 8;
      if (key === 'flashcards.imageEmbeddingMaxAttempts') return 3;
      if (key === 'flashcards.imageEmbeddingRetryDelayMs') return 0;
      return undefined;
    },
  };
  const eventEmitter = {
    emit: jest.fn(),
  };
  const prisma = {
    assetMetadata: {
      findUnique: jest.fn().mockResolvedValue({ colors: ['white', 'green'] }),
    },
  };

  let service: FlashcardImageRetrievalService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.assetMetadata.findUnique.mockResolvedValue({ colors: ['white', 'green'] });
    service = new FlashcardImageRetrievalService(
      searchService as unknown as SearchService,
      s3StorageService as unknown as S3StorageService,
      prisma as unknown as PrismaService,
      configService as unknown as ConfigService,
      eventEmitter as unknown as EventEmitter2,
    );
    s3StorageService.getSignedUrl.mockResolvedValue('https://signed.example/img');
  });

  const telemetry = {
    executionId: 'exec-1',
    requestId: 'req-1',
    correlationId: 'corr-1',
    workflowType: 'flashcards',
  };

  it('searches once with the LLM searchQuery only', async () => {
    searchService.search.mockResolvedValue({
      query: 'carrot vegetable',
      total: 1,
      results: [
        {
          assetId: 'asset-1',
          s3ObjectKey: 'assets/asset-1/original.png',
          caption: 'carrot',
          similarity: 0.9,
          mimeType: 'image/png',
          ageGroups: ['3-6'],
        },
      ],
      usage: {
        inputTokens: 4,
        totalTokens: 4,
        latencyMs: 18,
        model: 'text-embedding-3-small',
        fromCache: false,
      },
    });

    const result = await service.retrieveForCard(
      {
        queries: ['carrot vegetable'],
        ageMin: 3,
        ageMax: 4,
      },
      telemetry,
    );

    expect(searchService.search).toHaveBeenCalledTimes(1);
    expect(searchService.search).toHaveBeenCalledWith({
      query: 'carrot vegetable',
      limit: 8,
    });
    expect(result.status).toBe('found');
    expect(result.assetId).toBe('asset-1');
    expect(result.attempts).toEqual(['semantic']);
    expect(prisma.assetMetadata.findUnique).toHaveBeenCalledWith({
      where: { assetId: 'asset-1' },
      select: { colors: true },
    });
    expect(result.colors).toEqual(['white', 'green']);
    expect(result.color).toBe('#3DD68C');
  });

  it('always selects the highest-similarity hit, never a random lower-ranked one', async () => {
    searchService.search.mockResolvedValue({
      query: 'apple',
      total: 3,
      results: [
        {
          assetId: 'lower',
          s3ObjectKey: 'assets/lower/original.png',
          caption: 'apple c',
          similarity: 0.7,
          mimeType: 'image/png',
          ageGroups: ['3-6'],
        },
        {
          assetId: 'top',
          s3ObjectKey: 'assets/top/original.png',
          caption: 'apple a',
          similarity: 0.99,
          mimeType: 'image/png',
          ageGroups: ['8-12'],
        },
        {
          assetId: 'mid',
          s3ObjectKey: 'assets/mid/original.png',
          caption: 'apple b',
          similarity: 0.85,
          mimeType: 'image/png',
          ageGroups: ['3-6'],
        },
      ],
    });

    const result = await service.retrieveForCard({
      queries: ['apple'],
      ageMin: 3,
      ageMax: 4,
    });

    expect(searchService.search).toHaveBeenCalledWith({
      query: 'apple',
      limit: 8,
    });
    expect(result.status).toBe('found');
    expect(result.assetId).toBe('top');
    expect(result.similarity).toBe(0.99);
  });

  it('does not reuse an already-used asset; takes the 2nd-ranked hit instead', async () => {
    searchService.search.mockResolvedValue({
      query: 'apple',
      total: 2,
      results: [
        {
          assetId: 'used-1',
          s3ObjectKey: 'assets/used-1/original.png',
          caption: 'apple a',
          similarity: 0.95,
          mimeType: 'image/png',
          ageGroups: [],
        },
        {
          assetId: 'second',
          s3ObjectKey: 'assets/second/original.png',
          caption: 'apple b',
          similarity: 0.7,
          mimeType: 'image/png',
          ageGroups: [],
        },
      ],
    });

    const result = await service.retrieveForCard({
      queries: [{ searchQuery: 'apple', expectedObjects: ['apple'] }],
      ageMin: 4,
      ageMax: 6,
      usedAssetIds: new Set(['used-1']),
    });

    expect(searchService.search).toHaveBeenCalledTimes(1);
    expect(result.assetId).toBe('second');
    expect(result.status).toBe('found');
  });

  it('does not attach a duplicate when every ranked hit is already used', async () => {
    searchService.search.mockResolvedValue({
      query: 'apple',
      total: 1,
      results: [
        {
          assetId: 'used-1',
          s3ObjectKey: 'assets/used-1/original.png',
          caption: 'apple',
          similarity: 0.8,
          mimeType: 'image/png',
          ageGroups: [],
        },
      ],
      fromCache: true,
      usage: { fromCache: true, inputTokens: 0, totalTokens: 0 },
    });

    const result = await service.retrieveForCard({
      queries: ['apple'],
      ageMin: 4,
      ageMax: 6,
      usedAssetIds: new Set(['used-1']),
    });

    expect(searchService.search).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('IMAGE_NOT_FOUND');
    expect(result.assetId).toBeNull();
  });

  it('returns IMAGE_NOT_FOUND when embeddings yield no results', async () => {
    searchService.search.mockResolvedValue({
      query: 'missing object',
      total: 0,
      results: [],
      usage: { fromCache: false, inputTokens: 2, totalTokens: 2, latencyMs: 5 },
    });

    const result = await service.retrieveForCard({
      queries: ['missing object'],
      ageMin: null,
      ageMax: null,
    });

    expect(searchService.search).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('IMAGE_NOT_FOUND');
    expect(result.assetId).toBeNull();
  });

  it('does not rewrite style/topic into a second search query', async () => {
    searchService.search.mockResolvedValue({
      query: 'broccoli',
      total: 1,
      results: [
        {
          assetId: 'asset-b',
          s3ObjectKey: 'assets/asset-b/original.png',
          caption: 'broccoli',
          similarity: 0.88,
          mimeType: 'image/png',
          ageGroups: ['5-6'],
        },
      ],
    });

    const result = await service.retrieveForCard({
      queries: [
        {
          searchQuery: 'broccoli',
          expectedObjects: ['broccoli'],
          preferredStyle: 'cartoon',
          preferredBackground: 'white',
        },
      ],
      topic: 'vegetables',
      ageMin: 5,
      ageMax: 6,
    });

    expect(searchService.search).toHaveBeenCalledTimes(1);
    expect(searchService.search).toHaveBeenCalledWith({
      query: 'broccoli',
      limit: 8,
    });
    expect(result.status).toBe('found');
    expect(result.assetId).toBe('asset-b');
  });

  it('retries the same LLM query on embedding failure and does not change the query', async () => {
    searchService.search
      .mockRejectedValueOnce(new Error('embedding timeout'))
      .mockRejectedValueOnce(new Error('embedding timeout'))
      .mockResolvedValueOnce({
        query: 'lion',
        total: 1,
        results: [
          {
            assetId: 'lion-1',
            s3ObjectKey: 'assets/lion-1/original.png',
            caption: 'lion',
            similarity: 0.91,
            mimeType: 'image/png',
            ageGroups: [],
          },
        ],
      });

    const result = await service.retrieveForCard({
      queries: ['lion'],
      ageMin: 4,
      ageMax: 6,
    });

    expect(searchService.search).toHaveBeenCalledTimes(3);
    expect(searchService.search.mock.calls.every((call) => call[0].query === 'lion')).toBe(
      true,
    );
    expect(result.status).toBe('found');
    expect(result.assetId).toBe('lion-1');
  });

  it('returns error after embedding retries are exhausted', async () => {
    searchService.search.mockRejectedValue(new Error('embedding down'));

    const result = await service.retrieveForCard({
      queries: ['lion'],
      ageMin: 4,
      ageMax: 6,
    });

    expect(searchService.search).toHaveBeenCalledTimes(3);
    expect(result.status).toBe('error');
    expect(result.assetId).toBeNull();
  });
});
