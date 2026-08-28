import { normalizeLlmWorksheetPayload } from './structure.util';

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
