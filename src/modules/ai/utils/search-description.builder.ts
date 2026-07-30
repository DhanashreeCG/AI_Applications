import { VisionMetadataDto } from '../../../common/dto/vision-metadata.dto';

function joinUnique(values: string[]): string {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].join(
    ', ',
  );
}

export function buildSearchDescription(metadata: VisionMetadataDto): string {
  const lines: string[] = [];

  if (metadata.caption.trim()) {
    lines.push(metadata.caption.trim());
  }

  if (metadata.objects.length > 0) {
    lines.push(joinUnique(metadata.objects));
  }

  if (metadata.actions.length > 0) {
    lines.push(joinUnique(metadata.actions));
  }

  if (metadata.styles.length > 0) {
    lines.push(joinUnique(metadata.styles));
  }

  if (metadata.colors.length > 0) {
    lines.push(joinUnique(metadata.colors));
  }

  if (metadata.background.trim()) {
    lines.push(metadata.background.trim());
  }

  if (metadata.composition.trim()) {
    lines.push(metadata.composition.trim());
  }

  if (metadata.educational_uses.length > 0) {
    lines.push(joinUnique(metadata.educational_uses));
  }

  if (metadata.search_keywords.length > 0) {
    lines.push(joinUnique(metadata.search_keywords));
  }

  return lines.join('\n');
}
