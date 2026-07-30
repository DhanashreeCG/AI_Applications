import { VisionMetadataDto } from '../../../common/dto/vision-metadata.dto';

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
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
    age_groups: asStringArray(record.age_groups),
    educational_uses: asStringArray(record.educational_uses),
    search_keywords: asStringArray(record.search_keywords),
    extra_tags:
      record.extra_tags && typeof record.extra_tags === 'object'
        ? (record.extra_tags as Record<string, unknown>)
        : undefined,
  };
}
