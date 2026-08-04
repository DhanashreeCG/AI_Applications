import { TemplateComponentDefinition } from '../interfaces/flashcard.interfaces';

export const DEFAULT_FLASHCARD_PROMPT_VERSION = 'v3';

function ageBandGuidance(ageMin: number, ageMax: number): string {
  const midpoint = (ageMin + ageMax) / 2;
  if (midpoint <= 3) {
    return 'Ages 2–3: single word labels only; very simple vocabulary.';
  }
  if (midpoint <= 4) {
    return 'Ages 3–4: single word + one short simple sentence.';
  }
  if (midpoint <= 6) {
    return 'Ages 5–6: word + one short educational fact.';
  }
  if (midpoint <= 8) {
    return 'Ages 6–8: short description + a recognition question when a question component exists.';
  }
  return 'Ages 8+: factual description + a reasoning question when a question component exists.';
}

export function buildFlashcardContentPrompt(input: {
  query: string;
  topic: string;
  ageMin: number;
  ageMax: number;
  learningObjective: string;
  count: number;
  textComponents: TemplateComponentDefinition[];
  grade?: string | null;
  subject?: string | null;
  difficulty?: string | null;
  language?: string;
}): string {
  const ageLabel = `${input.ageMin}-${input.ageMax}`;
  const language = input.language || 'English';

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
- Never invent UI layout, positioning, colors, fonts, styling, or rendering metadata.
- Never choose templates.
- Never return image filenames — only semantic image search fields.
- Keep language age-appropriate for ages ${ageLabel}.
- Write all educational text in ${language}.
- ${ageBandGuidance(input.ageMin, input.ageMax)}
- Maximize educational variety. Do NOT always reuse the same canonical examples (e.g. A→Apple/Ball/Cat, or Potato/Tomato/Carrot). Rotate equally valid age-appropriate alternatives when they exist.
- Content must be factually correct, concise, curriculum-aligned, and visually teachable.

Learner profile:
- User request: ${input.query}
- Topic focus: ${input.topic}
- Grade: ${input.grade ?? 'unspecified'}
- Age group: ${ageLabel}
- Subject: ${input.subject ?? 'unspecified'}
- Difficulty: ${input.difficulty ?? 'unspecified'}
- Educational objective: ${input.learningObjective}
- Language: ${language}

Produce exactly ${input.count} cards.
Inside "components", use these exact keys verbatim. Do not rename, translate, or add keys:
${componentContract}

Each card must include imageSearchQueries: an array with one object per image (usually one) containing:
- searchQuery: short precise semantic query (object-first, child-friendly)
- expectedObjects: array of expected object names
- preferredStyle: e.g. cartoon
- preferredBackground: e.g. white
- orientation: e.g. portrait
- educationalUse: flashcard

JSON shape:
{
  "cards": [
    {
      "cardIndex": 0,
      "components": {
${exampleComponents}
      },
      "imageSearchQueries": [
        {
          "searchQuery": "cartoon green broccoli",
          "expectedObjects": ["broccoli"],
          "preferredStyle": "cartoon",
          "preferredBackground": "white",
          "orientation": "portrait",
          "educationalUse": "flashcard"
        }
      ]
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

  const imageQuerySchema = {
    type: 'object',
    properties: {
      searchQuery: { type: 'string' },
      expectedObjects: {
        type: 'array',
        items: { type: 'string' },
      },
      preferredStyle: { type: 'string' },
      preferredBackground: { type: 'string' },
      orientation: { type: 'string' },
      educationalUse: { type: 'string' },
    },
    required: ['searchQuery', 'expectedObjects'],
    propertyOrdering: [
      'searchQuery',
      'expectedObjects',
      'preferredStyle',
      'preferredBackground',
      'orientation',
      'educationalUse',
    ],
  };

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
              items: imageQuerySchema,
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
