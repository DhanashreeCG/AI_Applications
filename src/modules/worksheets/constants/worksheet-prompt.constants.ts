import { GenerateWorksheetRequest } from '../types/worksheet.types';

export function buildWorksheetContentPrompt(input: {
  request: GenerateWorksheetRequest;
  templateName: string;
  templateSlug: string;
  templateDescription?: string | null;
  structureDefinition: unknown;
  meta: unknown;
}): string {
  const request = input.request;
  const userRequest =
    request.query?.trim() ||
    [
      request.topic && `Topic: ${request.topic}`,
      request.subject && `Subject: ${request.subject}`,
      request.grade && `Grade: ${request.grade}`,
      request.age != null && `Age: ${request.age}`,
      request.difficulty && `Difficulty: ${request.difficulty}`,
    ]
      .filter(Boolean)
      .join('\n');

  return [
    'You generate educational worksheet CONTENT only.',
    'Return a single JSON object that matches the template structure definition.',
    'Do not generate HTML, CSS, JavaScript, layout, positions, or asset IDs.',
    'Do not invent image file names. Describe needed images with imageQuery strings.',
    'Every imageQuery must be a short visual search phrase (e.g. "three red apples").',
    'All text fields must be plain text suitable for young learners.',
    `Language: ${request.language?.trim() || 'English'}`,
    '',
    `Template: ${input.templateName} (${input.templateSlug})`,
    input.templateDescription ? `Description: ${input.templateDescription}` : '',
    '',
    'Educational request:',
    userRequest || 'Generate age-appropriate worksheet content for the selected template.',
    '',
    'Template metadata:',
    JSON.stringify(input.meta ?? {}, null, 2),
    '',
    'Structure definition (JSON Schema). Your output MUST conform:',
    JSON.stringify(input.structureDefinition, null, 2),
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export function buildWorksheetEditPrompt(input: {
  systemPrompt?: string | null;
  fieldPath: string;
  fieldPrompt?: string | null;
  instruction: string;
  currentValue: unknown;
  worksheetStructure: unknown;
  linkedValues: Record<string, unknown>;
}): string {
  const system =
    input.systemPrompt?.trim() ||
    'You edit a single worksheet field. Return JSON only. Do not generate HTML or CSS.';

  return [
    system,
    '',
    `Edit field: ${input.fieldPath}`,
    input.fieldPrompt ? `Field guidance: ${input.fieldPrompt}` : '',
    `User instruction: ${input.instruction}`,
    '',
    'Current field value:',
    JSON.stringify(input.currentValue, null, 2),
    '',
    Object.keys(input.linkedValues).length
      ? `Linked field values:\n${JSON.stringify(input.linkedValues, null, 2)}`
      : '',
    '',
    'Full worksheet structure (context only; do not rewrite unrelated fields):',
    JSON.stringify(input.worksheetStructure, null, 2),
    '',
    'Return JSON of the form {"value": <replacement>}.',
    'The replacement must be the new value for this field only.',
    'If the field uses images, keep or update imageQuery as a visual search phrase, never a filename.',
    'Plain text only. No HTML, CSS, or JavaScript.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}
