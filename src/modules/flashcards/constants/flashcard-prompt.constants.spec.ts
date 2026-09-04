import {
  SelectedTemplatePayload,
  TemplateComponentDefinition,
} from '../interfaces/flashcard.interfaces';
import {
  buildFlashcardContentPrompt,
  buildFlashcardContentSchema,
  expandTemplateComponents,
  parseRequestedRangeCount,
} from './flashcard-prompt.constants';

const selectedTemplate: SelectedTemplatePayload = {
  id: 'template-two-images',
  name: 'Two Image Fact Card',
  description: null,
  templateType: 'flashcard',
  layoutType: 'VERTICAL',
  templateVersion: '2.0',
  supportedAgeGroups: ['5-6'],
  supportedGrades: ['Grade 1'],
  learningObjectives: ['vocabulary'],
  subjectsSupported: ['EVS'],
  difficultyLevels: ['beginner'],
  tags: [],
  pageSize: 'A6',
  orientation: 'PORTRAIT',
  thumbnail: null,
  layoutDefinition: {
    regions: [],
  },
};

const textComponents: TemplateComponentDefinition[] = [
  {
    componentId: 'title_word',
    componentType: 'title',
    editable: true,
    required: true,
    regionId: 'header',
  },
];

const imageComponents: TemplateComponentDefinition[] = [
  {
    componentId: 'image_primary',
    componentType: 'image',
    editable: true,
    required: true,
    regionId: 'body',
  },
  {
    componentId: 'image_secondary',
    componentType: 'image',
    editable: true,
    required: true,
    regionId: 'footer',
  },
];

describe('flashcard template-aware prompt', () => {
  it('includes the selected template and every text/image component ID', () => {
    const prompt = buildFlashcardContentPrompt({
      query: 'Vegetables for Grade 1',
      topic: 'vegetables',
      ageMin: 5,
      ageMax: 6,
      learningObjective: 'vocabulary',
      count: 2,
      selectedTemplate,
      textComponents,
      imageComponents,
      grade: 'Grade 1',
      subject: 'EVS',
      difficulty: 'beginner',
      language: 'English',
    });

    expect(prompt).toContain('Template ID: template-two-images');
    expect(prompt).toContain('"title_word"');
    expect(prompt).toContain('"image_primary"');
    expect(prompt).toContain('"image_secondary"');
    expect(prompt).toContain('separate image requirement');
    expect(prompt).toContain('CROSS-CARD CONTENT UNIQUENESS');
    expect(prompt).toContain('expectedObjects[0] must be unique across cards');
  });

  it('pins schema fields to selected template component IDs', () => {
    const schema = buildFlashcardContentSchema(
      textComponents,
      imageComponents,
    ) as any;
    const cardProperties =
      schema.properties.cards.items.properties;

    expect(cardProperties.textComponents.properties).toHaveProperty(
      'title_word',
    );
    expect(cardProperties.imageComponents.properties).toHaveProperty(
      'image_primary',
    );
    expect(cardProperties.imageComponents.properties).toHaveProperty(
      'image_secondary',
    );
  });

  it('includes BARE_EXACT_QUERY rules for letterImage slots', () => {
    const prompt = buildFlashcardContentPrompt({
      query: 'Letter Q phonics',
      topic: 'alphabet',
      ageMin: 3,
      ageMax: 4,
      learningObjective: 'phonics',
      count: 1,
      selectedTemplate,
      textComponents: [
        {
          componentId: 'uppercaseLetter',
          componentType: 'title',
          editable: true,
          required: true,
          semanticRole: 'phonics.letter.uppercase',
        },
      ],
      imageComponents: [
        {
          componentId: 'letterImage',
          componentType: 'image',
          editable: true,
          required: true,
          semanticRole: 'phonics.letter.image',
        },
      ],
    });

    expect(prompt).toContain('style=BARE_EXACT_QUERY');
    expect(prompt).toContain('BARE_EXACT_QUERY image fields');
    expect(prompt).toContain('"letterImage"');
    expect(prompt).toMatch(/searchQuery MUST be ONLY the requested letter/i);
    expect(prompt).toContain('NEVER add styles, adjectives, or extra words');
  });

  it('asks STANDARD image searchQuery to follow title and skillLabel', () => {
    const prompt = buildFlashcardContentPrompt({
      query: 'Animals flashcards',
      topic: 'animals',
      ageMin: 5,
      ageMax: 6,
      learningObjective: 'vocabulary',
      count: 2,
      selectedTemplate,
      textComponents: [
        {
          componentId: 'skillLabel',
          componentType: 'title',
          editable: true,
          required: true,
        },
        {
          componentId: 'title',
          componentType: 'title',
          editable: true,
          required: true,
        },
      ],
      imageComponents: [
        {
          componentId: 'hero',
          componentType: 'image',
          editable: true,
          required: true,
        },
      ],
      subject: 'EVS',
    });

    expect(prompt).toContain('STANDARD image searchQuery fields');
    expect(prompt).toContain('"skillLabel"');
    expect(prompt).toContain('"title"');
    expect(prompt).toContain('Typically 2 to 6 words');
    expect(prompt).toContain('cartoon ant insect');
    expect(prompt).toContain('teaching-purpose, curriculum, and audience words');
    expect(prompt).toContain('invented scenery, props, settings, or narrative');
    expect(prompt).not.toContain('6 to 14 words');
  });

  it('forbids line-art terms unless the request is about tracing or colouring', () => {
    const components = {
      textComponents: [
        {
          componentId: 'title',
          componentType: 'title' as const,
          editable: true,
          required: true,
        },
      ],
      imageComponents: [
        {
          componentId: 'hero',
          componentType: 'image' as const,
          editable: true,
          required: true,
        },
      ],
    };

    const coloured = buildFlashcardContentPrompt({
      query: 'Animals flashcards',
      topic: 'animals',
      ageMin: 5,
      ageMax: 6,
      learningObjective: 'vocabulary',
      count: 2,
      selectedTemplate,
      ...components,
    });
    expect(coloured).toContain('this request is NOT about tracing or colouring');
    expect(coloured).toContain('MUST NOT contain "line art"');

    const lineArt = buildFlashcardContentPrompt({
      query: 'letter tracing cards for A to E',
      topic: 'alphabet',
      ageMin: 4,
      ageMax: 5,
      learningObjective: 'phonics',
      count: 2,
      selectedTemplate,
      ...components,
    });
    expect(lineArt).toContain('this request IS about tracing / colouring');
    expect(lineArt).toContain('ONLY for slots that must show the uncoloured drawing');
  });
});

