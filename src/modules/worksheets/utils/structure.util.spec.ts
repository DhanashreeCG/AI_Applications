import {
  collectImageSlots,
  normalizeImageQueryFields,
  normalizeLlmWorksheetPayload,
  resolveAliasFieldPath,
  resolveAliasImagePath,
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

  it('prefers left_hint over filename when normalizing pair images', () => {
    const next = normalizeImageQueryFields({
      pairs: [
        {
          id: 'pair_1',
          left_hint: 'small red bird',
          left_image: 'Birds/sparrow.png',
          right_hint: 'small birdhouse',
          right_image: null,
        },
      ],
    });
    const pair = (next.pairs as Array<Record<string, unknown>>)[0];
    expect((pair.left_image as { imageQuery: string }).imageQuery).toBe('small red bird');
    expect((pair.right_image as { imageQuery: string }).imageQuery).toBe('small birdhouse');
  });

  it('coerces left_imageQuery / right_imageQuery into left_image / right_image slots', () => {
    const next = normalizeImageQueryFields({
      pairs: [
        {
          id: 'pair_1',
          label: 'red planet',
          left_imageQuery: 'red planet cartoon',
          right_imageQuery: 'red planet cartoon',
        },
      ],
    });
    const pair = (next.pairs as Array<Record<string, unknown>>)[0];
    expect(pair.left_imageQuery).toBeUndefined();
    expect(pair.right_imageQuery).toBeUndefined();
    expect((pair.left_image as { imageQuery: string }).imageQuery).toBe(
      'red planet cartoon',
    );
    expect((pair.right_image as { imageQuery: string }).imageQuery).toBe(
      'red planet cartoon',
    );
    const slots = collectImageSlots(next);
    expect(slots.map((s) => s.path).sort()).toEqual([
      'pairs[0].left_image',
      'pairs[0].right_image',
    ]);
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

describe('alias field paths', () => {
  const structure = {
    items: [{ caption: 'C for Carrot', imageQuery: 'carrot' }],
    questions: [{ question: 'What?' }],
  };

  it('maps item_1 to the item caption and IMAGE_1 to the item slot', () => {
    expect(resolveAliasFieldPath(structure, 'item_1')).toBe('items[0].caption');
    expect(resolveAliasImagePath(structure, 'item_1')).toBe('items[0]');
    expect(resolveAliasImagePath(structure, 'IMAGE_1')).toBe('items[0]');
    expect(resolveAliasFieldPath(structure, 'question_1')).toBe('questions[0].question');
  });

  it('maps IMAGE_2_RIGHT onto pairs[1].right_image', () => {
    expect(
      resolveAliasImagePath(
        { pairs: [{}, {}] },
        'IMAGE_2_RIGHT',
      ),
    ).toBe('pairs[1].right_image');
  });

  it('maps left/right letter editables and scene image aliases', () => {
    const structure = {
      image: { id: 'scene_image', imageQuery: 'ant' },
      left_letters: [{ letter: 'i' }],
      right_letters: [{ letter: 'a' }],
    };
    expect(resolveAliasFieldPath(structure, 'left_letter_1')).toBe(
      'left_letters[0].letter',
    );
    expect(resolveAliasFieldPath(structure, 'right_letter_1')).toBe(
      'right_letters[0].letter',
    );
    expect(resolveAliasImagePath(structure, 'scene_image')).toBe('image');
    expect(resolveAliasImagePath(structure, 'SCENE')).toBe('image');
  });

  it('maps circle letter and vocab word editables', () => {
    const structure = {
      circle_letters: [{ letter: 'A' }],
      items: [{ word: 'ant' }],
    };
    expect(resolveAliasFieldPath(structure, 'cl_1')).toBe(
      'circle_letters[0].letter',
    );
    expect(resolveAliasFieldPath(structure, 'word_1')).toBe('items[0].word');
  });

  it('maps storytime_maze item ids onto items[n]', () => {
    const structure = {
      items: [
        { id: 'item_start', imageQuery: 'tortoise' },
        { id: 'item_obstacle', imageQuery: 'hare' },
      ],
    };
    expect(resolveAliasImagePath(structure, 'item_start')).toBe('items[0]');
    expect(resolveAliasImagePath(structure, 'item_obstacle')).toBe('items[1]');
  });
});
