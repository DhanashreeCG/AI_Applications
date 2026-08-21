import { TemplateSelectionCriteria } from '../interfaces/flashcard.interfaces';
import { ObjectiveConfidence, keywordMatches } from './user-request.resolver';

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
  isFallback: boolean;
  templateId: string;
  templateActive: boolean;
  templateAgeGroups: string[];
  templateAgeMin: number;
  templateAgeMax: number;
  templateSubjects: string[];
  templateObjectives: string[];
  templateDifficulties: string[];
  templateVersion: string;
  templateTags?: string[];
  templateType?: string;
  /** Opt-in layout (e.g. tracing): only eligible when the request asks for it. */
  requiresExplicitRequest?: boolean;
  /** Terms that count as an explicit request. Defaults to tags + templateType. */
  explicitRequestKeywords?: string[];
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
  /** 3 = exact native age group, 2 = covers requested band, 1 = younger band, 0 = unknown/legacy. */
  ageTier: number;
  youngerMax: number;
  exactAge: boolean;
  exactGrade: boolean;
  exactSubject: boolean;
  exactDifficulty: boolean;
  exactObjective: boolean;
  scoreComponents: {
    ageTier: number;
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

/**
 * Age is the first gate. Native (exact requested band) and covering ranges
 * stay in the pool; wholly younger bands are allowed as fallback; older-only
 * templates are excluded (e.g. 6-8 is not eligible for a 4-5 request).
 */
function templateAgeFit(
  supportedAgeGroups: string[],
  requestedAgeGroup: string | undefined,
  requestedAgeMin: number | null,
  requestedAgeMax: number | null,
): {
  eligible: boolean;
  native: boolean;
  younger: boolean;
  covers: boolean;
  exact: boolean;
  ageTier: number;
  youngerMax: number;
} {
  const none = {
    eligible: false,
    native: false,
    younger: false,
    covers: false,
    exact: false,
    ageTier: 0,
    youngerMax: 0,
  };

  if (!supportedAgeGroups.length) {
    return { ...none, eligible: true };
  }

  const requested = requestedAgeGroup
    ? parseAgeGroup(requestedAgeGroup)
    : null;
  const reqMin = requested?.min ?? requestedAgeMin;
  const reqMax = requested?.max ?? requestedAgeMax;
  if (reqMin === null || reqMax === null) {
    return none;
  }

  let native = false;
  let younger = false;
  let covers = false;
  let youngerMax = 0;

  for (const configured of supportedAgeGroups) {
    const parsed = parseAgeGroup(configured);
    if (!parsed) continue;
    if (parsed.min === reqMin && parsed.max === reqMax) {
      native = true;
    }
    if (parsed.min <= reqMin && parsed.max >= reqMax) {
      covers = true;
    }
    if (
      parsed.max <= reqMin &&
      (parsed.min !== reqMin || parsed.max !== reqMax)
    ) {
      younger = true;
      youngerMax = Math.max(youngerMax, parsed.max);
    }
  }

  const eligible = native || covers || younger;
  const ageTier = native ? 3 : covers ? 2 : younger ? 1 : 0;
  return {
    eligible,
    native,
    younger,
    covers,
    exact: native,
    ageTier,
    youngerMax,
  };
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Terms that unlock an opt-in template. Explicit keywords win; otherwise fall
 * back to the template's own tags + templateType so a newly flagged template
 * is never permanently unreachable.
 */
export function gateKeywordsFor(rule: SelectableRule): string[] {
  const configured = (rule.explicitRequestKeywords ?? [])
    .map((keyword) => keyword.trim())
    .filter(Boolean);
  if (configured.length) {
    return configured;
  }

  return [...(rule.templateTags ?? []), rule.templateType ?? '']
    .flatMap((value) => value.split(/[^\p{L}\p{N}]+/u))
    .map((token) => token.trim())
    .filter((token) => token.length > 2);
}

/**
 * Opt-in templates (tracing, handwriting drills) teach a mechanic rather than a
 * topic, so they must never be auto-selected. They become eligible only when the
 * user's own words name them.
 */
function passesExplicitRequestGate(
  rule: SelectableRule,
  criteria: { query?: string; topic?: string },
): boolean {
  if (!rule.requiresExplicitRequest) {
    return true;
  }

  const haystack = [criteria.query ?? '', criteria.topic ?? '']
    .join(' ')
    .trim()
    .toLowerCase();
  if (!haystack) {
    return false;
  }

  const keywords = gateKeywordsFor(rule);
  if (!keywords.length) {
    return false;
  }

  return keywords.some((keyword) => keywordMatches(haystack, keyword));
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

const GENERIC_FALLBACK_OBJECTIVES = [
  'vocabulary',
  'recognition',
  'general_knowledge',
];

/**
 * 3 = exact objective, 2 = directly related objective, 0 = no match.
 * Generic-tag tier 1 is applied later, and only if the whole survivor pool
 * has no exact/related match.
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

  return 0;
}

function hasGenericFallbackTag(configured: string[]): boolean {
  const configuredKeys = configured.map(normalizeObjective);
  return configuredKeys.some((objective) =>
    GENERIC_FALLBACK_OBJECTIVES.includes(objective),
  );
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
 * Age group is the first hard filter and the first rank key:
 * native (exact band) → covering range → younger bands. Older-only
 * templates are never eligible. Learning objective / user intent is
 * the next rank key within the same age tier.
 *
 * Templates flagged requiresExplicitRequest are dropped before ranking unless
 * the raw query names them, so opt-in layouts never reach the AI selector.
 *
 * Rank priority:
 * 1. age tier (native > covering > younger)
 * 2. closer younger band (higher youngerMax)
 * 3. educational objective / user intent
 * 4. exact grade / subject / difficulty
 * 5. newest active template version
 * 6. rule priority (lower number wins — more specific) / stable id
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

interface EligibleRule {
  rule: SelectableRule;
  gradeExact: boolean;
  exactSubject: boolean;
  exactDifficulty: boolean;
  exactAge: boolean;
  ageTier: number;
  youngerMax: number;
  exactObjective: boolean;
  ruleHasExplicitObjectives: boolean;
  rawObjectiveRank: number;
  configuredObjectives: string[];
  objectiveExactBoost: number;
}

function collectEligibleRules(
  rules: SelectableRule[],
  criteria: TemplateSelectionCriteria & {
    learningObjective: string;
    ageMin: number | null;
    ageMax: number | null;
    objectiveConfidence?: ObjectiveConfidence;
  },
  fallbackOnly: boolean,
): EligibleRule[] {
  const eligible: EligibleRule[] = [];

  for (const rule of rules) {
    if (!rule.templateActive) {
      continue;
    }
    if (Boolean(rule.isFallback) !== fallbackOnly) {
      continue;
    }

    const templateAge = templateAgeFit(
      rule.templateAgeGroups,
      criteria.ageGroup,
      criteria.ageMin,
      criteria.ageMax,
    );
    if (!templateAge.eligible) {
      continue;
    }

    if (!passesExplicitRequestGate(rule, criteria)) {
      continue;
    }

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

    const ruleHasExplicitObjectives = rule.learningObjectives.length > 0;
    const configuredObjectives = ruleHasExplicitObjectives
      ? rule.learningObjectives
      : rule.templateObjectives;
    const rawObjectiveRank = objectiveRelevance(
      criteria.learningObjective,
      configuredObjectives,
    );

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
    const ageTier =
      templateAge.exact || exactRuleAge
        ? Math.max(templateAge.ageTier, 3)
        : templateAge.ageTier;

    const objectiveExactBoost = ruleObjectiveExact
      ? 120
      : (!ruleHasExplicitObjectives && templateObjectiveExact)
        ? 80
        : (ruleHasExplicitObjectives || rule.templateObjectives.length)
          ? -40
          : 0;

    eligible.push({
      rule,
      gradeExact: grade.exact,
      exactSubject,
      exactDifficulty,
      exactAge,
      ageTier,
      youngerMax: templateAge.youngerMax,
      exactObjective,
      ruleHasExplicitObjectives,
      rawObjectiveRank,
      configuredObjectives,
      objectiveExactBoost,
    });
  }

  return eligible;
}

function toRankedCandidate(
  item: EligibleRule,
  rawObjectiveRank: number,
  objectiveConfidence: ObjectiveConfidence | undefined,
): RankedCandidate {
  const objectiveRank = effectiveObjectiveRank(
    rawObjectiveRank,
    objectiveConfidence,
  );
  const { rule } = item;
  let score = 0;
  score += item.ageTier * 2000;
  score += item.youngerMax;
  score += objectiveRank * 1000;
  if (item.exactAge) score += 500;
  if (item.gradeExact) score += 300;
  if (item.exactSubject) score += 200;
  if (item.exactDifficulty) score += 100;
  score += rule.priority;
  score += item.objectiveExactBoost;

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    templateId: rule.templateId,
    priority: rule.priority,
    score,
    templateVersion: rule.templateVersion,
    breakdown: {
      objectiveRank: rawObjectiveRank,
      effectiveObjectiveRank: objectiveRank,
      ageTier: item.ageTier,
      youngerMax: item.youngerMax,
      exactAge: item.exactAge,
      exactGrade: item.gradeExact,
      exactSubject: item.exactSubject,
      exactDifficulty: item.exactDifficulty,
      exactObjective: item.exactObjective,
      scoreComponents: {
        ageTier: item.ageTier * 2000,
        objectiveRank: objectiveRank * 1000,
        exactAge: item.exactAge ? 500 : 0,
        exactGrade: item.gradeExact ? 300 : 0,
        exactSubject: item.exactSubject ? 200 : 0,
        exactDifficulty: item.exactDifficulty ? 100 : 0,
        rulePriority: rule.priority,
        objectiveExactBoost: item.objectiveExactBoost,
        objectiveConfiguredPenalty: 0,
      },
    },
  };
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
  let eligible = collectEligibleRules(rules, criteria, false);
  if (!eligible.length) {
    eligible = collectEligibleRules(rules, criteria, true);
  }

  if (!eligible.length) {
    return [];
  }

  const poolMax = Math.max(
    ...eligible.map((item) => item.rawObjectiveRank),
    0,
  );
  const allowGenericFallback = poolMax === 0;

  const ranked: RankedCandidate[] = eligible.map((item) => {
    let raw = item.rawObjectiveRank;
    if (
      allowGenericFallback &&
      raw === 0 &&
      hasGenericFallbackTag(item.configuredObjectives)
    ) {
      raw = 1;
    }
    return toRankedCandidate(item, raw, criteria.objectiveConfidence);
  });

  ranked.sort((a, b) => {
    const left = a.breakdown;
    const right = b.breakdown;
    if (right.ageTier !== left.ageTier) {
      return right.ageTier - left.ageTier;
    }
    if (right.youngerMax !== left.youngerMax) {
      return right.youngerMax - left.youngerMax;
    }
    if (right.effectiveObjectiveRank !== left.effectiveObjectiveRank) {
      return right.effectiveObjectiveRank - left.effectiveObjectiveRank;
    }
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

    if (a.priority !== b.priority) return a.priority - b.priority;
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
