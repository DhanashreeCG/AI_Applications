import { TemplateComponentDefinition } from '../interfaces/flashcard.interfaces';

export const DEFAULT_FLASHCARD_PROMPT_VERSION = 'v2';

export function buildFlashcardContentPrompt(input: {
  query: string;
  topic: string;
  ageMin: number;
  ageMax: number;
  learningObjective: string;
  count: number;
  textComponents: TemplateComponentDefinition[];
}): string {
  const ageLabel = `${input.ageMin}-${input.ageMax}`;

  const componentContract = input.textComponents
    .map(
      (component) =>
        `- "${component.componentId}" -> ${component.componentType}${component.required ? ' (required)' : ' (optional)'}`,
    )
    .join('\n');

  const exampleComponents = input.textComponents
    .map(
      (component) =>
        `        "${component.componentId}": "<${component.componentType} text>"`,
    )
    .join(',\n');

  return `You generate educational flashcard CONTENT only.

Rules:
- Return JSON only.
- Never invent UI layout, positioning, colors, fonts, or styling.
- Never choose templates.
- Keep language age-appropriate for ages ${ageLabel}.
- User request: ${input.query}
- Topic focus: ${input.topic}
- Learning objective: ${input.learningObjective}
- Produce exactly ${input.count} cards.
- Inside "components", use these exact keys verbatim. Do not rename, translate, or add keys:
${componentContract}
- Each card must include imageSearchQueries: 1-3 short search phrases for finding a matching educational illustration (object-first, child-friendly).

JSON shape:
{
  "cards": [
    {
      "cardIndex": 0,
      "components": {
${exampleComponents}
      },
      "imageSearchQueries": ["carrot vegetable cartoon"]
    }
  ]
}`;
}

/**
 * Gemini structured output ignores free-form maps, so the component keys are
 * pinned to the selected template's componentIds on every request.
 */
export function buildFlashcardContentSchema(
  textComponents: TemplateComponentDefinition[],
): Record<string, unknown> {
  const componentProperties: Record<string, { type: string }> = {};
  for (const component of textComponents) {
    componentProperties[component.componentId] = { type: 'string' };
  }

  const requiredComponentIds = textComponents
    .filter((component) => component.required)
    .map((component) => component.componentId);

  return {
    type: 'object',
    properties: {
      cards: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            cardIndex: { type: 'integer' },
            components: {
              type: 'object',
              properties: componentProperties,
              required: requiredComponentIds,
              propertyOrdering: textComponents.map(
                (component) => component.componentId,
              ),
            },
            imageSearchQueries: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          required: ['components', 'imageSearchQueries'],
          propertyOrdering: ['cardIndex', 'components', 'imageSearchQueries'],
        },
      },
    },
    required: ['cards'],
  };
}
