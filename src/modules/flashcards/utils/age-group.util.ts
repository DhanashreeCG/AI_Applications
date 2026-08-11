export function parseAgeGroupBounds(
  groups: string[],
): { min: number; max: number } | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const group of groups) {
    const match = group.match(/(\d+)\s*-\s*(\d+)/);
    if (!match) {
      continue;
    }
    min = Math.min(min, Number(match[1]));
    max = Math.max(max, Number(match[2]));
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return null;
  }

  return { min, max };
}
