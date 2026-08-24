import { ImageSearchQuery, LlmCardContent } from '../interfaces/flashcard.interfaces';

/**
 * Asset embeddings are built from the vision `searchDescription`
 * (see `search-description.builder.ts`): caption, object nouns, actions, style
 * words, colours, background, composition, educational uses, keywords — one per
 * line. Because EVERY stored asset carries the pedagogy lines ("nursery
 * flashcards", "LKG alphabet learning", ...), a query containing those words
 * matches the whole library instead of the requested object, and retrieval
 * drifts to an unrelated worksheet. Only the visual part of the description
 * discriminates between assets, so a flashcard query must stay visual.
 */
/**
 * @deprecated Prefer ImageQueryRefinementService. This hardcoded list is kept
 * only as a fallback safety net for when the intent extraction LLM fails or is disabled.
 */
const PEDAGOGY_NOISE_PHRASES = [
  'for letter tracing',
  'for number tracing',
  'for early learners',
  'for young learners',
  'for classroom use',
  'for kids',
  'for children',
  'for toddlers',
  'for preschoolers',
  'for students',
  'unit study',
  'storytelling aid',
  'flash card',
  'flash cards',
  'flashcard',
  'flashcards',
  'worksheet',
  'worksheets',
  'educational',
  'education',
  'curriculum',
  'learning',
  'learner',
  'learners',
  'learn',
  'teaching',
  'teacher',
  'teach',
  'lesson',
  'lessons',
  'vocabulary',
  'recognition',
  'identification',
  'practice',
  'activity',
  'activities',
  'exercise',
  'exercises',
  'homework',
  'assignment',
  'study',
  'revision',
  'pre-nursery',
  'prenursery',
  'pre-school',
  'preschool',
  'nursery',
  'kindergarten',
  'montessori',
  'lkg',
  'ukg',
  'toddler',
  'toddlers',
  'kids',
  'children',
  'child friendly',
  'child-friendly',
];

/**
 * @deprecated Prefer ImageQueryRefinementService. This hardcoded list is kept
 * only as a fallback safety net for when the intent extraction LLM fails or is disabled.
 *
 * Line-art / outline assets exist alongside finished coloured pictures. These
 * terms are stripped unless the user's request is actually about tracing,
 * colouring, or outline work.
 */
const LINE_ART_PHRASES = [
  'line art',
  'line-art',
  'lineart',
  'line drawing',
  'outline drawing',
  'outlined',
  'outline',
  'black and white',
  'black-and-white',
  'coloring page',
  'colouring page',
  'coloring',
  'colouring',
  'uncolored',
  'uncoloured',
  'silhouette',
  'sketch',
  'doodle',
  'dotted line',
  'dotted lines',
  'traceable',
  'tracing',
  'trace',
];

/** Words that signal the user genuinely wants line art / outline assets. */
const LINE_ART_INTENT_PATTERN =
  /\b(trace|traces|tracing|traceable|colou?ring|colou?r\s+the|line\s*-?\s*art|line\s+drawing|outline|outlines|outlined|black\s+and\s+white|sketch|sketching|doodle|handwriting|writing\s+practice|pencil\s+control|dotted\s+lines?)\b/i;

/** Letter/number glyph queries ("Letter Q") must pass through untouched. */
const GLYPH_QUERY_PATTERN =
  /^(letter|capital\s+letter|small\s+letter|lowercase\s+letter|uppercase\s+letter|number|digit)\s+[a-z0-9]{1,2}$/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildPhrasePattern(phrases: string[]): RegExp {
  const ordered = [...phrases].sort((a, b) => b.length - a.length);
  return new RegExp(`\\b(?:${ordered.map(escapeRegExp).join('|')})\\b`, 'gi');
}

const PEDAGOGY_NOISE_PATTERN = buildPhrasePattern(PEDAGOGY_NOISE_PHRASES);
const LINE_ART_PATTERN = buildPhrasePattern(LINE_ART_PHRASES);

/** Prepositions/conjunctions left dangling once a noise phrase is removed. */
const DANGLING_CONNECTORS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'by',
  'for',
  'from',
  'in',
  'into',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

function tidy(value: string): string {
  const tokens = value
    .replace(/[,;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  while (tokens.length && DANGLING_CONNECTORS.has(tokens[0].toLowerCase())) {
    tokens.shift();
  }
  while (
    tokens.length &&
    DANGLING_CONNECTORS.has(tokens[tokens.length - 1].toLowerCase())
  ) {
    tokens.pop();
  }

  return tokens.join(' ');
}

export interface ImageQueryIntent {
  query?: string | null;
  topic?: string | null;
  learningObjective?: string | null;
  subject?: string | null;
}

/**
 * True when the user's own request is about tracing / colouring / outline work,
 * which is the only case where line-art assets should be retrieved.
 */
export function requestWantsLineArt(intent: ImageQueryIntent): boolean {
  return [intent.query, intent.topic, intent.learningObjective, intent.subject]
    .filter((value): value is string => Boolean(value?.trim()))
    .some((value) => LINE_ART_INTENT_PATTERN.test(value));
}

/**
 * Removal-only cleanup of one LLM `searchQuery`. Never invents wording and
 * never substitutes a different description — it strips the pedagogy boilerplate
 * (and, unless requested, line-art terms) that make the embedding match the
 * whole library instead of the named object. Falls back to the LLM's own
 * `expectedObjects[0]` if nothing visual survives.
 */
export function sanitizeImageSearchQuery(
  searchQuery: string,
  options: { allowLineArt?: boolean; fallback?: string } = {},
): string {
  const original = searchQuery.trim();
  if (!original || GLYPH_QUERY_PATTERN.test(original)) {
    return original;
  }

  let cleaned = original.replace(PEDAGOGY_NOISE_PATTERN, ' ');
  if (!options.allowLineArt) {
    cleaned = cleaned.replace(LINE_ART_PATTERN, ' ');
  }

  const tidied = tidy(cleaned);
  if (tidied) {
    return tidied;
  }

  const fallback = tidy(options.fallback?.trim() ?? '');
  return fallback || original;
}

/**
 * Applies `sanitizeImageSearchQuery` to every image slot in the generated set,
 * so the query stored on the card, shown in telemetry, and sent to asset search
 * are all the same single string.
 */
export function sanitizeCardImageQueries(
  cards: LlmCardContent[],
  options: { allowLineArt?: boolean } = {},
): Array<{ cardIndex: number; componentId: string; from: string; to: string }> {
  const changes: Array<{
    cardIndex: number;
    componentId: string;
    from: string;
    to: string;
  }> = [];

  for (const card of cards) {
    for (const [componentId, query] of Object.entries(card.imageComponents)) {
      const sanitized = sanitizeImageSearchQuery(query.searchQuery, {
        allowLineArt: options.allowLineArt,
        fallback: query.expectedObjects?.[0],
      });
      if (sanitized === query.searchQuery) {
        continue;
      }
      changes.push({
        cardIndex: card.cardIndex,
        componentId,
        from: query.searchQuery,
        to: sanitized,
      });
      card.imageComponents[componentId] = {
        ...query,
        searchQuery: sanitized,
      } satisfies ImageSearchQuery;
    }
  }

  return changes;
}
