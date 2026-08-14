import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SearchService } from '../../search/search.service';
import { S3StorageService } from '../../storage/s3-storage.service';
import { WorksheetAssetService } from './worksheet-asset.service';

describe('WorksheetAssetService', () => {
  const searchService = {
    search: jest.fn(),
  };
  const s3StorageService = {
    getSignedUrl: jest.fn(),
  };
  const configService = {
    get: (key: string) => {
      if (key === 'worksheets.imageConcurrency') return 2;
      if (key === 'worksheets.imageSearchLimit') return 1;
      if (key === 'worksheets.signedUrlTtlSeconds') return 3600;
      if (key === 'worksheets.renderer.apiBaseUrl') return 'http://localhost:3000';
      return undefined;
    },
  };

  let service: WorksheetAssetService;

  beforeEach(() => {
    jest.clearAllMocks();
        const eventEmitter = { emit: jest.fn() };
    service = new WorksheetAssetService(
      searchService as unknown as SearchService,
      s3StorageService as unknown as S3StorageService,
      configService as unknown as ConfigService,
      eventEmitter as unknown as EventEmitter2,
    );
    s3StorageService.getSignedUrl.mockResolvedValue('https://signed.example/img');
  });

  it('maps imageQuery to assetId and image URLs', async () => {
    searchService.search.mockImplementation(async ({ query }: { query: string }) => ({
      query,
      total: 1,
      results: [
        {
          assetId: query.includes('apple') ? 'asset-123' : 'asset-456',
          s3ObjectKey: query.includes('apple') ? 'assets/a.png' : 'assets/b.png',
        },
      ],
    }));

    const { structure, slots } = await service.attachAssets({
      instruction: 'Count',
      items: [
        { count: 3, imageQuery: 'red apples' },
        { count: 5, imageQuery: 'yellow bananas' },
      ],
    });

    expect(searchService.search).toHaveBeenCalledTimes(2);
    expect(slots.map((slot) => slot.assetId)).toEqual(['asset-123', 'asset-456']);
    expect(structure).toEqual({
      instruction: 'Count',
      items: [
        {
          count: 3,
          imageQuery: 'red apples',
          assetId: 'asset-123',
          imageUrl: 'http://localhost:3000/worksheets/assets/asset-123/image',
          assetUrl: 'http://localhost:3000/worksheets/assets/asset-123/image',
          signedUrl: 'https://signed.example/img',
        },
        {
          count: 5,
          imageQuery: 'yellow bananas',
          assetId: 'asset-456',
          imageUrl: 'http://localhost:3000/worksheets/assets/asset-456/image',
          assetUrl: 'http://localhost:3000/worksheets/assets/asset-456/image',
          signedUrl: 'https://signed.example/img',
        },
      ],
    });
  });

  it('retries without filters when the filtered search is empty', async () => {
    searchService.search
      .mockResolvedValueOnce({ query: 'red apples', total: 0, results: [] })
      .mockResolvedValueOnce({
        query: 'red apples',
        total: 1,
        results: [{ assetId: 'asset-123', s3ObjectKey: 'assets/a.png' }],
      });

    const { slots } = await service.attachAssets(
      { items: [{ imageQuery: 'red apples' }] },
      { grades: ['LKG'] },
    );

    expect(searchService.search).toHaveBeenCalledTimes(2);
    expect(searchService.search.mock.calls[0][0].filters).toEqual({
      grades: ['LKG'],
      ageGroups: undefined,
    });
    expect(searchService.search.mock.calls[1][0].filters).toBeUndefined();
    expect(slots[0].imageUrl).toBe(
      'http://localhost:3000/worksheets/assets/asset-123/image',
    );
  });
});
