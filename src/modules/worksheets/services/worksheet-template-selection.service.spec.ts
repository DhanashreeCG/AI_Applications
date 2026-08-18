import { WorksheetTemplateSelectionService } from './worksheet-template-selection.service';
import { WorksheetTemplateService } from './worksheet-template.service';
import { WorksheetTemplateRecord } from './worksheet-template.service';

function template(
  overrides: Partial<WorksheetTemplateRecord> & { meta?: unknown } = {},
): WorksheetTemplateRecord {
  return {
    id: overrides.id ?? 'tmpl-1',
    name: overrides.name ?? 'Counting Objects',
    slug: overrides.slug ?? 'counting_objects_v1',
    category: overrides.category ?? 'numeracy',
    description: null,
    status: overrides.status ?? 'ACTIVE',
    version: 1,
    templateHtml: '<html></html>',
    structureDefinition: {},
    meta: overrides.meta ?? {
      grades: ['LKG', 'UKG'],
      subjects: ['Math'],
      topics: ['Counting'],
      ageMin: 3,
      ageMax: 6,
      difficulty: ['easy', 'medium'],
    },
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

describe('WorksheetTemplateSelectionService', () => {
  const templateService = {
    getActiveByIdOrSlug: jest.fn(),
    listActive: jest.fn(),
    parseMeta: (row: WorksheetTemplateRecord) =>
      (row.meta ?? {}) as Record<string, unknown>,
  };

  let service: WorksheetTemplateSelectionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WorksheetTemplateSelectionService(
      templateService as unknown as WorksheetTemplateService,
    );
  });

  it('selects an eligible template by grade/subject/topic', async () => {
    const counting = template();
    const phonics = template({
      id: 'tmpl-2',
      slug: 'phonics_v1',
      meta: {
        grades: ['LKG'],
        subjects: ['English'],
        topics: ['Phonics'],
      },
    });
    templateService.listActive.mockResolvedValue([phonics, counting]);

    const selected = await service.select({
      grade: 'LKG',
      subject: 'Math',
      topic: 'Counting',
    });

    expect(selected.slug).toBe('counting_objects_v1');
  });

  it('throws when no matching template exists', async () => {
    templateService.listActive.mockResolvedValue([template()]);

    await expect(
      service.select({
        grade: 'Grade 5',
        subject: 'Science',
        topic: 'Planets',
      }),
    ).rejects.toMatchObject({ code: 'NO_TEMPLATE_FOUND' });
  });

  it('uses an explicit templateId without ranking', async () => {
    const explicit = template({ id: 'explicit', slug: 'explicit_v1' });
    templateService.getActiveByIdOrSlug.mockResolvedValue(explicit);

    const selected = await service.select({ templateId: 'explicit_v1' });
    expect(selected.id).toBe('explicit');
    expect(templateService.listActive).not.toHaveBeenCalled();
  });
});
