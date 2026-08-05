import {
  SelectedTemplatePayload,
  TemplateComponentDefinition,
} from '../interfaces/flashcard.interfaces';
import {
  buildFlashcardContentPrompt,
  buildFlashcardContentSchema,
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
