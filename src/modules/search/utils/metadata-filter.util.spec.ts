import { matchesMetadataFilters } from './metadata-filter.util';

describe('matchesMetadataFilters', () => {
  const metadata = {
    orientation: 'portrait',
    colors: ['red', 'white'],
    styles: ["Children's illustration"],
    objects: ['elephant', 'balloon'],
    actions: ['holding'],
    ageGroups: ['preschool', 'kindergarten'],
    educationalUses: ['worksheets'],
    background: 'White background',
  };

  it('should pass when no filters are provided', () => {
    expect(matchesMetadataFilters(metadata)).toBe(true);
  });

  it('should match orientation and array-based filters case-insensitively', () => {
    expect(
      matchesMetadataFilters(metadata, {
        orientation: 'Portrait',
        colors: ['RED'],
        objects: ['balloon'],
      }),
    ).toBe(true);
  });

  it('should match background using substring search', () => {
    expect(
      matchesMetadataFilters(metadata, {
        background: 'white',
      }),
    ).toBe(true);
  });

  it('should reject results that do not satisfy filters', () => {
    expect(
      matchesMetadataFilters(metadata, {
        orientation: 'landscape',
      }),
    ).toBe(false);

    expect(
      matchesMetadataFilters(metadata, {
        colors: ['blue'],
      }),
    ).toBe(false);
  });
});
