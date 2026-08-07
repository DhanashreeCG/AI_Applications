import { TemplateSelectionCriteria } from '../interfaces/flashcard.interfaces';
import { ObjectiveConfidence } from './user-request.resolver';

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
  templateAgeGroups: string[];
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

export interface CandidateRankingBreakdown {
  objectiveRank: number;
  effectiveObjectiveRank: number;
  exactAge: boolean;
  exactGrade: boolean;
  exactSubject: boolean;
  exactDifficulty: boolean;
  exactObjective: boolean;
  scoreComponents: {
    objectiveRank: number;
    exactAge: number;
    exactGrade: number;
    exactSubject: number;
    exactDifficulty: number;
    rulePriority: number;
    objectiveExactBoost: number;
    objectiveConfiguredPenalty: number;
  };
}

export interface RankedTemplateCandidate extends SelectionResult {
  breakdown: CandidateRankingBreakdown;
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

function parseAgeGroup(
  value: string,
): { min: number; max: number; normalized: string } | null {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/ages?/g, '')
    .replace(/[–—]/g, '-')
    .replace(/\s+to\s+/g, '-')
    .replace(/\s+/g, '');
  const match = normalized.match(/^(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;
  const min = Number(match[1]);
  const max = Number(match[2]);
  if (min > max) return null;
  return { min, max, normalized: `${min}-${max}` };
}

function templateSupportsAgeGroup(
  supportedAgeGroups: string[],
  requestedAgeGroup: string | undefined,
  requestedAgeMin: number | null,
  requestedAgeMax: number | null,
): { supported: boolean; exact: boolean } {
  // Legacy templates without metadata remain eligible, but never rank exact.
  if (!supportedAgeGroups.length) {
    return { supported: true, exact: false };
  }

  const requested =
    requestedAgeGroup ? parseAgeGroup(requestedAgeGroup) : null;
  const reqMin = requested?.min ?? requestedAgeMin;
  const reqMax = requested?.max ?? requestedAgeMax;
  if (reqMin === null || reqMax === null) {
    return { supported: false, exact: false };
  }

  let supported = false;
  let exact = false;
  for (const configured of supportedAgeGroups) {
    const parsed = parseAgeGroup(configured);
    if (!parsed) continue;
    if (parsed.min <= reqMax && parsed.max >= reqMin) {
      supported = true;
    }
    if (parsed.min === reqMin && parsed.max === reqMax) {
      exact = true;
    }
  }
  return { supported, exact };
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeDifficulty(value: string): string {
  const key = normalize(value);
  return DIFFICULTY_ALIASES[key] ?? key;
}

/** Canonical objective labels for configured rule/template lists and ranking. */
const OBJECTIVE_ALIASES: Record<string, string> = {
  // Counting / math
  count: 'counting',
  counting: 'counting',
  calculate: 'counting',
  calculating: 'counting',
  add: 'counting',
  addition: 'counting',
  sum: 'counting',
  tally: 'counting',
  amount: 'counting',
  math_operations: 'counting',
  // Comparison
  compare: 'comparison',
  comparing: 'comparison',
  difference: 'comparison',
  bigger_smaller: 'comparison',
  // Sorting / classification phrasing
  sort: 'sorting',
  sorting: 'sorting',
  grouping: 'sorting',
  categorization: 'classification',
  // Phonics / reading
  read: 'reading',
  reading: 'reading',
  reading_in_range: 'reading',
  phonics: 'phonics',
  letters: 'phonics',
  sounds: 'phonics',
  pronunciation: 'phonics',
  language_learning: 'phonics',
  // Identification / matching
  identify: 'recognition',
  identification: 'recognition',
  find: 'recognition',
  spot: 'recognition',
  match: 'matching',
  matching: 'matching',
  pair: 'matching',
  // Question & answer
  q_and_a: 'question_answer',
  qa: 'question_answer',
  question_and_answer: 'question_answer',
  quiz: 'question_answer',
  ask: 'question_answer',
};

function inflectionVariants(key: string): string[] {
  const variants = [key];
  if (key.endsWith('ing') && key.length > 4) {
    variants.push(key.slice(0, -3));
  }
  if (key.endsWith('ed') && key.length > 3) {
    variants.push(key.slice(0, -2));
  }
  if (key.endsWith('s') && key.length > 2 && !key.endsWith('ss')) {
    variants.push(key.slice(0, -1));
  }
  return variants;
}

function normalizeObjective(value: string): string {
  const key = normalize(value).replace(/[\s-]+/g, '_');
  for (const variant of inflectionVariants(key)) {
    const alias = OBJECTIVE_ALIASES[variant];
    if (alias) return alias;
  }
  return key;
}

const RELATED_OBJECTIVES: Record<string, string[]> = {
  comparison: ['classification', 'matching', 'recognition', 'vocabulary'],
  classification: ['sorting', 'matching', 'comparison', 'recognition'],
  matching: ['recognition', 'classification', 'vocabulary'],
  sorting: ['classification', 'matching', 'recognition'],
  phonics: ['reading', 'vocabulary', 'recognition'],
  reading: ['phonics', 'vocabulary', 'question_answer'],
  science_facts: ['general_knowledge', 'question_answer', 'vocabulary'],
  question_answer: ['reading', 'general_knowledge', 'science_facts'],
  counting: ['recognition', 'matching', 'vocabulary'],
  recognition: ['vocabulary', 'classification'],
  vocabulary: ['recognition', 'reading'],
  general_knowledge: ['science_facts', 'question_answer', 'vocabulary'],
};

/**
 * 3 = exact objective, 2 = directly related objective, 1 = generic fallback.
 */
function objectiveRelevance(
  requested: string,
  configured: string[],
): number {
  if (!configured.length) return 0;
  const requestedKey = normalizeObjective(requested);
  const configuredKeys = configured.map(normalizeObjective);
  if (configuredKeys.includes(requestedKey)) return 3;

  const related = RELATED_OBJECTIVES[requestedKey] ?? [];
  if (configuredKeys.some((objective) => related.includes(objective))) {
    return 2;
  }

  const genericFallbacks = ['vocabulary', 'recognition', 'general_knowledge'];
  return configuredKeys.some((objective) => genericFallbacks.includes(objective))
    ? 1
    : 0;
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

interface RankedCandidate extends RankedTemplateCandidate {}

/**
 * Deterministic template selection (FLASH_CARD_REVISED):
 * Topic must NOT determine the template.
 *
 * Template supportedAgeGroups are the first hard filter. Learning objective
 * is then ranked exact → related → generic fallback.
 *
 * Rank priority:
 * 1. supported age-group overlap (hard filter)
 * 2. educational objective relevance
 * 3. exact age range
 * 4. exact grade
 * 5. exact subject / difficulty
 * 6. newest active template version
 * 7. rule priority / stable id
 */
function effectiveObjectiveRank(
  objectiveRank: number,
  objectiveConfidence: ObjectiveConfidence | undefined,
): number {
  if (objectiveConfidence !== 'age_default' || objectiveRank <= 1) {
    return objectiveRank;
  }
  // Age-default objectives are weak signals — cap at "related" tier so
  // ranking does not over-trust an inferred label.
  return Math.min(objectiveRank, 2);
}

export function rankTemplateCandidates(
  rules: SelectableRule[],
  criteria: TemplateSelectionCriteria & {
    learningObjective: string;
    ageMin: number | null;
    ageMax: number | null;
    objectiveConfidence?: ObjectiveConfidence;
  },
): RankedTemplateCandidate[] {
  const ranked: RankedCandidate[] = [];

  for (const rule of rules) {
    if (!rule.templateActive) {
      continue;
    }

    const templateAge = templateSupportsAgeGroup(
      rule.templateAgeGroups,
      criteria.ageGroup,
      criteria.ageMin,
      criteria.ageMax,
    );
    if (!templateAge.supported) {
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

    const ruleObjectiveRank = objectiveRelevance(
      criteria.learningObjective,
      rule.learningObjectives,
    );
    const templateObjectiveRank = objectiveRelevance(
      criteria.learningObjective,
      rule.templateObjectives,
    );
    // When a rule defines explicit objectives, those define the candidate's
    // purpose.  Template objectives only provide signal for rules without
    // explicit objectives (e.g. synthetic fallback rules).
    const ruleHasExplicitObjectives = rule.learningObjectives.length > 0;
    const rawObjectiveRank = ruleHasExplicitObjectives
      ? ruleObjectiveRank
      : templateObjectiveRank;
    const objectiveRank = effectiveObjectiveRank(
      rawObjectiveRank,
      criteria.objectiveConfidence,
    );
    // exactObjective: the rule's own objectives directly match the request.
    // For rules without explicit objectives, fall back to template signal.
    const exactObjective = ruleHasExplicitObjectives
      ? ruleObjectiveExact
      : templateObjectiveExact;
    const exactSubject =
      subject.exact || softExact(rule.templateSubjects, criteria.subject);
    const exactDifficulty =
      difficulty.exact ||
      softExact(
        rule.templateDifficulties,
        criteria.difficulty,
        normalizeDifficulty,
      );

    const exactRuleAge =
      rule.ageMin !== null &&
      rule.ageMax !== null &&
      criteria.ageMin !== null &&
      criteria.ageMax !== null &&
      rule.ageMin === criteria.ageMin &&
      rule.ageMax === criteria.ageMax;
    const exactAge = templateAge.exact || exactRuleAge;

    // Boost reflects rule-level match quality.  When the rule has explicit
    // objectives, template-level matches must not inflate the score.
    const objectiveExactBoost = ruleObjectiveExact
      ? 120
      : (!ruleHasExplicitObjectives && templateObjectiveExact)
        ? 80
        : (ruleHasExplicitObjectives || rule.templateObjectives.length)
          ? -40
          : 0;

    let score = 0;
    score += objectiveRank * 1000;
    if (exactAge) score += 500;
    if (grade.exact) score += 300;
    if (exactSubject) score += 200;
    if (exactDifficulty) score += 100;
    score += rule.priority;
    score += objectiveExactBoost;

    ranked.push({
      ruleId: rule.id,
      ruleName: rule.name,
      templateId: rule.templateId,
      priority: rule.priority,
      score,
      templateVersion: rule.templateVersion,
      breakdown: {
        objectiveRank: rawObjectiveRank,
        effectiveObjectiveRank: objectiveRank,
        exactAge,
        exactGrade: grade.exact,
        exactSubject,
        exactDifficulty,
        exactObjective,
        scoreComponents: {
          objectiveRank: objectiveRank * 1000,
          exactAge: exactAge ? 500 : 0,
          exactGrade: grade.exact ? 300 : 0,
          exactSubject: exactSubject ? 200 : 0,
          exactDifficulty: exactDifficulty ? 100 : 0,
          rulePriority: rule.priority,
          objectiveExactBoost,
          objectiveConfiguredPenalty: 0,
        },
      },
    });
  }

  if (!ranked.length) {
    return [];
  }

  ranked.sort((a, b) => {
    const left = a.breakdown;
    const right = b.breakdown;
    if (right.effectiveObjectiveRank !== left.effectiveObjectiveRank) {
      return right.effectiveObjectiveRank - left.effectiveObjectiveRank;
    }
    // Prefer rules whose own objectives directly match the request.
    if (left.exactObjective !== right.exactObjective) {
      return left.exactObjective ? -1 : 1;
    }
    if (left.exactAge !== right.exactAge) return left.exactAge ? -1 : 1;
    if (left.exactGrade !== right.exactGrade) return left.exactGrade ? -1 : 1;
    if (left.exactSubject !== right.exactSubject) return left.exactSubject ? -1 : 1;
    if (left.exactDifficulty !== right.exactDifficulty) {
      return left.exactDifficulty ? -1 : 1;
    }
    const versionCmp = compareTemplateVersions(
      a.templateVersion,
      b.templateVersion,
    );
    if (versionCmp !== 0) return versionCmp;

    if (b.priority !== a.priority) return b.priority - a.priority;
    if (b.score !== a.score) return b.score - a.score;
    return a.ruleId.localeCompare(b.ruleId);
  });

  return ranked;
}

export function selectBestTemplate(
  rules: SelectableRule[],
  criteria: TemplateSelectionCriteria & {
    learningObjective: string;
    ageMin: number | null;
    ageMax: number | null;
    objectiveConfidence?: ObjectiveConfidence;
  },
): SelectionResult | null {
  const ranked = rankTemplateCandidates(rules, criteria);
  if (!ranked.length) {
    return null;
  }

  const best = ranked[0];
  return {
    ruleId: best.ruleId,
    ruleName: best.ruleName,
    templateId: best.templateId,
    priority: best.priority,
    score: best.score,
    templateVersion: best.templateVersion,
  };
}
