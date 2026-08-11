import { FlashcardException } from '../errors/flashcard.exception';
import { TemplateComponentDefinition } from '../interfaces/flashcard.interfaces';
import { validateLlmFlashcardPayload } from './llm-content.validator';

const textComponents: TemplateComponentDefinition[] = [
  {
    componentId: 'title_word',
    componentType: 'title',
    editable: true,
    required: true,
  },
  {
    componentId: 'fact_main',
    componentType: 'fact',
    editable: true,
    required: true,
  },
];

const imageComponents: TemplateComponentDefinition[] = [
  {
    componentId: 'image_primary',
    componentType: 'image',
    editable: true,
    required: true,
  },
  {
    componentId: 'image_secondary',
    componentType: 'image',
    editable: true,
    required: true,
  },
];

const validCard = {
  cardIndex: 0,
  textComponents: {
    title_word: 'Broccoli',
    fact_main: 'Broccoli is a green vegetable.',
  },
  imageComponents: {
    image_primary: {
      searchQuery: 'fresh green broccoli white background',
      expectedObjects: ['broccoli'],
      preferredStyle: 'photo',
      preferredBackground: 'white',
      orientation: 'portrait',
      educationalUse: 'flashcard',
    },
    image_secondary: {
      searchQuery: 'broccoli florets close up',
      expectedObjects: ['broccoli florets'],
      preferredStyle: 'photo',
      preferredBackground: 'white',
      orientation: 'portrait',
      educationalUse: 'flashcard',
    },
  },
};

describe('validateLlmFlashcardPayload', () => {
  it('validates text and each image against selected template component IDs', () => {
    const payload = validateLlmFlashcardPayload(
      { cards: [validCard] },
      1,
      textComponents,
      imageComponents,
    );

    expect(payload.cards[0].textComponents.title_word).toBe('Broccoli');
    expect(
      payload.cards[0].imageComponents.image_secondary.searchQuery,
    ).toBe('broccoli florets close up');
  });

  it('rejects a missing required image component', () => {
    const card = {
      ...validCard,
      imageComponents: {
        image_primary: validCard.imageComponents.image_primary,
      },
    };

    expect(() =>
      validateLlmFlashcardPayload(
        { cards: [card] },
        1,
        textComponents,
        imageComponents,
      ),
    ).toThrow(FlashcardException);
  });

  it('rejects component IDs not present in the selected template', () => {
    const card = {
      ...validCard,
      textComponents: {
        ...validCard.textComponents,
        invented_subtitle: 'Do not accept this.',
      },
    };

    expect(() =>
      validateLlmFlashcardPayload(
        { cards: [card] },
        1,
        textComponents,
        imageComponents,
      ),
    ).toThrow(FlashcardException);
  });

  it('rejects empty required text and image search fields', () => {
    expect(() =>
      validateLlmFlashcardPayload(
        {
          cards: [
            {
              ...validCard,
              textComponents: {
                ...validCard.textComponents,
                fact_main: ' ',
              },
            },
          ],
        },
        1,
        textComponents,
        imageComponents,
      ),
    ).toThrow(FlashcardException);
  });

  it('supports templates without image components', () => {
    const payload = validateLlmFlashcardPayload(
      {
        cards: [
          {
            cardIndex: 0,
            textComponents: validCard.textComponents,
            imageComponents: {},
          },
        ],
      },
      1,
      textComponents,
      [],
    );

    expect(payload.cards[0].imageComponents).toEqual({});
  });

  it('rejects layout, template, and rendering data from the LLM', () => {
    expect(() =>
      validateLlmFlashcardPayload(
        { cards: [validCard], template: { id: 'invented' } },
        1,
        textComponents,
        imageComponents,
      ),
    ).toThrow(FlashcardException);
  });
});
