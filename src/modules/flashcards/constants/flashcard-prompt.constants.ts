import {
  SelectedTemplatePayload,
  TemplateComponentDefinition,
} from '../interfaces/flashcard.interfaces';

export const DEFAULT_FLASHCARD_PROMPT_VERSION = 'v5-template-components-expanded';

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
// NEW: repeat-group expansion
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
 * Pulls a repeat/grid size hint from a component's validationRules when the
 * CMS/template declares one (maxItems, count, range, etc.).
 */
// function repeatCountFromComponentDef(
//   componentDef?: TemplateComponentDefinition,
// ): number | undefined {
//   if (!componentDef?.validationRules) return undefined;
//   const rules = componentDef.validationRules;

//   const asPositiveInt = (value: unknown): number | undefined => {
//     if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
//     const n = Math.trunc(value);
//     return n >= 1 ? n : undefined;
//   };

//   const direct =
//     asPositiveInt(rules.maxItems) ??
//     asPositiveInt(rules.count) ??
//     asPositiveInt(rules.repeatCount) ??
//     asPositiveInt(rules.maxCount) ??
//     asPositiveInt(rules.minItems);
//   if (direct !== undefined) return direct;

//   const range = rules.range;
//   if (range && typeof range === 'object' && !Array.isArray(range)) {
//     const start = asPositiveInt((range as { start?: unknown }).start);
//     const end = asPositiveInt((range as { end?: unknown }).end);
//     if (start !== undefined && end !== undefined) {
//       return Math.abs(end - start) + 1;
//     }
//     if (end !== undefined) return end;
//   }
//   if (Array.isArray(range) && range.length >= 2) {
//     const start = asPositiveInt(range[0]);
//     const end = asPositiveInt(range[1]);
//     if (start !== undefined && end !== undefined) {
//       return Math.abs(end - start) + 1;
//     }
//   }

//   return undefined;
// }

function repeatCountFromComponentDef(
  componentDef?: TemplateComponentDefinition,
): number | undefined {
  if (!componentDef) return undefined;

  const asPositiveInt = (value: unknown): number | undefined => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    const n = Math.trunc(value);
    return n >= 1 ? n : undefined;
  };

  // Extract from both `constraints` AND `validationRules`
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
        if (
          value >= 1 &&
          id.includes('{x}') &&
          !isImageRepeatId(id)
        ) {
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
// NEW: distinguish "raw grid value" components from "narrative" components
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

const TITLE_LABEL_SEMANTIC_ROLES = new Set([
  'phonics.skill.label',
  'header.label',
  'title.label',
  'card.title',
  'skill.label',
]);

const TITLE_LABEL_ID_PATTERN = /^(skillLabel|title|headerLabel|cardTitle)$/i;

function isTitleLabelComponent(component: TemplateComponentDefinition): boolean {
  const role = (component as { semanticRole?: string }).semanticRole;
  if (role) return TITLE_LABEL_SEMANTIC_ROLES.has(role);
  return TITLE_LABEL_ID_PATTERN.test(component.componentId);
}

function componentStyleLabel(component: TemplateComponentDefinition): string {
  if (isRawValueComponent(component)) return 'RAW_VALUE';
  if (isTitleLabelComponent(component)) return 'TITLE_LABEL';
  return 'NARRATIVE';
}

const BARE_EXACT_QUERY_IMAGE_ROLES = new Set(['phonics.letter.image']);

const BARE_EXACT_QUERY_IMAGE_ID_PATTERN = /^(letterImage|letter_image)$/i;

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
  // Optional: exact repeat count per templated componentId (e.g.
  // { "num-{x}": 50 } for a "numbers 51-100" request). When omitted,
  // repeating fields fall back to an inferred default — see
  // expandTemplateComponents(). Pass this whenever the real count is known.
  repeatCounts?: RepeatCountMap;
}): string {
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

  const titleComponents = textComponents.filter(isTitleLabelComponent);
  const rawValueComponents = textComponents.filter(isRawValueComponent);
  const bareExactQueryImages = imageComponents.filter(
    isBareExactQueryImageComponent,
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
          ? 'bare value, e.g. a number or single word — no sentence'
          : style === 'TITLE_LABEL'
            ? '1–4 word domain title, e.g. Numbers 91 to 100 — no sentence'
            : component.componentType + ' content';
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
          "searchQuery": "<precise semantic query for this image slot>",
          "expectedObjects": ["<primary expected object>"],
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
- Output ONLY the exact value for that single slot (a number, a spelled-out number word, or a single sight word). No sentences, no filler, no punctuation beyond what the value itself requires.
- Never merge multiple slots' values into one field. Each indexed component id (e.g. "num-1", "num-2") gets its own independent, single value.
- Do NOT apply the age-band narrative style below to these fields — that guidance is for descriptive/narrative fields only.
- Respect each field's own validation limits exactly (see "validation" above).`
      : '';

  const titleLabelRules =
    titleComponents.length > 0
      ? `
TITLE / SKILL LABEL fields (e.g. ${titleComponents.map((c) => `"${c.componentId}"`).join(', ')}):
- Output ONLY a clean, 1 to 4 word domain/topic title (e.g., "Numbers 91 to 100" or "Sight Words").
- NEVER write full sentences, conversational filler, or instructions (FORBIDDEN: "Let us read", "Look at the", "Read together", "Carefully").
- Ignore age-band sentence/narrative guidelines for these fields.`
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
- ${ageBandGuidance(input.ageMin, input.ageMax)} (applies only to NARRATIVE-style fields — see per-field style below; never applies to RAW_VALUE or TITLE_LABEL fields.)
- Maximize educational variety. Do NOT always reuse the same canonical examples (e.g. A→Apple/Ball/Cat, or Potato/Tomato/Carrot). Rotate equally valid age-appropriate alternatives when they exist.
- Content must be factually correct, concise, curriculum-aligned, and visually teachable.
${rawValueRules}${titleLabelRules}${bareExactQueryRules}

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
Inside "textComponents", use these exact component IDs verbatim (already-expanded, one value each). Do not rename, translate, omit required IDs, merge IDs together, or add IDs:
${textContract || '- No text components in this template.'}

Inside "imageComponents", use these exact component IDs verbatim. Each ID represents a separate image requirement:
${imageContract || '- No image components in this template.'}

Every image component value must contain:
- searchQuery: for style=STANDARD use a short precise semantic query (object-first, child-friendly); for style=BARE_EXACT_QUERY use ONLY the letter phrase (e.g. "Letter Q") with no extra adjectives
- expectedObjects: array of expected object names
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
// NEW: map a component's declared validationRules onto real JSON Schema
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
}): string {
  return [
    'You edit a single flashcard component. Return JSON only.',
    `Card id: ${input.cardId}`,
    `Component id: ${input.componentId}`,
    `Component type: ${input.componentType}`,
    `User instruction: ${input.instruction}`,
    '',
    'Current component value:',
    JSON.stringify(input.currentValue, null, 2),
    '',
    'Full card (context only; do not rewrite unrelated components):',
    JSON.stringify(input.card, null, 2),
    '',
    'Return JSON of the form {"value": <replacement>}.',
    'For text components, value must be a plain string. No HTML or CSS.',
    'For image components, value must be a visual search phrase (never a filename).',
  ].join('\n');
}