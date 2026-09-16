/**
 * Internal semantic model for universal_template composition.
 * LLM designs educational content; this model is the layout engine's input.
 */

export type UniversalLayoutPrimitive =
  | 'single-focus'
  | 'large-picture'
  | 'image-row'
  | 'image-grid'
  | 'choice-grid'
  | 'matching-columns'
  | 'matching-grid'
  | 'trace-row'
  | 'sequence-row'
  | 'classification-grid'
  | 'picture-and-word'
  | 'picture-pairs'
  | 'connect-items';

export type UniversalActivityType =
  | 'recognize'
  | 'match'
  | 'circle'
  | 'trace'
  | 'count'
  | 'classify'
  | 'choose'
  | 'identify'
  | 'sort'
  | 'sequence'
  | 'compare'
  | 'complete'
  | 'color'
  | 'connect'
  | 'label'
  | 'find'
  | 'odd-one-out'
  | 'point';

export type UniversalImageRole =
  | 'primary'
  | 'option'
  | 'matching'
  | 'decorative'
  | 'outline'
  | 'unknown';

export type UniversalImageImportance = 'high' | 'normal' | 'low';

export type UniversalActivityDensity = 'comfortable' | 'compact' | 'spacious';

export type UniversalActivityItem = {
  kind: 'image' | 'word' | 'trace' | 'choice' | 'pair-left' | 'pair-right';
  label?: string;
  /** 1-based IMAGE_N index into worksheet images[] (before dense remap). */
  imageIndex?: number;
  role?: UniversalImageRole;
};

export type UniversalActivityLayoutIntent = {
  preferredLayout: UniversalLayoutPrimitive;
  density: UniversalActivityDensity;
  imageImportance: UniversalImageImportance;
};

export type UniversalActivityModel = {
  id: string;
  type: UniversalActivityType | string;
  title: string;
  instruction: string;
  items: UniversalActivityItem[];
  /** Matching: left/right columns (preferred over flat items when present). */
  leftItems?: UniversalActivityItem[];
  rightItems?: UniversalActivityItem[];
  layoutIntent: UniversalActivityLayoutIntent;
  /** Derived metrics */
  imageCount: number;
  itemCount: number;
  signature: string;
};

export type UniversalImageModel = {
  imageQuery: string;
  role?: UniversalImageRole;
  importance?: UniversalImageImportance;
  activityId?: string;
  assetId?: string;
  assetUrl?: string;
  caption?: string;
  searchDescription?: string;
};

export type UniversalWorksheetModel = {
  worksheet_type: 'universal_template';
  main_topic: string;
  sub_topic: string;
  instruction_text: string;
  activities: UniversalActivityModel[];
  labels: string[];
  images: UniversalImageModel[];
};

export const UNIVERSAL_LAYOUT_PRIMITIVES: UniversalLayoutPrimitive[] = [
  'single-focus',
  'large-picture',
  'image-row',
  'image-grid',
  'choice-grid',
  'matching-columns',
  'matching-grid',
  'trace-row',
  'sequence-row',
  'classification-grid',
  'picture-and-word',
  'picture-pairs',
  'connect-items',
];

export function normalizeActivityType(raw: string): string {
  const t = (raw || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!t) return 'identify';
  if (t === 'colour' || t === 'coloring' || t === 'colouring') return 'color';
  if (t === 'matching') return 'match';
  if (t === 'oddoneof' || t === 'oddoneout') return 'odd-one-out';
  return t.slice(0, 40);
}

export function inferPreferredLayout(
  type: string,
  imageCount: number,
  hasMatchColumns: boolean,
): UniversalLayoutPrimitive {
  if (hasMatchColumns || /match|connect|pair/i.test(type)) {
    return imageCount >= 6 ? 'matching-grid' : 'matching-columns';
  }
  if (/trace|complete|write/i.test(type)) return 'trace-row';
  if (/sequence/i.test(type)) return 'sequence-row';
  if (/classify|sort/i.test(type)) return 'classification-grid';
  if (/circle|choose|odd|find|point/i.test(type)) {
    if (imageCount <= 1) return 'large-picture';
    if (imageCount <= 3) return 'choice-grid';
    return 'image-grid';
  }
  if (/color/i.test(type)) return 'large-picture';
  if (/recognize|identify|look/i.test(type)) {
    if (imageCount <= 1) return 'large-picture';
    if (imageCount <= 4) return 'image-row';
    return 'image-grid';
  }
  if (imageCount <= 1) return 'single-focus';
  if (imageCount <= 3) return 'image-row';
  return 'image-grid';
}

export function isColoringCompatibleQuery(imageQuery: string): boolean {
  const q = (imageQuery || '').toLowerCase();
  return (
    /\b(outline|line\s*art|lineart|black\s*and\s*white|b&w|bw|coloring|colouring|color.?in|colour.?in|printable outline|uncolored|uncoloured)\b/i.test(
      q,
    )
  );
}
