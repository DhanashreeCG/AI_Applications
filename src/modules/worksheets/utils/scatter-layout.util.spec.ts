import { generateScatterPositions } from './scatter-layout.util';

describe('generateScatterPositions', () => {
  it('keeps every item fully inside the box', () => {
    const box = { left: 58, top: 58, width: 744, height: 644 };
    const itemSize = { width: 150, height: 180 };
    const positions = generateScatterPositions(7, box, itemSize);
    expect(positions).toHaveLength(7);
    for (const pos of positions) {
      expect(pos.left).toBeGreaterThanOrEqual(box.left);
      expect(pos.top).toBeGreaterThanOrEqual(box.top);
      expect(pos.left + itemSize.width).toBeLessThanOrEqual(box.left + box.width);
      expect(pos.top + itemSize.height).toBeLessThanOrEqual(box.top + box.height);
    }
  });
});
