import {
  SelectableRule,
  rankTemplateCandidates,
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
      objectiveConfidence: 'exact_keyword',
    });

    expect(match?.templateId).toBe('t-comparison');
  });

  it('returns ranked candidates with score breakdown', () => {
    const rules = [
      rule({
        id: 'r1',
        templateId: 't1',
        templateAgeGroups: ['3-4'],
        learningObjectives: ['vocabulary'],
        templateObjectives: ['vocabulary'],
      }),
    ];

    const ranked = rankTemplateCandidates(rules, {
      learningObjective: 'vocabulary',
      ageGroup: '3-4',
      ageMin: 3,
      ageMax: 4,
      objectiveConfidence: 'exact_keyword',
    });

    expect(ranked).toHaveLength(1);
    expect(ranked[0].breakdown.scoreComponents.objectiveRank).toBeGreaterThan(0);
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

  it('breaks ties deterministically by lexicographic ruleId', () => {
    const rules = [
      rule({
        id: 'z_rule',
        templateId: 't-z',
        templateAgeGroups: ['3-4'],
        learningObjectives: ['vocabulary'],
        templateObjectives: ['vocabulary'],
        ageMin: 3,
        ageMax: 4,
        priority: 110,
      }),
      rule({
        id: 'a_rule',
        templateId: 't-a',
        templateAgeGroups: ['3-4'],
        learningObjectives: ['vocabulary'],
        templateObjectives: ['vocabulary'],
        ageMin: 3,
        ageMax: 4,
        priority: 110,
      }),
    ];

    const forward = selectBestTemplate(rules, {
      learningObjective: 'vocabulary',
      ageGroup: '3-4',
      ageMin: 3,
      ageMax: 4,
      objectiveConfidence: 'exact_keyword',
    });
    const reverse = selectBestTemplate([...rules].reverse(), {
      learningObjective: 'vocabulary',
      ageGroup: '3-4',
      ageMin: 3,
      ageMax: 4,
      objectiveConfidence: 'exact_keyword',
    });

    expect(forward?.ruleId).toBe('a_rule');
    expect(reverse?.ruleId).toBe('a_rule');
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

  it('assigns tier 0 when rule explicitly targets a mismatched objective', () => {
    const rules = [
      rule({
        id: 'counting-rule',
        templateId: 't-counting',
        ageMin: 3,
        ageMax: 4,
        learningObjectives: ['counting'],
        templateObjectives: ['vocabulary', 'recognition'],
        templateAgeGroups: ['3-4'],
        priority: 110,
      }),
      rule({
        id: 'vocabulary-rule',
        templateId: 't-vocab',
        ageMin: 3,
        ageMax: 4,
        learningObjectives: ['vocabulary'],
        templateObjectives: ['vocabulary', 'recognition'],
        templateAgeGroups: ['3-4'],
        priority: 100,
      }),
    ];

    const ranked = rankTemplateCandidates(rules, {
      learningObjective: 'comparison',
      ageGroup: '3-4',
      ageMin: 3,
      ageMax: 4,
      objectiveConfidence: 'exact_keyword',
    });

    const counting = ranked.find((row) => row.ruleId === 'counting-rule');
    const vocabulary = ranked.find((row) => row.ruleId === 'vocabulary-rule');
    // counting rule objectives ['counting'] have no relation to 'comparison'
    // → objectiveRelevance = 0. But RELATED_OBJECTIVES['comparison']
    // includes 'matching' and 'recognition'. 'counting' not in related.
    // Actually 'counting' is not related to 'comparison'. So tier = 0.
    expect(counting?.breakdown.effectiveObjectiveRank).toBe(0);
    // vocabulary rule objectives ['vocabulary'] — 'vocabulary' IS in
    // RELATED_OBJECTIVES['comparison'] → tier 2.
    expect(vocabulary?.breakdown.effectiveObjectiveRank).toBe(2);
    expect(vocabulary?.breakdown.effectiveObjectiveRank).toBeGreaterThan(
      counting?.breakdown.effectiveObjectiveRank ?? 0,
    );
  });

  it('normalizes verb-style objective labels when ranking configured rules', () => {
    const rules = [
      rule({
        id: 'counting-rule',
        templateId: 't-counting',
        ageMin: 5,
        ageMax: 6,
        learningObjectives: ['counting'],
        templateObjectives: ['counting', 'vocabulary'],
        templateAgeGroups: ['5-6'],
      }),
    ];

    const ranked = rankTemplateCandidates(rules, {
      learningObjective: 'calculate',
      ageGroup: '5-6',
      ageMin: 5,
      ageMax: 6,
      objectiveConfidence: 'exact_keyword',
    });

    expect(ranked[0].breakdown.effectiveObjectiveRank).toBe(3);
  });

  it('prefers QA rule over comparison rule for question_answer requests', () => {
    const rules = [
      rule({
        id: 'comparison-rule',
        templateId: 't-qa-template',
        ageMin: 6,
        ageMax: 8,
        learningObjectives: ['comparison', 'classification', 'reading'],
        templateObjectives: ['question_answer', 'reading', 'identification'],
        templateAgeGroups: ['6-8'],
        priority: 110,
      }),
      rule({
        id: 'qa-rule',
        templateId: 't-qa-template',
        ageMin: 6,
        ageMax: 8,
        learningObjectives: ['question_answer', 'reading', 'identification'],
        templateObjectives: ['question_answer', 'reading', 'identification'],
        templateAgeGroups: ['6-8'],
        priority: 100,
      }),
    ];

    const match = selectBestTemplate(rules, {
      learningObjective: 'question_answer',
      ageGroup: '6-8',
      ageMin: 6,
      ageMax: 8,
      objectiveConfidence: 'exact_keyword',
    });

    // QA rule has exact objective match; comparison rule only has related
    // (reading).  QA must win despite lower priority.
    expect(match?.ruleId).toBe('qa-rule');
  });

  it('prefers facts rule over counting rule for science_facts requests', () => {
    const rules = [
      rule({
        id: 'counting-rule',
        templateId: 't-facts',
        ageMin: 5,
        ageMax: 6,
        learningObjectives: ['counting', 'matching', 'vocabulary'],
        templateObjectives: ['science_facts', 'vocabulary', 'general_knowledge'],
        templateAgeGroups: ['5-6'],
        priority: 110,
      }),
      rule({
        id: 'facts-rule',
        templateId: 't-facts',
        ageMin: 5,
        ageMax: 6,
        learningObjectives: ['science_facts', 'vocabulary', 'general_knowledge'],
        templateObjectives: ['science_facts', 'vocabulary', 'general_knowledge'],
        templateAgeGroups: ['5-6'],
        priority: 100,
      }),
    ];

    const match = selectBestTemplate(rules, {
      learningObjective: 'science_facts',
      ageGroup: '5-6',
      ageMin: 5,
      ageMax: 6,
      objectiveConfidence: 'exact_keyword',
    });

    // Facts rule has exact objective match; counting rule's objectives
    // only have generic relevance (vocabulary).
    expect(match?.ruleId).toBe('facts-rule');
  });

  it('prefers vocabulary rule over phonics rule on age-default vocabulary (exactObjective tiebreak)', () => {
    const rules = [
      rule({
        id: 'phonics-rule',
        templateId: 't-shared',
        ageMin: 3,
        ageMax: 4,
        learningObjectives: ['phonics', 'reading'],
        templateObjectives: ['vocabulary', 'recognition', 'reading'],
        templateAgeGroups: ['3-4'],
        priority: 110,
      }),
      rule({
        id: 'vocabulary-rule',
        templateId: 't-shared',
        ageMin: 3,
        ageMax: 4,
        learningObjectives: ['vocabulary', 'recognition', 'reading'],
        templateObjectives: ['vocabulary', 'recognition', 'reading'],
        templateAgeGroups: ['3-4'],
        priority: 100,
      }),
    ];

    const match = selectBestTemplate(rules, {
      learningObjective: 'vocabulary',
      ageGroup: '3-4',
      ageMin: 3,
      ageMax: 4,
      objectiveConfidence: 'age_default',
    });

    // Both rules reach effective tier 2 (age_default cap), but vocabulary rule
    // has ruleObjectiveExact=true → exactObjective=true in sort.
    expect(match?.ruleId).toBe('vocabulary-rule');
  });

  it('uses template objectives for synthetic rules without explicit objectives', () => {
    const rules = [
      rule({
        id: 'synthetic-tmpl',
        templateId: 't-vocab',
        learningObjectives: [],   // synthetic — no rule objectives
        templateObjectives: ['vocabulary', 'recognition'],
        templateAgeGroups: ['3-4'],
        priority: 50,
      }),
    ];

    const ranked = rankTemplateCandidates(rules, {
      learningObjective: 'vocabulary',
      ageGroup: '3-4',
      ageMin: 3,
      ageMax: 4,
      objectiveConfidence: 'exact_keyword',
    });

    // Template objectives should still be used for synthetic rules.
    expect(ranked[0].breakdown.effectiveObjectiveRank).toBe(3);
    expect(ranked[0].breakdown.exactObjective).toBe(true);
  });
});
