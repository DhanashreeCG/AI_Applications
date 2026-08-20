import {
  SelectedTemplatePayload,
  TemplateComponentDefinition,
} from '../interfaces/flashcard.interfaces';
import {
  buildCountryForbiddenPromptClause,
  containsForbiddenContent,
  topicIsPrimarilyForbidden,
} from '../utils/content-restriction.registry';

export const DEFAULT_FLASHCARD_PROMPT_VERSION =
  'v6-content-safety-no-adjectives-topic-lock-variety';

function ageBandGuidance(ageMin: number, ageMax: number): string {
  const midpoint = (ageMin + ageMax) / 2;
  if (midpoint <= 3) {
    return 'Ages 2–3: single word labels only; very simple vocabulary.';
  }
  if (midpoint <= 4) {
    return 'Ages 3–4: single word + one short simple sentence.';
  }
  if (midpoint <= 6) {
    return 'Ages 5–6: word + one short educational fact.';
  }
  if (midpoint <= 8) {
    return 'Ages 6–8: short description + a recognition question when a question component exists.';
  }
  return 'Ages 8+: factual description + a reasoning question when a question component exists.';
}

// ---------------------------------------------------------------------------
// NEW: content safety — hard-blocked topics/objects and religious content
// ---------------------------------------------------------------------------
//
// Three layers of defense, since a prompt instruction alone is not "strict"
// enough on its own (the model can still slip):
//
//   1. INPUT GUARD  — assertContentRequestIsAllowed() rejects a request
//      up front when the user's topic/query is itself centered on a
//      forbidden subject (e.g. topic: "pig"), before we ever call the LLM.
//   2. PROMPT GUARD — the generated prompt text (see buildFlashcardContentPrompt)
//      explicitly lists everything that must never be generated, named,
//      described, or depicted, in ANY field, even if it's tangentially
//      related to a broader allowed topic (e.g. topic "farm animals" must
//      simply skip pigs while still generating the rest).
//   3. OUTPUT GUARD — scanCardsForForbiddenContent() lets the caller
//      validate the model's actual JSON response and reject/regenerate any
//      card that slipped a forbidden term through, instead of trusting the
//      model unconditionally.
//
// We deliberately do NOT try to bake this into the Gemini JSON Schema via a
// regex `pattern` (e.g. a negative-lookahead blacklist). Structured-output
// schema pattern support is inconsistent/partial across Gemini versions,
// is case-sensitive by default (defeating a case-insensitive block list),
// and a bad pattern can silently break generation for unrelated fields.
// Prompt + input guard + output guard is the reliable combination.

export { containsForbiddenContent } from '../utils/content-restriction.registry';

export class ForbiddenContentError extends Error {
  constructor(
    public readonly matchedTerm: string,
    public readonly field: string,
  ) {
    super(
      `Requested content is not allowed: "${matchedTerm}" (found in ${field}). ` +
        'This platform never generates flashcards involving banned or restricted content ' +
        'for the requested region.',
    );
    this.name = 'ForbiddenContentError';
  }
}

/**
 * INPUT GUARD. Call this before building any prompt. Throws
 * ForbiddenContentError if the topic or query is itself a forbidden
 * subject. Safe to call with either field omitted.
 */
export function assertContentRequestIsAllowed(input: {
  topic?: string;
  query?: string;
  countryCode?: string;
}): void {
  const candidates: Array<{ field: string; value?: string }> = [
    { field: 'topic', value: input.topic },
    { field: 'query', value: input.query },
  ];
  for (const candidate of candidates) {
    if (!candidate.value) continue;
    const matched = topicIsPrimarilyForbidden(candidate.value, input.countryCode);
    if (matched) {
      throw new ForbiddenContentError(matched, candidate.field);
    }
  }
}

export interface ForbiddenContentViolation {
  cardIndex: number;
  componentId: string;
  field: 'text' | 'image.searchQuery' | 'image.expectedObjects';
  matchedTerm: string;
  value: string;
}

/**
 * OUTPUT GUARD. Scan a generated response for forbidden content that slipped
 * through despite the prompt instructions. Callers should treat any
 * violation as a hard failure for that card — either strip/regenerate just
 * that card, or reject the whole batch, depending on your retry strategy.
 */
export function scanCardsForForbiddenContent(
  cards: Array<{
    cardIndex?: number;
    textComponents?: Record<string, unknown>;
    imageComponents?: Record<
      string,
      { searchQuery?: string; expectedObjects?: string[] } | undefined
    >;
  }>,
  countryCode?: string,
): ForbiddenContentViolation[] {
  const violations: ForbiddenContentViolation[] = [];

  cards.forEach((card, idx) => {
    const cardIndex = card.cardIndex ?? idx;

    for (const [componentId, value] of Object.entries(card.textComponents ?? {})) {
      if (typeof value !== 'string') continue;
      const matched = containsForbiddenContent(value, countryCode);
      if (matched) {
        violations.push({ cardIndex, componentId, field: 'text', matchedTerm: matched, value });
      }
    }

    for (const [componentId, image] of Object.entries(card.imageComponents ?? {})) {
      if (!image) continue;
      if (typeof image.searchQuery === 'string') {
        const matched = containsForbiddenContent(image.searchQuery, countryCode);
        if (matched) {
          violations.push({
            cardIndex,
            componentId,
            field: 'image.searchQuery',
            matchedTerm: matched,
            value: image.searchQuery,
          });
        }
      }
      for (const obj of image.expectedObjects ?? []) {
        const matched = containsForbiddenContent(obj, countryCode);
        if (matched) {
          violations.push({
            cardIndex,
            componentId,
            field: 'image.expectedObjects',
            matchedTerm: matched,
            value: obj,
          });
        }
      }
    }
  });

  return violations;
}

// ---------------------------------------------------------------------------
// repeat-group expansion
// ---------------------------------------------------------------------------
//
// Some template components are declared with a "{x}" placeholder in their
// componentId (e.g. "num-{x}", "number-{x}", "reading-{x}") to mean
// "repeat this field once per grid slot." Those placeholders must be
// expanded into concrete, individually-addressable component IDs
// ("num-1".."num-N") BEFORE they are handed to the prompt builder or the
// Gemini response schema builder. If a literal "{x}" ever reaches either of
// those, Gemini is only given a single string slot to fill and will
// collapse every value into that one field (this was the root cause of
// "num-{x}": "10, 20, 30..." / "reading-{x}": "Ten. I see ten stars.").
//
// `repeatCounts` must be resolved by the template/layout engine BEFORE
// calling this — e.g. from the CMS schema's `range` (count = end-start+1)
// or `layout.rows * layout.cols`. This function does not guess counts.

export interface RepeatCountMap {
  // keyed by the raw templated componentId, e.g. { "num-{x}": 10 }
  [templatedComponentId: string]: number;
}

