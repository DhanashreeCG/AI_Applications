import {
  bindGenericEditorHooks,
  highlightCaptionLetter,
  imageZoneForSlot,
  parseImageZoneBoxes,
  resolveImageSlot,
} from './template-tokens.util';

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

  it('maps IMAGE_1 to the first item slot', () => {
    expect(resolveImageSlot(structure, 'IMAGE_1')?.path).toBe('items[0]');
  });
});

describe('look-and-say template helpers', () => {
  it('parses img-zone-box rectangles', () => {
    const zones = parseImageZoneBoxes(`
      {{IMAGE_1}}
      <div class="img-zone-box" onclick="selectWorksheetImage('item_1')" style="left:50px;top:260px;width:300px;height:230px;"></div>
    `);
    expect(zones.item_1).toEqual({ left: 50, top: 260, width: 300, height: 230 });
  });

  it('highlights the target letter in captions', () => {
    expect(highlightCaptionLetter('Y for Yoghurt', 'Y')).toBe(
      '<span class="hl-letter">Y</span> for <span class="hl-letter">Y</span>oghurt',
    );
  });

  it('keeps every fallback quadrant zone clear of the letter circle', () => {
    // green ring measured on the background art, in canvas px
    const circle = { left: 324, top: 479, right: 690, bottom: 835 };
    ['item_1', 'item_2', 'item_3', 'item_4'].forEach((slot) => {
      const zone = imageZoneForSlot('{{IMAGE_1}}', slot);
      expect(zone).toBeDefined();
      const overlaps =
        zone!.left < circle.right &&
        zone!.left + zone!.width > circle.left &&
        zone!.top < circle.bottom &&
        zone!.top + zone!.height > circle.top;
      expect(overlaps).toBe(false);
    });
  });

  it('binds prototype item_1 hooks to items[n] paths', () => {
    const html = bindGenericEditorHooks(
      `<div class="img-zone-box" onclick="selectWorksheetImage('item_1')" style="left:50px;top:260px;width:300px;height:230px;"></div>
       <button class="img-camera-btn" onclick="selectWorksheetImage('item_1')"></button>
       <div class="caption" data-editable="item_1">C for Carrot</div>
       <button class="ai-pencil" data-pencil-for="item_1"></button>`,
      {
        items: [{ id: 'item_1', caption: 'C for Carrot', imageQuery: 'carrot' }],
      },
    );
    expect(html).toContain('data-image-slot="item_1"');
    expect(html).toContain('data-field-path="items[0]"');
    expect(html).toContain('data-field-path="items[0].caption"');
    expect(html).toContain('data-pencil-for="items[0].caption"');
  });
});
