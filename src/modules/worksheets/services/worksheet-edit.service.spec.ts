import { EventEmitter2 } from '@nestjs/event-emitter';
import { WorksheetEditService } from './worksheet-edit.service';
import { PrismaService } from '../../database/prisma.service';
import { WorksheetTemplateService } from './worksheet-template.service';
import { WorksheetContentService } from './worksheet-content.service';
import { WorksheetValidationService } from './worksheet-validation.service';
import { WorksheetAssetService } from './worksheet-asset.service';
import { WorksheetException } from '../errors/worksheet.exception';

describe('WorksheetEditService', () => {
  const prisma = {
    worksheet: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  const templateService = {
    getById: jest.fn(),
    parseAiConfig: jest.fn(),
    parseFieldPrompts: jest.fn(),
    parseMeta: jest.fn(),
  };
  const contentService = {
    generateFieldReplacement: jest.fn(),
  };
  const validationService = {
    validateGeneratedStructure: jest.fn(),
  };
  const assetService = {
    resolveSlot: jest.fn(),
    applySlot: jest.fn(
      (structure: Record<string, unknown>, slot: { assetId?: string; imageUrl?: string; assetUrl?: string; signedUrl?: string }) => ({
        ...structure,
        items: [
          {
            ...((structure.items as Array<Record<string, unknown>>)[0] ?? {}),
            assetId: slot.assetId,
            imageUrl: slot.imageUrl,
            assetUrl: slot.assetUrl,
            signedUrl: slot.signedUrl,
          },
        ],
      }),
    ),
  };

  const eventEmitter = { emit: jest.fn() };

  let service: WorksheetEditService;

  const worksheet = {
    id: 'ws-1',
    templateId: 'tmpl-1',
    status: 'GENERATED',
    request: { topic: 'Counting' },
    structure: {
      instruction: 'Count the objects.',
      items: [{ count: 3, imageQuery: 'red apples', assetId: 'old-asset' }],
    },
  };

  const template = { id: 'tmpl-1', slug: 'counting_objects_v1', name: 'Counting', rendererType: 'generic', aiSystemPrompt: 'edit' };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WorksheetEditService(
      prisma as unknown as PrismaService,
      templateService as unknown as WorksheetTemplateService,
      contentService as unknown as WorksheetContentService,
      validationService as unknown as WorksheetValidationService,
      assetService as unknown as WorksheetAssetService,
      eventEmitter as unknown as EventEmitter2,
    );
    prisma.worksheet.findUnique.mockResolvedValue(worksheet);
    templateService.getById.mockResolvedValue(template);
    templateService.parseAiConfig.mockReturnValue({
      editableFields: ['instruction', 'items'],
    });
    templateService.parseFieldPrompts.mockReturnValue({
      instruction: 'Keep it short.',
    });
    templateService.parseMeta.mockReturnValue({});
    validationService.validateGeneratedStructure.mockImplementation(
      (value: unknown) => value,
    );
    prisma.worksheet.update.mockImplementation(async ({ data }: { data: { structure: unknown } }) => ({
      ...worksheet,
      structure: data.structure,
    }));
  });

  it('accepts an editable field and persists the Gemini replacement', async () => {
    contentService.generateFieldReplacement.mockResolvedValue('Count the fruit.');

    const result = await service.edit('ws-1', {
      field: 'instruction',
      instruction: 'Make this shorter.',
    });

    expect(contentService.generateFieldReplacement).toHaveBeenCalled();
    expect(result.structure.instruction).toBe('Count the fruit.');
    expect(assetService.resolveSlot).not.toHaveBeenCalled();
  });

  it('rejects a non-editable field', async () => {
    templateService.parseAiConfig.mockReturnValue({ editableFields: ['instruction'] });

    await expect(
      service.edit('ws-1', {
        field: 'secret',
        instruction: 'change it',
      }),
    ).rejects.toBeInstanceOf(WorksheetException);
  });

  it('re-resolves assets when an imageQuery is edited', async () => {
    contentService.generateFieldReplacement.mockResolvedValue('green grapes');
    assetService.resolveSlot.mockResolvedValue({
      path: 'items[0]',
      imageQuery: 'green grapes',
      assetId: 'asset-999',
      imageUrl: 'http://localhost:3000/worksheets/assets/asset-999/image',
      assetUrl: 'http://localhost:3000/worksheets/assets/asset-999/image',
      signedUrl: 'https://signed.example/img',
    });

    const result = await service.edit('ws-1', {
      fieldPath: 'items[0].imageQuery',
      instruction: 'Use grapes instead',
    });

    expect(assetService.resolveSlot).toHaveBeenCalledWith(
      'green grapes',
      'items[0]',
      expect.any(Object),
      expect.objectContaining({ workflowType: 'worksheets_edit' }),
    );
    expect(
      (result.structure.items as Array<Record<string, unknown>>)[0].assetId,
    ).toBe('asset-999');
  });
});