/** Hard cap for inferred grid size when falling back from the user query. */
const MAX_FALLBACK_REPEAT = 50;

/**
 * Parses a requested numeric range size from free-text (query/topic).
 * Supports start+end, end-only, and start-only forms with separators like
 * "-", "to", "through", "till", "until", "between…and", "up to", "from".
 * Returns undefined when no usable range is found.
 */
export function parseRequestedRangeCount(text?: string): number | undefined {
  if (!text?.trim()) return undefined;

  // Strip thousands separators so "1,000" → "1000"
  const normalized = text.replace(/,/g, ' ');

  type DualMatch = { start: number; end: number; index: number };
  const dualMatches: DualMatch[] = [];

  const dualPatterns: RegExp[] = [
    /\bfrom\s+(\d+)\s+(?:to|through|thru|till|until|upto|-|–|—)\s+(\d+)\b/gi,
    /\bbetween\s+(\d+)\s+and\s+(\d+)\b/gi,
    /\b(\d+)\s*(?:-|–|—)\s*(\d+)\b/g,
    /\b(\d+)\s+(?:to|through|thru|till|until)\s+(\d+)\b/gi,
  ];

  for (const pattern of dualPatterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(normalized)) !== null) {
      const start = Number.parseInt(match[1], 10);
      const end = Number.parseInt(match[2], 10);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      dualMatches.push({ start, end, index: match.index });
    }
  }

  const isLikelyAgeBand = (start: number, end: number, index: number): boolean => {
    const lo = Math.min(start, end);
    const hi = Math.max(start, end);
    // Typical learner age bands are small and near age/year wording.
    if (lo < 1 || hi > 18) return false;
    const windowStart = Math.max(0, index - 24);
    const windowEnd = Math.min(normalized.length, index + 40);
    const window = normalized.slice(windowStart, windowEnd);
    return /\b(age|ages|year|years|old|olds|yr|yrs)\b/i.test(window);
  };

  const usableDual = dualMatches.filter(
    (m) => !isLikelyAgeBand(m.start, m.end, m.index),
  );

  if (usableDual.length > 0) {
    // Prefer the widest span (e.g. 1–100 over incidental smaller pairs).
    let best = usableDual[0];
    let bestSpan = Math.abs(best.end - best.start);
    for (let i = 1; i < usableDual.length; i++) {
      const span = Math.abs(usableDual[i].end - usableDual[i].start);
      if (span > bestSpan) {
        best = usableDual[i];
        bestSpan = span;
      }
    }
    const lo = Math.min(best.start, best.end);
    const hi = Math.max(best.start, best.end);
    return Math.max(1, hi - lo + 1);
  }

  // End-only: "up to 100", "until 50", "till 20", "numbers to 100"
  const endOnly =
    /\b(?:up\s*to|upto|until|till)\s+(\d+)\b/i.exec(normalized) ??
    /(?:^|[^\d])\bto\s+(\d+)\b/i.exec(normalized);
  if (endOnly) {
    const end = Number.parseInt(endOnly[1], 10);
    if (Number.isFinite(end) && end >= 1) {
      // Implicit start at 1 → inclusive count is `end`
      return end;
    }
  }

  // Start-only: "from 51", "starting from 20", "starting at 10"
  // Open-ended → caller caps at MAX_FALLBACK_REPEAT.
  const startOnly =
    /\b(?:starting\s+from|starting\s+at|from)\s+(\d+)\b/i.exec(normalized);
  if (startOnly) {
    const start = Number.parseInt(startOnly[1], 10);
    if (Number.isFinite(start) && start >= 0) {
      return MAX_FALLBACK_REPEAT;
    }
  }

  return undefined;
}

// Known repeating component ids and how to size them when the caller
// doesn't pass an explicit repeatCounts entry. This is a SAFETY NET, not
// the primary mechanism — whenever the actual requested range/count is
// known upstream (e.g. "numbers 51 to 100"), pass it via `repeatCounts` so
// the card reflects exactly what was asked for. These fallbacks exist so a
// missing repeatCounts entry degrades to a reasonable default instead of
// crashing generation. When a range is detectable in `query`, use
// min(50, rangeSize); otherwise prefer bounds from the component definition
// (`validationRules`), then age/template defaults below.
function inferFallbackRepeatCount(
  templatedComponentId: string,
  componentDef?: TemplateComponentDefinition,
  ageMin?: number,
  ageMax?: number,
  query?: string,
): number {
  // 1. Check if user specified a numeric range in query (e.g. "1 to 50")
  const fromQuery = parseRequestedRangeCount(query);
  if (fromQuery !== undefined) {
    return Math.min(MAX_FALLBACK_REPEAT, Math.max(1, fromQuery));
  }

  // 2. Read explicit bounds from the template component definition when present
  const fromDef = repeatCountFromComponentDef(componentDef);
  if (fromDef !== undefined) {
    return Math.min(MAX_FALLBACK_REPEAT, Math.max(1, fromDef));
  }

  // 3. Fallback defaults for unconstrained repeating components
  if (templatedComponentId === 'word-{x}') {
    const midpoint = ((ageMin ?? 5) + (ageMax ?? 5)) / 2;
    return midpoint <= 4 ? 4 : 6; // matches GRID_1X4 vs GRID_2X3 selectionRule
  }
  if (
    templatedComponentId === 'num-{x}' ||
    templatedComponentId === 'number-{x}' ||
    templatedComponentId === 'reading-{x}'
  ) {
    return 10;
  }
  return 10; // generic fallback for any other repeating field (incl. image-{x})
}

/**
 * Pulls a repeat/grid size hint from a component's constraints or
 * validationRules when the CMS/template declares one (maxItems, count,
 * range, etc.). Checks both `constraints` and `validationRules` since
 * different template sources use either key.
 */
function repeatCountFromComponentDef(
  componentDef?: TemplateComponentDefinition,
): number | undefined {
  if (!componentDef) return undefined;

  const asPositiveInt = (value: unknown): number | undefined => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    const n = Math.trunc(value);
    return n >= 1 ? n : undefined;
  };

  const sources = [
    componentDef as unknown as Record<string, unknown>,
    (componentDef.constraints as Record<string, unknown> | undefined) ?? {},
    (componentDef.validationRules as Record<string, unknown> | undefined) ?? {},
  ];

  for (const src of sources) {
    const direct =
      asPositiveInt(src.maxItems) ??
      asPositiveInt(src.minItems) ??
      asPositiveInt(src.count) ??
      asPositiveInt(src.repeatCount) ??
      asPositiveInt(src.maxCount) ??
      asPositiveInt(src.itemCount);

    if (direct !== undefined) return direct;

    const range = src.range;
    if (range && typeof range === 'object' && !Array.isArray(range)) {
      const start = asPositiveInt((range as { start?: unknown }).start);
      const end = asPositiveInt((range as { end?: unknown }).end);
      if (start !== undefined && end !== undefined) {
        return Math.abs(end - start) + 1;
      }
      if (end !== undefined) return end;
    }
    if (Array.isArray(range) && range.length >= 2) {
      const start = asPositiveInt(range[0]);
      const end = asPositiveInt(range[1]);
      if (start !== undefined && end !== undefined) {
        return Math.abs(end - start) + 1;
      }
    }
  }

  return undefined;
}

