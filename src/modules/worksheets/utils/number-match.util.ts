const WORD_NAMES: Record<number, string> = {
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

/** Rewrite number/name pairs so the right column matches the AI Edit match type. */
export function applyNumberMatchOverrides(
  structure: Record<string, unknown>,
  fields: Record<string, string>,
): Record<string, unknown> {
  const next = { ...structure };
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
  return next;
}
