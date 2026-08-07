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

function assertExactComponentIds(
  actual: Record<string, unknown>,
  definitions: TemplateComponentDefinition[],
  cardIndex: number,
  field: 'textComponents' | 'imageComponents',
): void {
  const allowed = new Set(definitions.map((item) => item.componentId));

  for (const componentId of Object.keys(actual)) {
    if (!allowed.has(componentId)) {
      throw new FlashcardException(
        'INVALID_LLM_OUTPUT',
        `cards[${cardIndex}].${field} has unsupported component id "${componentId}"`,
        undefined,
        { expectedComponentIds: Array.from(allowed) },
      );
    }
  }

  for (const definition of definitions) {
    if (
      definition.required &&
      !Object.prototype.hasOwnProperty.call(actual, definition.componentId)
    ) {
      throw new FlashcardException(
        'INVALID_LLM_OUTPUT',
        `cards[${cardIndex}].${field} missing required component "${definition.componentId}"`,
        undefined,
        {
          expectedComponentIds: definitions.map((item) => item.componentId),
          receivedComponentIds: Object.keys(actual),
        },
      );
    }
  }
}

function validateTextComponents(
  raw: unknown,
  definitions: TemplateComponentDefinition[],
  cardIndex: number,
): Record<string, string> {
  if (!isRecord(raw)) {
    throw new FlashcardException(
      'INVALID_LLM_OUTPUT',
      `cards[${cardIndex}].textComponents must be an object keyed by the selected template componentId`,
    );
  }

  assertExactComponentIds(raw, definitions, cardIndex, 'textComponents');

  const content: Record<string, string> = {};
  for (const [componentId, value] of Object.entries(raw)) {
    const text = asString(value);
    if (!text) {
      throw new FlashcardException(
        'INVALID_LLM_OUTPUT',
        `cards[${cardIndex}].textComponents.${componentId} must be a non-empty string`,
      );
    }
    content[componentId] = text;
  }

  return content;
}

function validateImageQuery(
  raw: unknown,
  cardIndex: number,
  componentId: string,
): ImageSearchQuery {
  if (!isRecord(raw)) {
    throw new FlashcardException(
      'INVALID_LLM_OUTPUT',
      `cards[${cardIndex}].imageComponents.${componentId} must be an object`,
    );
  }

  const searchQuery = asString(raw.searchQuery);
  if (!searchQuery) {
    throw new FlashcardException(
      'INVALID_LLM_OUTPUT',
      `cards[${cardIndex}].imageComponents.${componentId}.searchQuery is required`,
    );
  }

  if (!Array.isArray(raw.expectedObjects)) {
    throw new FlashcardException(
      'INVALID_LLM_OUTPUT',
      `cards[${cardIndex}].imageComponents.${componentId}.expectedObjects must be an array`,
    );
  }

  const expectedObjects = raw.expectedObjects
    .map((item) => asString(item))
    .filter((item): item is string => Boolean(item));

  if (!expectedObjects.length) {
    throw new FlashcardException(
      'INVALID_LLM_OUTPUT',
      `cards[${cardIndex}].imageComponents.${componentId}.expectedObjects must contain at least one object`,
    );
  }

  return {
    searchQuery,
    expectedObjects,
    preferredStyle: asString(raw.preferredStyle) ?? undefined,
    preferredBackground: asString(raw.preferredBackground) ?? undefined,
    orientation: asString(raw.orientation) ?? undefined,
    educationalUse: asString(raw.educationalUse) ?? undefined,
  };
}

function validateImageComponents(
  raw: unknown,
  definitions: TemplateComponentDefinition[],
  cardIndex: number,
): Record<string, ImageSearchQuery> {
  if (!isRecord(raw)) {
    throw new FlashcardException(
      'INVALID_LLM_OUTPUT',
      `cards[${cardIndex}].imageComponents must be an object keyed by the selected template componentId`,
    );
  }

  assertExactComponentIds(raw, definitions, cardIndex, 'imageComponents');

  const content: Record<string, ImageSearchQuery> = {};
  for (const [componentId, value] of Object.entries(raw)) {
    content[componentId] = validateImageQuery(value, cardIndex, componentId);
  }
  return content;
}

function validateCard(
  raw: unknown,
  cardIndex: number,
  textComponents: TemplateComponentDefinition[],
  imageComponents: TemplateComponentDefinition[],
): LlmCardContent {
  if (!isRecord(raw)) {
    throw new FlashcardException(
      'INVALID_LLM_OUTPUT',
      `cards[${cardIndex}] must be an object`,
    );
  }

  if (
    raw.cardIndex !== undefined &&
    (!Number.isInteger(raw.cardIndex) || raw.cardIndex !== cardIndex)
  ) {
    throw new FlashcardException(
      'INVALID_LLM_OUTPUT',
      `cards[${cardIndex}].cardIndex must equal ${cardIndex}`,
    );
  }

  return {
    cardIndex,
    textComponents: validateTextComponents(
      raw.textComponents,
      textComponents,
      cardIndex,
    ),
    imageComponents: validateImageComponents(
      raw.imageComponents,
      imageComponents,
      cardIndex,
    ),
  };
}

export function validateLlmFlashcardPayload(
  raw: unknown,
  expectedCount: number,
  textComponents: TemplateComponentDefinition[],
  imageComponents: TemplateComponentDefinition[],
): LlmFlashcardPayload {
  if (
    isRecord(raw) &&
    (raw.layout ||
      raw.layoutDefinition ||
      raw.styling ||
      raw.template ||
      raw.renderingMetadata)
  ) {
    throw new FlashcardException(
      'INVALID_LLM_OUTPUT',
      'LLM response must contain template-bound educational content only',
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

  return {
    cards: raw.cards.map((card, index) =>
      validateCard(card, index, textComponents, imageComponents),
    ),
  };
}

/** Validate a single card payload (used for per-card regeneration). */
export function validateLlmCardContent(
  raw: unknown,
  cardIndex: number,
  textComponents: TemplateComponentDefinition[],
  imageComponents: TemplateComponentDefinition[],
): LlmCardContent {
  return {
    ...validateCard(raw, cardIndex, textComponents, imageComponents),
    cardIndex,
  };
}
