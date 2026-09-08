import {
  ageBandsOverlap,
  parseAgeGroupRange,
  readTemplateAgeRange,
  resolveAgeBand,
  templateHasAgeMeta,
} from './age-band.util';

describe('age-band.util', () => {
  describe('parseAgeGroupRange', () => {
    it('parses both ends of a range (not first digit only)', () => {
      expect(parseAgeGroupRange('4-5')).toEqual({ min: 4, max: 5 });
      expect(parseAgeGroupRange('2 – 3')).toEqual({ min: 2, max: 3 });
      expect(parseAgeGroupRange('ages 5 to 6')).toEqual({ min: 5, max: 6 });
    });

    it('treats a single number as a point band', () => {
      expect(parseAgeGroupRange('4')).toEqual({ min: 4, max: 4 });
    });
  });

  describe('resolveAgeBand', () => {
    it('uses point age when provided', () => {
      expect(resolveAgeBand({ age: 4, ageGroup: '2-3' })).toEqual({
        min: 4,
        max: 4,
        source: 'age',
      });
    });

    it('uses full ageGroup range when age is absent', () => {
      expect(resolveAgeBand({ ageGroup: '4-5' })).toEqual({
        min: 4,
        max: 5,
        source: 'ageGroup',
      });
    });

    it('maps grade/stage to canonical age band', () => {
      expect(resolveAgeBand({ grade: 'LKG' })).toEqual({
        min: 3,
        max: 4,
        source: 'grade',
      });
      expect(resolveAgeBand({ grade: 'fs0' })).toEqual({
        min: 2,
        max: 3,
        source: 'grade',
      });
    });
  });

  describe('ageBandsOverlap', () => {
    it('requires inclusive overlap', () => {
      expect(ageBandsOverlap(5, 6, 4, 5)).toBe(true);
      expect(ageBandsOverlap(5, 6, 4, 4)).toBe(false);
      expect(ageBandsOverlap(3, 4, 4, 5)).toBe(true);
    });
  });

  describe('templateHasAgeMeta / readTemplateAgeRange', () => {
    it('requires both finite endpoints', () => {
      expect(templateHasAgeMeta(3, 4)).toBe(true);
      expect(templateHasAgeMeta(undefined, 4)).toBe(false);
      expect(templateHasAgeMeta(3, undefined)).toBe(false);
      expect(readTemplateAgeRange({ ageMin: 3, ageMax: 4 })).toEqual({
        min: 3,
        max: 4,
      });
      expect(readTemplateAgeRange({})).toBeNull();
    });
  });
});
