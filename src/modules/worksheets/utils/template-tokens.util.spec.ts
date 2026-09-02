import { resolveImageSlot } from './template-tokens.util';

describe('resolveImageSlot', () => {
  const structure = {
    image: { id: 'main_image', imageQuery: 'goat' },
    items: [
      { imageQuery: 'carrot', assetId: 'a1' },
      { imageQuery: 'apple', assetId: 'a2' },
    ],
  };

  it('does not map an unknown slot to the first image', () => {
    expect(resolveImageSlot(structure, 'question_3')).toBeNull();
    expect(resolveImageSlot(structure, 'missing')).toBeNull();
  });

  it('maps goat/main aliases to the main image only', () => {
    expect(resolveImageSlot(structure, 'goat')?.path).toBe('image');
    expect(resolveImageSlot(structure, 'main_image')?.path).toBe('image');
  });

  it('maps item_1 / item_2 to distinct items', () => {
    expect(resolveImageSlot(structure, 'item_1')?.path).toBe('items[0]');
    expect(resolveImageSlot(structure, 'item_2')?.path).toBe('items[1]');
  });
});