/**
 * Expands "{x}"-templated componentIds (e.g. "num-{x}", "image-{x}") into
 * concrete, individually-addressable ids ("num-1".."num-N", "image-1"..).
 *
 * Never throws. If `repeatCounts` doesn't have an entry for a given
 * templated id, falls back to inferFallbackRepeatCount() and logs a
 * warning — this keeps generation working even if an upstream caller
 * hasn't been wired to pass the real requested count yet. Pass
 * `repeatCounts` explicitly whenever the real count is known (it always
 * should be, since it comes from the same range/age-group the request
 * already carries) to get an exact rather than a default-sized grid.
 *
 * For `image-{x}`, when no explicit count is provided, the count is
 * inherited from a paired text repeat field (word-/num-/number-/reading-{x})
 * via `pairWithComponents` or already-resolved entries in `repeatCounts`.
 */
export function expandTemplateComponents(
  components: TemplateComponentDefinition[],
  options: {
    repeatCounts?: RepeatCountMap;
    ageMin?: number;
    ageMax?: number;
    /** User request text — used to infer range size when repeatCounts is missing. */
    query?: string;
    /**
     * Sibling component defs (typically the template's text components) used
     * to infer `image-{x}` count so image slots stay 1:1 with word/num slots.
     */
    pairWithComponents?: TemplateComponentDefinition[];
  } = {},
): TemplateComponentDefinition[] {
  const { ageMin, ageMax, query } = options;
  const repeatCounts = resolveRepeatCounts(components, options);
  const expanded: TemplateComponentDefinition[] = [];

  for (const component of components) {
    if (!component.componentId.includes('{x}')) {
      expanded.push(component);
      continue;
    }

    let count = repeatCounts[component.componentId];
    if (!count || count < 1) {
      count = inferFallbackRepeatCount(
        component.componentId,
        component,
        ageMin,
        ageMax,
        query,
      );
      // eslint-disable-next-line no-console
      console.warn(
        `[flashcard-prompt] No repeatCounts entry for "${component.componentId}"; ` +
          `falling back to inferred count ${count}. Pass the real requested ` +
          `count via repeatCounts to render exactly what the user asked for.`,
      );
    } else if (
      !options.repeatCounts?.[component.componentId] ||
      (options.repeatCounts[component.componentId] ?? 0) < 1
    ) {
      // eslint-disable-next-line no-console
      console.warn(
        `[flashcard-prompt] No repeatCounts entry for "${component.componentId}"; ` +
          `falling back to inferred count ${count}. Pass the real requested ` +
          `count via repeatCounts to render exactly what the user asked for.`,
      );
    }

    for (let i = 1; i <= count; i++) {
      expanded.push({
        ...component,
        componentId: component.componentId.replace('{x}', String(i)),
      });
    }
  }

  return expanded;
}

/** True for repeating image placeholders such as `image-{x}`. */
function isImageRepeatId(componentId: string): boolean {
  return /(?:^|-)image-\{x\}$/i.test(componentId) || /^image-\{x\}$/i.test(componentId);
}

const PAIRED_TEXT_REPEAT_IDS = [
  'word-{x}',
  'num-{x}',
  'number-{x}',
  'reading-{x}',
] as const;

/**
 * Fills missing repeatCounts so text `{x}` fields are sized first, then
 * `image-{x}` inherits that size when not set explicitly.
 */
function resolveRepeatCounts(
  components: TemplateComponentDefinition[],
  options: {
    repeatCounts?: RepeatCountMap;
    ageMin?: number;
    ageMax?: number;
    query?: string;
    pairWithComponents?: TemplateComponentDefinition[];
  },
): RepeatCountMap {
  const { ageMin, ageMax, query, pairWithComponents = [] } = options;
  const counts: RepeatCountMap = { ...(options.repeatCounts ?? {}) };

  const findComponentDef = (
    templatedId: string,
  ): TemplateComponentDefinition | undefined =>
    components.find((c) => c.componentId === templatedId) ??
    pairWithComponents.find((c) => c.componentId === templatedId);

  const ensureCount = (
    templatedId: string,
    componentDef?: TemplateComponentDefinition,
  ): void => {
    if (counts[templatedId] && counts[templatedId] >= 1) return;
    counts[templatedId] = inferFallbackRepeatCount(
      templatedId,
      componentDef ?? findComponentDef(templatedId),
      ageMin,
      ageMax,
      query,
    );
  };

  // 1) Resolve paired text siblings first (source of truth for image grids).
  for (const component of pairWithComponents) {
    if (
      component.componentId.includes('{x}') &&
      !isImageRepeatId(component.componentId)
    ) {
      ensureCount(component.componentId, component);
    }
  }

  // 2) Resolve non-image repeating fields in the list being expanded.
  for (const component of components) {
    if (!component.componentId.includes('{x}')) continue;
    if (isImageRepeatId(component.componentId)) continue;
    ensureCount(component.componentId, component);
  }

  // 3) Image repeats inherit paired text count when not explicit.
  for (const component of components) {
    if (!isImageRepeatId(component.componentId)) continue;
    if (!component.componentId.includes('{x}')) continue;
    if (counts[component.componentId] && counts[component.componentId] >= 1) {
      continue;
    }

    let paired: number | undefined;
    for (const id of PAIRED_TEXT_REPEAT_IDS) {
      if (counts[id] && counts[id] >= 1) {
        paired = counts[id];
        break;
      }
    }
    if (paired === undefined) {
      for (const [id, value] of Object.entries(counts)) {
        if (value >= 1 && id.includes('{x}') && !isImageRepeatId(id)) {
          paired = value;
          break;
        }
      }
    }

    counts[component.componentId] =
      paired ??
      inferFallbackRepeatCount(
        component.componentId,
        component,
        ageMin,
        ageMax,
        query,
      );
  }

  return counts;
}

// ---------------------------------------------------------------------------
// distinguish "raw grid value" components from "narrative" components
// ---------------------------------------------------------------------------
//
// A component is treated as a raw value (bare digit/word, no sentences, no
// filler) if its semanticRole marks it as grid/sequence data, OR — as a
// fallback for templates that don't carry semanticRole yet — if its
// (post-expansion) componentId matches a numbered-slot pattern like
// "num-3", "number-7", "reading-2", "word-4".
//
// Title/Label components (skillLabel, title, etc.) are a third category:
// clean 1–4 word domain titles — never age-band narrative sentences.
//
// Everything else (free-text description/fact/question fields) keeps the
// existing age-band narrative guidance.

