import { ImageSearchQuery } from '../interfaces/flashcard.interfaces';

// ---------------------------------------------------------------------------
// Image Query Refinement — Prompt Builder
// ---------------------------------------------------------------------------
//
// Builds the system + user prompt for the lightweight LLM intent extraction
// stage. The LLM receives the content-generation output (raw image search
// queries, text components for context) and returns a refined 2–5 word search
// key per image slot — optimised for semantic vector search against asset
// embeddings.
//
// Design principles (from flashcard_fixes.md):
//   1. Search for IDENTITY first, appearance second
//   2. Never substitute concepts (number 10 ≠ number 9)
//   3. Never invent objects the card didn't request
//   4. Remove pedagogy / audience / curriculum noise semantically
//   5. Preserve exact letter / number identity
//   6. 2–5 word search key, not a sentence

/**
 * One image slot to refine — carries enough context for the LLM to
 * understand what the card is about without seeing the full prompt.
 */
export interface ImageSlotForRefinement {
  componentId: string;
  searchQuery: string;
  expectedObjects: string[];
  preferredStyle?: string;
  /** Text content of the card this image belongs to (context only). */
  cardTextSummary?: string;
}

export interface RefinementPromptInput {
  slots: ImageSlotForRefinement[];
  topic: string;
  learningObjective: string;
  allowLineArt: boolean;
  assetVocabulary?: string;
}

// ---------------------------------------------------------------------------
// System prompt — reasoning framework, not word lists
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a retrieval-intent extractor for an educational image asset library.

## Your ONLY Job
Convert each image component's intended visual content into the smallest, most discriminative search query possible for an existing image asset database.

## How Asset Search Works
Each asset in the library has an AI-generated description embedded as a vector. That description contains: object/content, synonyms, shape, actions, style, colors, background, composition, educational uses, search keywords.

Many assets share generic properties (cartoon, vector, educational, pink, blue, preschool, minimalist). These generic terms match the entire library equally and provide zero discriminative signal. Your query must be dominated by the visual IDENTITY of the requested image, not shared attributes.

## Extraction Rules

### 1. Primary Visual Identity (MOST IMPORTANT)
What is the single thing that must appear in the image?
Examples: apple, dog, number 10, letter Q, triangle, butterfly

### 2. Identity-Defining Attributes
Only keep attributes that distinguish this image from sibling assets.
Examples: red apple (color matters), three apples (count matters), capital letter Q (case matters)

### 3. Required Visual State
Keep activity/style modifier ONLY when it changes what asset is sought.
Examples: number 10 tracing, outlined triangle, cartoon dog

### 4. Remove Everything Else
Strip ALL of the following — they match the entire library equally:
- Teaching-purpose words (flashcard, educational, learning, teaching, lesson, vocabulary, recognition, practice, activity, worksheet, curriculum, study)
- Audience words (for kids, for children, preschool, nursery, kindergarten, LKG, UKG, toddler)
- Decorative adjectives (cute, beautiful, fun, high quality, colorful, nice, simple, friendly, attractive)
- Invented scenery/props (on a green leaf, in a classroom, in the jungle, standing in grassland, holding a book)
- Narrative filler (let us learn, look at the, read together)

### 5. Identity Collision Protection
When several concepts are siblings (number 8 vs 9 vs 10, letter O vs Q vs D, apple vs orange vs banana), preserve the EXACT distinguishing concept. Never replace an exact identity with a broad category.
- Bad: number, letter, fruit, shape, animal
- Good: number 10, letter Q, apple fruit, square shape, dog animal

### 6. Never Substitute Concepts
- Never replace lion with tiger because tiger exists
- Never replace number 10 with number 9 because 9 exists
- Never invent objects the card did not request

### 7. Do Not Invent Specific Objects
If the card says "Show square shape objects" without specifying an object, produce "square shape object" — do NOT invent "square block" or "square window".

### 8. Query Length
Prefer 2–5 meaningful words. Use the category noun to prevent sibling-topic collisions (fruit vs vegetable, letter glyph vs object). The category noun is the only extra noun allowed.

### 9. Contextual Disambiguation
If the provided 'currentSearchQuery' is overly generic (like 'topic image' or 'flashcard picture'), you MUST look at the 'cardContext' text to infer the unique subject of that specific flashcard. Every image slot belongs to a different card; therefore, the visual identity and refined searchQuery MUST be distinct across different slots. Do not output the same generic query for every slot!

## Output Contract
Return ONLY valid JSON — an array with one entry per input slot:
[
  {
    "componentId": "string",
    "primaryConcept": "the most important visual identity",
    "requiredAttributes": ["only attributes necessary to identify the intended visual asset"],
    "searchQuery": "final concise 2-5 word embedding query"
  }
]