describe('parseRequestedRangeCount', () => {
  it('parses start and end with dash, to, and between…and', () => {
    expect(parseRequestedRangeCount('numbers 51-100')).toBe(50);
    expect(parseRequestedRangeCount('numbers 51 to 100')).toBe(50);
    expect(parseRequestedRangeCount('numbers from 51 to 60')).toBe(10);
    expect(parseRequestedRangeCount('numbers between 1 and 20')).toBe(20);
    expect(parseRequestedRangeCount('numbers 91–100')).toBe(10);
  });

  it('caps large ranges at the caller via min(50, range)', () => {
    // parse returns full inclusive size; inferFallback applies the cap
    expect(parseRequestedRangeCount('numbers 1 to 100')).toBe(100);
  });

  it('parses end-only forms as inclusive count from 1', () => {
    expect(parseRequestedRangeCount('numbers up to 20')).toBe(20);
    expect(parseRequestedRangeCount('count till 15')).toBe(15);
    expect(parseRequestedRangeCount('practice until 30')).toBe(30);
  });

  it('treats start-only forms as open-ended (max fallback size)', () => {
    expect(parseRequestedRangeCount('numbers from 51')).toBe(50);
    expect(parseRequestedRangeCount('starting from 20')).toBe(50);
  });

  it('ignores age bands near age/year wording', () => {
    expect(parseRequestedRangeCount('flashcards for ages 5-6')).toBeUndefined();
    expect(
      parseRequestedRangeCount('numbers 1-20 for ages 5-6'),
    ).toBe(20);
  });

  it('swaps inverted ranges', () => {
    expect(parseRequestedRangeCount('numbers 100 to 91')).toBe(10);
  });
});

