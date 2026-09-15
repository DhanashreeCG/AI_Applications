import { resolveUniversalActivityPolicy } from './universal-activity-policy.util';

describe('universal-activity-policy.util', () => {
  it('maps 2-3 to exactly 1 easy activity', () => {
    expect(resolveUniversalActivityPolicy({ ageGroup: '2-3' })).toMatchObject({
      bandKey: '2-3',
      maxSections: 1,
      targetSections: 1,
      difficulty: 'easy',
    });
    expect(resolveUniversalActivityPolicy({ age: 3 })).toMatchObject({
      bandKey: '2-3',
      maxSections: 1,
    });
  });

  it('maps 3-4 to exactly 2 easy activities', () => {
    expect(resolveUniversalActivityPolicy({ ageGroup: '3-4' })).toMatchObject({
      bandKey: '3-4',
      maxSections: 2,
      targetSections: 2,
      difficulty: 'easy',
    });
    expect(resolveUniversalActivityPolicy({ age: 4 })).toMatchObject({
      bandKey: '3-4',
      maxSections: 2,
    });
  });

  it('maps 4-5+ to max 4 / target 3 medium', () => {
    expect(resolveUniversalActivityPolicy({ ageGroup: '4-5' })).toMatchObject({
      bandKey: '4-5+',
      maxSections: 4,
      targetSections: 3,
      difficulty: 'medium',
    });
    expect(resolveUniversalActivityPolicy({ age: 6 })).toMatchObject({
      bandKey: '4-5+',
      maxSections: 4,
      targetSections: 3,
    });
  });

  it('uses 4-5+ defaults when age is unknown', () => {
    expect(resolveUniversalActivityPolicy({})).toMatchObject({
      bandKey: 'unknown',
      maxSections: 4,
      targetSections: 3,
      difficulty: 'medium',
    });
  });
});
