import {
  buildSeedCatalog,
  collectDiagnosticResults,
  DiagnosticCaseInput,
  formatDiagnosticReportMarkdown,
} from './template-selection.diagnostic.util';

export const DIAGNOSTIC_CASES: DiagnosticCaseInput[] = [
  {
    label: 'compare keyword',
    query: 'Compare fruits',
    ageGroup: '3-4',
    expectedObjective: 'comparison',
    expectedTemplateId: 'tmpl_image_word_sentence',
  },
  {
    label: 'sort keyword',
    query: 'Sort vegetables by color',
    ageGroup: '5-6',
    expectedObjective: 'sorting',
    expectedTemplateId: 'tmpl_image_word_fact',
  },
  {
    label: 'phonics sound query',
    query: 'What sound does A make?',
    ageGroup: '3-4',
    expectedObjective: 'phonics',
    expectedTemplateId: 'tmpl_image_word_sentence',
  },
  {
    label: 'no keyword age default vocabulary',
    query: 'Generate flashcards on vegetables',
    ageGroup: '3-4',
    expectedObjective: 'vocabulary',
    expectedObjectiveConfidence: 'age_default',
    expectedTemplateId: 'tmpl_image_word_sentence',
  },
  {
    label: 'about noise word does not hijack objective',
    query: 'Flashcards about animals',
    ageGroup: '3-4',
    expectedObjective: 'vocabulary',
    expectedObjectiveConfidence: 'age_default',
    expectedTemplateId: 'tmpl_image_word_sentence',
  },
  {
    label: 'multi-keyword identify and count',
    query: 'Identify and count the animals',
    ageGroup: '3-4',
    expectedObjective: 'counting',
    expectedTemplateId: 'tmpl_image_word_sentence',
  },
  {
    label: 'quiz keyword',
    query: 'Make a quiz about animals',
    ageGroup: '6-8',
    expectedObjective: 'question_answer',
    expectedTemplateId: 'tmpl_image_description_question',
  },
  {
    label: 'science facts',
    query: 'Science facts about planets',
    ageGroup: '5-6',
    expectedObjective: 'science_facts',
    expectedTemplateId: 'tmpl_image_word_fact',
  },
  {
    label: 'recognition age default 2-3',
    query: 'Animals',
    ageGroup: '2-3',
    expectedObjective: 'recognition',
    expectedObjectiveConfidence: 'age_default',
    expectedTemplateId: 'tmpl_large_image_word',
  },
  {
    label: 'general knowledge age default 10-12',
    query: 'World capitals',
    ageGroup: '10-12',
    expectedObjective: 'general_knowledge',
    expectedObjectiveConfidence: 'age_default',
    expectedTemplateId: 'tmpl_image_fact_quiz',
  },
  {
    label: 'match pairs',
    query: 'Match animal pairs',
    ageGroup: '3-4',
    expectedObjective: 'matching',
    expectedTemplateId: 'tmpl_image_word_sentence',
  },
  {
    label: 'classify categories',
    query: 'Classify fruits and vegetables',
    ageGroup: '5-6',
    expectedObjective: 'classification',
    expectedTemplateId: 'tmpl_image_word_fact',
  },
  {
    label: 'reading story',
    query: 'Read a short story about birds',
    ageGroup: '6-8',
    expectedObjective: 'reading',
    expectedTemplateId: 'tmpl_image_description_question',
  },
  {
    label: 'how many counting',
    query: 'How many apples are there?',
    ageGroup: '5-6',
    expectedObjective: 'counting',
    expectedTemplateId: 'tmpl_image_word_fact',
  },
  {
    label: 'difference comparison phrasing',
    query: 'Show the difference between cats and dogs',
    ageGroup: '5-6',
    expectedObjective: 'comparison',
    expectedTemplateId: 'tmpl_image_word_fact',
  },
  {
    label: 'explicit phonics',
    query: 'Generate phonics flashcards for alphabet',
    ageGroup: '4-5',
    expectedObjective: 'phonics',
    expectedTemplateId: 'tmpl_image_word_sentence',
  },
  {
    label: 'spot recognition',
    query: 'Spot the red objects',
    ageGroup: '2-3',
    expectedObjective: 'recognition',
    expectedTemplateId: 'tmpl_large_image_word',
  },
  {
    label: 'grade 1 vegetables EVS',
    query: 'Generate 12 flashcards on vegetables for Grade 1',
    ageGroup: '5-6',
    expectedObjective: 'vocabulary',
    expectedObjectiveConfidence: 'age_default',
    expectedTemplateId: 'tmpl_image_word_fact',
  },
  {
    label: 'vs comparison shorthand',
    query: 'Lion vs tiger',
    ageGroup: '6-8',
    expectedObjective: 'comparison',
    expectedTemplateId: 'tmpl_image_description_question',
  },
  {
    label: 'group sorting phrasing',
    query: 'Group shapes by size',
    ageGroup: '3-4',
    expectedObjective: 'sorting',
    expectedTemplateId: 'tmpl_image_word_sentence',
  },
  {
    label: 'calculate verb counting',
    query: 'Calculate how many stars',
    ageGroup: '5-6',
    expectedObjective: 'counting',
    expectedTemplateId: 'tmpl_image_word_fact',
  },
  {
    label: 'add verb counting',
    query: 'Add the apples',
    ageGroup: '5-6',
    expectedObjective: 'counting',
    expectedTemplateId: 'tmpl_image_word_fact',
  },
  {
    label: 'reading in range phrasing',
    query: 'Reading in range practice',
    ageGroup: '6-8',
    expectedObjective: 'reading',
    expectedTemplateId: 'tmpl_image_description_question',
  },
];

