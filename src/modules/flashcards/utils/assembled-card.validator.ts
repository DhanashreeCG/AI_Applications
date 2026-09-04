import { FlashcardException } from '../errors/flashcard.exception';
import {
  EditableComponentPayload,
  TemplateComponentDefinition,
} from '../interfaces/flashcard.interfaces';
import {
  assertContiguousIndexedIds,
  buildIndexedIdPattern,
  getRepeatBase,
  isRepeatPlaceholderId,
} from './repeat-component.util';

/**
 * Walks the selected template's editable components in order and matches
 * them against the assembled card:
 * - non-{x} ids must appear exactly once, in template order
 * - `{x}` placeholders consume a contiguous run of ^{base}-\d+$ ids
 *   (e.g. num-1..num-N) in that slot, inheriting the placeholder's type /
 *   editable / required flags
 *
 * Exact-id templates are unchanged: length + order still must match 1:1.
 */
export function assertAssembledCardComponents(
  cardId: string,
  components: EditableComponentPayload[],
  editableComponents: TemplateComponentDefinition[],
): void {
  let cursor = 0;

  for (const definition of editableComponents) {
    if (!isRepeatPlaceholderId(definition.componentId)) {
      const component = components[cursor];
      if (!component || component.componentId !== definition.componentId) {
        throw new FlashcardException(
          'INVALID_LLM_OUTPUT',
          `Card "${cardId}" missing required component "${definition.componentId}" at position ${cursor}`,
          undefined,
          {
            expectedComponentId: definition.componentId,
            actualComponentId: component?.componentId ?? null,
            actualIds: components.map((item) => item.componentId),
          },
        );
      }
      assertComponentMatchesDefinition(cardId, component, definition);
      cursor += 1;
      continue;
    }

    const base = getRepeatBase(definition.componentId);
    const pattern = buildIndexedIdPattern(base);
    const matched: EditableComponentPayload[] = [];

    while (
      cursor < components.length &&
      pattern.test(components[cursor].componentId)
    ) {
      const component = components[cursor];
      assertComponentMatchesDefinition(cardId, component, definition);
      matched.push(component);
      cursor += 1;
    }

    if (definition.required && matched.length === 0) {
      throw new FlashcardException(
        'INVALID_LLM_OUTPUT',
        `Card "${cardId}" missing required indexed components for "${definition.componentId}" (expected ${base}-1..${base}-N)`,
        undefined,
        {
          templatedComponentId: definition.componentId,
          expectedPattern: `^${base}-\\d+$`,
          actualIds: components.map((item) => item.componentId),
        },
      );
    }

    assertContiguousIndexedIds(
      matched.map((item) => item.componentId),
      definition.componentId,
      `Card "${cardId}"`,
    );
  }

  if (cursor !== components.length) {
    const unexpected = components
      .slice(cursor)
      .map((item) => item.componentId);
    throw new FlashcardException(
      'INVALID_LLM_OUTPUT',
      `Card "${cardId}" has unexpected components after template match: ${unexpected.join(', ')}`,
      undefined,
      {
        unexpectedComponentIds: unexpected,
        actualIds: components.map((item) => item.componentId),
      },
    );
  }
}

function assertComponentMatchesDefinition(
  cardId: string,
  component: EditableComponentPayload,
  definition: TemplateComponentDefinition,
): void {
  if (
    component.type !== definition.componentType ||
    component.componentType !== definition.componentType ||
    component.editable !== definition.editable
  ) {
    throw new FlashcardException(
      'INVALID_LLM_OUTPUT',
      `Card "${cardId}" component "${component.componentId}" does not match its selected template definition`,
      undefined,
      {
        componentId: component.componentId,
        expectedType: definition.componentType,
        actualType: component.componentType,
        expectedEditable: definition.editable,
        actualEditable: component.editable,
      },
    );
  }

  if (
    definition.componentType !== 'image' &&
    definition.required &&
    !component.content?.trim()
  ) {
    throw new FlashcardException(
      'INVALID_LLM_OUTPUT',
      `Card "${cardId}" required text component "${component.componentId}" has no content`,
    );
  }

  if (
    definition.componentType === 'image' &&
    definition.required &&
    component.assetReference === undefined
  ) {
    throw new FlashcardException(
      'INVALID_LLM_OUTPUT',
      `Card "${cardId}" required image component "${component.componentId}" has no retrieval result`,
    );
  }
}
