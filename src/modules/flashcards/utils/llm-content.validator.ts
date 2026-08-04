import { FlashcardException } from '../errors/flashcard.exception';
import {
  ImageSearchQuery,
  LlmCardContent,
  LlmFlashcardPayload,
  TemplateComponentDefinition,
} from '../interfaces/flashcard.interfaces';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() : null;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * The LLM occasionally answers with its own key spelling (`title`, `Title Word`)
 * instead of the template componentId, so keys are mapped back before validation.
 */
function resolveComponentId(
  key: string,
  definitions: TemplateComponentDefinition[],
): string | null {
  const exact = definitions.find(
    (definition) => definition.componentId === key,
  );
  if (exact) {
    return exact.componentId;
  }

  const normalized = normalizeKey(key);

  const byId = definitions.filter(
    (definition) => normalizeKey(definition.componentId) === normalized,
  );
  if (byId.length === 1) {
    return byId[0].componentId;
  }

  const byType = definitions.filter(
    (definition) => normalizeKey(definition.componentType) === normalized,
  );
  if (byType.length === 1) {
    return byType[0].componentId;
  }

  const byPartial = definitions.filter((definition) => {
    const normalizedId = normalizeKey(definition.componentId);
    return (
      normalizedId.includes(normalized) || normalized.includes(normalizedId)
    );
  });
  if (byPartial.length === 1) {
    return byPartial[0].componentId;
  }

  return null;
}

function normalizeCardComponents(
  raw: unknown,
  definitions: TemplateComponentDefinition[],
  cardIndex: number,
): Record<string, string> {
  const entries: Array<[string, unknown]> = [];

  if (isRecord(raw)) {
    entries.push(...Object.entries(raw));
  } else if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!isRecord(item)) {
        continue;
      }
      const key =
        asString(item.componentId) ??
        asString(item.id) ??
        asString(item.componentType) ??
        asString(item.type);
      if (key) {
        entries.push([key, item.content ?? item.text ?? item.value]);
      }
    }
  } else {
    throw new FlashcardException(
      'INVALID_LLM_OUTPUT',
      `cards[${cardIndex}].components must be an object keyed by componentId`,
    );
  }

  const components: Record<string, string> = {};
  for (const [key, value] of entries) {
    const text = asString(value);
    if (text === null) {
      throw new FlashcardException(
        'INVALID_LLM_OUTPUT',
        `cards[${cardIndex}].components.${key} must be a string`,
      );
    }
    if (!text) {
      throw new FlashcardException(
        'INVALID_LLM_OUTPUT',
        `cards[${cardIndex}].components.${key} must not be empty`,
      );
    }

    const resolvedId = resolveComponentId(key, definitions);
    if (!resolvedId) {
      throw new FlashcardException(
        'INVALID_LLM_OUTPUT',
        `cards[${cardIndex}] has unsupported component id "${key}"`,
        undefined,
        {
          expectedComponentIds: definitions.map((item) => item.componentId),
        },
      );
    }
    components[resolvedId] = text;
  }

  return components;
}

function normalizeImageSearchQuery(
  raw: unknown,
  cardIndex: number,
  queryIndex: number,
): ImageSearchQuery {
  // Backward compatible: plain string queries from older prompts.
  const asPlain = asString(raw);
  if (asPlain) {
    return {
      searchQuery: asPlain,
      expectedObjects: [],
      preferredStyle: 'cartoon',
      preferredBackground: 'white',
      orientation: 'portrait',
      educationalUse: 'flashcard',
    };
  }

  if (!isRecord(raw)) {
    throw new FlashcardException(
      'INVALID_LLM_OUTPUT',
      `cards[${cardIndex}].imageSearchQueries[${queryIndex}] must be an object`,
    );
  }

  const searchQuery = asString(raw.searchQuery);
  if (!searchQuery) {
    throw new FlashcardException(
      'INVALID_LLM_OUTPUT',
      `cards[${cardIndex}].imageSearchQueries[${queryIndex}].searchQuery is required`,
    );
  }

  const expectedRaw = raw.expectedObjects;
  const expectedObjects = Array.isArray(expectedRaw)
    ? expectedRaw
        .map((item) => asString(item))
        .filter((item): item is string => Boolean(item))
    : [];

  return {
    searchQuery,
    expectedObjects,
    preferredStyle: asString(raw.preferredStyle) ?? undefined,
    preferredBackground: asString(raw.preferredBackground) ?? undefined,
    orientation: asString(raw.orientation) ?? undefined,
    educationalUse: asString(raw.educationalUse) ?? undefined,
  };
}

export function validateLlmFlashcardPayload(
  raw: unknown,
  expectedCount: number,
  textComponents: TemplateComponentDefinition[],
): LlmFlashcardPayload {
  if (isRecord(raw) && (raw.layout || raw.layoutDefinition || raw.styling)) {
    throw new FlashcardException(
      'INVALID_LLM_OUTPUT',
      'LLM response must not include layout or styling information',
    );
  }

  if (!isRecord(raw) || !Array.isArray(raw.cards)) {
    throw new FlashcardException(
      'INVALID_LLM_OUTPUT',
      'LLM response must be JSON with a cards array',
    );
  }

  if (raw.cards.length !== expectedCount) {
    throw new FlashcardException(
      'INVALID_LLM_OUTPUT',
      `Expected ${expectedCount} cards, received ${raw.cards.length}`,
    );
  }

  const allowedIds = new Set(
    textComponents.map((component) => component.componentId),
  );

  const cards: LlmCardContent[] = raw.cards.map((card, index) => {
    if (!isRecord(card)) {
      throw new FlashcardException(
        'INVALID_LLM_OUTPUT',
        `cards[${index}] is not an object`,
      );
    }

    const components = normalizeCardComponents(
      card.components,
      textComponents,
      index,
    );

    for (const key of Object.keys(components)) {
      if (!allowedIds.has(key)) {
        throw new FlashcardException(
          'INVALID_LLM_OUTPUT',
          `cards[${index}] has unsupported component id "${key}"`,
        );
      }
    }

    for (const definition of textComponents) {
      if (definition.required && !components[definition.componentId]) {
        throw new FlashcardException(
          'INVALID_LLM_OUTPUT',
          `cards[${index}] missing required component "${definition.componentId}"`,
          undefined,
          {
            expectedComponentIds: textComponents.map(
              (item) => item.componentId,
            ),
            receivedKeys: Object.keys(components),
          },
        );
      }
    }

    const queriesRaw = card.imageSearchQueries;
    if (!Array.isArray(queriesRaw) || queriesRaw.length === 0) {
      throw new FlashcardException(
        'INVALID_LLM_OUTPUT',
        `cards[${index}].imageSearchQueries must be a non-empty array`,
      );
    }

    const imageSearchQueries = queriesRaw.map((query, queryIndex) =>
      normalizeImageSearchQuery(query, index, queryIndex),
    );

    return {
      cardIndex:
        typeof card.cardIndex === 'number' ? card.cardIndex : index,
      components,
      imageSearchQueries,
    };
  });

  return {
    cards,
    resolvedLearningObjective:
      asString(raw.resolvedLearningObjective) ?? undefined,
  };
}

/** Validate a single card payload (used for per-card regeneration). */
export function validateLlmCardContent(
  raw: unknown,
  cardIndex: number,
  textComponents: TemplateComponentDefinition[],
): LlmCardContent {
  const wrapped = validateLlmFlashcardPayload(
    { cards: [raw] },
    1,
    textComponents,
  );
  return {
    ...wrapped.cards[0],
    cardIndex,
  };
}
