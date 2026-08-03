import {
  SelectableRule,
  selectBestTemplate,
} from './template-selection.engine';

function rule(overrides: Partial<SelectableRule> & Pick<SelectableRule, 'id' | 'templateId'>): SelectableRule {
  return {
    name: overrides.name ?? overrides.id,
    priority: overrides.priority ?? 100,
    ageMin: overrides.ageMin ?? null,
    ageMax: overrides.ageMax ?? null,
    grades: overrides.grades ?? [],
    subjects: overrides.subjects ?? [],
    learningObjectives: overrides.learningObjectives ?? [],
    difficulties: overrides.difficulties ?? [],
    intents: overrides.intents ?? [],
    topics: overrides.topics ?? [],
    templateActive: overrides.templateActive ?? true,
    templateAgeMin: overrides.templateAgeMin ?? 0,
    templateAgeMax: overrides.templateAgeMax ?? 99,
    templateSubjects: overrides.templateSubjects ?? [],
    templateObjectives: overrides.templateObjectives ?? [],
    templateDifficulties: overrides.templateDifficulties ?? [],
    templateVersion: overrides.templateVersion ?? '1.0',
    id: overrides.id,
    templateId: overrides.templateId,
  };
}

describe('selectBestTemplate', () => {
  it('selects the age-matching vocabulary template deterministically', () => {
    const rules = [
      rule({
        id: 'r1',
        templateId: 't-word',
        ageMin: 2,
        ageMax: 3,
        learningObjectives: ['recognition'],
        priority: 100,
        templateAgeMin: 2,
        templateAgeMax: 3,
        templateObjectives: ['recognition'],
      }),
      rule({
        id: 'r2',
        templateId: 't-sentence',
        ageMin: 3,
        ageMax: 4,
        learningObjectives: ['vocabulary'],
        priority: 100,
        templateAgeMin: 3,
        templateAgeMax: 4,
        templateObjectives: ['vocabulary'],
      }),
    ];

    const match = selectBestTemplate(rules, {
      learningObjective: 'vocabulary',
      ageMin: 3,
      ageMax: 4,
      topic: 'vegetables',
    });

    expect(match?.templateId).toBe('t-sentence');
    expect(match?.ruleId).toBe('r2');
  });

  it('prefers higher priority when scores tie', () => {
    const rules = [
      rule({
        id: 'low',
        templateId: 't-low',
        priority: 10,
        learningObjectives: ['vocabulary'],
        templateObjectives: ['vocabulary'],
      }),
      rule({
        id: 'high',
        templateId: 't-high',
        priority: 200,
        learningObjectives: ['vocabulary'],
        templateObjectives: ['vocabulary'],
      }),
    ];

    const match = selectBestTemplate(rules, {
      learningObjective: 'vocabulary',
      ageMin: null,
      ageMax: null,
    });

    expect(match?.templateId).toBe('t-high');
  });

  it('returns null when no rule matches', () => {
    const rules = [
      rule({
        id: 'r1',
        templateId: 't1',
        ageMin: 2,
        ageMax: 3,
        learningObjectives: ['recognition'],
        templateObjectives: ['recognition'],
        templateAgeMin: 2,
        templateAgeMax: 3,
      }),
    ];

    const match = selectBestTemplate(rules, {
      learningObjective: 'question_answer',
      ageMin: 10,
      ageMax: 12,
    });

    expect(match).toBeNull();
  });
});
