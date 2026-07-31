import { VisionMetadataDto } from '../../../common/dto/vision-metadata.dto';

const AGE_RANGE_PATTERN = /^(\d{1,3})\s*-\s*(\d{1,3})$/;
const ALLOWED_GRADES = new Set(['toddlers', 'kids', 'teens', 'adults']);

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function asAgeRanges(value: unknown): string[] {
  return asStringArray(value).flatMap((item) => {
    const match = item.match(AGE_RANGE_PATTERN);
    if (!match) {
      return [];
    }

    const minimumAge = Number(match[1]);
    const maximumAge = Number(match[2]);
    if (minimumAge > maximumAge) {
      return [];
    }

    return [`${minimumAge}-${maximumAge}`];
  });
}

function asGrades(value: unknown): VisionMetadataDto['grades'] {
  return asStringArray(value)
    .map((item) => item.toLowerCase())
    .filter(
      (item): item is VisionMetadataDto['grades'][number] =>
        ALLOWED_GRADES.has(item),
    );
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

export function parseVisionMetadata(raw: unknown): VisionMetadataDto {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Vision metadata response is not a JSON object');
  }

  const record = raw as Record<string, unknown>;

  return {
    caption: asString(record.caption),
    objects: asStringArray(record.objects),
    actions: asStringArray(record.actions),
    styles: asStringArray(record.styles),
    colors: asStringArray(record.colors),
    background: asString(record.background),
    composition: asString(record.composition),
    orientation: asString(record.orientation, 'square'),
    age_groups: asAgeRanges(record.age_groups),
    grades: asGrades(record.grades),
    educational_uses: asStringArray(record.educational_uses),
    search_keywords: asStringArray(record.search_keywords),
    extra_tags:
      record.extra_tags && typeof record.extra_tags === 'object'
        ? (record.extra_tags as Record<string, unknown>)
        : undefined,
  };
}