const RAW_VALUE_SEMANTIC_ROLES = new Set([
  'counting.sequence.item',
  'numbers.digit.item',
  'numbers.reading.item',
  'sightwords.item',
  'comparison.left.label',
  'comparison.right.label',
  'vocabulary.word.label',
  'phonics.letter.uppercase',
  'phonics.letter.lowercase',
  'phonics.example.label',
  'phonics.letter',
  'phonics.word',
  'phonics.sound',
]);

const RAW_VALUE_ID_PATTERN = /^(num|number|reading|word)-\d+$/;

function isRawValueComponent(component: TemplateComponentDefinition): boolean {
  const role = (component as { semanticRole?: string }).semanticRole;
  if (role) return RAW_VALUE_SEMANTIC_ROLES.has(role);
  return RAW_VALUE_ID_PATTERN.test(component.componentId);
}

// ---------------------------------------------------------------------------
// NEW: split the old single "TITLE_LABEL" bucket into two distinct fields
// ---------------------------------------------------------------------------
//
// These are NOT the same thing and must not share one rule:
//
//   GENERIC_SKILL_LABEL  ("skillLabel", "headerLabel", ...) — a domain-level
//   term for the whole set/worksheet, e.g. "Animals", "Fruits". Stays the
//   same generic word regardless of what any individual card depicts.
//
//   PER_CARD_OBJECT_TITLE ("title", "cardTitle", ...) — the name of the
//   SPECIFIC thing shown on THIS card, e.g. "Lion", "Strawberry". Must
//   change per card and must match that card's image subject. Getting this
//   conflated with GENERIC_SKILL_LABEL was the bug where every card's title
//   said "Animals" instead of naming the animal actually pictured.

const GENERIC_SKILL_LABEL_SEMANTIC_ROLES = new Set([
  'phonics.skill.label',
  'header.label',
  'skill.label',
]);

const GENERIC_SKILL_LABEL_ID_PATTERN = /^(skillLabel|headerLabel)$/i;

function isGenericSkillLabelComponent(
  component: TemplateComponentDefinition,
): boolean {
  const role = (component as { semanticRole?: string }).semanticRole;
  if (role) return GENERIC_SKILL_LABEL_SEMANTIC_ROLES.has(role);
  return GENERIC_SKILL_LABEL_ID_PATTERN.test(component.componentId);
}

const PER_CARD_OBJECT_TITLE_SEMANTIC_ROLES = new Set([
  'title.label',
  'card.title',
  'item.label',
  'object.label',
]);

const PER_CARD_OBJECT_TITLE_ID_PATTERN =
  /^(title|cardTitle|itemLabel|objectLabel|itemTitle)$/i;

function isPerCardObjectTitleComponent(
  component: TemplateComponentDefinition,
): boolean {
  const role = (component as { semanticRole?: string }).semanticRole;
  if (role) return PER_CARD_OBJECT_TITLE_SEMANTIC_ROLES.has(role);
  return PER_CARD_OBJECT_TITLE_ID_PATTERN.test(component.componentId);
}

function componentStyleLabel(component: TemplateComponentDefinition): string {
  if (isRawValueComponent(component)) return 'RAW_VALUE';
  if (isGenericSkillLabelComponent(component)) return 'GENERIC_SKILL_LABEL';
  if (isPerCardObjectTitleComponent(component)) return 'PER_CARD_OBJECT_TITLE';
  return 'NARRATIVE';
}

/** Crude singularizer for comparing nouns like "lion"/"lions", "fox"/"foxes" is not handled — good enough for a heuristic match, not linguistically exact. */
function normalizeNoun(value: string): string {
  return value.trim().toLowerCase().replace(/[.,!?]+$/, '').replace(/s$/, '');
}

export interface TitleImageMismatch {
  cardIndex: number;
  titleComponentId: string;
  titleValue: string;
  imageComponentIds: string[];
}

/**
 * OUTPUT GUARD for per-card title/image consistency. Flags cards where the
 * PER_CARD_OBJECT_TITLE value (e.g. "Lion") doesn't match any expectedObjects
 * entry across that card's images — the exact bug where a card's title said
 * "Animals" while the image showed a lion. Only fires when the card has at
 * least one image component with expectedObjects to compare against.
 */
export function scanPerCardTitleImageMismatches(
  cards: Array<{
    cardIndex?: number;
    textComponents?: Record<string, unknown>;
    imageComponents?: Record<string, { expectedObjects?: string[] } | undefined>;
  }>,
  expandedTextComponents: TemplateComponentDefinition[],
): TitleImageMismatch[] {
  const titleIds = expandedTextComponents
    .filter(isPerCardObjectTitleComponent)
    .map((c) => c.componentId);
  if (titleIds.length === 0) return [];

  const mismatches: TitleImageMismatch[] = [];

  cards.forEach((card, idx) => {
    const cardIndex = card.cardIndex ?? idx;

    for (const titleId of titleIds) {
      const titleValue = card.textComponents?.[titleId];
      if (typeof titleValue !== 'string' || !titleValue.trim()) continue;

      const normalizedTitle = normalizeNoun(titleValue);
      const allExpected: string[] = [];
      for (const image of Object.values(card.imageComponents ?? {})) {
        for (const obj of image?.expectedObjects ?? []) {
          allExpected.push(normalizeNoun(obj));
        }
      }
      if (allExpected.length === 0) continue; // nothing to compare against

      const matches = allExpected.some(
        (obj) =>
          obj === normalizedTitle ||
          obj.includes(normalizedTitle) ||
          normalizedTitle.includes(obj),
      );
      if (!matches) {
        mismatches.push({
          cardIndex,
          titleComponentId: titleId,
          titleValue,
          imageComponentIds: Object.keys(card.imageComponents ?? {}),
        });
      }
    }
  });

  return mismatches;
}

const BARE_EXACT_QUERY_IMAGE_ROLES = new Set(['phonics.letter.image', 'math.number.tracing.image']);

const BARE_EXACT_QUERY_IMAGE_ID_PATTERN = /^(letterImage|letter_image|numberImage|number_image)$/i;

/**
 * Letter-glyph image slots whose searchQuery must be ONLY the letter phrase
 * (e.g. "Letter Q") — no style adjectives or decorative filler.
 */
function isBareExactQueryImageComponent(
  component: TemplateComponentDefinition,
): boolean {
  const role = component.semanticRole;
  if (role) return BARE_EXACT_QUERY_IMAGE_ROLES.has(role);
  return BARE_EXACT_QUERY_IMAGE_ID_PATTERN.test(component.componentId);
}