No explanations. No prose. No alternative queries. No fallback queries.`;

// ---------------------------------------------------------------------------
// User prompt — dynamic per request
// ---------------------------------------------------------------------------

export function buildImageQueryRefinementPrompt(
  input: RefinementPromptInput,
): { system: string; user: string } {
  const slotsPayload = input.slots.map((slot) => ({
    componentId: slot.componentId,
    currentSearchQuery: slot.searchQuery,
    expectedObjects: slot.expectedObjects,
    preferredStyle: slot.preferredStyle,
    ...(slot.cardTextSummary
      ? { cardContext: slot.cardTextSummary }
      : {}),
  }));

  const lineArtClause = input.allowLineArt
    ? `This request IS about tracing/colouring/outline work. For slots that should show uncoloured drawings, include exactly one line-art term ("line art" or "outline") in searchQuery. Normal coloured picture slots must NOT contain line-art terms.`
    : `This request is NOT about tracing or colouring. searchQuery MUST NOT contain "line art", "lineart", "outline", "black and white", "coloring", "colouring", "sketch", "silhouette", "trace", or "tracing". Use "cartoon" as the style word for normal coloured pictures.`;

  const vocabularySection = input.assetVocabulary
    ? `\n## Available Asset Vocabulary (for terminology guidance only — do NOT force the concept to fit)\n${input.assetVocabulary}\n\nUse this vocabulary to understand canonical terminology. If the requested concept has no exact match, preserve the requested concept anyway.\n`
    : '';

  const user = `Topic: ${input.topic}
Learning objective: ${input.learningObjective}

## Line-Art Rule
${lineArtClause}
${vocabularySection}
## Image Slots to Refine
${JSON.stringify(slotsPayload, null, 2)}

For each slot, extract the visual identity and return the refined searchQuery. Remember:
- If currentSearchQuery is vague (e.g., 'flashcard image', 'topic image'), you MUST infer the specific object from the cardContext text.
- Every slot represents a different flashcard. The refined searchQuery MUST be distinct and directly relevant to the specific cardContext of that slot.
- searchQuery should be a 2–5 word search key, not a sentence
- Identity first, appearance second
- Exact letters/numbers must be preserved
- No pedagogy, audience, or decorative words
- Add category noun to prevent sibling collisions (e.g. "cartoon ant insect", "cartoon lion wild animal")

Return the JSON array only.`;

  return { system: SYSTEM_PROMPT, user };
}

// ---------------------------------------------------------------------------
// Structured output schema
// ---------------------------------------------------------------------------

export function buildImageQueryRefinementSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            componentId: { type: 'string' },
            primaryConcept: { type: 'string' },
            requiredAttributes: {
              type: 'array',
              items: { type: 'string' },
            },
            searchQuery: { type: 'string', maxLength: 80 },
          },
          required: [
            'componentId',
            'primaryConcept',
            'requiredAttributes',
            'searchQuery',
          ],
        },
      },
    },
    required: ['results'],
  };
}

// ---------------------------------------------------------------------------
// Response parser
// ---------------------------------------------------------------------------

export interface RefinedImageSlot {
  componentId: string;
  primaryConcept: string;
  requiredAttributes: string[];
  searchQuery: string;
}

/**
 * Parse and validate the LLM response. Returns `null` when the response is
 * structurally invalid — callers should fall back to the original queries.
 */
export function parseRefinementResponse(
  raw: unknown,
  expectedSlotIds: string[],
): RefinedImageSlot[] | null {
  // Handle both { results: [...] } and bare array forms
  let items: unknown[];
  if (Array.isArray(raw)) {
    items = raw;
  } else if (
    raw &&
    typeof raw === 'object' &&
    Array.isArray((raw as { results?: unknown }).results)
  ) {
    items = (raw as { results: unknown[] }).results;
  } else {
    return null;
  }

  const results: RefinedImageSlot[] = [];
  const expectedSet = new Set(expectedSlotIds);

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const slot = item as Record<string, unknown>;

    const componentId =
      typeof slot.componentId === 'string' ? slot.componentId.trim() : '';
    const primaryConcept =
      typeof slot.primaryConcept === 'string'
        ? slot.primaryConcept.trim()
        : '';
    const searchQuery =
      typeof slot.searchQuery === 'string' ? slot.searchQuery.trim() : '';

    if (!componentId || !searchQuery) continue;
    if (!expectedSet.has(componentId)) continue;

    const requiredAttributes = Array.isArray(slot.requiredAttributes)
      ? (slot.requiredAttributes as unknown[])
          .filter((a): a is string => typeof a === 'string')
          .map((a) => a.trim())
          .filter(Boolean)
      : [];

    results.push({
      componentId,
      primaryConcept: primaryConcept || searchQuery,
      requiredAttributes,
      searchQuery,
    });
  }

  return results.length > 0 ? results : null;
}
