import { TemplateSelectionCriteria } from '../interfaces/flashcard.interfaces';

export interface SelectableRule {
  id: string;
  name: string;
  priority: number;
  ageMin: number | null;
  ageMax: number | null;
  grades: string[];
  subjects: string[];
  learningObjectives: string[];
  difficulties: string[];
  intents: string[];
  topics: string[];
  templateId: string;
  templateActive: boolean;
  templateAgeMin: number;
  templateAgeMax: number;
  templateSubjects: string[];
  templateObjectives: string[];
  templateDifficulties: string[];
  templateVersion: string;
}

export interface SelectionResult {
  ruleId: string;
  ruleName: string;
  templateId: string;
  priority: number;
  score: number;
  templateVersion: string;
}

/** Map legacy / seed difficulty labels onto the revised taxonomy. */
const DIFFICULTY_ALIASES: Record<string, string> = {
  beginner: 'beginner',
  easy: 'beginner',
  basic: 'beginner',
  simple: 'beginner',
  intermediate: 'intermediate',
  medium: 'intermediate',
  moderate: 'intermediate',
  advanced: 'advanced',
  hard: 'advanced',
  difficult: 'advanced',
  challenging: 'advanced',
};

function overlapsAge(
  ruleAgeMin: number | null,
  ruleAgeMax: number | null,
  reqAgeMin: number | null,
  reqAgeMax: number | null,
): boolean {
  if (reqAgeMin === null && reqAgeMax === null) {
    return true;
  }
  if (ruleAgeMin === null && ruleAgeMax === null) {
    return true;
  }

  const leftMin = reqAgeMin ?? reqAgeMax!;
  const leftMax = reqAgeMax ?? reqAgeMin!;
  const rightMin = ruleAgeMin ?? Number.NEGATIVE_INFINITY;
  const rightMax = ruleAgeMax ?? Number.POSITIVE_INFINITY;
  return leftMin <= rightMax && leftMax >= rightMin;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeDifficulty(value: string): string {
  const key = normalize(value);
  return DIFFICULTY_ALIASES[key] ?? key;
}

function normalizeObjective(value: string): string {
  const key = normalize(value).replace(/[\s-]+/g, '_');
  if (key === 'language_learning') return 'phonics';
  if (key === 'identification') return 'recognition';
  if (key === 'q_and_a' || key === 'qa' || key === 'question_and_answer') {
    return 'question_answer';
  }
  return key;
}

function listIncludes(
  configured: string[],
  value: string | undefined,
  normalizer: (value: string) => string = normalize,
): boolean {
  if (!value) return false;
  const needle = normalizer(value);
  return configured.some((item) => normalizer(item) === needle);
}

/**
 * Exact match when the rule configures the dimension.
 * Empty configured list = wildcard (always passes, not an exact match).
 */
function ruleDimensionMatch(
  configured: string[],
  value: string | undefined,
  normalizer: (value: string) => string = normalize,
): { passes: boolean; exact: boolean } {
  if (!configured.length) {
    return { passes: true, exact: false };
  }
  if (!value) {
    // Rule constrains this dimension but request omitted it — do not hard-fail;
    // treat as non-exact so age/objective-only requests still resolve.
    return { passes: true, exact: false };
  }
  const exact = listIncludes(configured, value, normalizer);
  return { passes: exact, exact };
}

function softExact(
  configured: string[],
  value: string | undefined,
  normalizer: (value: string) => string = normalize,
): boolean {
  if (!configured.length || !value) {
    return false;
  }
  return listIncludes(configured, value, normalizer);
}

function parseVersion(version: string): number[] {
  return version
    .split('.')
    .map((part) => Number.parseInt(part.replace(/\D/g, ''), 10) || 0);
}

/** Newer versions sort first (negative when a > b). */
export function compareTemplateVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (right[i] ?? 0) - (left[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return b.localeCompare(a);
}

interface RankedCandidate extends SelectionResult {
  exactGrade: boolean;
  exactObjective: boolean;
  exactSubject: boolean;
  exactDifficulty: boolean;
  exactAge: boolean;
}

/**
 * Deterministic template selection (FLASH_CARD_REVISED):
 * Topic must NOT determine the template.
 *
 * Hard filters come from selection-rule fields only (empty = wildcard).
 * Template metadata is used for ranking preference, not elimination —
 * otherwise seed labels like difficulty "easy" reject request "beginner".
 *
 * Rank priority:
 * 1. exact grade
 * 2. exact educational objective
 * 3. exact subject
 * 4. exact difficulty
 * 5. age overlap specificity
 * 6. newest active template version
 * 7. rule priority / stable id
 */
export function selectBestTemplate(
  rules: SelectableRule[],
  criteria: TemplateSelectionCriteria & {
    learningObjective: string;
    ageMin: number | null;
    ageMax: number | null;
  },
): SelectionResult | null {
  const ranked: RankedCandidate[] = [];

  for (const rule of rules) {
    if (!rule.templateActive) {
      continue;
    }

    if (
      !overlapsAge(
        rule.ageMin,
        rule.ageMax,
        criteria.ageMin,
        criteria.ageMax,
      )
    ) {
      continue;
    }

    if (
      criteria.ageMin !== null &&
      criteria.ageMax !== null &&
      (criteria.ageMax < rule.templateAgeMin ||
        criteria.ageMin > rule.templateAgeMax)
    ) {
      continue;
    }

    // Hard filters: age (+ optional rule grade/subject/difficulty when the
    // request supplies them AND the rule configures them).
    // Learning objective is ranked, not a hard gate — otherwise a phonics
    // request in an age band whose rule lists only "vocabulary" returns nothing.
    const grade = ruleDimensionMatch(rule.grades, criteria.grade);
    const subject = ruleDimensionMatch(rule.subjects, criteria.subject);
    const difficulty = ruleDimensionMatch(
      rule.difficulties,
      criteria.difficulty,
      normalizeDifficulty,
    );

    if (!grade.passes || !subject.passes || !difficulty.passes) {
      continue;
    }

    const ruleObjectiveExact = softExact(
      rule.learningObjectives,
      criteria.learningObjective,
      normalizeObjective,
    );
    const templateObjectiveExact = softExact(
      rule.templateObjectives,
      criteria.learningObjective,
      normalizeObjective,
    );

    const exactObjective = ruleObjectiveExact || templateObjectiveExact;
    const exactSubject =
      subject.exact || softExact(rule.templateSubjects, criteria.subject);
    const exactDifficulty =
      difficulty.exact ||
      softExact(
        rule.templateDifficulties,
        criteria.difficulty,
        normalizeDifficulty,
      );

    const exactAge =
      rule.ageMin !== null &&
      rule.ageMax !== null &&
      criteria.ageMin !== null &&
      criteria.ageMax !== null &&
      rule.ageMin === criteria.ageMin &&
      rule.ageMax === criteria.ageMax;

    let score = 0;
    if (grade.exact) score += 1000;
    if (exactObjective) score += 400;
    if (exactSubject) score += 200;
    if (exactDifficulty) score += 100;
    if (exactAge) score += 50;
    score += rule.priority;

    if (ruleObjectiveExact) score += 120;
    else if (templateObjectiveExact) score += 80;
    else if (
      rule.learningObjectives.length ||
      rule.templateObjectives.length
    ) {
      score -= 40;
    }

    ranked.push({
      ruleId: rule.id,
      ruleName: rule.name,
      templateId: rule.templateId,
      priority: rule.priority,
      score,
      templateVersion: rule.templateVersion,
      exactGrade: grade.exact,
      exactObjective,
      exactSubject,
      exactDifficulty,
      exactAge,
    });
  }

  if (!ranked.length) {
    return null;
  }

  // Prefer objective-compatible templates when any exist.
  const objectiveCompatible = ranked.filter((item) => item.exactObjective);
  const pool = objectiveCompatible.length ? objectiveCompatible : ranked;

  pool.sort((a, b) => {
    if (a.exactGrade !== b.exactGrade) return a.exactGrade ? -1 : 1;
    if (a.exactObjective !== b.exactObjective) return a.exactObjective ? -1 : 1;
    if (a.exactSubject !== b.exactSubject) return a.exactSubject ? -1 : 1;
    if (a.exactDifficulty !== b.exactDifficulty) {
      return a.exactDifficulty ? -1 : 1;
    }
    if (a.exactAge !== b.exactAge) return a.exactAge ? -1 : 1;

    const versionCmp = compareTemplateVersions(
      a.templateVersion,
      b.templateVersion,
    );
    if (versionCmp !== 0) return versionCmp;

    if (b.priority !== a.priority) return b.priority - a.priority;
    if (b.score !== a.score) return b.score - a.score;
    return a.ruleId.localeCompare(b.ruleId);
  });

  const best = pool[0];
  return {
    ruleId: best.ruleId,
    ruleName: best.ruleName,
    templateId: best.templateId,
    priority: best.priority,
    score: best.score,
    templateVersion: best.templateVersion,
  };
}
