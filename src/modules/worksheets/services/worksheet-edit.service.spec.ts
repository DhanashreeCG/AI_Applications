import { EventEmitter2 } from '@nestjs/event-emitter';
import { WorksheetEditService } from './worksheet-edit.service';
import { PrismaService } from '../../database/prisma.service';
import { WorksheetTemplateService } from './worksheet-template.service';
import { WorksheetContentService } from './worksheet-content.service';
import { WorksheetValidationService } from './worksheet-validation.service';
import { WorksheetAssetService } from './worksheet-asset.service';
import { WorksheetRenderService } from './worksheet-render.service';
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
    generateStructure: jest.fn(),
  };
  const validationService = {
    validateGeneratedStructure: jest.fn(),
  };
  const assetService = {
    resolveSlot: jest.fn(),
    applySlot: jest.fn(
      (structure: Record<string, unknown>, slot: { assetId?: string }) => ({
        ...structure,
        items: [
          {
            ...((structure.items as Array<Record<string, unknown>>)[0] ?? {}),
            assetId: slot.assetId,
          },
        ],
      }),
    ),
    persistableStructure: (value: Record<string, unknown>) => value,
    resolveAsset: jest.fn(),
    attachAssets: jest.fn(),
    applyLibraryImage: jest.fn(
      (structure: Record<string, unknown>, path: string, assetId: string) => {
        const items = [...((structure.items as Array<Record<string, unknown>>) ?? [])];
        if (path.startsWith('items')) {
          items[0] = { ...(items[0] ?? {}), assetId };
          return { ...structure, items };
        }
        return { ...structure, [path]: { ...((structure[path] as object) ?? {}), assetId } };
      },
    ),
    applyUserUploadedImage: jest.fn(
      (structure: Record<string, unknown>, path: string, upload: { key: string }) => ({
        ...structure,
        [path]: {
          ...((structure[path] as object) ?? {}),
          assetId: null,
          userUploadedKey: upload.key,
        },
        userUploadedImages: { [path]: { key: upload.key } },
      }),
    ),
    uploadUserImage: jest.fn(),
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
      { composeHtml: () => ({ html: '<p>ok</p>', canvas: { width: 1016, height: 1316 } }) } as unknown as WorksheetRenderService,
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
    });

    const result = await service.edit('ws-1', {
      fieldPath: 'items[0].imageQuery',
      instruction: 'Use grapes instead',
    });

    expect(assetService.resolveSlot).toHaveBeenCalledWith(
      'green grapes',
      'items[0]',
      expect.any(Object),
    );
    expect(
      (result.structure.items as Array<Record<string, unknown>>)[0].assetId,
    ).toBe('asset-999');
  });

  it('saves text and image replacements in one write', async () => {
    assetService.resolveAsset.mockResolvedValue({ assetId: 'new-asset' });

    const result = await service.saveEdits('ws-1', {
      fields: [{ path: 'instruction', value: 'Count the fruit.' }],
      images: [{ path: 'items[0]', assetId: 'new-asset' }],
    });

    expect(assetService.applyLibraryImage).toHaveBeenCalledWith(
      expect.objectContaining({ instruction: 'Count the fruit.' }),
      'items[0]',
      'new-asset',
    );
    expect(prisma.worksheet.update).toHaveBeenCalled();
    expect(result.structure.instruction).toBe('Count the fruit.');
  });
});
