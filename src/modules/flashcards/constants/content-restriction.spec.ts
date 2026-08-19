import {
  assertContentRequestIsAllowed,
  buildFlashcardContentPrompt,
  ForbiddenContentError,
} from './flashcard-prompt.constants';
import { SelectedTemplatePayload } from '../interfaces/flashcard.interfaces';
import {
  hydrateContentRestrictions,
  resetContentRestrictionsToDefaults,
  topicIsPrimarilyForbidden,
} from '../utils/content-restriction.registry';

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
  layoutDefinition: { regions: [] },
};

describe('content restrictions', () => {
  beforeEach(() => {
    resetContentRestrictionsToDefaults();
  });

  it('rejects long religious queries via ratio (no word-count bypass)', () => {
    expect(() =>
      assertContentRequestIsAllowed({
        query: 'tell me the story of jesus christ and the resurrection for grade 1',
      }),
    ).toThrow(ForbiddenContentError);
  });

  it('rejects topical about-queries even when the ratio is low', () => {
    expect(() =>
      assertContentRequestIsAllowed({
        query: 'please generate educational flashcards about ramadan for grade one',
      }),
    ).toThrow(ForbiddenContentError);
  });

  it('allows a broad farm topic that only mentions a country-specific term in passing', () => {
    expect(
      topicIsPrimarilyForbidden('farm animals including pigs and chickens and ducks'),
    ).toBeUndefined();
  });

  it('bans pigs for Saudi Arabia even in a moderately focused query', () => {
    expect(topicIsPrimarilyForbidden('pigs on the farm', 'SA')).toBe('pigs');
    expect(topicIsPrimarilyForbidden('pigs on the farm', 'US')).toBeUndefined();
  });

  it('bans cow terms for India only', () => {
    expect(() =>
      assertContentRequestIsAllowed({ topic: 'cows', countryCode: 'IN' }),
    ).toThrow(ForbiddenContentError);
    expect(() =>
      assertContentRequestIsAllowed({ topic: 'cows', countryCode: 'US' }),
    ).not.toThrow();
  });

  it('injects country-specific banned terms into the prompt', () => {
    const prompt = buildFlashcardContentPrompt({
      query: 'Farm animals for Grade 1',
      topic: 'farm animals',
      ageMin: 5,
      ageMax: 6,
      learningObjective: 'vocabulary',
      count: 1,
      selectedTemplate,
      textComponents: [
        {
          componentId: 'title_word',
          componentType: 'title',
          editable: true,
          required: true,
        },
      ],
      imageComponents: [],
      countryCode: 'SA',
    });

    expect(prompt).toContain("this learner's country (SA)");
    expect(prompt).toContain('pork');
    expect(prompt).toContain('BANNED (hard block)');
  });

  it('uses database-hydrated restricted terms in the prompt', () => {
    hydrateContentRestrictions([
      {
        term: 'unicorn',
        category: 'OTHER',
        severity: 'RESTRICTED',
        countryCode: '*',
        active: true,
      },
    ]);
    const prompt = buildFlashcardContentPrompt({
      query: 'Animals for Grade 1',
      topic: 'animals',
      ageMin: 5,
      ageMax: 6,
      learningObjective: 'vocabulary',
      count: 1,
      selectedTemplate,
      textComponents: [
        {
          componentId: 'title_word',
          componentType: 'title',
          editable: true,
          required: true,
        },
      ],
      imageComponents: [],
    });
    expect(prompt).toContain('unicorn');
    expect(prompt).toContain('RESTRICTED (skip for this region)');
  });
});
