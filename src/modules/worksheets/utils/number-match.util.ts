const WORD_NAMES: Record<number, string> = {
  0: 'zero',
  1: 'one',
  2: 'two',
  3: 'three',
  4: 'four',
  5: 'five',
  6: 'six',
  7: 'seven',
  8: 'eight',
  9: 'nine',
  10: 'ten',
  11: 'eleven',
  12: 'twelve',
  13: 'thirteen',
  14: 'fourteen',
  15: 'fifteen',
  16: 'sixteen',
  17: 'seventeen',
  18: 'eighteen',
  19: 'nineteen',
  20: 'twenty',
};

const ROMAN: Array<[number, string]> = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

const MATCH_INSTRUCTIONS: Record<string, string> = {
  number_names: 'Match the numbers with their number names.',
  addition: 'Match the numbers with their addition pairs.',
  subtraction: 'Match the numbers with their subtraction pairs.',
  multiplication: 'Match the numbers with their multiplication pairs.',
  division: 'Match the numbers with their division pairs.',
  doubles: 'Match the numbers with their doubles.',
  halves: 'Match the numbers with their halves.',
  roman_numerals: 'Match the numbers with their Roman numerals.',
  ordinals: 'Match the numbers with their ordinal names.',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parsePairNumber(value: unknown): number | null {
  const n = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function toRomanNumeral(value: number): string {
  let remaining = Math.floor(Math.abs(value));
  if (remaining <= 0) return 'N';
  let out = '';
  for (const [amount, glyph] of ROMAN) {
    while (remaining >= amount) {
      out += glyph;
      remaining -= amount;
    }
  }
  return out;
}

export function toNumberWord(value: number): string {
  if (WORD_NAMES[value]) return WORD_NAMES[value];
  if (value > 20 && value < 100) {
    const tens = Math.floor(value / 10) * 10;
    const ones = value % 10;
    const tensWord: Record<number, string> = {
      20: 'twenty',
      30: 'thirty',
      40: 'forty',
      50: 'fifty',
    };
    return ones ? `${tensWord[tens] || String(tens)}-${WORD_NAMES[ones]}` : tensWord[tens] || String(value);
  }
  return String(value);
}

export function toOrdinalWord(value: number): string {
  const special: Record<number, string> = {
    1: 'first',
    2: 'second',
    3: 'third',
    4: 'fourth',
    5: 'fifth',
    6: 'sixth',
    7: 'seventh',
    8: 'eighth',
    9: 'ninth',
    10: 'tenth',
    11: 'eleventh',
    12: 'twelfth',
  };
  return special[value] || `${toNumberWord(value)}th`;
}

export function matchRightValue(matchType: string, left: number): string {
  switch (matchType) {
    case 'roman_numerals':
      return toRomanNumeral(left);
    case 'ordinals':
      return toOrdinalWord(left);
    case 'addition': {
      const a = Math.max(1, Math.floor(left / 2));
      return `${a} + ${left - a}`;
    }
    case 'subtraction':
      return `${left + 3} − 3`;
    case 'multiplication': {
      if (left <= 1) return '1 × 1';
      for (let i = 2; i <= 10; i += 1) {
        if (left % i === 0) return `${i} × ${left / i}`;
      }
      return `${left} × 1`;
    }
    case 'division':
      return `${left * 2} ÷ 2`;
    case 'doubles':
      return String(left * 2);
    case 'halves':
      return left % 2 === 0 ? String(left / 2) : String(left);
    case 'number_names':
    default:
      return toNumberWord(left);
  }
}

export function looksLikeNumberNamePairs(structure: Record<string, unknown>): boolean {
  const pairs = structure.pairs;
  if (!Array.isArray(pairs) || pairs.length === 0) return false;
  return pairs.every(
    (pair) =>
      isRecord(pair) &&
      ('number' in pair || 'name' in pair) &&
      !('left_image' in pair) &&
      !('right_image' in pair),
  );
}

export function instructionForMatchType(matchType: string): string | undefined {
  return MATCH_INSTRUCTIONS[matchType];
}

/** Parse "1-4", "1 to 4", "from 1–4", etc. */
export function parseNumberRangeHint(
  text: string | undefined | null,
): { min: number; max: number } | null {
  if (!text?.trim()) return null;
  const match = text.match(
    /(?:from\s*)?(\d{1,2})\s*(?:-|–|—|to)\s*(\d{1,2})/i,
  );
  if (!match) return null;
  const a = Number(match[1]);
  const b = Number(match[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

/** Parse comma/space separated specifics like "1, 2, 3, 4". */
export function parseSpecificNumbersHint(
  text: string | undefined | null,
): number[] {
  if (!text?.trim()) return [];
  const nums = text
    .split(/[,;\s]+/)
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 100);
  const seen = new Set<number>();
  const unique: number[] = [];
  for (const n of nums) {
    if (seen.has(n)) continue;
    seen.add(n);
    unique.push(n);
  }
  return unique;
}

const NUMBER_NAMES_PALETTE_COLORS = [
  '#F8D7DA',
  '#D1E9F6',
  '#E2EFD9',
  '#E2D9F3',
  '#FFF2CC',
  '#FAD7C4',
];

function buildNumberNamePair(
  value: number,
  index: number,
  matchType: string,
  existing?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(existing ?? {}),
    id: (typeof existing?.id === 'string' && existing.id) || `pair_${index + 1}`,
    number: String(value),
    name: matchRightValue(matchType || 'number_names', value),
    color:
      (typeof existing?.color === 'string' && existing.color) ||
      NUMBER_NAMES_PALETTE_COLORS[index % NUMBER_NAMES_PALETTE_COLORS.length],
    editable: existing?.editable ?? true,
  };
}

/**
 * Enforce unique left-column numbers and honor an explicit range / list.
 * e.g. range 1–4 → exactly 4 pairs (1,2,3,4) — never pad to 6 with repeats.
 */
export function normalizeNumberNamesPairs(
  structure: Record<string, unknown>,
  hints?: {
    range?: string;
    specificNumbers?: string;
    query?: string;
    matchType?: string;
  },
): Record<string, unknown> {
  if (!looksLikeNumberNamePairs(structure)) {
    return structure;
  }

  const matchType =
    hints?.matchType?.trim() ||
    (typeof structure.worksheet_type === 'string'
      ? structure.worksheet_type
      : 'number_names');

  const specific = parseSpecificNumbersHint(hints?.specificNumbers);
  const range =
    parseNumberRangeHint(hints?.range) ||
    parseNumberRangeHint(hints?.query) ||
    parseNumberRangeHint(
      typeof structure.instruction_text === 'string'
        ? structure.instruction_text
        : '',
    );

  const rawPairs = Array.isArray(structure.pairs)
    ? (structure.pairs as Array<Record<string, unknown>>)
    : [];

  let values: number[] = [];

  if (specific.length > 0) {
    values = specific.slice(0, 6);
  } else if (range) {
    const span = range.max - range.min + 1;
    if (span >= 1 && span <= 6) {
      values = Array.from({ length: span }, (_, i) => range.min + i);
    } else if (span > 6) {
      // Prefer existing unique values inside the range, then fill.
      const inside = rawPairs
        .map((p) => parsePairNumber(p.number))
        .filter((n): n is number => n != null && n >= range.min && n <= range.max);
      const seen = new Set<number>();
      for (const n of inside) {
        if (seen.has(n)) continue;
        seen.add(n);
        values.push(n);
        if (values.length >= 6) break;
      }
      for (let n = range.min; n <= range.max && values.length < 6; n += 1) {
        if (seen.has(n)) continue;
        seen.add(n);
        values.push(n);
      }
    }
  }

  if (values.length === 0) {
    // No explicit range/list: dedupe existing pairs, cap at 6, no repeat-padding.
    const seen = new Set<string>();
    const deduped: Array<Record<string, unknown>> = [];
    for (const pair of rawPairs) {
      const key = String(pair.number ?? '').trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      deduped.push(pair);
      if (deduped.length >= 6) break;
    }
    const next: Record<string, unknown> = { ...structure, pairs: deduped };
    if (isRecord(next.layout)) {
      next.layout = { ...next.layout, row_count: deduped.length };
    }
    return next;
  }

  // Clamp to template bounds when we have an explicit set.
  if (values.length > 6) values = values.slice(0, 6);

  const byNumber = new Map<number, Record<string, unknown>>();
  for (const pair of rawPairs) {
    const n = parsePairNumber(pair.number);
    if (n == null || byNumber.has(n)) continue;
    byNumber.set(n, pair);
  }

  const pairs = values.map((value, index) =>
    buildNumberNamePair(value, index, matchType, byNumber.get(value)),
  );

  const next: Record<string, unknown> = {
    ...structure,
    pairs,
    worksheet_type: structure.worksheet_type ?? 'number_names',
  };
  if (isRecord(next.layout)) {
    next.layout = { ...next.layout, row_count: pairs.length };
  } else {
    next.layout = { row_count: pairs.length };
  }
  return next;
}

/** Rewrite number/name pairs so the right column matches the AI Edit match type. */
export function applyNumberMatchOverrides(
  structure: Record<string, unknown>,
  fields: Record<string, string>,
): Record<string, unknown> {
  let next = { ...structure };
  if (fields.topic) {
    next.topic = fields.topic;
  }
  const matchType = fields.matchType?.trim();
  if (matchType && MATCH_INSTRUCTIONS[matchType]) {
    next.instruction_text = instructionForMatchType(matchType);
  }
  if (matchType && looksLikeNumberNamePairs(next)) {
    next.pairs = (next.pairs as Array<Record<string, unknown>>).map((pair) => {
      const left = parsePairNumber(pair.number);
      if (left == null) return pair;
      return { ...pair, name: matchRightValue(matchType, left) };
    });
  }
  next = normalizeNumberNamesPairs(next, {
    range: fields.range,
    specificNumbers: fields.specificNumbers,
    query: fields.query,
    matchType: matchType || fields.matchType,
  });
  return next;
}
