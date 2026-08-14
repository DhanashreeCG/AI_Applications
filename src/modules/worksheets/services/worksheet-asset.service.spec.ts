import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SearchService } from '../../search/search.service';
import { WorksheetAssetService } from './worksheet-asset.service';

describe('WorksheetAssetService', () => {
  const searchService = {
    search: jest.fn(),
  };
  const configService = {
    get: (key: string) => {
      if (key === 'worksheets.imageConcurrency') return 2;
      if (key === 'worksheets.imageSearchLimit') return 1;
      return undefined;
    },
  };

  let service: WorksheetAssetService;

  beforeEach(() => {
    jest.clearAllMocks();
        const eventEmitter = { emit: jest.fn() };
        service = new WorksheetAssetService(
      searchService as unknown as SearchService,
      configService as unknown as ConfigService,
      eventEmitter as unknown as EventEmitter2,
    );
  });

  it('maps imageQuery to assetId', async () => {
    searchService.search.mockImplementation(async ({ query }: { query: string }) => ({
      query,
      total: 1,
      results: [{ assetId: query.includes('apple') ? 'asset-123' : 'asset-456' }],
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
        { count: 3, imageQuery: 'red apples', assetId: 'asset-123' },
        { count: 5, imageQuery: 'yellow bananas', assetId: 'asset-456' },
      ],
    });
  });
});