function imageStyleLabel(component: TemplateComponentDefinition): string {
  return isBareExactQueryImageComponent(component)
    ? 'BARE_EXACT_QUERY'
    : 'STANDARD';
}

// ---------------------------------------------------------------------------
// NEW: no-adjective safety net for short (RAW_VALUE-style) fields
// ---------------------------------------------------------------------------
//
// The prompt instructs the model to never attach adjectives to an object's
// name (see NO ADJECTIVES RULE in buildFlashcardContentPrompt). This is a
// lightweight, non-destructive heuristic safety net for the common failure
// mode where a short one/two-word field comes back as "<adjective> <noun>"
// (e.g. "juicy strawberry", "friendly cow"). It is NOT a substitute for the
// prompt rule — it only catches a leading common adjective on otherwise
// short values, and is intentionally conservative to avoid mangling
// legitimate two-word nouns (e.g. "ice cream", "polar bear").

const COMMON_DESCRIPTIVE_ADJECTIVES = [
  'friendly', 'happy', 'cute', 'juicy', 'shiny', 'big', 'small', 'tiny', 'huge',
  'colorful', 'colourful', 'bright', 'fresh', 'ripe', 'sweet', 'sour', 'fluffy',
  'soft', 'furry', 'giant', 'little', 'lovely', 'beautiful', 'pretty', 'scary',
  'fierce', 'gentle', 'wild', 'tame', 'young', 'baby', 'old', 'ancient',
  'magical', 'sparkly', 'yummy', 'delicious', 'tasty', 'round', 'red', 'green',
  'yellow', 'blue', 'orange', 'purple', 'pink', 'golden', 'silver', 'striped',
  'spotted', 'smiling', 'playful', 'strong', 'brave', 'smart', 'busy', 'lazy',
];

/** Strips a single leading common descriptive adjective from a short value, if present. */
export function stripLeadingDescriptiveAdjective(value: string): string {
  const trimmed = value.trim();
  const words = trimmed.split(/\s+/);
  if (words.length <= 1) return trimmed;
  const [first, ...rest] = words;
  if (COMMON_DESCRIPTIVE_ADJECTIVES.includes(first.toLowerCase())) {
    return rest.join(' ');
  }
  return trimmed;
}

/**
 * OUTPUT GUARD for the no-adjective rule. Flags RAW_VALUE fields whose
 * generated value starts with a common descriptive adjective, so the caller
 * can auto-correct with stripLeadingDescriptiveAdjective() or trigger a
 * targeted re-generation for just that field.
 */
