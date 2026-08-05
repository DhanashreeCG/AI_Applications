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
    templateAgeGroups: overrides.templateAgeGroups ?? [],
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

  it('keeps exact age match ahead of grade after objective matching', () => {
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

    expect(match?.templateId).toBe('t-age');
  });

  it('hard-filters templates using the user-selected age group', () => {
    const rules = [
      rule({
        id: 'disjoint-groups',
        templateId: 't-disjoint',
        templateAgeGroups: ['2-3', '8-10'],
        templateAgeMin: 2,
        templateAgeMax: 10,
        learningObjectives: ['vocabulary'],
        templateObjectives: ['vocabulary'],
      }),
      rule({
        id: 'matching-group',
        templateId: 't-match',
        templateAgeGroups: ['5-6'],
        templateAgeMin: 5,
        templateAgeMax: 6,
        learningObjectives: ['vocabulary'],
        templateObjectives: ['vocabulary'],
      }),
    ];

    const match = selectBestTemplate(rules, {
      learningObjective: 'vocabulary',
      ageGroup: '5-6',
      ageMin: 5,
      ageMax: 6,
    });

    expect(match?.templateId).toBe('t-match');
  });

  it('prefers an exact template age group over a broader overlap', () => {
    const rules = [
      rule({
        id: 'broad',
        templateId: 't-broad',
        templateAgeGroups: ['4-7'],
        templateVersion: '2.0',
        learningObjectives: ['vocabulary'],
        templateObjectives: ['vocabulary'],
      }),
      rule({
        id: 'exact',
        templateId: 't-exact',
        templateAgeGroups: ['5-6'],
        templateVersion: '1.0',
        learningObjectives: ['vocabulary'],
        templateObjectives: ['vocabulary'],
      }),
    ];

    const match = selectBestTemplate(rules, {
      learningObjective: 'vocabulary',
      ageGroup: '5-6',
      ageMin: 5,
      ageMax: 6,
    });

    expect(match?.templateId).toBe('t-exact');
  });

  it('selects comparison objective within age range over vocabulary', () => {
    const rules = [
      rule({
        id: 'vocabulary-exact-age',
        templateId: 't-vocabulary',
        templateAgeGroups: ['3-4'],
        templateObjectives: ['vocabulary'],
        templateVersion: '2.0',
      }),
      rule({
        id: 'comparison-overlap',
        templateId: 't-comparison',
        templateAgeGroups: ['3-5'],
        templateObjectives: ['comparison'],
        templateVersion: '1.0',
      }),
    ];

    const match = selectBestTemplate(rules, {
      learningObjective: 'comparison',
      ageGroup: '3-4',
      ageMin: 3,
      ageMax: 4,
    });

    expect(match?.templateId).toBe('t-comparison');
  });

  it('falls back to a related objective within the requested age range', () => {
    const rules = [
      rule({
        id: 'vocabulary',
        templateId: 't-vocabulary',
        templateAgeGroups: ['3-4'],
        templateObjectives: ['vocabulary'],
      }),
      rule({
        id: 'classification',
        templateId: 't-classification',
        templateAgeGroups: ['3-4'],
        templateObjectives: ['classification'],
      }),
    ];

    const match = selectBestTemplate(rules, {
      learningObjective: 'comparison',
      ageGroup: '3-4',
      ageMin: 3,
      ageMax: 4,
    });

    expect(match?.templateId).toBe('t-classification');
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
        templateAgeGroups: ['2-3'],
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
