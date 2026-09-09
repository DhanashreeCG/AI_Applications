import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisCacheService } from '../cache/redis-cache.service';
import { TranslationException } from './errors/translation.exception';
import { GcpTranslationProvider } from './providers/gcp-translation.provider';
import { TranslationService } from './translation.service';

describe('TranslationService', () => {
  let provider: {
    translateTexts: jest.Mock;
    isReady: jest.Mock;
  };
  let cache: {
    get: jest.Mock;
    set: jest.Mock;
    isAvailable: jest.Mock;
  };
  let config: { get: jest.Mock };
  let service: TranslationService;

  const flashcardPayload = {
    request: {
      query: 'animals',
      topic: 'animals',
      language: 'English',
      count: 2,
    },
    selection: { ruleId: 'r1', ruleName: 'rule', score: 1, priority: 1 },
    template: {
      id: 'tmpl-1',
      name: 'Word',
      templateType: 'WORD',
      layoutType: 'IMAGE_TOP',
      templateVersion: '1.0',
    },
    cards: [
      {
        cardId: 'card-1',
        cardIndex: 0,
        components: [
          {
            componentId: 'title',
            type: 'title',
            componentType: 'title',
            editable: true,
            content: 'Lion',
          },
          {
            componentId: 'fact',
            type: 'sentence',
            componentType: 'sentence',
            editable: true,
            content: 'A lion is a big cat.',
          },
          {
            componentId: 'hero',
            type: 'image',
            componentType: 'image',
            editable: true,
            content: null,
            assetReference: {
              assetId: 'asset-lion',
              s3ObjectKey: 'assets/lion.png',
              signedUrl: 'https://cdn.example/lion.png',
              imageUrl: '/flashcards/assets/asset-lion/image',
              caption: 'lion photo',
              similarity: 0.9,
              mimeType: 'image/png',
              status: 'found',
              queryUsed: 'lion standing in grass',
              attempts: ['lion standing in grass'],
            },
          },
        ],
      },
      {
        cardId: 'card-2',
        cardIndex: 1,
        components: [
          {
            componentId: 'title',
            type: 'title',
            componentType: 'title',
            editable: true,
            content: 'Bird',
          },
          {
            componentId: 'fact',
            type: 'sentence',
            componentType: 'sentence',
            editable: true,
            content: 'A bird can fly.',
          },
          {
            componentId: 'hero',
            type: 'image',
            componentType: 'image',
            editable: true,
            content: null,
            assetReference: {
              assetId: 'asset-bird',
              signedUrl: null,
              imageUrl: null,
              caption: null,
              similarity: null,
              mimeType: null,
              status: 'IMAGE_NOT_FOUND',
              queryUsed: 'bird on a tree',
              attempts: ['bird on a tree'],
            },
          },
        ],
      },
    ],
    metadata: {
      generatedAt: '2026-01-01T00:00:00.000Z',
      promptVersion: 'v1',
      contentModel: 'gemini',
      imageConcurrency: 3,
    },
  };

  const worksheetPayload = {
    id: 'ws-1',
    template: { id: 't1', slug: 'match', name: 'Match', rendererType: 'generic' },
    request: { topic: 'animals' },
    structure: {
      instruction: 'Match each animal with its home.',
      title: 'Animals',
      items: [
        {
          label: 'Lion',
          imageQuery: 'lion standing in grass',
          assetId: 'a1',
          assetUrl: 'https://cdn.example/a1.png',
          count: 1,
        },
        {
          label: 'Bird',
          imageQuery: 'bird on a tree',
          assetId: 'a2',
        },
      ],
    },
    html: '<h1>Animals</h1>',
  };

  beforeEach(() => {
    provider = {
      translateTexts: jest.fn(async (texts: string[]) =>
        texts.map((text) => `MR:${text}`),
      ),
      isReady: jest.fn().mockReturnValue(true),
    };
    cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      isAvailable: jest.fn().mockReturnValue(true),
    };
    config = {
      get: jest.fn((key: string) => {
        const values: Record<string, unknown> = {
          'translation.enabled': true,
          'translation.maxBatchSize': 100,
          'translation.maxBatchCodeUnits': 25000,
          'redis.translationCacheTtlSeconds': 86400,
        };
        return values[key];
      }),
    };

    service = new TranslationService(
      provider as unknown as GcpTranslationProvider,
      config as unknown as ConfigService,
      cache as unknown as RedisCacheService,
    );
  });

  it('translates simple and nested flashcard text fields in one GCP batch', async () => {
    const result = (await service.translateContent(flashcardPayload, 'mr', {
      product: 'flashcards',
    })) as typeof flashcardPayload;

    expect(provider.translateTexts).toHaveBeenCalledTimes(1);
    expect(provider.translateTexts.mock.calls[0][4]).toBe('flashcards');
    const sent = provider.translateTexts.mock.calls[0][0];
    expect(sent).toEqual([
      'Lion',
      'A lion is a big cat.',
      'lion photo',
      'Bird',
      'A bird can fly.',
    ]);

    expect(result.cards[0].components[0].content).toBe('MR:Lion');
    expect(result.cards[0].components[1].content).toBe(
      'MR:A lion is a big cat.',
    );
    expect(result.cards[1].components[0].content).toBe('MR:Bird');
  });

  it('preserves image search fields, asset ids, urls, numbers, and structure', async () => {
    const original = structuredClone(flashcardPayload);
    const result = (await service.translateContent(
      flashcardPayload,
      'mr',
    )) as typeof flashcardPayload;

    const image = result.cards[0].components[2].assetReference!;
    expect(image.assetId).toBe('asset-lion');
    expect(image.signedUrl).toBe('https://cdn.example/lion.png');
    expect(image.imageUrl).toBe('/flashcards/assets/asset-lion/image');
    expect(image.queryUsed).toBe('lion standing in grass');
    expect(image.attempts).toEqual(['lion standing in grass']);
    expect(image.similarity).toBe(0.9);
    expect(image.status).toBe('found');
    expect(image.caption).toBe('MR:lion photo');

    expect(result.template).toEqual(original.template);
    expect(result.request).toEqual(original.request);
    expect(result.selection).toEqual(original.selection);
    expect(flashcardPayload).toEqual(original);
  });

  it('deduplicates identical strings before calling GCP', async () => {
    const payload = {
      cards: [
        {
          cardId: 'c1',
          cardIndex: 0,
          components: [
            {
              componentId: 'title',
              type: 'title',
              componentType: 'title',
              editable: true,
              content: 'Apple',
            },
          ],
        },
        {
          cardId: 'c2',
          cardIndex: 1,
          components: [
            {
              componentId: 'title',
              type: 'title',
              componentType: 'title',
              editable: true,
              content: 'Apple',
            },
          ],
        },
      ],
    };

    const result = (await service.translateContent(payload, 'hi')) as typeof payload;
    expect(provider.translateTexts).toHaveBeenCalledTimes(1);
    expect(provider.translateTexts.mock.calls[0][0]).toEqual(['Apple']);
    expect(result.cards[0].components[0].content).toBe('MR:Apple');
    expect(result.cards[1].components[0].content).toBe('MR:Apple');
  });

  it('does not call GCP for English → English and returns a clone', async () => {
    const result = await service.translateContent(flashcardPayload, 'en');
    expect(provider.translateTexts).not.toHaveBeenCalled();
    expect(result).toEqual(flashcardPayload);
    expect(result).not.toBe(flashcardPayload);
  });

  it('leaves empty/null values unchanged', async () => {
    const payload = {
      cards: [
        {
          cardId: 'c1',
          cardIndex: 0,
          components: [
            {
              componentId: 'title',
              type: 'title',
              componentType: 'title',
              editable: true,
              content: '',
            },
            {
              componentId: 'fact',
              type: 'sentence',
              componentType: 'sentence',
              editable: true,
              content: null,
            },
          ],
        },
      ],
    };

    const result = (await service.translateContent(payload, 'mr')) as typeof payload;
    expect(provider.translateTexts).not.toHaveBeenCalled();
    expect(result.cards[0].components[0].content).toBe('');
    expect(result.cards[0].components[1].content).toBeNull();
  });

  it('translates worksheet structure and html with worksheets product key scope', async () => {
    const result = (await service.translateContent(worksheetPayload, 'mr', {
      product: 'worksheets',
    })) as typeof worksheetPayload;

    expect(provider.translateTexts).toHaveBeenCalled();
    expect(result.structure.instruction).toBe(
      'MR:Match each animal with its home.',
    );
    expect(result.structure.title).toBe('MR:Animals');
    expect(result.structure.items[0].label).toBe('MR:Lion');
    expect(result.structure.items[0].imageQuery).toBe('lion standing in grass');
    expect(result.structure.items[0].assetId).toBe('a1');
    expect(result.structure.items[0].count).toBe(1);
    expect(result.html).toBe('MR:<h1>Animals</h1>');

    const products = provider.translateTexts.mock.calls.map((call) => call[4]);
    expect(products.every((p) => p === 'worksheets')).toBe(true);
    const mimeTypes = provider.translateTexts.mock.calls.map(
      (call) => call[3] ?? 'text/plain',
    );
    expect(mimeTypes).toContain('text/html');
  });

  it('does not mutate original input when GCP fails', async () => {
    const original = structuredClone(flashcardPayload);
    provider.translateTexts.mockRejectedValueOnce(new Error('GCP down'));

    await expect(
      service.translateContent(flashcardPayload, 'mr'),
    ).rejects.toBeInstanceOf(TranslationException);

    expect(flashcardPayload).toEqual(original);
  });

  it('rejects invalid language codes', async () => {
    await expect(
      service.translateContent(flashcardPayload, '!!!'),
    ).rejects.toMatchObject({
      code: 'INVALID_LANGUAGE',
      getStatus: expect.any(Function),
    });
    expect(provider.translateTexts).not.toHaveBeenCalled();
  });

  it('returns 503 when translation is disabled', async () => {
    config.get.mockImplementation((key: string) => {
      if (key === 'translation.enabled') return false;
      return true;
    });

    try {
      await service.translateContent(flashcardPayload, 'mr');
      fail('expected TranslationException');
    } catch (error) {
      expect(error).toBeInstanceOf(TranslationException);
      expect((error as TranslationException).getStatus()).toBe(
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  });

  it('chunks large batches when configured limit is small', async () => {
    config.get.mockImplementation((key: string) => {
      const values: Record<string, unknown> = {
        'translation.enabled': true,
        'translation.maxBatchSize': 2,
        'translation.maxBatchCodeUnits': 25000,
        'redis.translationCacheTtlSeconds': 86400,
      };
      return values[key];
    });

    await service.translateContent(flashcardPayload, 'mr');
    // 5 unique texts with maxBatchSize 2 → 3 GCP calls
    expect(provider.translateTexts.mock.calls.length).toBe(3);
  });
});