export function scanRawValueFieldsForAdjectives(
  expandedTextComponents: TemplateComponentDefinition[],
  generatedTextComponents: Record<string, unknown>,
): Array<{ componentId: string; value: string; suspectedAdjective: string }> {
  const results: Array<{ componentId: string; value: string; suspectedAdjective: string }> = [];
  for (const component of expandedTextComponents) {
    if (!isRawValueComponent(component)) continue;
    const value = generatedTextComponents[component.componentId];
    if (typeof value !== 'string') continue;
    const words = value.trim().split(/\s+/);
    if (words.length <= 1) continue;
    const first = words[0].toLowerCase();
    if (COMMON_DESCRIPTIVE_ADJECTIVES.includes(first)) {
      results.push({ componentId: component.componentId, value, suspectedAdjective: first });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

export function buildFlashcardContentPrompt(input: {
  query: string;
  topic: string;
  ageMin: number;
  ageMax: number;
  learningObjective: string;
  count: number;
  selectedTemplate: SelectedTemplatePayload;
  textComponents: TemplateComponentDefinition[]; // may contain "{x}" ids — expanded internally
  imageComponents: TemplateComponentDefinition[]; // may contain "image-{x}" — expanded with text pairing
  grade?: string | null;
  subject?: string | null;
  difficulty?: string | null;
  language?: string;
  countryCode?: string;
  // Optional: exact repeat count per templated componentId (e.g.
  // { "num-{x}": 50 } for a "numbers 51-100" request). When omitted,
  // repeating fields fall back to an inferred default — see
  // expandTemplateComponents(). Pass this whenever the real count is known.
  repeatCounts?: RepeatCountMap;
}): string {
  // INPUT GUARD — reject up front if the request is centrally about a
  // forbidden subject. Broader topics that merely touch a forbidden term
  // (e.g. "farm animals") are allowed through and handled by the prompt
  // guard below, which tells the model to skip just that one item.
  assertContentRequestIsAllowed({
    topic: input.topic,
    query: input.query,
    countryCode: input.countryCode,
  });

  const ageLabel = `${input.ageMin}-${input.ageMax}`;
  const language = input.language || 'English';

  // Self-contained: expands any "{x}" ids automatically. No caller-side
  // change required — this is what makes the fix resilient to upstream
  // code that hasn't been (or can't yet be) updated to pre-expand.
  const expansionOptions = {
    repeatCounts: input.repeatCounts,
    ageMin: input.ageMin,
    ageMax: input.ageMax,
    query: input.query,
  };
  const textComponents = expandTemplateComponents(
    input.textComponents,
    expansionOptions,
  );
  // image-{x} must expand to the same slot count as paired text (word-/num-{x}).
  const imageComponents = expandTemplateComponents(input.imageComponents, {
    ...expansionOptions,
    pairWithComponents: input.textComponents,
  });

  const genericSkillLabelComponents = textComponents.filter(
    isGenericSkillLabelComponent,
  );
  const perCardObjectTitleComponents = textComponents.filter(
    isPerCardObjectTitleComponent,
  );
  const rawValueComponents = textComponents.filter(isRawValueComponent);
  const bareExactQueryImages = imageComponents.filter(
    isBareExactQueryImageComponent,
  );
  const standardImages = imageComponents.filter(
    (component) => !isBareExactQueryImageComponent(component),
  );

  const textContract = textComponents
    .map(
      (component) =>
        `- "${component.componentId}": type=${component.componentType}, region=${component.regionId ?? 'unspecified'}, ${component.required ? 'required' : 'optional'}, style=${componentStyleLabel(component)}, validation=${JSON.stringify(component.validationRules ?? {})}`,
    )
    .join('\n');

  const imageContract = imageComponents
    .map(
      (component) =>
        `- "${component.componentId}": type=image, region=${component.regionId ?? 'unspecified'}, ${component.required ? 'required' : 'optional'}, style=${imageStyleLabel(component)}, validation=${JSON.stringify(component.validationRules ?? {})}`,
    )
    .join('\n');

  const exampleTextComponents = textComponents
    .map((component) => {
      const style = componentStyleLabel(component);
      const placeholder =
        style === 'RAW_VALUE'
          ? 'bare value, e.g. a number or single word — no adjectives, no sentence'
          : style === 'GENERIC_SKILL_LABEL'
            ? 'clean generic 1–4 word domain title for the whole set, e.g. Animals or Fruits — no adjectives, no sentence, same generic word regardless of what this specific card shows'
            : style === 'PER_CARD_OBJECT_TITLE'
              ? 'the specific object THIS card depicts, as a bare noun, e.g. Lion or Strawberry — must match this card\'s image subject, no adjectives, no sentence'
              : component.componentType + ' content — object names must stay bare nouns, no adjectives';
      return `        "${component.componentId}": "<${placeholder}>"`;
    })
    .join(',\n');

  const exampleImageComponents = imageComponents
    .map((component) => {
      if (isBareExactQueryImageComponent(component)) {
        return `        "${component.componentId}": {
          "searchQuery": "<Letter Q — ONLY the letter phrase, no extra words>",
          "expectedObjects": ["Q"],
          "preferredStyle": "cartoon",
          "preferredBackground": "white",
          "orientation": "${input.selectedTemplate.orientation.toLowerCase()}",
          "educationalUse": "flashcard"
        }`;
      }
      return `        "${component.componentId}": {
          "searchQuery": "<detailed retrieval phrase: this card's title subject + skillLabel/topic domain + what the picture must clearly show>",
          "expectedObjects": ["<primary expected object, bare noun matching the title>"],
          "preferredStyle": "cartoon",
          "preferredBackground": "white",
          "orientation": "${input.selectedTemplate.orientation.toLowerCase()}",
          "educationalUse": "flashcard"
        }`;
    })
    .join(',\n');

  const rawValueRules =
    rawValueComponents.length > 0
      ? `
RAW VALUE fields (listed as style=RAW_VALUE above — e.g. ${rawValueComponents
          .slice(0, 3)
          .map((c) => `"${c.componentId}"`)
          .join(', ')}${rawValueComponents.length > 3 ? ', ...' : ''}):
- Output ONLY the exact value for that single slot (a number, a spelled-out number word, or a single sight word/object noun). No sentences, no filler, no punctuation beyond what the value itself requires.
- Never merge multiple slots' values into one field. Each indexed component id (e.g. "num-1", "num-2") gets its own independent, single value.
- Do NOT apply the age-band narrative style below to these fields — that guidance is for descriptive/narrative fields only.
- Respect each field's own validation limits exactly (see "validation" above).`
      : '';

  const genericSkillLabelRules =
    genericSkillLabelComponents.length > 0
      ? `
GENERIC SKILL LABEL fields (e.g. ${genericSkillLabelComponents.map((c) => `"${c.componentId}"`).join(', ')}):
- These are domain/topic labels for the WHOLE SET, not for any one card. Output ONLY a clean, generic 1 to 4 word domain/topic name in Title Case (e.g., "Animals", "Fruits", "Numbers 91 to 100", "Sight Words").
- The requested topic is "${input.topic}". The label should generally just BE that topic, cleanly capitalized (e.g. "Animals") — do NOT bolt on a redundant generic suffix like "${input.topic} Vocabulary", "${input.topic} Words", or "${input.topic} Flashcards". Only add a qualifying word when it removes real ambiguity between multiple cards in the same set (e.g. "Fruit Colors" vs "Fruit Shapes" if both genuinely exist as separate focuses).
- This value stays the SAME generic word across every card in the set — it must NOT change to name the specific object a given card depicts (that is the job of the PER_CARD_OBJECT_TITLE field below, if the template has one).
- NEVER write full sentences, conversational filler, or instructions (FORBIDDEN: "Let us read", "Look at the", "Read together", "Carefully").
- Never attach adjectives or decorative words to the label (see NO ADJECTIVES RULE below).
- Ignore age-band sentence/narrative guidelines for these fields.`
      : '';

  const perCardObjectTitleRules =
    perCardObjectTitleComponents.length > 0
      ? `
PER-CARD OBJECT TITLE fields (e.g. ${perCardObjectTitleComponents.map((c) => `"${c.componentId}"`).join(', ')}):
- This is NOT the generic topic label. It must name the SPECIFIC object, animal, word, or number that THIS card is actually about — a bare noun only, no adjectives (e.g. "Lion", "Strawberry", "Seven" — not "Big Lion", not the generic topic word "Animals"/"Fruits").
- It MUST exactly match, in singular bare-noun form, this same card's image expectedObjects[0]. If the image on this card shows a lion, this field must say "Lion" — never the generic category name, and never a different animal. The image searchQuery may be a longer phrase, but it must still be about that same title subject.
- Must be different for each card in the set (see CROSS-CARD CONTENT UNIQUENESS below) — it is the per-card counterpart to the set-wide GENERIC SKILL LABEL, not a duplicate of it.
- Still respects the TOPIC DOMAIN LOCK and STRICTLY FORBIDDEN CONTENT rules below.
- Ignore age-band sentence/narrative guidelines for this field — it is a short label, not a sentence.`
      : '';

  const bareExactQueryRules =
    bareExactQueryImages.length > 0
      ? `
BARE_EXACT_QUERY image fields (e.g. ${bareExactQueryImages
          .map((c) => `"${c.componentId}"`)
          .join(', ')}):
- searchQuery MUST be ONLY the requested letter phrase (e.g., "Letter Q" or "letter q").
- NEVER add styles, adjectives, or extra words like "cartoon", "fun", "capital", "style", or "colorful" inside searchQuery.
- expectedObjects should be just the letter itself (e.g. ["Q"]). Prefer preferredStyle/preferredBackground fields for rendering hints — do not bake those words into searchQuery.`
      : '';

  const skillLabelIds = genericSkillLabelComponents.map((c) => `"${c.componentId}"`);
  const titleIds = perCardObjectTitleComponents.map((c) => `"${c.componentId}"`);
  const standardImageIds = standardImages.map((c) => `"${c.componentId}"`);

  const standardImageQueryRules =
    standardImages.length > 0
      ? `
STANDARD image searchQuery fields (e.g. ${standardImageIds.join(', ')}):
- Do NOT emit a one-word object name. Write a detailed semantic retrieval phrase (typically 6 to 14 words) so search can find the correct educational picture for THIS card.
- ${titleIds.length > 0 ? `The primary subject MUST be the object named in ${titleIds.join(', ')} on this card (the PER_CARD_OBJECT_TITLE).` : `The primary subject MUST be the specific object this card teaches (the per-card title/label), not a generic category.`}
- ${skillLabelIds.length > 0 ? `The scene MUST stay inside the domain named by ${skillLabelIds.join(', ')} (the GENERIC SKILL LABEL) and the requested topic "${input.topic}". Never retrieve an image from a different skill.` : `The scene MUST stay inside the requested topic "${input.topic}"${input.subject ? ` and subject "${input.subject}"` : ''}.`}
- Include concrete visual/educational detail: what is shown (whole identifiable subject), typical setting or use that belongs to that skill, and enough nouns that the picture cannot be confused with a sibling topic (e.g. fruit vs vegetable, letter glyph vs object that starts with the letter).
- expectedObjects[0] remains the bare singular noun that matches the title (e.g. "strawberry"). searchQuery is the longer retrieval phrase ABOUT that noun.
- Correct: title "Lion", skillLabel "Animals" → searchQuery "lion wild animal standing in grassland". Forbidden: "lion" alone, "juicy strawberry", a query about a different animal than the title, or boilerplate like "educational flashcard".
- Still follow NO ADJECTIVES RULE for the object's own name (no "friendly", "juicy", "cute"). Scene nouns and skill nouns are required; decorative fluff is not.
- Never put style words like cartoon/colorful/white background into searchQuery — those belong in preferredStyle/preferredBackground.`
      : '';

  const crossCardUniquenessRules =
    input.count > 1
      ? `
CROSS-CARD CONTENT UNIQUENESS (count is ${input.count}):
- Every card in this set must be distinct. Never repeat the same object, word, fact, sentence, or number across two different cards.
- Each card must show a DIFFERENT primary image subject. Never repeat the same object, animal, food, or scene across cards (forbidden: strawberry on card 1 and strawberry on card 2).
- expectedObjects[0] must be unique across cards in this response.
- searchQuery must name that distinct title subject (plus skill/domain detail) so retrieval does not return the same image type twice.
- Any PER_CARD_OBJECT_TITLE field must change accordingly on every card, always naming that card's own distinct subject (e.g. card 1 "Lion", card 2 "Elephant") — never the same value twice, and never the generic set-wide skill label.
- For narrative/description/fact/question fields, use a different sentence structure and a different true fact for each card — never copy the same phrasing with only the noun swapped.
- Exception 1: BARE_EXACT_QUERY letter-glyph slots may repeat the same letter phrase when teaching that letter.
- Exception 2: sequential RAW_VALUE fields (e.g. "num-1".."num-${input.count}") may legitimately repeat values only when the topic explicitly requests a numeric sequence — the values themselves are still each distinct per slot.
`
      : '';

  return `You generate educational flashcard CONTENT only.

Rules:
- Return JSON only.
- Never invent UI layout, positioning, colors, fonts, styling, or rendering metadata.
- Never choose templates.
- The backend already selected the template below. Treat its component IDs and types as the exact output contract. Component IDs are already fully expanded — every indexed component (e.g. "num-1".."num-${input.count}") is a separate, independent field. Never output a literal "{x}" in any field name or value.
- Generate one independent value for every required text component and one independent image search description for every required image component.
- Never reuse one image component's query as a substitute for another image component.
- Never return image filenames — only semantic image search fields.
- Keep language age-appropriate for ages ${ageLabel}.
- Write all educational text in ${language}.
- ${ageBandGuidance(input.ageMin, input.ageMax)} (applies only to NARRATIVE-style fields — see per-field style below; never applies to RAW_VALUE, GENERIC_SKILL_LABEL, or PER_CARD_OBJECT_TITLE fields.)
- NO ADJECTIVES RULE: Never attach a descriptive, decorative, evaluative, or emotional adjective to an object's name, in ANY field — text or image. Use the bare noun only. Correct: "cow", "strawberry", "lion". Forbidden: "friendly cow", "juicy strawberry", "big lion". This applies to labels, titles, raw values, the subject noun inside narrative sentences, and expectedObjects. STANDARD image searchQuery may add extra skill/scene nouns around that bare name (see STANDARD image rules) but must still not decorate the object name itself. A narrative fact sentence may still state true educational information about the object (what it does, where it lives, what it is used for) as a separate predicate — it just must not decorate the object's own name with adjectives. This rule is about NOT decorating the name — it does NOT mean omitting the object's name itself (see PER-CARD OBJECT TITLE rules below: the specific object must still be named, just without adjectives).
- TOPIC DOMAIN LOCK: Every object, word, number, or image named anywhere across all cards MUST belong strictly to the requested topic ("${input.topic}") and subject ("${input.subject ?? 'unspecified'}"). Never drift into an adjacent or unrelated category (e.g. if the topic is fruits, never include vegetables, drinks, packaged snacks, or any non-fruit item).
- SUBJECT FAMILIARITY: unless the request explicitly asks for rare, exotic, or extinct subjects, choose commonly recognized members of the topic category with clear, unambiguous, easy-to-illustrate identities (e.g. for "animals": lion, elephant, tiger, monkey, giraffe, zebra, bear, rabbit, cow, horse — not obscure or extinct picks like dodo). Images are matched from an existing dataset by semantic search, not generated fresh, so an obscure or ambiguous subject is much more likely to return an irrelevant or wrong image.
- TITLE-IMAGE CONSISTENCY: whenever a card has both a per-card object title/label field and an image field, they must refer to the exact same object. Never let a card's image show one thing while its title/label names a different thing or only the generic topic word. The STANDARD searchQuery must be relevant to that title AND remain inside the skillLabel/topic domain.
${buildCountryForbiddenPromptClause(input.countryCode)}
- Maximize educational variety. Do NOT always reuse the same canonical examples (e.g. A→Apple/Ball/Cat, or Potato/Tomato/Carrot). Rotate equally valid age-appropriate alternatives when they exist, while staying inside the TOPIC DOMAIN LOCK and SUBJECT FAMILIARITY rules above.
- Content must be factually correct, concise, curriculum-aligned, and visually teachable.
${rawValueRules}${genericSkillLabelRules}${perCardObjectTitleRules}${bareExactQueryRules}${standardImageQueryRules}

Learner profile:
- User request: ${input.query}
- Topic focus: ${input.topic}
- Grade: ${input.grade ?? 'unspecified'}
- Age group: ${ageLabel}
- Subject: ${input.subject ?? 'unspecified'}
- Difficulty: ${input.difficulty ?? 'unspecified'}
- Educational objective: ${input.learningObjective}
- Language: ${language}

Selected template contract:
- Template ID: ${input.selectedTemplate.id}
- Template name: ${input.selectedTemplate.name}
- Template version: ${input.selectedTemplate.templateVersion}
- Template type: ${input.selectedTemplate.templateType}
- Layout type: ${input.selectedTemplate.layoutType}
- Orientation: ${input.selectedTemplate.orientation}

Produce exactly ${input.count} cards.
${crossCardUniquenessRules}
Inside "textComponents", use these exact component IDs verbatim (already-expanded, one value each). Do not rename, translate, omit required IDs, merge IDs together, or add IDs:
${textContract || '- No text components in this template.'}

Inside "imageComponents", use these exact component IDs verbatim. Each ID represents a separate image requirement:
${imageContract || '- No image components in this template.'}

Every image component value must contain:
- searchQuery: for style=STANDARD use a detailed retrieval phrase tied to this card's title subject and skillLabel/topic (see STANDARD image rules); for style=BARE_EXACT_QUERY use ONLY the letter phrase (e.g. "Letter Q") with no extra adjectives
- expectedObjects: array of expected object names, bare nouns only (no adjectives)
- preferredStyle: e.g. cartoon
- preferredBackground: e.g. white
- orientation: e.g. portrait
- educationalUse: flashcard

JSON shape:
{
  "cards": [
    {
      "cardIndex": 0,
      "textComponents": {
${exampleTextComponents}
      },
      "imageComponents": {
${exampleImageComponents}
      }
    }
  ]
}`;
}

/**
 * Gemini structured output ignores free-form maps, so the component keys are
 * pinned to the selected template's componentIds on every request.
 *
 * Self-contained: expands any "{x}" ids automatically via
 * expandTemplateComponents(), same as buildFlashcardContentPrompt — no
 * caller-side pre-expansion required. Pass `repeatCounts`/`ageMin`/`ageMax`/
 * `query` in `options` whenever the real requested count is known, so the schema
 * (and therefore the model's available slots) matches exactly what the
 * user asked for rather than the inferred fallback.
 *
 * Both text and image components are expanded here — a literal "{x}" must
 * never appear as a Gemini schema property key.
 *
 * NOTE ON CONTENT SAFETY: this schema intentionally does NOT embed a
 * forbidden-term regex `pattern` on the string fields. Gemini's structured
 * output pattern support is inconsistent across versions, is case-sensitive
 * by default, and a bad pattern can silently break unrelated fields. Content
 * safety for this schema is enforced instead by (1) assertContentRequestIsAllowed
 * in buildFlashcardContentPrompt, and (2) scanCardsForForbiddenContent on the
 * response — callers should run that check and reject/regenerate on violation.
 */
export function buildFlashcardContentSchema(
  rawTextComponents: TemplateComponentDefinition[],
  rawImageComponents: TemplateComponentDefinition[],
  options: {
    repeatCounts?: RepeatCountMap;
    ageMin?: number;
    ageMax?: number;
    query?: string;
  } = {},
): Record<string, unknown> {
  const textComponents = expandTemplateComponents(rawTextComponents, options);
  const imageComponents = expandTemplateComponents(rawImageComponents, {
    ...options,
    pairWithComponents: rawTextComponents,
  });

  const componentProperties: Record<string, unknown> = {};
  for (const component of textComponents) {
    componentProperties[component.componentId] = validationRulesToJsonSchema(
      component.validationRules,
    );
  }

  const requiredComponentIds = textComponents
    .filter((component) => component.required)
    .map((component) => component.componentId);

  const imageQuerySchema = {
    type: 'object',
    properties: {
      searchQuery: { type: 'string' },
      expectedObjects: {
        type: 'array',
        items: { type: 'string' },
      },
      preferredStyle: { type: 'string' },
      preferredBackground: { type: 'string' },
      orientation: { type: 'string' },
      educationalUse: { type: 'string' },
    },
    required: ['searchQuery', 'expectedObjects'],
    propertyOrdering: [
      'searchQuery',
      'expectedObjects',
      'preferredStyle',
      'preferredBackground',
      'orientation',
      'educationalUse',
    ],
  };

  const imageComponentProperties: Record<string, unknown> = {};
  for (const component of imageComponents) {
    imageComponentProperties[component.componentId] = imageQuerySchema;
  }

  const requiredImageComponentIds = imageComponents
    .filter((component) => component.required)
    .map((component) => component.componentId);

  return {
    type: 'object',
    properties: {
      cards: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            cardIndex: { type: 'integer' },
            textComponents: {
              type: 'object',
              properties: componentProperties,
              required: requiredComponentIds,
              propertyOrdering: textComponents.map(
                (component) => component.componentId,
              ),
            },
            imageComponents: {
              type: 'object',
              properties: imageComponentProperties,
              required: requiredImageComponentIds,
              propertyOrdering: imageComponents.map(
                (component) => component.componentId,
              ),
            },
          },
          required: ['textComponents', 'imageComponents'],
          propertyOrdering: ['cardIndex', 'textComponents', 'imageComponents'],
        },
      },
    },
    required: ['cards'],
  };
}

