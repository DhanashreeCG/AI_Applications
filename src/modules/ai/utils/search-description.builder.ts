import { VisionMetadataDto } from '../../../common/dto/vision-metadata.dto';

function joinUnique(values: string[]): string {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].join(
    ', ',
  );
}

const SYNONYM_CLUSTERS: Record<string, string[]> = {
  // shapes
  cube: ['cuboid', 'box shaped', 'square box'],
  cuboid: ['cube', 'box shaped', 'rectangular box'],
  sphere: ['ball shaped', 'round', 'globe shaped'],
  cylinder: ['tube shaped', 'can shaped', 'round tube'],
  cone: ['cone shaped', 'ice cream cone shaped'],
  pyramid: ['triangular sided', 'pyramid shaped'],

  // animal groups
  cow: ['farm animal', 'domestic animal'],
  hen: ['farm animal', 'bird'],
  lion: ['wild animal'],
  tiger: ['wild animal'],
  elephant: ['wild animal'],
  fish: ['sea animal', 'aquatic animal'],
  dog: ['pet', 'domestic animal'],
  cat: ['pet', 'domestic animal'],

  // fruit/veg
  apple: ['fruit'],
  banana: ['fruit'],
  carrot: ['vegetable'],
  potato: ['vegetable'],

  // vehicles
  car: ['land vehicle', 'four-wheeler'],
  bicycle: ['land vehicle', 'two-wheeler'],
  airplane: ['air vehicle'],
  boat: ['water vehicle'],

  // opposites — expand both directions
  big: ['large', 'opposite of small'],
  small: ['tiny', 'opposite of big'],
  tall: ['opposite of short'],
  short: ['opposite of tall'],
  hot: ['opposite of cold'],
  cold: ['opposite of hot'],
  full: ['opposite of empty'],
  empty: ['opposite of full'],

  // emotions
  happy: ['smiling', 'joyful'],
  sad: ['crying', 'upset'],
  angry: ['mad', 'frustrated'],

  // alphabet case
  uppercase: ['capital letter'],
  lowercase: ['small letter'],
};

const NUMERAL_WORD_MAP: Record<string, string> = {
  '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
  '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine', '10': 'ten',
};

function expandSynonyms(values: string[]): string[] {
  const expanded = new Set(values.map((v) => v.trim()).filter(Boolean));

  for (const value of values) {
    const lower = value.toLowerCase();

    for (const [key, synonyms] of Object.entries(SYNONYM_CLUSTERS)) {
      if (lower.includes(key)) {
        synonyms.forEach((s) => expanded.add(s));
      }
    }

    const numMatch = lower.match(/\b(\d)\b/);
    if (numMatch && NUMERAL_WORD_MAP[numMatch[1]]) {
      expanded.add(NUMERAL_WORD_MAP[numMatch[1]]);
      expanded.add(`number ${numMatch[1]}`);
      expanded.add(`digit ${numMatch[1]}`);
    }
  }

  return [...expanded];
}

export function buildSearchDescription(metadata: VisionMetadataDto): string {
  const lines: string[] = [];

  if (metadata.caption.trim()) {
    lines.push(metadata.caption.trim());
  }

  if (metadata.objects.length > 0) {
    lines.push(joinUnique(expandSynonyms(metadata.objects)));
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
    lines.push(joinUnique(expandSynonyms(metadata.search_keywords)));
  }

  return lines.join('\n');
}
