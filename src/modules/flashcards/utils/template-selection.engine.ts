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
}

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

function includesIfConfigured(
  configured: string[],
  value: string | undefined,
): { matched: boolean; applicable: boolean } {
  if (!configured.length) {
    return { matched: false, applicable: false };
  }
  if (!value) {
    return { matched: false, applicable: true };
  }
  const normalized = value.trim().toLowerCase();
  return {
    matched: configured.some((item) => item.toLowerCase() === normalized),
    applicable: true,
  };
}

/**
 * Deterministic template selection:
 * 1. Drop inactive templates / non-overlapping age
 * 2. Hard-fail optional filters when the rule configures them and request misses
 * 3. Score soft matches; higher priority wins ties
 */
export function selectBestTemplate(
  rules: SelectableRule[],
  criteria: TemplateSelectionCriteria & {
    learningObjective: string;
    ageMin: number | null;
    ageMax: number | null;
  },
): SelectionResult | null {
  const scored: SelectionResult[] = [];

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

    let score = 0;
    let eliminated = false;

    const checks: Array<{
      configured: string[];
      value?: string;
      weight: number;
    }> = [
      {
        configured: rule.learningObjectives,
        value: criteria.learningObjective,
        weight: 40,
      },
      { configured: rule.grades, value: criteria.grade, weight: 15 },
      { configured: rule.subjects, value: criteria.subject, weight: 15 },
      {
        configured: rule.difficulties,
        value: criteria.difficulty,
        weight: 10,
      },
      { configured: rule.intents, value: criteria.intent, weight: 10 },
      { configured: rule.topics, value: criteria.topic, weight: 20 },
    ];

    for (const check of checks) {
      const result = includesIfConfigured(check.configured, check.value);
      if (result.applicable && !result.matched) {
        eliminated = true;
        break;
      }
      if (result.matched) {
        score += check.weight;
      }
    }

    if (eliminated) {
      continue;
    }

    if (
      rule.templateObjectives.length &&
      !rule.templateObjectives
        .map((item) => item.toLowerCase())
        .includes(criteria.learningObjective.toLowerCase())
    ) {
      continue;
    }

    if (
      criteria.subject &&
      rule.templateSubjects.length &&
      !rule.templateSubjects
        .map((item) => item.toLowerCase())
        .includes(criteria.subject.toLowerCase())
    ) {
      continue;
    }

    if (
      criteria.difficulty &&
      rule.templateDifficulties.length &&
      !rule.templateDifficulties
        .map((item) => item.toLowerCase())
        .includes(criteria.difficulty.toLowerCase())
    ) {
      continue;
    }

    // Prefer more specific rules (configured dimensions).
    score +=
      [
        rule.learningObjectives,
        rule.grades,
        rule.subjects,
        rule.difficulties,
        rule.intents,
        rule.topics,
        rule.ageMin !== null || rule.ageMax !== null ? ['age'] : [],
      ].filter((list) => list.length > 0).length * 2;

    scored.push({
      ruleId: rule.id,
      ruleName: rule.name,
      templateId: rule.templateId,
      priority: rule.priority,
      score,
    });
  }

  if (!scored.length) {
    return null;
  }

  scored.sort((a, b) => {
    if (b.priority !== a.priority) {
      return b.priority - a.priority;
    }
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.ruleId.localeCompare(b.ruleId);
  });

  return scored[0];
}