// ---------------------------------------------------------------------------
// map a component's declared validationRules onto real JSON Schema
// constraints, so Gemini's structured output is actually bounded by them
// instead of the rules only existing as prose in the prompt text.
// ---------------------------------------------------------------------------

interface ValidationRules {
  maxCharacters?: number;
  minCharacters?: number;
  pattern?: string;
  enum?: string[];
  [key: string]: unknown;
}

function validationRulesToJsonSchema(
  rules: ValidationRules | undefined,
): Record<string, unknown> {
  const schema: Record<string, unknown> = { type: 'string' };
  if (!rules) return schema;

  if (typeof rules.maxCharacters === 'number') {
    schema.maxLength = rules.maxCharacters;
  }
  if (typeof rules.minCharacters === 'number') {
    schema.minLength = rules.minCharacters;
  }
  if (typeof rules.pattern === 'string') {
    schema.pattern = rules.pattern;
  }
  if (Array.isArray(rules.enum) && rules.enum.length > 0) {
    schema.enum = rules.enum;
  }

  return schema;
}

export function buildFlashcardEditPrompt(input: {
  instruction: string;
  cardId: string;
  componentId: string;
  componentType: string;
  currentValue: unknown;
  card: unknown;
  countryCode?: string;
}): string {
  // INPUT GUARD — an edit instruction can just as easily ask for forbidden
  // content ("change this to a witch", "make it a pig") as an initial
  // generation request can.
  const matchedForbiddenTerm = topicIsPrimarilyForbidden(
    input.instruction,
    input.countryCode,
  );
  if (matchedForbiddenTerm) {
    throw new ForbiddenContentError(matchedForbiddenTerm, 'instruction');
  }

  return [
    'You edit a single flashcard component. Return JSON only.',
    `Card id: ${input.cardId}`,
    `Component id: ${input.componentId}`,
    `Component type: ${input.componentType}`,
    `User instruction: ${input.instruction}`,
    '',
    'Rules:',
    '- NO ADJECTIVES RULE: never attach a descriptive/decorative adjective to an object\'s name — bare noun only (e.g. "strawberry", not "juicy strawberry").',
    buildCountryForbiddenPromptClause(input.countryCode),
    '- Stay within the same topic domain as the current value — do not drift into an unrelated category.',
    '',
    'Current component value:',
    JSON.stringify(input.currentValue, null, 2),
    '',
    'Full card (context only; do not rewrite unrelated components):',
    JSON.stringify(input.card, null, 2),
    '',
    'Return JSON of the form {"value": <replacement>}.',
    'For text components, value must be a plain string. No HTML or CSS.',
    'For image components, value must be a visual search phrase (never a filename), naming only the bare object with no adjectives.',
  ].join('\n');
}