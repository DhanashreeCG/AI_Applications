import {
  applyNumberMatchOverrides,
  looksLikeNumberNamePairs,
  matchRightValue,
  normalizeNumberNamesPairs,
  toRomanNumeral,
} from './number-match.util';

describe('number-match.util', () => {
  it('converts digits to Roman numerals', () => {
    expect(toRomanNumeral(1)).toBe('I');
    expect(toRomanNumeral(4)).toBe('IV');
    expect(toRomanNumeral(12)).toBe('XII');
    expect(toRomanNumeral(20)).toBe('XX');
  });

  it('maps zero to the word name', () => {
    expect(matchRightValue('number_names', 0)).toBe('zero');
  });

  it('normalizes range 1-4 to exactly four unique pairs without padding', () => {
    const next = normalizeNumberNamesPairs(
      {
        worksheet_type: 'number_names',
        pairs: [
          { number: '1', name: 'one' },
          { number: '2', name: 'two' },
          { number: '3', name: 'three' },
          { number: '4', name: 'four' },
          { number: '1', name: 'one' },
          { number: '2', name: 'two' },
        ],
      },
      { range: '1-4', matchType: 'number_names' },
    );
    const pairs = next.pairs as Array<{ number: string; name: string }>;
    expect(pairs.map((p) => p.number)).toEqual(['1', '2', '3', '4']);
    expect(pairs.map((p) => p.name)).toEqual(['one', 'two', 'three', 'four']);
    expect((next.layout as { row_count: number }).row_count).toBe(4);
  });

  it('dedupes pairs when no range is given', () => {
    const next = normalizeNumberNamesPairs({
      worksheet_type: 'number_names',
      pairs: [
        { number: '5', name: 'five' },
        { number: '5', name: 'five' },
        { number: '6', name: 'six' },
      ],
    });
    expect((next.pairs as Array<{ number: string }>).map((p) => p.number)).toEqual([
      '5',
      '6',
    ]);
  });

  it('does not treat picture-match pairs as number-name pairs', () => {
    expect(
      looksLikeNumberNamePairs({
        pairs: [{ left_image: { assetId: 'a' }, right_image: { assetId: 'b' } }],
      }),
    ).toBe(false);
  });

  it('rewrites number_names pairs to Roman numerals from AI Edit fields', () => {
    const next = applyNumberMatchOverrides(
      {
        topic: 'NUMBER NAMES',
        instruction_text: 'Match the numbers with their word names.',
        badge_label: 'Numeracy',
        pairs: [
          { number: '1', name: 'one' },
          { number: '5', name: 'five' },
          { number: '12', name: 'twelve' },
        ],
      },
      { topic: 'whole numbers', matchType: 'roman_numerals' },
    );

    expect(next.topic).toBe('whole numbers');
    expect(next.instruction_text).toBe('Match the numbers with their Roman numerals.');
    expect(next.badge_label).toBe('Numeracy');
    expect((next.pairs as Array<{ name: string }>).map((pair) => pair.name)).toEqual([
      'I',
      'V',
      'XII',
    ]);
  });

  it('rewrites pairs to addition expressions', () => {
    expect(matchRightValue('addition', 12)).toMatch(/^\d+ \+ \d+$/);
    const next = applyNumberMatchOverrides(
      { pairs: [{ number: '12', name: 'twelve' }] },
      { matchType: 'addition' },
    );
    expect((next.pairs as Array<{ name: string }>)[0].name).toMatch(/^\d+ \+ \d+$/);
  });

  it('leaves non-number worksheets unchanged', () => {
    const structure = {
      topic: 'Vegetables',
      questions: [{ question: 'What do you eat?' }],
    };
    expect(applyNumberMatchOverrides(structure, { topic: 'Fruits' })).toEqual({
      topic: 'Fruits',
      questions: [{ question: 'What do you eat?' }],
    });
  });
});
