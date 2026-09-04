import { FlashcardException } from '../errors/flashcard.exception';
import { TemplateComponentDefinition } from '../interfaces/flashcard.interfaces';
import { validateLlmFlashcardPayload } from './llm-content.validator';

function getFlashcardMessage(error: unknown): string {
  if (!(error instanceof FlashcardException)) {
    return String(error);
  }
  const response = error.getResponse();
  if (
    typeof response === 'object' &&
    response !== null &&
    'error' in response &&
    typeof (response as { error?: { message?: unknown } }).error?.message ===
      'string'
  ) {
    return (response as { error: { message: string } }).error.message;
  }
  return error.message;
}

function expectFlashcardMessage(run: () => unknown, pattern: RegExp): void {
  try {
    run();
    throw new Error('Expected FlashcardException to be thrown');
  } catch (error) {
    expect(error).toBeInstanceOf(FlashcardException);
    expect(getFlashcardMessage(error)).toMatch(pattern);
  }
}

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

  describe('indexed {x} component ids', () => {
    const indexedTextComponents: TemplateComponentDefinition[] = [
      {
        componentId: 'skillLabel',
        componentType: 'title',
        editable: true,
        required: true,
      },
      {
        componentId: 'num-{x}',
        componentType: 'fact',
        editable: true,
        required: true,
        validationRules: { maxCharacters: 4 },
      },
    ];

    const indexedCard = {
      cardIndex: 0,
      textComponents: {
        skillLabel: 'Count to ten',
        'num-1': '1',
        'num-2': '2',
        'num-3': '3',
      },
      imageComponents: {},
    };

    it('accepts contiguous expanded ids matching ^{base}-\\d+$', () => {
      const payload = validateLlmFlashcardPayload(
        { cards: [indexedCard] },
        1,
        indexedTextComponents,
        [],
      );

      expect(payload.cards[0].textComponents).toEqual({
        skillLabel: 'Count to ten',
        'num-1': '1',
        'num-2': '2',
        'num-3': '3',
      });
    });

    it('rejects the literal placeholder id as an output key', () => {
      expectFlashcardMessage(
        () =>
          validateLlmFlashcardPayload(
            {
              cards: [
                {
                  ...indexedCard,
                  textComponents: {
                    skillLabel: 'Count to ten',
                    'num-{x}': '1, 2, 3',
                  },
                },
              ],
            },
            1,
            indexedTextComponents,
            [],
          ),
        /must not use placeholder id "num-\{x\}"/,
      );
    });

    it('rejects non-numeric suffixes (num-abc) and bare prefixes (num-)', () => {
      expectFlashcardMessage(
        () =>
          validateLlmFlashcardPayload(
            {
              cards: [
                {
                  ...indexedCard,
                  textComponents: {
                    skillLabel: 'Count to ten',
                    'num-abc': 'x',
                  },
                },
              ],
            },
            1,
            indexedTextComponents,
            [],
          ),
        /unsupported component id "num-abc"/,
      );

      expectFlashcardMessage(
        () =>
          validateLlmFlashcardPayload(
            {
              cards: [
                {
                  ...indexedCard,
                  textComponents: {
                    skillLabel: 'Count to ten',
                    'num-': 'x',
                  },
                },
              ],
            },
            1,
            indexedTextComponents,
            [],
          ),
        /unsupported component id "num-"/,
      );
    });

    it('flags a gap in the indexed run with a specific missing-id message', () => {
      expectFlashcardMessage(
        () =>
          validateLlmFlashcardPayload(
            {
              cards: [
                {
                  ...indexedCard,
                  textComponents: {
                    skillLabel: 'Count to ten',
                    'num-1': '1',
                    'num-3': '3',
                  },
                },
              ],
            },
            1,
            indexedTextComponents,
            [],
          ),
        /num-2 missing/,
      );
    });

    it('requires the indexed run to start at 1', () => {
      expectFlashcardMessage(
        () =>
          validateLlmFlashcardPayload(
            {
              cards: [
                {
                  ...indexedCard,
                  textComponents: {
                    skillLabel: 'Count to ten',
                    'num-2': '2',
                    'num-3': '3',
                  },
                },
              ],
            },
            1,
            indexedTextComponents,
            [],
          ),
        /num-1 missing/,
      );
    });

    it('applies inherited validationRules to each expanded instance', () => {
      expectFlashcardMessage(
        () =>
          validateLlmFlashcardPayload(
            {
              cards: [
                {
                  ...indexedCard,
                  textComponents: {
                    skillLabel: 'Count to ten',
                    'num-1': '1',
                    'num-2': 'too-long',
                    'num-3': '3',
                  },
                },
              ],
            },
            1,
            indexedTextComponents,
            [],
          ),
        /textComponents\.num-2 exceeds maxCharacters=4 \(got 8 characters\)/,
      );
    });

    it('does not change exact-id validation for non-{x} templates', () => {
      expectFlashcardMessage(
        () =>
          validateLlmFlashcardPayload(
            {
              cards: [
                {
                  ...validCard,
                  textComponents: {
                    title_word: 'Broccoli',
                    // fact_main intentionally omitted
                  },
                },
              ],
            },
            1,
            textComponents,
            imageComponents,
          ),
        /missing required component "fact_main"/,
      );
    });
  });
});
