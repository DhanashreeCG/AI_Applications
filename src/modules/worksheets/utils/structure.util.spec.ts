import {
  collectImageSlots,
  normalizeImageQueryFields,
  normalizeLlmWorksheetPayload,
  stripLineartFromNonImageFields,
  withLineartQuery,
} from './structure.util';

describe('normalizeImageQueryFields pair images', () => {
  it('wraps left_image and right_image filenames into searchable slots', () => {
    const next = normalizeImageQueryFields({
      pairs: [
        {
          id: 'pair_1',
          label: 'eye',
          left_image: 'body_parts/eye.png',
          right_image: 'body_parts/eye.png',
        },
      ],
    });
    const left = (next.pairs as Array<Record<string, unknown>>)[0].left_image as Record<string, unknown>;
    expect(left.imageQuery).toBe('eye');
    expect(left.image_name).toBe('body_parts/eye.png');
    const slots = collectImageSlots(next);
    expect(slots.some((slot) => slot.path === 'pairs[0].left_image')).toBe(true);
    expect(slots.some((slot) => slot.path === 'pairs[0].right_image')).toBe(true);
    expect(slots.find((slot) => slot.path === 'pairs[0].left_image')?.slotId).toBe(
      'pairs[0].left_image',
    );
  });
});

describe('normalizeLlmWorksheetPayload', () => {
  const vegetableItems = [
    { id: 'i1', label: 'carrot', imageQuery: 'carrot', is_correct: true },
    { id: 'i2', label: 'apple', imageQuery: 'apple', is_correct: false },
    { id: 'i3', label: 'broccoli', imageQuery: 'broccoli', is_correct: true },
  ];

  it('keeps circle_the_things items on a single worksheet', () => {
    const parsed = {
      topic: 'VEGETABLES',
      instruction_text: 'Circle all the vegetables.',
      items: vegetableItems,
    };
    expect(normalizeLlmWorksheetPayload(parsed, 1)).toEqual([parsed]);
  });

  it('does not turn items[] into one worksheet per image', () => {
    const parsed = { items: vegetableItems };
    const result = normalizeLlmWorksheetPayload(parsed, 1);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(parsed);
  });

  it('wraps a top-level array of activity items as one worksheet', () => {
    const result = normalizeLlmWorksheetPayload(vegetableItems, 1);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ items: vegetableItems });
  });

  it('wraps a top-level array of sentence rows as one worksheet', () => {
    const rows = [
      { sentence: 'The toys are in the box.', target_sight_word: 'in' },
      { sentence: 'She has a doll.', target_sight_word: 'she' },
    ];
    expect(normalizeLlmWorksheetPayload(rows, 1)).toEqual([{ rows }]);
  });

  it('honours requested worksheet count for a worksheets[] wrapper', () => {
    const result = normalizeLlmWorksheetPayload(
      {
        worksheets: [
          { topic: 'A', items: vegetableItems },
          { topic: 'B', items: vegetableItems },
        ],
      },
      1,
    );
    expect(result).toHaveLength(1);
    expect((result[0] as { topic: string }).topic).toBe('A');
  });
});

describe('withLineartQuery', () => {
  it('appends lineart for answer_and_colour when missing', () => {
    expect(withLineartQuery('two goats', 'answer_and_colour')).toBe(
      'two goats lineart',
    );
  });

  it('does not duplicate an existing lineart term', () => {
    expect(withLineartQuery('goat lineart', 'answer-and-colour')).toBe(
      'goat lineart',
    );
  });

  it('leaves other templates unchanged', () => {
    expect(withLineartQuery('two goats', 'circle_the_words')).toBe('two goats');
  });
});

describe('stripLineartFromNonImageFields', () => {
  it('keeps lineart on imageQuery and removes it from questions and topic', () => {
    const next = stripLineartFromNonImageFields({
      topic: 'Farm lineart animals',
      instruction_text: 'Colour the line art picture.',
      questions: [{ question: 'What is this lineart goat doing?' }],
      image: { imageQuery: 'two goats lineart' },
    });
    expect(next.topic).toBe('Farm animals');
    expect(next.instruction_text).toBe('Colour the picture.');
    expect(
      (next.questions as Array<{ question: string }>)[0].question,
    ).toBe('What is this goat doing?');
    expect((next.image as { imageQuery: string }).imageQuery).toBe(
      'two goats lineart',
    );
  });
});
