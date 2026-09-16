import {
  allocateUniversalPageSpace,
  chooseBestGridLayout,
  contentHeightForMatching,
  estimateActivityLayoutRequirement,
  fitMatchingImageSize,
  resolveActivityImageBoxBudget,
} from './universal-dynamic-layout.util';

describe('universal-dynamic-layout.util', () => {
  it('chooseBestGridLayout prefers larger readable cells for 6 items', () => {
    const layout = chooseBestGridLayout({
      itemCount: 6,
      availableWidth: 900,
      availableHeight: 420,
      preferColumns: 3,
    });
    expect(layout.columns).toBeGreaterThanOrEqual(2);
    expect(layout.rows * layout.columns).toBeGreaterThanOrEqual(6);
    expect(layout.imageSize).toBeGreaterThanOrEqual(90);
  });

  it('fitMatchingImageSize keeps every pair row visible', () => {
    for (const pairs of [2, 4, 6]) {
      const availH = 500;
      const size = fitMatchingImageSize({
        pairCount: pairs,
        availableWidth: 900,
        availableHeight: availH,
      });
      const bodyH = contentHeightForMatching({
        imageSize: size,
        pairCount: pairs,
        chrome: 0,
      });
      expect(size).toBeGreaterThanOrEqual(40);
      expect(bodyH).toBeLessThanOrEqual(availH + 4);
    }
  });

  it('matching activities receive more height than simple recognition when constrained', () => {
    const plan = allocateUniversalPageSpace({
      requirements: [
        estimateActivityLayoutRequirement({
          activityId: 'find',
          activityType: 'find',
          imageCount: 3,
          hasLabel: true,
          hasChoices: true,
          imageRole: 'primary',
        }),
        estimateActivityLayoutRequirement({
          activityId: 'match',
          activityType: 'match',
          imageCount: 4,
          pairCount: 2,
          hasMatch: true,
          hasLabel: true,
          imageRole: 'matching',
        }),
      ],
      viewportContentH: 1104,
    });
    const find = plan.allocations.find((a) => a.activityId === 'find')!;
    const match = plan.allocations.find((a) => a.activityId === 'match')!;
    expect(match.pairCount).toBe(2);
    expect(match.contentHeight).toBeGreaterThan(0);
    expect(find.imageSize).toBeGreaterThan(match.imageSize);
    expect(match.imageSize).toBeGreaterThanOrEqual(80);
  });

  it('resolveActivityImageBoxBudget is per-activity, not equal page share', () => {
    const primary = resolveActivityImageBoxBudget({
      activityHeightPx: 420,
      imagesInActivity: 1,
      activityType: 'recognize',
    });
    const matching = resolveActivityImageBoxBudget({
      activityHeightPx: 360,
      imagesInActivity: 4,
      activityType: 'match',
      hasMatch: true,
      pairCount: 2,
    });
    expect(primary.targetPx).toBeGreaterThan(matching.targetPx);
    expect(matching.minPx).toBeGreaterThanOrEqual(72);
  });

  it('never allocates zero image size for dense matching', () => {
    const plan = allocateUniversalPageSpace({
      requirements: [
        estimateActivityLayoutRequirement({
          activityId: 'm',
          activityType: 'match',
          imageCount: 12,
          pairCount: 6,
          hasMatch: true,
          hasLabel: true,
        }),
      ],
      viewportContentH: 900,
    });
    expect(plan.allocations[0].imageSize).toBeGreaterThanOrEqual(40);
    expect(plan.allocations[0].pairCount).toBe(6);
  });
});
