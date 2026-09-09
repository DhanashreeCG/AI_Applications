import {
  applyTranslations,
  chunkTextsForTranslation,
  extractTranslatableFields,
  isValidLanguageCode,
  normalizeLanguageCode,
  shouldSkipStringValue,
} from './translatable-fields.util';

describe('translatable-fields.util', () => {
  describe('language helpers', () => {
    it('normalizes language codes', () => {
      expect(normalizeLanguageCode(' MR ')).toBe('mr');
      expect(normalizeLanguageCode('pt_BR')).toBe('pt-br');
    });

    it('validates language codes', () => {
      expect(isValidLanguageCode('mr')).toBe(true);
      expect(isValidLanguageCode('pt-BR')).toBe(true);
      expect(isValidLanguageCode('')).toBe(false);
      expect(isValidLanguageCode('123')).toBe(false);
    });
  });

  describe('shouldSkipStringValue', () => {
    it('skips empty, urls, ids, colors, numbers', () => {
      expect(shouldSkipStringValue('')).toBe(true);
      expect(shouldSkipStringValue('https://cdn.example/a.png')).toBe(true);
      expect(shouldSkipStringValue('/flashcards/assets/x/image')).toBe(true);
      expect(
        shouldSkipStringValue('550e8400-e29b-41d4-a716-446655440000'),
      ).toBe(true);
      expect(shouldSkipStringValue('#ff00aa')).toBe(true);
      expect(shouldSkipStringValue('42')).toBe(true);
      expect(shouldSkipStringValue('Lion')).toBe(false);
    });
  });

  describe('extractTranslatableFields', () => {
    it('extracts flashcard component content and captions, skips image search fields', () => {
      const content = {
        request: { query: 'animals', language: 'English' },
        template: { name: 'Word Card', id: 'tmpl-1' },
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
                  assetId: 'asset-1',
                  signedUrl: 'https://cdn.example/lion.png',
                  imageUrl: '/flashcards/assets/asset-1/image',
                  caption: 'A lion',
                  queryUsed: 'lion standing in grass',
                  attempts: ['lion standing in grass'],
                  status: 'found',
                },
              },
            ],
          },
        ],
      };

      const { uniqueTexts, refs, clone } = extractTranslatableFields(content);

      expect(uniqueTexts).toEqual([
        'Lion',
        'A lion is a big cat.',
        'A lion',
      ]);
      expect(refs).toHaveLength(3);
      expect(clone).not.toBe(content);
      expect(
        (content.cards[0].components[2].assetReference as { queryUsed: string })
          .queryUsed,
      ).toBe('lion standing in grass');
    });

    it('deduplicates identical strings', () => {
      const content = {
        cards: [
          {
            cardId: 'c1',
            cardIndex: 0,
            components: [
              {
                componentId: 't1',
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
                componentId: 't1',
                type: 'title',
                componentType: 'title',
                editable: true,
                content: 'Apple',
              },
            ],
          },
        ],
      };

      const { uniqueTexts, refs } = extractTranslatableFields(content);
      expect(uniqueTexts).toEqual(['Apple']);
      expect(refs).toHaveLength(2);
      expect(refs[0].textIndex).toBe(0);
      expect(refs[1].textIndex).toBe(0);
    });

    it('extracts worksheet structure text and leaves imageQuery untouched', () => {
      const content = {
        structure: {
          instruction: 'Match each animal with its home.',
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
        html: '<h1>Match each animal with its home.</h1>',
      };

      const { uniqueTexts, html } = extractTranslatableFields(content);
      expect(uniqueTexts).toEqual([
        'Match each animal with its home.',
        'Lion',
        'Bird',
      ]);
      expect(uniqueTexts).not.toContain('lion standing in grass');
      expect(html).toBe('<h1>Match each animal with its home.</h1>');
    });

    it('does not mutate original input when applying translations', () => {
      const content = {
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
                content: 'Lion',
              },
            ],
          },
        ],
      };
      const snapshot = structuredClone(content);
      const { clone, refs, uniqueTexts } = extractTranslatableFields(content);
      applyTranslations(clone, refs, ['सिंह']);

      expect(content).toEqual(snapshot);
      expect(uniqueTexts).toEqual(['Lion']);
      expect(
        (clone as { cards: Array<{ components: Array<{ content: string }> }> })
          .cards[0].components[0].content,
      ).toBe('सिंह');
    });
  });

  describe('chunkTextsForTranslation', () => {
    it('chunks by size and code units', () => {
      const batches = chunkTextsForTranslation(
        ['aa', 'bb', 'cccc'],
        2,
        100,
      );
      expect(batches).toEqual([['aa', 'bb'], ['cccc']]);
    });
  });
});
