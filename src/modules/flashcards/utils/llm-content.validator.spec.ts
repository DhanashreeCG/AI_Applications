import { validateLlmFlashcardPayload } from './llm-content.validator';
import { FlashcardException } from '../errors/flashcard.exception';
import { TemplateComponentDefinition } from '../interfaces/flashcard.interfaces';

const textComponents: TemplateComponentDefinition[] = [
  {
    componentId: 'title_word',
    componentType: 'title',
    editable: true,
    required: true,
  },
  {
    componentId: 'sentence_main',
    componentType: 'sentence',
    editable: true,
    required: true,
  },
];

describe('validateLlmFlashcardPayload', () => {
  it('accepts a valid payload', () => {
    const payload = validateLlmFlashcardPayload(
      {
        cards: [
          {
            cardIndex: 0,
            components: {
              title_word: 'Carrot',
              sentence_main: 'A carrot is orange.',
            },
            imageSearchQueries: ['carrot vegetable cartoon'],
          },
        ],
      },
      1,
      textComponents,
    );

    expect(payload.cards).toHaveLength(1);
    expect(payload.cards[0].components.title_word).toBe('Carrot');
  });

  it('maps component-type and loosely spelled keys back to componentIds', () => {
    const payload = validateLlmFlashcardPayload(
      {
        cards: [
          {
            components: {
              title: 'Carrot',
              'Sentence Main': 'A carrot is orange.',
            },
            imageSearchQueries: ['carrot'],
          },
        ],
      },
      1,
      textComponents,
    );

    expect(payload.cards[0].components).toEqual({
      title_word: 'Carrot',
      sentence_main: 'A carrot is orange.',
    });
  });

  it('accepts an array of component entries', () => {
    const payload = validateLlmFlashcardPayload(
      {
        cards: [
          {
            components: [
              { componentId: 'title_word', content: 'Carrot' },
              { componentId: 'sentence_main', content: 'A carrot is orange.' },
            ],
            imageSearchQueries: ['carrot'],
          },
        ],
      },
      1,
      textComponents,
    );

    expect(payload.cards[0].components.sentence_main).toBe(
      'A carrot is orange.',
    );
  });

  it('rejects missing required components', () => {
    expect(() =>
      validateLlmFlashcardPayload(
        {
          cards: [
            {
              components: { title_word: 'Carrot' },
              imageSearchQueries: ['carrot'],
            },
          ],
        },
        1,
        textComponents,
      ),
    ).toThrow(FlashcardException);
  });

  it('rejects wrong card count', () => {
    expect(() =>
      validateLlmFlashcardPayload({ cards: [] }, 2, textComponents),
    ).toThrow(FlashcardException);
  });

  it('accepts structured image search queries', () => {
    const payload = validateLlmFlashcardPayload(
      {
        cards: [
          {
            cardIndex: 0,
            components: {
              title_word: 'Broccoli',
              sentence_main: 'Broccoli is a green vegetable.',
            },
            imageSearchQueries: [
              {
                searchQuery: 'cartoon green broccoli',
                expectedObjects: ['broccoli'],
                preferredStyle: 'cartoon',
                preferredBackground: 'white',
                orientation: 'portrait',
                educationalUse: 'flashcard',
              },
            ],
          },
        ],
      },
      1,
      textComponents,
    );

    expect(payload.cards[0].imageSearchQueries[0]).toMatchObject({
      searchQuery: 'cartoon green broccoli',
      expectedObjects: ['broccoli'],
      preferredStyle: 'cartoon',
    });
  });

  it('rejects unsupported component ids and layout fields', () => {
    expect(() =>
      validateLlmFlashcardPayload(
        {
          layout: { x: 1 },
          cards: [
            {
              components: {
                title_word: 'Carrot',
                sentence_main: 'Orange.',
                extra_field: 'nope',
              },
              imageSearchQueries: ['carrot'],
            },
          ],
        },
        1,
        textComponents,
      ),
    ).toThrow(FlashcardException);
  });
});
