import { FlashcardException } from '../errors/flashcard.exception';
import {
  ImageSearchQuery,
  LlmCardContent,
  LlmFlashcardPayload,
  TemplateComponentDefinition,
} from '../interfaces/flashcard.interfaces';
import {
  assertContiguousIndexedIds,
  buildIndexedIdPattern,
  getRepeatBase,
  isRepeatPlaceholderId,
  resolveTemplateDefinition,
} from './repeat-component.util';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() : null;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function assertExactComponentIds(
  actual: Record<string, unknown>,
  definitions: TemplateComponentDefinition[],
  cardIndex: number,
  field: 'textComponents' | 'imageComponents',
): void {
  const exactDefinitions = definitions.filter(
    (item) => !isRepeatPlaceholderId(item.componentId),
  );
  const repeatDefinitions = definitions.filter((item) =>
    isRepeatPlaceholderId(item.componentId),
  );

  const exactAllowed = new Set(
    exactDefinitions.map((item) => item.componentId),
  );
  const placeholderIds = new Set(
    repeatDefinitions.map((item) => item.componentId),
  );
  const matchedByTemplate = new Map<string, string[]>();

  for (const componentId of Object.keys(actual)) {
    // Placeholder strings are never valid LLM output keys.
    if (placeholderIds.has(componentId)) {
      const base = getRepeatBase(componentId);
      throw new FlashcardException(
        'INVALID_LLM_OUTPUT',
        `cards[${cardIndex}].${field} must not use placeholder id "${componentId}"; expected concrete ids matching ^${base}-\\d+$ (e.g. ${base}-1, ${base}-2)`,
        undefined,
        {
          templatedComponentId: componentId,
          receivedComponentIds: Object.keys(actual),
        },
      );
    }

    if (exactAllowed.has(componentId)) {
      continue;
    }

    let matchedTemplate: TemplateComponentDefinition | undefined;
    for (const definition of repeatDefinitions) {
      const base = getRepeatBase(definition.componentId);
      if (buildIndexedIdPattern(base).test(componentId)) {
        matchedTemplate = definition;
        break;
      }
    }

    if (!matchedTemplate) {
      const expectedPatterns = [
        ...exactDefinitions.map((item) => item.componentId),
        ...repeatDefinitions.map((item) => {
          const base = getRepeatBase(item.componentId);
          return `${base}-1..${base}-N (from ${item.componentId})`;
        }),
      ];
      throw new FlashcardException(
        'INVALID_LLM_OUTPUT',
        `cards[${cardIndex}].${field} has unsupported component id "${componentId}"`,
        undefined,
        { expectedComponentIds: expectedPatterns },
      );
    }

    const list = matchedByTemplate.get(matchedTemplate.componentId) ?? [];
    list.push(componentId);
    matchedByTemplate.set(matchedTemplate.componentId, list);
  }

  for (const definition of exactDefinitions) {
    if (definition.required && !hasOwn(actual, definition.componentId)) {
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

  for (const definition of repeatDefinitions) {
    const base = getRepeatBase(definition.componentId);
    const matched = matchedByTemplate.get(definition.componentId) ?? [];

    if (definition.required && matched.length === 0) {
      throw new FlashcardException(
        'INVALID_LLM_OUTPUT',
        `cards[${cardIndex}].${field} missing required indexed components for "${definition.componentId}" (expected ${base}-1..${base}-N)`,
        undefined,
        {
          templatedComponentId: definition.componentId,
          expectedPattern: `^${base}-\\d+$`,
          receivedComponentIds: Object.keys(actual),
        },
      );
    }

    assertContiguousIndexedIds(
      matched,
      definition.componentId,
      `cards[${cardIndex}].${field}`,
    );
  }
}

/**
 * Applies a component's validationRules to a single text value.
 * Used for both exact and expanded indexed instances.
 */
function assertTextValidationRules(
  text: string,
  componentId: string,
  rules: Record<string, unknown> | undefined,
  cardIndex: number,
): void {
  if (!rules) {
    return;
  }

  const maxCharacters =
    typeof rules.maxCharacters === 'number'
      ? rules.maxCharacters
      : typeof rules.maxLength === 'number'
        ? rules.maxLength
        : undefined;

  if (typeof maxCharacters === 'number' && text.length > maxCharacters) {
    throw new FlashcardException(
      'INVALID_LLM_OUTPUT',
      `cards[${cardIndex}].textComponents.${componentId} exceeds maxCharacters=${maxCharacters} (got ${text.length} characters)`,
      undefined,
      { componentId, rule: 'maxCharacters', maxCharacters, actualLength: text.length },
    );
  }

  const minCharacters =
    typeof rules.minCharacters === 'number'
      ? rules.minCharacters
      : typeof rules.minLength === 'number'
        ? rules.minLength
        : undefined;

  if (typeof minCharacters === 'number' && text.length < minCharacters) {
    throw new FlashcardException(
      'INVALID_LLM_OUTPUT',
      `cards[${cardIndex}].textComponents.${componentId} below minCharacters=${minCharacters} (got ${text.length} characters)`,
      undefined,
      { componentId, rule: 'minCharacters', minCharacters, actualLength: text.length },
    );
  }

  if (typeof rules.pattern === 'string') {
    let regex: RegExp;
    try {
      regex = new RegExp(rules.pattern);
    } catch {
      throw new FlashcardException(
        'INVALID_LLM_OUTPUT',
        `cards[${cardIndex}].textComponents.${componentId} has invalid validationRules.pattern`,
        undefined,
        { componentId, rule: 'pattern', pattern: rules.pattern },
      );
    }
    if (!regex.test(text)) {
      throw new FlashcardException(
        'INVALID_LLM_OUTPUT',
        `cards[${cardIndex}].textComponents.${componentId} does not match validationRules.pattern=${JSON.stringify(rules.pattern)}`,
        undefined,
        { componentId, rule: 'pattern', pattern: rules.pattern },
      );
    }
  }

  if (Array.isArray(rules.enum) && rules.enum.length > 0) {
    const allowed = rules.enum.filter(
      (item): item is string => typeof item === 'string',
    );
    if (allowed.length > 0 && !allowed.includes(text)) {
      throw new FlashcardException(
        'INVALID_LLM_OUTPUT',
        `cards[${cardIndex}].textComponents.${componentId} is not in validationRules.enum`,
        undefined,
        { componentId, rule: 'enum', allowed },
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

    const definition = resolveTemplateDefinition(componentId, definitions);
    assertTextValidationRules(
      text,
      componentId,
      definition?.validationRules,
      cardIndex,
    );

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
