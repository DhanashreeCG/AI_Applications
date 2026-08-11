export interface PageDimensions {
  width: number;
  height: number;
}

const PAGE_SIZES: Record<string, PageDimensions> = {
  A6: { width: 900, height: 1200 },
  A5: { width: 1200, height: 1697 },
  A4: { width: 1200, height: 1697 },
  LETTER: { width: 1200, height: 1545 },
};

export function resolvePageDimensions(
  pageSize: string | undefined,
  orientation: string | undefined,
): PageDimensions {
  const normalizedSize = (pageSize || 'A6').trim().toUpperCase();
  const base = PAGE_SIZES[normalizedSize] ?? PAGE_SIZES.A6;

  if ((orientation || 'PORTRAIT').trim().toUpperCase() === 'LANDSCAPE') {
    return { width: base.height, height: base.width };
  }

  return base;
}
