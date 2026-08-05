import {
  SelectedTemplatePayload,
  TemplateComponentDefinition,
} from '../interfaces/flashcard.interfaces';

export const DEFAULT_FLASHCARD_PROMPT_VERSION = 'v4-template-components';

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
  selectedTemplate: SelectedTemplatePayload;
  textComponents: TemplateComponentDefinition[];
  imageComponents: TemplateComponentDefinition[];
  grade?: string | null;
  subject?: string | null;
  difficulty?: string | null;
  language?: string;
}): string {
  const ageLabel = `${input.ageMin}-${input.ageMax}`;
  const language = input.language || 'English';

  const textContract = input.textComponents
    .map(
      (component) =>
        `- "${component.componentId}": type=${component.componentType}, region=${component.regionId ?? 'unspecified'}, ${component.required ? 'required' : 'optional'}, validation=${JSON.stringify(component.validationRules ?? {})}`,
    )
    .join('\n');

  const imageContract = input.imageComponents
    .map(
      (component) =>
        `- "${component.componentId}": type=image, region=${component.regionId ?? 'unspecified'}, ${component.required ? 'required' : 'optional'}, validation=${JSON.stringify(component.validationRules ?? {})}`,
    )
    .join('\n');

  const exampleTextComponents = input.textComponents
    .map(
      (component) =>
        `        "${component.componentId}": "<${component.componentType} content>"`,
    )
    .join(',\n');

  const exampleImageComponents = input.imageComponents
    .map(
      (component) => `        "${component.componentId}": {
          "searchQuery": "<precise semantic query for this image slot>",
          "expectedObjects": ["<primary expected object>"],
          "preferredStyle": "cartoon",
          "preferredBackground": "white",
          "orientation": "${input.selectedTemplate.orientation.toLowerCase()}",
          "educationalUse": "flashcard"
        }`,
    )
    .join(',\n');

  return `You generate educational flashcard CONTENT only.

Rules:
- Return JSON only.
- Never invent UI layout, positioning, colors, fonts, styling, or rendering metadata.
- Never choose templates.
- The backend already selected the template below. Treat its component IDs and types as the exact output contract.
- Generate one independent value for every required text component and one independent image search description for every required image component.
- Never reuse one image component's query as a substitute for another image component.
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

Selected template contract:
- Template ID: ${input.selectedTemplate.id}
- Template name: ${input.selectedTemplate.name}
- Template version: ${input.selectedTemplate.templateVersion}
- Template type: ${input.selectedTemplate.templateType}
- Layout type: ${input.selectedTemplate.layoutType}
- Orientation: ${input.selectedTemplate.orientation}

Produce exactly ${input.count} cards.
Inside "textComponents", use these exact component IDs verbatim. Do not rename, translate, omit required IDs, or add IDs:
${textContract || '- No text components in this template.'}

Inside "imageComponents", use these exact component IDs verbatim. Each ID represents a separate image requirement:
${imageContract || '- No image components in this template.'}

Every image component value must contain:
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
      "textComponents": {
${exampleTextComponents}
      },
      "imageComponents": {
${exampleImageComponents}
      }
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
  imageComponents: TemplateComponentDefinition[],
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

  const imageComponentProperties: Record<string, unknown> = {};
  for (const component of imageComponents) {
    imageComponentProperties[component.componentId] = imageQuerySchema;
  }

  const requiredImageComponentIds = imageComponents
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
            textComponents: {
              type: 'object',
              properties: componentProperties,
              required: requiredComponentIds,
              propertyOrdering: textComponents.map(
                (component) => component.componentId,
              ),
            },
            imageComponents: {
              type: 'object',
              properties: imageComponentProperties,
              required: requiredImageComponentIds,
              propertyOrdering: imageComponents.map(
                (component) => component.componentId,
              ),
            },
          },
          required: ['textComponents', 'imageComponents'],
          propertyOrdering: ['cardIndex', 'textComponents', 'imageComponents'],
        },
      },
    },
    required: ['cards'],
  };
}
