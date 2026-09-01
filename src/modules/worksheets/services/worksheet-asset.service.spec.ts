import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SearchService } from '../../search/search.service';
import { S3StorageService } from '../../storage/s3-storage.service';
import { PrismaService } from '../../database/prisma.service';
import { WorksheetAssetService } from './worksheet-asset.service';

describe('WorksheetAssetService', () => {
  const searchService = {
    search: jest.fn(),
  };
  const s3StorageService = {
    getSignedUrl: jest.fn(),
    uploadFile: jest.fn(),
    downloadBuffer: jest.fn(),
  };
  const prisma = {
    asset: { findUnique: jest.fn() },
  };
  const configService = {
    get: (key: string) => {
      if (key === 'worksheets.imageConcurrency') return 2;
      if (key === 'worksheets.imageSearchLimit') return 1;
      if (key === 'worksheets.imagePickerLimit') return 10;
      if (key === 'worksheets.signedUrlTtlSeconds') return 3600;
      if (key === 'worksheets.assetImagePath') return '/worksheets/assets';
      if (key === 'worksheets.userUploadS3Prefix') return 'worksheets/uploads';
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
      prisma as unknown as PrismaService,
      configService as unknown as ConfigService,
      eventEmitter as unknown as EventEmitter2,
    );
    s3StorageService.getSignedUrl.mockResolvedValue('https://signed.example/img');
  });

  it('maps imageQuery to assetId only in persisted structure', async () => {
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
        { count: 3, imageQuery: 'red apples', assetId: 'asset-123' },
        { count: 5, imageQuery: 'yellow bananas', assetId: 'asset-456' },
      ],
    });
    expect(JSON.stringify(structure)).not.toContain('signedUrl');
    expect(JSON.stringify(structure)).not.toContain('imageUrl');
  });

  it('searches assets from structure.image.image_name when imageQuery is absent', async () => {
    searchService.search.mockResolvedValue({
      query: 'cute jumping dolphins in the ocean',
      total: 1,
      results: [{ assetId: 'dolphin-1', s3ObjectKey: 'assets/d.png' }],
    });

    const { structure, slots } = await service.attachAssets({
      topic: 'Dolphin Fun',
      image: {
        id: 'main_image',
        image_name: 'cute jumping dolphins in the ocean',
      },
    });

    expect(searchService.search).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'cute jumping dolphins in the ocean' }),
    );
    expect(slots).toEqual([
      {
        path: 'image',
        imageQuery: 'cute jumping dolphins in the ocean',
        assetId: 'dolphin-1',
      },
    ]);
    expect(structure).toEqual({
      topic: 'Dolphin Fun',
      image: {
        id: 'main_image',
        image_name: 'cute jumping dolphins in the ocean',
        imageQuery: 'cute jumping dolphins in the ocean',
        assetId: 'dolphin-1',
      },
    });
  });

  it('resolves proxy and signed URLs at preview time from assetId', async () => {
    prisma.asset.findUnique.mockResolvedValue({
      id: 'asset-123',
      s3ObjectKey: 'assets/a.png',
      s3Bucket: 'bucket',
    });

    await expect(service.resolveAsset('asset-123')).resolves.toEqual({
      assetId: 'asset-123',
      imageUrl: '/worksheets/assets/asset-123/image',
      signedUrl: 'https://signed.example/img',
    });
    expect(s3StorageService.getSignedUrl).toHaveBeenCalled();
  });

  it('keeps a replacement imageUrl when assetId is missing', () => {
    const enriched = service.enrichForRender({
      items: [
        {
          imageQuery: 'carrot',
          assetId: null,
          imageUrl: '/worksheets/assets/new-carrot/image',
        },
      ],
    });
    expect(enriched.items).toEqual([
      {
        imageQuery: 'carrot',
        assetId: null,
        assetUrl: '/worksheets/assets/new-carrot/image',
        imageUrl: '/worksheets/assets/new-carrot/image',
      },
    ]);
  });

  it('injects assetUrl for render without persisting it', () => {
    const enriched = service.enrichForRender({
      items: [{ imageQuery: 'apples', assetId: 'asset-123', signedUrl: 'stale' }],
    });
    expect(enriched).toEqual({
      items: [
        {
          imageQuery: 'apples',
          assetId: 'asset-123',
          assetUrl: '/worksheets/assets/asset-123/image',
        },
      ],
    });
  });

  it('injects user-uploaded assetUrl when assetId is null', () => {
    const enriched = service.enrichForRender({
      image: {
        imageQuery: 'custom',
        assetId: null,
        userUploadedKey: 'worksheets/uploads/ws-1/pic.png',
      },
      userUploadedImages: {
        image: { key: 'worksheets/uploads/ws-1/pic.png', contentType: 'image/png' },
      },
    });
    expect(enriched.image).toEqual({
      imageQuery: 'custom',
      assetId: null,
      userUploadedKey: 'worksheets/uploads/ws-1/pic.png',
      assetUrl: '/worksheets/ws-1/uploads/pic.png/image',
    });
  });

  it('persists user uploads on the slot and userUploadedImages index', () => {
    const next = service.applyUserUploadedImage(
      { image: { imageQuery: 'goat', assetId: 'old' } },
      'image',
      { key: 'worksheets/uploads/ws-1/pic.png', contentType: 'image/png' },
    );
    expect(next).toEqual({
      image: {
        imageQuery: 'goat',
        assetId: null,
        userUploadedKey: 'worksheets/uploads/ws-1/pic.png',
      },
      userUploadedImages: {
        image: { key: 'worksheets/uploads/ws-1/pic.png', contentType: 'image/png' },
      },
    });
  });

  it('returns empty slot when search returns 0 results', async () => {
    searchService.search.mockResolvedValueOnce({ query: 'red apples', total: 0, results: [] });

    const { slots, structure } = await service.attachAssets(
      { items: [{ imageQuery: 'red apples' }] },
      { grades: ['LKG'] },
    );

    expect(searchService.search).toHaveBeenCalledTimes(1);
    expect(slots[0].assetId).toBeUndefined();
    expect(structure).toEqual({
      items: [{ imageQuery: 'red apples' }],
    });
  });

  it('deduplicates identical image queries across multiple worksheets in a batch', async () => {
    searchService.search.mockImplementation(async ({ query }: { query: string }) => ({
      query,
      total: 1,
      results: [
        {
          assetId: query.includes('apple') ? 'asset-apple' : 'asset-banana',
          s3ObjectKey: query.includes('apple') ? 'assets/apple.png' : 'assets/banana.png',
        },
      ],
    }));

    const batchStructures = [
      { items: [{ imageQuery: 'red apple' }] },
      { items: [{ imageQuery: 'red apple' }] },
      { items: [{ imageQuery: 'yellow banana' }] },
    ];

    const results = await service.attachAssetsBatch(batchStructures);

    expect(results).toHaveLength(3);
    // 'red apple' should only be searched once even though 2 worksheets requested it
    expect(searchService.search).toHaveBeenCalledTimes(2);
    expect(results[0].structure).toEqual({
      items: [{ imageQuery: 'red apple', assetId: 'asset-apple' }],
    });
    expect(results[1].structure).toEqual({
      items: [{ imageQuery: 'red apple', assetId: 'asset-apple' }],
    });
    expect(results[2].structure).toEqual({
      items: [{ imageQuery: 'yellow banana', assetId: 'asset-banana' }],
    });
  });
});
