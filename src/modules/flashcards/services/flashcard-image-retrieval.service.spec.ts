import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SearchService } from '../../search/search.service';
import { S3StorageService } from '../../storage/s3-storage.service';
import { FlashcardImageRetrievalService } from './flashcard-image-retrieval.service';
import { PIPELINE_TRACKER_EVENTS } from '../../../common/events/pipeline-tracker.events';

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
      if (key === 'flashcards.imageSearchLimit') return 1;
      return undefined;
    },
  };
  const eventEmitter = {
    emit: jest.fn(),
  };

  let service: FlashcardImageRetrievalService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new FlashcardImageRetrievalService(
      searchService as unknown as SearchService,
      s3StorageService as unknown as S3StorageService,
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

  it('fetches only the single top semantic match (limit 1)', async () => {
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
      limit: 1,
    });
    expect(result.status).toBe('found');
    expect(result.assetId).toBe('asset-1');
    expect(result.attempts).toEqual(['semantic']);
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
      limit: 1,
    });
    expect(result.status).toBe('found');
    expect(result.assetId).toBe('top');
    expect(result.similarity).toBe(0.99);
  });

  it('still attaches the top embedding hit when it was already used', async () => {
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
    expect(result.status).toBe('found');
    expect(result.assetId).toBe('used-1');
  });

  it('returns IMAGE_NOT_FOUND only when embeddings yield no results', async () => {
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

    expect(searchService.search).toHaveBeenCalledWith({
      query: 'missing object',
      limit: 1,
    });
    expect(result.status).toBe('IMAGE_NOT_FOUND');
    expect(result.assetId).toBeNull();
  });

  it('cascades to expectedObjects when the primary semantic query misses', async () => {
    searchService.search.mockImplementation(async (input: { query: string }) => {
      if (input.query === 'broccoli') {
        return {
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
        };
      }
      return { query: input.query, total: 0, results: [] };
    });

    const result = await service.retrieveForCard({
      queries: [
        {
          searchQuery: 'cartoon green broccoli',
          expectedObjects: ['broccoli'],
          preferredStyle: 'cartoon',
        },
      ],
      topic: 'vegetables',
      ageMin: 5,
      ageMax: 6,
    });

    expect(result.status).toBe('found');
    expect(result.assetId).toBe('asset-b');
    expect(result.queryUsed).toBe('broccoli');
    expect(result.attempts).toContain('semantic');
    expect(result.attempts).toContain('expected_objects');
  });
});
