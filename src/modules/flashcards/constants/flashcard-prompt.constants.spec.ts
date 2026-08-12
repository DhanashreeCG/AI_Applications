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
    componentType: 'text',
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
});
