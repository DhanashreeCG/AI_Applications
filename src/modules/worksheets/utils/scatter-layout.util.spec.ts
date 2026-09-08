import {
  circleGridRowPattern,
  circleRowBandCenters,
  generateCircleGridPositions,
  generateScatterPositions,
} from './scatter-layout.util';

describe('circleGridRowPattern', () => {
  it('uses 2-3-2 for seven items', () => {
    expect(circleGridRowPattern(7)).toEqual([2, 3, 2]);
  });

  it('uses 2-2-2 for six items', () => {
    expect(circleGridRowPattern(6)).toEqual([2, 2, 2]);
  });
});

describe('circleRowBandCenters', () => {
  it('spaces three bands with about 90px clear gap', () => {
    const boxHeight = 644;
    const itemHeight = 145;
    const bands = circleRowBandCenters(3, boxHeight, itemHeight);
    expect(bands).toHaveLength(3);
    const centersPx = bands.map((y) => y * boxHeight);
    const gap01 =
      centersPx[1] - itemHeight / 2 - (centersPx[0] + itemHeight / 2);
    const gap12 =
      centersPx[2] - itemHeight / 2 - (centersPx[1] + itemHeight / 2);
    expect(gap01).toBeGreaterThanOrEqual(80);
    expect(gap01).toBeLessThanOrEqual(100);
    expect(gap12).toBeGreaterThanOrEqual(80);
    expect(gap12).toBeLessThanOrEqual(100);
  });
});

describe('generateCircleGridPositions', () => {
  const box = { left: 58, top: 58, width: 744, height: 644 };
  const itemSize = { width: 165, height: 145 };

  it('places seven items in staggered 2-3-2 zones with roomy row gaps', () => {
    const positions = generateCircleGridPositions(7, box, itemSize);
    expect(positions).toHaveLength(7);

    const band = (top: number) => {
      const cy = top + itemSize.height / 2 - box.top;
      if (cy < box.height / 3) return 0;
      if (cy < (box.height * 2) / 3) return 1;
      return 2;
    };
    const byBand = [0, 1, 2].map((b) =>
      positions.filter((p) => band(p.top) === b).sort((a, c) => a.left - c.left),
    );
    expect(byBand[0]).toHaveLength(2);
    expect(byBand[1]).toHaveLength(3);
    expect(byBand[2]).toHaveLength(2);

    // Within each band, tops should differ (natural stagger, not a flat row).
    expect(byBand[0][0].top).not.toBe(byBand[0][1].top);
    expect(new Set(byBand[1].map((p) => p.top)).size).toBeGreaterThan(1);

    // Bottom pair is inset vs top pair (not stacked in the same columns).
    expect(byBand[2][0].left).toBeGreaterThan(byBand[0][0].left);
    expect(byBand[2][1].left).toBeLessThan(byBand[0][1].left);

    // Clear gap between row bounding boxes should stay comfortable.
    const bandBottom = (items: typeof positions) =>
      Math.max(...items.map((p) => p.top + itemSize.height));
    const bandTop = (items: typeof positions) => Math.min(...items.map((p) => p.top));
    const gap01 = bandTop(byBand[1]) - bandBottom(byBand[0]);
    const gap12 = bandTop(byBand[2]) - bandBottom(byBand[1]);
    expect(gap01).toBeGreaterThanOrEqual(55);
    expect(gap12).toBeGreaterThanOrEqual(55);

    for (const pos of positions) {
      expect(pos.left).toBeGreaterThanOrEqual(box.left);
      expect(pos.top).toBeGreaterThanOrEqual(box.top);
      expect(pos.left + itemSize.width).toBeLessThanOrEqual(box.left + box.width);
      expect(pos.top + itemSize.height).toBeLessThanOrEqual(box.top + box.height);
    }
  });
});

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
