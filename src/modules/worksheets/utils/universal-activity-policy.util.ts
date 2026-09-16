import { GenerateWorksheetRequest } from '../types/worksheet.types';
import { resolveAgeBand } from './age-band.util';

export type UniversalActivityBandKey = '2-3' | '3-4' | '4-5+' | 'unknown';

export type UniversalActivityDifficulty = 'easy' | 'medium';

export type UniversalActivityPolicy = {
  bandKey: UniversalActivityBandKey;
  /** Hard max activity sections kept after post-LLM normalize. */
  maxSections: 1 | 2 | 4;
  /** Prompt target section count (code does not invent missing sections). */
  targetSections: 1 | 2 | 3;
  difficulty: UniversalActivityDifficulty;
  allowedActivities: string[];
  forbiddenActivities: string[];
};

const POLICY_2_3: UniversalActivityPolicy = {
  bandKey: '2-3',
  maxSections: 1,
  targetSections: 1,
  difficulty: 'easy',
  allowedActivities: [
    'look-and-name pictures',
    'point to a picture',
    'colour / colour-in a picture',
  ],
  forbiddenActivities: [
    'match grids / draw-a-line matching',
    'tracing letters or words',
    'reading sentences',
    'counting above 5',
    'multi-step tasks',
    'dense facts',
  ],
};

const POLICY_3_4: UniversalActivityPolicy = {
  bandKey: '3-4',
  maxSections: 2,
  targetSections: 2,
  difficulty: 'easy',
  allowedActivities: [
    'look-and-name pictures',
    'circle / tick one picture',
    'simple 2-pair picture match',
    'colour / point',
  ],
  forbiddenActivities: [
    'tracing letters or words',
    'dense facts',
    '3 or more activity sections',
    'multi-step reading / writing',
    'counting above 10',
  ],
};

const POLICY_4_5_PLUS: UniversalActivityPolicy = {
  bandKey: '4-5+',
  maxSections: 4,
  targetSections: 3,
  difficulty: 'medium',
  allowedActivities: [
    'look-and-name / teach strip',
    'match pairs (2–3)',
    'circle / tick',
    'short trace words',
    'simple fact cards + practice',
  ],
  forbiddenActivities: [
    'more than 4 activity sections',
    'activities that overflow the viewport',
    'adult / scary themes',
  ],
};

const POLICY_UNKNOWN: UniversalActivityPolicy = {
  ...POLICY_4_5_PLUS,
  bandKey: 'unknown',
};

/**
 * Single source of truth for universal_template activity count + difficulty.
 * Enforced in post-LLM normalize (provider-agnostic).
 */
export function resolveUniversalActivityPolicy(
  request: Pick<GenerateWorksheetRequest, 'age' | 'ageGroup' | 'grade'>,
): UniversalActivityPolicy {
  const band = resolveAgeBand(request as GenerateWorksheetRequest);
  if (!band) {
    return POLICY_UNKNOWN;
  }
  if (band.max <= 3) {
    return POLICY_2_3;
  }
  if (band.max === 4) {
    return POLICY_3_4;
  }
  return POLICY_4_5_PLUS;
}

/** Prompt lines shared by Gemini and OpenAI (same contract). */
export function buildUniversalActivityPolicyPromptLines(
  policy: UniversalActivityPolicy,
): string[] {
  const header =
    policy.bandKey === 'unknown'
      ? 'AGE BAND UNKNOWN — use 4–5+ defaults (override density guidance when they conflict):'
      : `AGE BAND ${policy.bandKey} HARD RULES (override density guidance when they conflict):`;

  const countLine =
    policy.bandKey === '2-3'
      ? `  • Activity count: EXACTLY ${policy.targetSections} activity section (plus the instruction box). NEVER 2+. Extra sections will be removed in post-process.`
      : policy.bandKey === '3-4'
        ? `  • Activity count: EXACTLY ${policy.targetSections} activity sections (plus the instruction box). NEVER 3+. Extra sections will be removed in post-process.`
        : `  • Activity count: target **${policy.targetSections}** activity sections when they fit the viewport; never exceed the page. Code caps at ${policy.maxSections}. Prefer dropping density over overflowing.`;

  return [
    '',
    header,
    `  • DIFFICULTY: ${policy.difficulty}${policy.difficulty === 'easy' ? ' only' : ' (age-appropriate)'}.`,
    countLine,
    `  • Allowed activities: ${policy.allowedActivities.join('; ')}.`,
    `  • Forbidden: ${policy.forbiddenActivities.join('; ')}.`,
    ...(policy.bandKey === '2-3'
      ? [
          '  • Picture + simple text only: large clear pictures, 1-word labels (teacher may read aloud).',
          '  • ONE activity does NOT mean one tiny picture. Make that single activity RICH:',
          '    3–5 large pictures in a choice grid (prefer 2×2 when there are 4) — never a skinny row of tiny images on a half-blank page.',
          '  • Never leave most of the page blank. Prefer spacious large-picture or choice-grid layoutIntent.',
          '  • COLORING: only if images[] use outline/line-art queries. Otherwise use find/point/circle — never “color” a fully colored cartoon.',
          '  • instruction_text: one short teacher-spoken line for the single activity.',
          '  • imageQuery: “cute cartoon [name], centered in square frame, simple white background” (or outline for coloring).',
        ]
      : []),
    ...(policy.bandKey === '3-4'
      ? [
          '  • Picture + simple text: 1–2 word labels (or short phrases a teacher reads aloud).',
          '  • COHERENCE: section 2 must reuse the SAME animals/objects from section 1. NEVER introduce a new creature only in the match section.',
          '  • MATCH LAYOUT (if used): exactly 2 pairs; equal square .ws-img-box px; scramble so correct answers are not same-row; prefer picture↔picture.',
          '  • IMAGE SIZE: prefer fewer larger pictures; the renderer sizes boxes from available space.',
          '  • instruction_text: one short teacher-spoken line that covers both activities briefly.',
          '  • imageQuery: “cute cartoon [name], centered in square frame, simple white background”.',
        ]
      : []),
    ...(policy.bandKey === '4-5+' || policy.bandKey === 'unknown'
      ? [
          '  • Mix teach + practice (e.g. learn row → match/circle → optional short trace) when they fit.',
          '  • Every section outline, label, and {{IMAGE_N}} must stay fully visible — never crop or overflow.',
          '  • Prefer **2–3 match pairs** with readable pictures; never force a 4th filler activity.',
        ]
      : []),
    '  • Prefer **3 excellent distinct activities** over 4 weak/repetitive ones when age allows.',
    '  • Every {{IMAGE_N}} must sit fully inside its own activity section and inside the page canvas.',
    '  • Never emit an empty bordered activity shell (question only with no pictures/choices/trace). Every activity section MUST include learner content.',
    '  • ONE visible learner question per activity — no separate section title like “Look and Name” or “Match Two Pairs”.',
  ];
}
