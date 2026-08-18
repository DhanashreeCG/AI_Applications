import { ImageSearchQuery, LlmCardContent } from '../interfaces/flashcard.interfaces';

const GENERIC_SUBJECTS = new Set([
  'animal',
  'background',
  'cartoon',
  'clipart',
  'colorful',
  'drawing',
  'educational',
  'flashcard',
  'food',
  'fruit',
  'illustration',
  'image',
  'object',
  'picture',
  'plant',
  'scene',
  'style',
  'vegetable',
  'white',
]);

export function normalizeImageSubject(value: string | undefined | null): string {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isLetterGlyphSubject(subject: string): boolean {
  return /^[a-z]$/i.test(subject) || /^letter\s+[a-z]$/i.test(subject);
}

export function primaryImageSubject(
  query: ImageSearchQuery | string | undefined,
): string {
  if (!query) {
    return '';
  }
  if (typeof query === 'string') {
    return firstMeaningfulToken(query);
  }
  const fromObjects = query.expectedObjects
    ?.map((item) => normalizeImageSubject(item))
    .find((item) => item && !GENERIC_SUBJECTS.has(item));
  if (fromObjects) {
    return fromObjects;
  }
  return firstMeaningfulToken(query.searchQuery);
}

function firstMeaningfulToken(raw: string | undefined): string {
  const normalized = normalizeImageSubject(raw);
  if (!normalized) {
    return '';
  }
  const token = normalized.split(' ').find((part) => !GENERIC_SUBJECTS.has(part));
  return token || normalized;
}

/**
 * When more than one card is generated, rewrite duplicate image subjects so
 * later cards search for a different object (text on the card, extra expected
 * objects, or an explicit "not X" query). Letter-glyph slots are left as-is.
 */
export function uniquifyCardImageQueries(cards: LlmCardContent[]): LlmCardContent[] {
  if (cards.length <= 1) {
    return cards;
  }

  const used = new Set<string>();

  for (const card of cards) {
    for (const [componentId, query] of Object.entries(card.imageComponents)) {
      const current = primaryImageSubject(query);
      if (!current || isLetterGlyphSubject(current)) {
        if (current) {
          used.add(current);
        }
        continue;
      }

      if (!used.has(current)) {
        used.add(current);
        continue;
      }

      const replacement = pickReplacementSubject(card, query, used);
      if (!replacement) {
        continue;
      }

      card.imageComponents[componentId] = {
        ...query,
        searchQuery: replacement.searchQuery,
        expectedObjects: replacement.expectedObjects,
      };
      used.add(replacement.subject);
    }
  }

  return cards;
}

function pickReplacementSubject(
  card: LlmCardContent,
  query: ImageSearchQuery,
  used: Set<string>,
): { subject: string; searchQuery: string; expectedObjects: string[] } | null {
  const extraObject = query.expectedObjects
    ?.map((item) => normalizeImageSubject(item))
    .find((item) => item && !used.has(item) && !GENERIC_SUBJECTS.has(item));
  if (extraObject) {
    return {
      subject: extraObject,
      searchQuery: extraObject,
      expectedObjects: [extraObject],
    };
  }

  const fromText = Object.values(card.textComponents)
    .map((value) => firstMeaningfulToken(value))
    .find((item) => item && !used.has(item) && !GENERIC_SUBJECTS.has(item));
  if (fromText) {
    return {
      subject: fromText,
      searchQuery: fromText,
      expectedObjects: [fromText],
    };
  }

  const banned = [...used].filter(Boolean).join(', ');
  return {
    subject: `card-${card.cardIndex}-alt`,
    searchQuery: `different object not ${banned}`,
    expectedObjects: query.expectedObjects?.length
      ? query.expectedObjects
      : ['different object'],
  };
}

export function hitSubjectKeys(hit: {
  objects?: string[];
  caption?: string;
  searchDescription?: string;
}): string[] {
  const keys = new Set<string>();
  for (const object of hit.objects || []) {
    const normalized = normalizeImageSubject(object);
    if (normalized && !GENERIC_SUBJECTS.has(normalized) && !isLetterGlyphSubject(normalized)) {
      keys.add(normalized);
    }
  }
  const caption = firstMeaningfulToken(hit.caption);
  if (caption && !GENERIC_SUBJECTS.has(caption) && !isLetterGlyphSubject(caption)) {
    keys.add(caption);
  }
  return [...keys];
}
