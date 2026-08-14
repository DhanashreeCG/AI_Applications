import { WorksheetValidationService } from './worksheet-validation.service';
import { WorksheetTemplateRecord } from './worksheet-template.service';

function template(definition: Record<string, unknown>): WorksheetTemplateRecord {
  return {
    id: 'tmpl-1',
    name: 'Counting',
    slug: 'counting_objects_v1',
    category: 'numeracy',
    description: null,
    status: 'ACTIVE',
    version: 1,
    templateHtml: '<div></div>',
    structureDefinition: definition,
    meta: {},
    rendererType: 'generic',
    rendererConfig: null,
    aiConfig: null,
    fieldPrompts: null,
    aiSystemPrompt: null,
    backgroundAssetId: null,
    sampleAssetId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as WorksheetTemplateRecord;
}

const countingSchema = {
  type: 'object',
  required: ['instruction', 'items'],
  additionalProperties: false,
  properties: {
    instruction: { type: 'string', minLength: 1 },
    items: {
      type: 'array',
      minItems: 2,
      maxItems: 2,
      items: {
        type: 'object',
        required: ['count', 'imageQuery'],
        additionalProperties: false,
        properties: {
          count: { type: 'integer', minimum: 1, maximum: 10 },
          imageQuery: { type: 'string', minLength: 1 },
        },
      },
    },
  },
};

describe('WorksheetValidationService', () => {
  const service = new WorksheetValidationService();
  const tmpl = template(countingSchema);

  const valid = {
    instruction: 'Count the objects.',
    items: [
      { count: 3, imageQuery: 'red apples' },
      { count: 5, imageQuery: 'yellow bananas' },
    ],
  };

  it('accepts a valid structure', () => {
    expect(service.validateGeneratedStructure(valid, tmpl)).toEqual(valid);
  });

  it('rejects a missing required field', () => {
    expect(() =>
      service.validateGeneratedStructure({ items: valid.items }, tmpl),
    ).toThrow(/missing required field "instruction"/);
  });

  it('rejects an extra field when the schema is strict', () => {
    expect(() =>
      service.validateGeneratedStructure(
        { ...valid, extra: 'nope' },
        tmpl,
      ),
    ).toThrow(/unexpected field "extra"/);
  });

  it('rejects an invalid array length', () => {
    expect(() =>
      service.validateGeneratedStructure(
        { instruction: 'Count', items: [valid.items[0]] },
        tmpl,
      ),
    ).toThrow(/at least 2 items/);
  });

  it('rejects a file-name image query', () => {
    expect(() =>
      service.validateGeneratedStructure(
        {
          instruction: 'Count',
          items: [
            { count: 1, imageQuery: 'apple_23.png' },
            { count: 2, imageQuery: 'bananas' },
          ],
        },
        tmpl,
      ),
    ).toThrow(/must describe the image/);
  });

  it('allows assetId enrichment after retrieval but not signed URLs', () => {
    const enriched = {
      instruction: 'Count the objects.',
      items: [
        {
          count: 3,
          imageQuery: 'red apples',
          assetId: 'asset-1',
        },
        { count: 5, imageQuery: 'yellow bananas', assetId: 'asset-2' },
      ],
    };
    expect(
      service.validateGeneratedStructure(enriched, tmpl, {
        allowEnrichmentKeys: true,
      }),
    ).toEqual(enriched);
  });
});