describe('expandTemplateComponents range fallback', () => {
  const numComponent: TemplateComponentDefinition = {
    componentId: 'num-{x}',
    componentType: 'badge',
    editable: true,
    required: true,
  };

  it('uses min(50, parsed range) when query has a range', () => {
    const expanded = expandTemplateComponents([numComponent], {
      query: 'numbers 51 to 100',
    });
    expect(expanded).toHaveLength(50);
    expect(expanded[0].componentId).toBe('num-1');
    expect(expanded[49].componentId).toBe('num-50');
  });

  it('uses exact range size when under the cap', () => {
    const expanded = expandTemplateComponents([numComponent], {
      query: 'numbers 1-12',
    });
    expect(expanded).toHaveLength(12);
  });

  it('falls back to 10 when no range is present', () => {
    const expanded = expandTemplateComponents([numComponent], {
      query: 'counting practice',
    });
    expect(expanded).toHaveLength(10);
  });

  it('uses validationRules.maxItems from the component definition', () => {
    const withMaxItems: TemplateComponentDefinition = {
      ...numComponent,
      validationRules: { maxItems: 8 },
    };
    const expanded = expandTemplateComponents([withMaxItems], {
      query: 'counting practice',
    });
    expect(expanded).toHaveLength(8);
  });

  it('uses validationRules.range from the component definition', () => {
    const withRange: TemplateComponentDefinition = {
      ...numComponent,
      validationRules: { range: { start: 1, end: 12 } },
    };
    const expanded = expandTemplateComponents([withRange], {
      query: 'counting practice',
    });
    expect(expanded).toHaveLength(12);
  });
});

describe('expandTemplateComponents image-{x} pairing', () => {
  const wordComponent: TemplateComponentDefinition = {
    componentId: 'word-{x}',
    componentType: 'badge',
    editable: true,
    required: true,
  };
  const imageComponent: TemplateComponentDefinition = {
    componentId: 'image-{x}',
    componentType: 'image',
    editable: true,
    required: true,
  };

  it('expands image-{x} to match paired word-{x} count', () => {
    const expanded = expandTemplateComponents([imageComponent], {
      ageMin: 5,
      ageMax: 6,
      pairWithComponents: [wordComponent],
    });
    // word-{x} for ages 5-6 → 6
    expect(expanded).toHaveLength(6);
    expect(expanded.map((c) => c.componentId)).toEqual([
      'image-1',
      'image-2',
      'image-3',
      'image-4',
      'image-5',
      'image-6',
    ]);
  });

  it('respects explicit image-{x} repeatCounts over paired text', () => {
    const expanded = expandTemplateComponents([imageComponent], {
      repeatCounts: { 'image-{x}': 2, 'word-{x}': 6 },
      pairWithComponents: [wordComponent],
    });
    expect(expanded).toHaveLength(2);
    expect(expanded.map((c) => c.componentId)).toEqual(['image-1', 'image-2']);
  });

  it('leaves non-repeating image ids unchanged', () => {
    const staticImage: TemplateComponentDefinition = {
      componentId: 'image_primary',
      componentType: 'image',
      editable: true,
      required: true,
    };
    const expanded = expandTemplateComponents([staticImage], {
      pairWithComponents: [wordComponent],
    });
    expect(expanded).toHaveLength(1);
    expect(expanded[0].componentId).toBe('image_primary');
  });
});

describe('buildFlashcardContentSchema expands image-{x}', () => {
  it('never puts a literal image-{x} key in the schema', () => {
    const schema = buildFlashcardContentSchema(
      [
        {
          componentId: 'word-{x}',
          componentType: 'badge',
          editable: true,
          required: true,
        },
      ],
      [
        {
          componentId: 'image-{x}',
          componentType: 'image',
          editable: true,
          required: true,
        },
      ],
      { ageMin: 5, ageMax: 6 },
    ) as any;

    const imageProps =
      schema.properties.cards.items.properties.imageComponents.properties;
    expect(imageProps).not.toHaveProperty('image-{x}');
    expect(imageProps).toHaveProperty('image-1');
    expect(imageProps).toHaveProperty('image-6');
    expect(Object.keys(imageProps)).toHaveLength(6);
  });
});
