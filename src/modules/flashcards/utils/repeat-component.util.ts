import { FlashcardException } from '../errors/flashcard.exception';
import { TemplateComponentDefinition } from '../interfaces/flashcard.interfaces';

/** True when the registered componentId is a repeat placeholder (e.g. num-{x}). */
export function isRepeatPlaceholderId(componentId: string): boolean {
  return componentId.includes('{x}');
}

/**
 * Extracts the base prefix for a `{x}` componentId.
 * `num-{x}` → `num`, `reading-{x}` → `reading`.
 */
export function getRepeatBase(templatedComponentId: string): string {
  if (templatedComponentId.endsWith('-{x}')) {
    return templatedComponentId.slice(0, -'{x}'.length - 1);
  }
  return templatedComponentId.replace('{x}', '').replace(/-$/, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Builds /^{base}-\d+$/ for matching expanded ids like num-1, num-2. */
export function buildIndexedIdPattern(base: string): RegExp {
  return new RegExp(`^${escapeRegExp(base)}-\\d+$`);
}

export function parseIndexedSuffix(componentId: string, base: string): number {
  return Number.parseInt(componentId.slice(base.length + 1), 10);
}

/**
 * Collects concrete ids matching a `{x}` definition from a set of available
 * keys, sorted by numeric suffix ascending.
 */
export function collectIndexedComponentIds(
  templatedComponentId: string,
  availableIds: Iterable<string>,
): string[] {
  const base = getRepeatBase(templatedComponentId);
  const pattern = buildIndexedIdPattern(base);
  return Array.from(availableIds)
    .filter((componentId) => pattern.test(componentId))
    .sort(
      (a, b) => parseIndexedSuffix(a, base) - parseIndexedSuffix(b, base),
    );
}

/**
 * Expands template definitions for a single card: non-{x} ids pass through;
 * `{x}` placeholders become one concrete definition per matched id in
 * `availableIds` (e.g. num-{x} → num-1..num-N).
 */
export function expandDefinitionsForAvailableIds(
  definitions: TemplateComponentDefinition[],
  availableIds: Iterable<string>,
): TemplateComponentDefinition[] {
  const available = Array.from(availableIds);
  const expanded: TemplateComponentDefinition[] = [];

  for (const definition of definitions) {
    if (!isRepeatPlaceholderId(definition.componentId)) {
      expanded.push(definition);
      continue;
    }

    const matchedIds = collectIndexedComponentIds(
      definition.componentId,
      available,
    );
    for (const componentId of matchedIds) {
      expanded.push({
        ...definition,
        componentId,
      });
    }
  }

  return expanded;
}

/**
 * Validates that matched indexed ids form a contiguous run starting at 1
 * (e.g. num-1..num-N). Reports the first gap specifically (e.g. "num-2 missing").
 */
export function assertContiguousIndexedIds(
  matchedIds: string[],
  templatedComponentId: string,
  contextLabel: string,
): void {
  const base = getRepeatBase(templatedComponentId);
  const indices = matchedIds.map((componentId) => {
    const index = parseIndexedSuffix(componentId, base);
    if (!Number.isInteger(index) || index < 1) {
      throw new FlashcardException(
        'INVALID_LLM_OUTPUT',
        `${contextLabel} has invalid indexed component id "${componentId}" (expected ${base}-1, ${base}-2, …)`,
        undefined,
        {
          templatedComponentId,
          base,
          receivedComponentIds: matchedIds,
        },
      );
    }
    return index;
  }).sort((a, b) => a - b);

  if (indices.length === 0) {
    return;
  }

  const max = indices[indices.length - 1];
  const present = new Set(indices);

  for (let expected = 1; expected <= max; expected += 1) {
    if (!present.has(expected)) {
      throw new FlashcardException(
        'INVALID_LLM_OUTPUT',
        `${contextLabel} ${base}-${expected} missing (indexed component "${templatedComponentId}" requires a contiguous run ${base}-1..${base}-${max})`,
        undefined,
        {
          templatedComponentId,
          base,
          receivedComponentIds: matchedIds,
          missingComponentId: `${base}-${expected}`,
        },
      );
    }
  }
}

/**
 * Resolve which template definition owns a concrete componentId.
 * Exact (non-{x}) ids win; otherwise the first `{x}` definition whose
 * ^{base}-\d+$ pattern matches.
 */
export function resolveTemplateDefinition(
  componentId: string,
  definitions: TemplateComponentDefinition[],
): TemplateComponentDefinition | undefined {
  for (const definition of definitions) {
    if (isRepeatPlaceholderId(definition.componentId)) {
      continue;
    }
    if (definition.componentId === componentId) {
      return definition;
    }
  }

  for (const definition of definitions) {
    if (!isRepeatPlaceholderId(definition.componentId)) {
      continue;
    }
    const base = getRepeatBase(definition.componentId);
    if (buildIndexedIdPattern(base).test(componentId)) {
      return definition;
    }
  }

  return undefined;
}
