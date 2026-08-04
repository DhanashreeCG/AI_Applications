import {
  SelectableRule,
  selectBestTemplate,
} from './template-selection.engine';

function rule(
  overrides: Partial<SelectableRule> &
    Pick<SelectableRule, 'id' | 'templateId'>,
): SelectableRule {
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

  it('ignores topic when choosing templates', () => {
    const rules = [
      rule({
        id: 'r-vocab',
        templateId: 't-vocab',
        learningObjectives: ['vocabulary'],
        templateObjectives: ['vocabulary'],
        topics: ['animals'],
      }),
    ];

    const fruits = selectBestTemplate(rules, {
      learningObjective: 'vocabulary',
      ageMin: 5,
      ageMax: 6,
      topic: 'fruits',
    });
    const veggies = selectBestTemplate(rules, {
      learningObjective: 'vocabulary',
      ageMin: 5,
      ageMax: 6,
      topic: 'vegetables',
    });

    expect(fruits?.templateId).toBe('t-vocab');
    expect(veggies?.templateId).toBe('t-vocab');
  });

  it('prefers exact grade match over age-only match', () => {
    const rules = [
      rule({
        id: 'age-only',
        templateId: 't-age',
        ageMin: 5,
        ageMax: 6,
        learningObjectives: ['vocabulary'],
        templateObjectives: ['vocabulary'],
        templateVersion: '2.0',
      }),
      rule({
        id: 'grade-exact',
        templateId: 't-grade',
        grades: ['Grade 1'],
        learningObjectives: ['vocabulary'],
        templateObjectives: ['vocabulary'],
        templateVersion: '1.0',
      }),
    ];

    const match = selectBestTemplate(rules, {
      learningObjective: 'vocabulary',
      grade: 'Grade 1',
      ageMin: 5,
      ageMax: 6,
    });

    expect(match?.templateId).toBe('t-grade');
  });

  it('prefers newer template version when other ranks tie', () => {
    const rules = [
      rule({
        id: 'old',
        templateId: 't-old',
        learningObjectives: ['vocabulary'],
        templateObjectives: ['vocabulary'],
        templateVersion: '1.0',
        priority: 100,
      }),
      rule({
        id: 'new',
        templateId: 't-new',
        learningObjectives: ['vocabulary'],
        templateObjectives: ['vocabulary'],
        templateVersion: '2.1',
        priority: 100,
      }),
    ];

    const match = selectBestTemplate(rules, {
      learningObjective: 'vocabulary',
      ageMin: null,
      ageMax: null,
    });

    expect(match?.templateId).toBe('t-new');
  });

  it('matches beginner requests to templates labeled easy', () => {
    const rules = [
      rule({
        id: 'r-easy',
        templateId: 't-easy',
        ageMin: 3,
        ageMax: 4,
        learningObjectives: ['vocabulary'],
        templateObjectives: ['vocabulary'],
        templateDifficulties: ['easy'],
        templateAgeMin: 3,
        templateAgeMax: 4,
      }),
    ];

    const match = selectBestTemplate(rules, {
      learningObjective: 'vocabulary',
      difficulty: 'beginner',
      ageMin: 3,
      ageMax: 4,
      subject: 'EVS',
    });

    expect(match?.templateId).toBe('t-easy');
  });

  it('does not hard-fail when template subjects omit the inferred subject', () => {
    const rules = [
      rule({
        id: 'r1',
        templateId: 't1',
        ageMin: 3,
        ageMax: 4,
        learningObjectives: ['vocabulary'],
        templateObjectives: ['vocabulary'],
        templateSubjects: ['science', 'general'],
        templateAgeMin: 3,
        templateAgeMax: 4,
      }),
    ];

    const match = selectBestTemplate(rules, {
      learningObjective: 'vocabulary',
      subject: 'EVS',
      difficulty: 'beginner',
      ageMin: 3,
      ageMax: 4,
    });

    expect(match?.templateId).toBe('t1');
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
