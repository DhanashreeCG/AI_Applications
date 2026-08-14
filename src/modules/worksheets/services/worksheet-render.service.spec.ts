import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { S3StorageService } from '../../storage/s3-storage.service';
import { BrowserPoolService } from '../../flashcards/flashcard-renderer/browser/browser-pool.service';
import { WorksheetRendererRegistry } from '../renderers/worksheet-renderer.registry';
import { WorksheetTemplateService } from './worksheet-template.service';
import { WorksheetRenderService } from './worksheet-render.service';
import { GenericWorksheetRenderer } from '../renderers/generic-worksheet.renderer';

describe('WorksheetRenderService', () => {
  const prisma = {
    worksheet: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    worksheetOutput: {
      create: jest.fn(),
    },
  };
  const templateService = {
    getById: jest.fn(),
    parseRendererConfig: jest.fn(),
  };
  const configService = {
    get: (key: string) => {
      if (key === 'worksheets.renderer.enabled') return true;
      if (key === 'worksheets.renderer.apiBaseUrl') return 'http://localhost:3000';
      if (key === 'worksheets.renderer.defaultWidth') return 794;
      if (key === 'worksheets.renderer.defaultHeight') return 1123;
      return undefined;
    },
  };

  let service: WorksheetRenderService;

  beforeEach(() => {
    jest.clearAllMocks();
    const registry = new WorksheetRendererRegistry(new GenericWorksheetRenderer());
    service = new WorksheetRenderService(
      prisma as unknown as PrismaService,
      configService as unknown as ConfigService,
      templateService as unknown as WorksheetTemplateService,
      registry,
      {} as BrowserPoolService,
      {} as S3StorageService,
      { emit: jest.fn() } as unknown as EventEmitter2,
    );
    prisma.worksheet.findUnique.mockResolvedValue({
      id: 'ws-1',
      templateId: 'tmpl-1',
      structure: {
        instruction: 'Count',
        items: [{ count: 1, imageQuery: 'apple', assetId: 'a1' }],
      },
    });
    templateService.getById.mockResolvedValue({
      id: 'tmpl-1',
      rendererType: 'generic',
      templateHtml: '<p>{{instruction}}</p><img src="{{#items}}{{assetUrl}}{{/items}}" />',
      backgroundAssetId: null,
    });
    templateService.parseRendererConfig.mockReturnValue({});
  });

  it('returns HTML from the trusted generic renderer', async () => {
    const result = await service.render('ws-1', 'html');
    expect(result.format).toBe('html');
    expect(result.html).toContain('Count');
    expect(result.html).toContain('/worksheets/assets/a1/image');
  });

  it('rejects an unsupported format', async () => {
    await expect(service.render('ws-1', 'png')).rejects.toMatchObject({
      code: 'UNSUPPORTED_FORMAT',
    });
  });

  it('rejects an unknown renderer type', async () => {
    templateService.getById.mockResolvedValue({
      id: 'tmpl-1',
      rendererType: 'missing',
      templateHtml: '<p></p>',
      backgroundAssetId: null,
    });
    await expect(service.render('ws-1', 'html')).rejects.toMatchObject({
      code: 'UNSUPPORTED_RENDERER',
    });
  });
});
