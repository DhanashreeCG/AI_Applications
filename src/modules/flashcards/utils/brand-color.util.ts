export interface FlashcardBrandTheme {
  frame: string;
  ink: string;
  tint: string;
  dash: string;
  bubble: string;
  names: string[];
}

/** Same palettes as public/flashcards.html THEMES. */
export const FLASHCARD_BRAND_THEMES: FlashcardBrandTheme[] = [
  {
    frame: '#FFD233',
    ink: '#7a5900',
    tint: '#FFF6D5',
    dash: 'rgba(255,255,255,.92)',
    bubble: '#4C1D95',
    names: ['yellow', 'gold', 'sunshine', 'orange', 'amber'],
  },
  {
    frame: '#FF3D8B',
    ink: '#8e0f43',
    tint: '#FFE6F0',
    dash: 'rgba(255,255,255,.92)',
    bubble: '#4C1D95',
    names: ['pink', 'magenta', 'rose', 'fuchsia', 'hotpink'],
  },
  {
    frame: '#4FC3F7',
    ink: '#0b5f83',
    tint: '#E4F6FE',
    dash: 'rgba(255,255,255,.95)',
    bubble: '#1D4ED8',
    names: ['blue', 'cyan', 'sky', 'teal', 'aqua'],
  },
  {
    frame: '#FF5A5F',
    ink: '#8c1f22',
    tint: '#FFE9E9',
    dash: 'rgba(255,255,255,.92)',
    bubble: '#4C1D95',
    names: ['red', 'coral', 'scarlet', 'crimson'],
  },
  {
    frame: '#3DD68C',
    ink: '#0d6641',
    tint: '#E3FAEF',
    dash: 'rgba(255,255,255,.95)',
    bubble: '#0F766E',
    names: ['green', 'lime', 'mint', 'emerald', 'olive'],
  },
  {
    frame: '#A78BFA',
    ink: '#4a2ca0',
    tint: '#F1EBFF',
    dash: 'rgba(255,255,255,.95)',
    bubble: '#4C1D95',
    names: ['purple', 'violet', 'lavender', 'lilac', 'indigo'],
  },
];

const SKIPPED_COLOR_NAMES = new Set([
  'white',
  'offwhite',
  'off-white',
  'ivory',
  'cream',
  'snow',
  'beige',
  'linen',
  'transparent',
  'none',
]);

export function isUnusableAssetColor(value: string): boolean {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return true;
  if (SKIPPED_COLOR_NAMES.has(text.replace(/\s+/g, ''))) return true;
  const hex = parseHexColor(text);
  if (!hex) return false;
  const min = Math.min(hex.r, hex.g, hex.b);
  const max = Math.max(hex.r, hex.g, hex.b);
  return min >= 230 && max >= 240;
}

export function resolveFlashcardBrandTheme(
  colors: string[] | null | undefined,
): FlashcardBrandTheme | null {
  for (const raw of colors || []) {
    const theme = matchBrandTheme(raw);
    if (theme) return theme;
  }
  return null;
}

export function resolveFlashcardBrandColor(
  colors: string[] | null | undefined,
): string | null {
  return resolveFlashcardBrandTheme(colors)?.frame ?? null;
}

export function matchBrandTheme(value: string): FlashcardBrandTheme | null {
  const text = String(value || '').trim().toLowerCase();
  if (!text || isUnusableAssetColor(text)) return null;
  const named = FLASHCARD_BRAND_THEMES.find((theme) =>
    theme.names.some((name) => text.includes(name)),
  );
  if (named) return named;
  const hex = parseHexColor(text);
  if (!hex) return null;
  let best = FLASHCARD_BRAND_THEMES[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const theme of FLASHCARD_BRAND_THEMES) {
    const brand = parseHexColor(theme.frame);
    if (!brand) continue;
    const distance =
      (hex.r - brand.r) ** 2 + (hex.g - brand.g) ** 2 + (hex.b - brand.b) ** 2;
    if (distance < bestDistance) {
      best = theme;
      bestDistance = distance;
    }
  }
  return best;
}

function parseHexColor(
  value: string,
): { r: number; g: number; b: number } | null {
  const match = value.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((ch) => ch + ch)
      .join('');
  }
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}
