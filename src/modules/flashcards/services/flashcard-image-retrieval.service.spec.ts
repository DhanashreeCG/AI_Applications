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

  it('calls search once with limit 1 and returns the single result', async () => {
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
        ageMax: 5,
      },
      telemetry,
    );

    expect(searchService.search).toHaveBeenCalledTimes(1);
    expect(searchService.search).toHaveBeenCalledWith({
      query: 'carrot vegetable',
      limit: 1,
      filters: { ageGroups: ['3-5'] },
    });
    expect(result.status).toBe('found');
    expect(result.assetId).toBe('asset-1');
    expect(result.attempts).toEqual(['primary+age']);

    const started = eventEmitter.emit.mock.calls.filter(
      ([event]) => event === PIPELINE_TRACKER_EVENTS.IMAGE_SEARCH_STARTED,
    );
    const completed = eventEmitter.emit.mock.calls.filter(
      ([event]) => event === PIPELINE_TRACKER_EVENTS.IMAGE_SEARCH_COMPLETED,
    );
    expect(started).toHaveLength(1);
    expect(completed).toHaveLength(1);

    const embeddingStarted = eventEmitter.emit.mock.calls.filter(
      ([event, payload]) =>
        event === PIPELINE_TRACKER_EVENTS.AI_INVOCATION_STARTED &&
        payload.purpose === 'flashcard_image_search_embedding',
    );
    expect(embeddingStarted).toHaveLength(1);
  });

  it('does not retry when search returns empty', async () => {
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
    expect(searchService.search).toHaveBeenCalledWith({
      query: 'missing object',
      limit: 1,
      filters: undefined,
    });
    expect(result.status).toBe('not_found');
    expect(result.assetId).toBeNull();
  });

  it('marks not_found without a second search when the only hit is already used', async () => {
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
    expect(result.status).toBe('not_found');
    expect(
      eventEmitter.emit.mock.calls.some(
        ([event, payload]) =>
          event === PIPELINE_TRACKER_EVENTS.AI_INVOCATION_STARTED &&
          payload.purpose === 'flashcard_image_search_embedding',
      ),
    ).toBe(false);
  });
});
