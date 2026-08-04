export interface LayoutExtras {
  editableComponents: unknown;
  componentHierarchy: unknown;
  componentConstraints: unknown;
  renderingHints: unknown;
  defaultStyles: unknown;
}

/**
 * Editable/layout extras live inside layoutDefinition JSON after the
 * FlashcardTemplate redesign (no dedicated columns).
 */
export function extractLayoutExtras(layoutDefinition: unknown): LayoutExtras {
  const layout =
    layoutDefinition && typeof layoutDefinition === 'object'
      ? (layoutDefinition as Record<string, unknown>)
      : {};

  return {
    editableComponents: layout.editableComponents ?? [],
    componentHierarchy: layout.componentHierarchy ?? [],
    componentConstraints: layout.componentConstraints ?? null,
    renderingHints: layout.renderingHints ?? null,
    defaultStyles: layout.defaultStyles ?? null,
  };
}

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

export function buildLayoutDefinition(input: {
  root: string;
  slots: Array<{ componentId: string; role: string }>;
  editableComponents: unknown;
  componentHierarchy: unknown;
  renderingHints?: unknown;
  componentConstraints?: unknown;
  defaultStyles?: unknown;
}): Record<string, unknown> {
  return {
    root: input.root,
    slots: input.slots,
    editableComponents: input.editableComponents,
    componentHierarchy: input.componentHierarchy,
    ...(input.renderingHints !== undefined
      ? { renderingHints: input.renderingHints }
      : {}),
    ...(input.componentConstraints !== undefined
      ? { componentConstraints: input.componentConstraints }
      : {}),
    ...(input.defaultStyles !== undefined
      ? { defaultStyles: input.defaultStyles }
      : {}),
  };
}
