import { SearchMetadataFilters } from '../interfaces/search-result.interface';

interface MetadataLike {
  orientation: string | null;
  colors: string[];
  styles: string[];
  objects: string[];
  actions: string[];
  ageGroups: string[];
  grades: string[];
  educationalUses: string[];
  background: string | null;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function hasOverlap(values: string[], filters: string[]): boolean {
  const normalizedValues = new Set(values.map(normalize));
  return filters.some((filter) => normalizedValues.has(normalize(filter)));
}

export function matchesMetadataFilters(
  metadata: MetadataLike,
  filters?: SearchMetadataFilters,
): boolean {
  if (!filters) {
    return true;
  }

  if (
    filters.orientation &&
    normalize(metadata.orientation ?? '') !== normalize(filters.orientation)
  ) {
    return false;
  }

  if (filters.colors?.length && !hasOverlap(metadata.colors, filters.colors)) {
    return false;
  }

  if (filters.styles?.length && !hasOverlap(metadata.styles, filters.styles)) {
    return false;
  }

  if (filters.objects?.length && !hasOverlap(metadata.objects, filters.objects)) {
    return false;
  }

  if (filters.actions?.length && !hasOverlap(metadata.actions, filters.actions)) {
    return false;
  }

  if (
    filters.ageGroups?.length &&
    !hasOverlap(metadata.ageGroups, filters.ageGroups)
  ) {
    return false;
  }

  if (filters.grades?.length && !hasOverlap(metadata.grades, filters.grades)) {
    return false;
  }

  if (
    filters.educationalUses?.length &&
    !hasOverlap(metadata.educationalUses, filters.educationalUses)
  ) {
    return false;
  }

  if (filters.background) {
    const background = normalize(metadata.background ?? '');
    if (!background.includes(normalize(filters.background))) {
      return false;
    }
  }

  return true;
}