const SEED_RULES = buildSeedCatalog();

describe('template selection diagnostics', () => {
  const results = collectDiagnosticResults(DIAGNOSTIC_CASES, SEED_RULES);

  it.each(DIAGNOSTIC_CASES)(
    '$label — resolves objective and selects template',
    (testCase) => {
      const result = results.find((entry) => entry.label === testCase.label);
      expect(result).toBeDefined();
      expect(result!.resolved.learningObjective).toBe(testCase.expectedObjective);
      if (testCase.expectedObjectiveConfidence) {
        expect(result!.resolved.objectiveConfidence).toBe(
          testCase.expectedObjectiveConfidence,
        );
      }
      expect(result!.selectedTemplateId).toBe(testCase.expectedTemplateId);
      expect(result!.candidates.length).toBeGreaterThan(0);
      expect(result!.candidates[0].templateId).toBe(testCase.expectedTemplateId);
    },
  );

  it('emits full ranking breakdown for all diagnostic cases', () => {
    expect(results).toHaveLength(DIAGNOSTIC_CASES.length);

    for (const result of results) {
      expect(result.candidates.every((row) => row.rank >= 1)).toBe(true);
      expect(result.candidates[0].rank).toBe(1);
      for (const row of result.candidates) {
        expect(row.ruleId).toBeTruthy();
        expect(row.templateId).toBeTruthy();
        expect(row.scoreComponents.objectiveRank).toBeGreaterThanOrEqual(0);
      }
    }

    const markdown = formatDiagnosticReportMarkdown(results);
    expect(markdown).toContain('Template Selection Ranking Breakdown');
    expect(markdown.match(/^## /gm)?.length).toBe(DIAGNOSTIC_CASES.length);
  });

  it('lists fragile passes where objective-tier gap is below 1', () => {
    const fragile = results.filter((result) => result.fragilePass);

    for (const result of fragile) {
      expect(result.objectiveTierGap).toBe(0);
      expect(result.candidates.length).toBeGreaterThanOrEqual(2);
      expect(result.fragileReason).toContain('effectiveObjectiveRank');
      expect(result.selectedTemplateId).toBe(result.expectedTemplateId);
    }

    const stableLabels = fragile.map((result) => result.label).sort();
    expect(stableLabels).toEqual([
      'about noise word does not hijack objective',
      'classify categories',
      'difference comparison phrasing',
      'grade 1 vegetables EVS',
      'match pairs',
      'no keyword age default vocabulary',
      'quiz keyword',
      'reading in range phrasing',
      'reading story',
      'recognition age default 2-3',
      'science facts',
      'spot recognition',
      'vs comparison shorthand',
    ]);
  });

  it('demotes unrelated objective rules for age-default vocabulary queries', () => {
    const result = results.find(
      (entry) => entry.label === 'no keyword age default vocabulary',
    );
    expect(result).toBeDefined();

    for (const ruleId of [
      'rule_obj_3_4_counting',
      'rule_obj_3_4_comparison',
      'rule_obj_3_4_sorting',
    ]) {
      const row = result!.candidates.find((candidate) => candidate.ruleId === ruleId);
      expect(row?.effectiveObjectiveRank).toBe(0);
    }
  });

  it('gives unrelated explicit rule objectives tier 0 for comparison requests', () => {
    const result = results.find((entry) => entry.label === 'compare keyword');
    expect(result).toBeDefined();

    const phonics = result!.candidates.find(
      (row) => row.ruleId === 'rule_obj_3_4_phonics',
    );
    expect(phonics).toBeDefined();
    expect(phonics!.effectiveObjectiveRank).toBe(0);
    expect(phonics!.rawObjectiveRank).toBe(0);
  });

  it('documents objective tie-break priority for identify + count', () => {
    const result = results.find(
      (entry) => entry.label === 'multi-keyword identify and count',
    );
    expect(result?.resolved.learningObjective).toBe('counting');
    expect(result?.resolved.objectiveConfidence).toBe('exact_keyword');
  });
});

describe('template selection rule-id tie-break', () => {
  it('is deterministic via lexicographic ruleId (not DB insertion order)', () => {
    const rules = [
      {
        id: 'z_rule_late',
        name: 'Late id',
        priority: 110,
        ageMin: 3,
        ageMax: 4,
        grades: [],
        subjects: [],
        learningObjectives: ['comparison'],
        difficulties: [],
        intents: [],
        topics: [],
        templateId: 'tmpl_a',
        templateActive: true,
        templateAgeGroups: ['3-4'],
        templateAgeMin: 3,
        templateAgeMax: 4,
        templateSubjects: [],
        templateObjectives: ['vocabulary'],
        templateDifficulties: [],
        templateVersion: '1.0',
      },
      {
        id: 'a_rule_early',
        name: 'Early id',
        priority: 110,
        ageMin: 3,
        ageMax: 4,
        grades: [],
        subjects: [],
        learningObjectives: ['comparison'],
        difficulties: [],
        intents: [],
        topics: [],
        templateId: 'tmpl_b',
        templateActive: true,
        templateAgeGroups: ['3-4'],
        templateAgeMin: 3,
        templateAgeMax: 4,
        templateSubjects: [],
        templateObjectives: ['vocabulary'],
        templateDifficulties: [],
        templateVersion: '1.0',
      },
    ];

    const rankedForward = collectDiagnosticResults(
      [
        {
          label: 'tie-break probe',
          query: 'Compare fruits',
          ageGroup: '3-4',
          expectedObjective: 'comparison',
          expectedTemplateId: 'tmpl_b',
        },
      ],
      rules,
    )[0];

    const rankedReverse = collectDiagnosticResults(
      [
        {
          label: 'tie-break probe',
          query: 'Compare fruits',
          ageGroup: '3-4',
          expectedObjective: 'comparison',
          expectedTemplateId: 'tmpl_b',
        },
      ],
      [...rules].reverse(),
    )[0];

    expect(rankedForward.selectedRuleId).toBe('a_rule_early');
    expect(rankedReverse.selectedRuleId).toBe('a_rule_early');
  });
});
