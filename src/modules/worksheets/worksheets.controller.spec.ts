import { Test } from '@nestjs/testing';
import { WorksheetsController } from './worksheets.controller';
import { WorksheetGenerationService } from './services/worksheet-generation.service';
import { WorksheetEditService } from './services/worksheet-edit.service';
import { WorksheetRenderService } from './services/worksheet-render.service';
import { WorksheetTemplateService } from './services/worksheet-template.service';
import { AssetImageService } from '../flashcards/services/asset-image.service';

describe('WorksheetsController', () => {
  const generationService = {
    generate: jest.fn(),
    generateSet: jest.fn(),
    list: jest.fn(),
    getById: jest.fn(),
    uiSettings: jest.fn(),
  };
  const editService = {
    edit: jest.fn(),
    replaceImage: jest.fn(),
    updateField: jest.fn(),
    searchImages: jest.fn(),
    saveEdits: jest.fn(),
    uploadImage: jest.fn(),
    loadUserUpload: jest.fn(),
  };
  const renderService = {
    render: jest.fn(),
    preview: jest.fn(),
  };
  const templateService = { create: jest.fn(), listCatalog: jest.fn() };
  const assetImageService = { loadImage: jest.fn() };

  let controller: WorksheetsController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [WorksheetsController],
      providers: [
        { provide: WorksheetGenerationService, useValue: generationService },
        { provide: WorksheetEditService, useValue: editService },
        { provide: WorksheetRenderService, useValue: renderService },
        { provide: WorksheetTemplateService, useValue: templateService },
        { provide: AssetImageService, useValue: assetImageService },
      ],
    }).compile();
    controller = moduleRef.get(WorksheetsController);
  });

  it('POST /worksheets/generate delegates to generation', async () => {
    generationService.generate.mockResolvedValue({ id: 'ws-1' });
    await expect(
      controller.generate({ topic: 'Counting', grade: 'LKG' }),
    ).resolves.toEqual({ id: 'ws-1' });
  });

  it('POST /worksheets/:id/edit delegates to edit', async () => {
    editService.edit.mockResolvedValue({ id: 'ws-1' });
    await expect(
      controller.edit('ws-1', { field: 'instruction', instruction: 'shorter' }),
    ).resolves.toEqual({ id: 'ws-1' });
  });

  it('POST /worksheets/:id/render delegates to render', async () => {
    renderService.render.mockResolvedValue({ format: 'pdf' });
    await expect(
      controller.render('ws-1', { format: 'pdf' }),
    ).resolves.toEqual({ format: 'pdf' });
  });

  it('GET /worksheets/:id/preview delegates to preview', async () => {
    renderService.preview.mockResolvedValue({ html: '<p>ok</p>' });
    await expect(controller.preview('ws-1', 'editor')).resolves.toEqual({
      html: '<p>ok</p>',
    });
  });

  it('POST /worksheets/templates delegates to template create', async () => {
    templateService.create.mockResolvedValue({ id: 'tmpl-1' });
    const background = { buffer: Buffer.from('bg'), originalname: 'bg.png' };
    const sample = { buffer: Buffer.from('ex'), originalname: 'ex.png' };
    await expect(
      controller.createTemplate(
        { name: 'Counting', slug: 'counting_objects_v1' } as never,
        { background: [background], sample: [sample] } as never,
      ),
    ).resolves.toEqual({ id: 'tmpl-1' });
    expect(templateService.create).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'counting_objects_v1' }),
      { background, sample },
    );
  });

  it('POST /worksheets/:id/save delegates to saveEdits', async () => {
    editService.saveEdits.mockResolvedValue({ id: 'ws-1' });
    await expect(
      controller.saveEdits('ws-1', {
        fields: [{ path: 'instruction', value: 'Count.' }],
        images: [{ path: 'image', assetId: 'asset-1' }],
      }),
    ).resolves.toEqual({ id: 'ws-1' });
  });
});
