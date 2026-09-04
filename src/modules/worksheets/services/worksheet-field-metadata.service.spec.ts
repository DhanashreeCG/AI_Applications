import { WorksheetFieldMetadataService } from './worksheet-field-metadata.service';
import { WorksheetTemplateRecord } from './worksheet-template.service';

describe('WorksheetFieldMetadataService', () => {
  const service = new WorksheetFieldMetadataService();

  const template = {
    aiConfig: {
      editableFields: ['instruction', 'items'],
      fieldPrompts: { instruction: 'should not leak into fields' },
    },
    fieldPrompts: { instruction: 'Keep it short.' },
    structureDefinition: {
      type: 'object',
      properties: {
        instruction: { type: 'string' },
        items: { type: 'array' },
      },
    },
  } as unknown as WorksheetTemplateRecord;

  it('normalizes type, path, editable, and aiEditable without mixing fieldPrompts', () => {
    const fields = service.normalize(template, {
      instruction: 'Count',
      items: [{ count: 1, imageQuery: 'apples', assetId: 'a1' }],
    });

    expect(fields.find((field) => field.path === 'instruction')).toEqual(
      expect.objectContaining({
        type: 'text',
        path: 'instruction',
        editable: true,
        aiEditable: true,
      }),
    );
    expect(fields.find((field) => field.path === 'items')).toEqual(
      expect.objectContaining({
        type: 'array',
        editable: true,
        aiEditable: true,
      }),
    );
    expect(fields.find((field) => field.path === 'items[0]')).toEqual(
      expect.objectContaining({
        type: 'image',
        path: 'items[0]',
      }),
    );
    expect(JSON.stringify(fields)).not.toContain('Keep it short');
  });
});
