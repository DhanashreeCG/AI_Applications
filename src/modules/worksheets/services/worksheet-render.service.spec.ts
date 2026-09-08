import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { S3StorageService } from '../../storage/s3-storage.service';
import { BrowserPoolService } from '../../flashcards/flashcard-renderer/browser/browser-pool.service';
import { WorksheetRendererRegistry } from '../renderers/worksheet-renderer.registry';
import { WorksheetTemplateService } from './worksheet-template.service';
import { WorksheetRenderService } from './worksheet-render.service';
import { GenericWorksheetRenderer } from '../renderers/generic-worksheet.renderer';
import { CircleTheThingsRenderer } from '../renderers/circle-the-things.renderer';

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
      if (key === 'worksheets.renderer.apiBaseUrl') return 'http://localhost:5000';
      if (key === 'worksheets.renderer.defaultWidth') return 1016;
      if (key === 'worksheets.renderer.defaultHeight') return 1316;
      return undefined;
    },
  };

  let service: WorksheetRenderService;

  beforeEach(() => {
    jest.clearAllMocks();
    const generic = new GenericWorksheetRenderer();
    const registry = new WorksheetRendererRegistry(generic, new CircleTheThingsRenderer(generic));
    service = new WorksheetRenderService(
      prisma as unknown as PrismaService,
      configService as unknown as ConfigService,
      templateService as unknown as WorksheetTemplateService,
      registry,
      {} as BrowserPoolService,
      {} as S3StorageService,
      {
        persistableStructure: (value: Record<string, unknown>) => value,
        enrichForRender: (value: Record<string, unknown>) => {
          const walk = (node: unknown): unknown => {
            if (Array.isArray(node)) {
              return node.map((item) => walk(item));
            }
            if (node && typeof node === 'object') {
              const record = node as Record<string, unknown>;
              const next: Record<string, unknown> = {};
              for (const [key, child] of Object.entries(record)) {
                if (['imageUrl', 'assetUrl', 'signedUrl'].includes(key)) {
                  continue;
                }
                next[key] = walk(child);
              }
              if (typeof record.assetId === 'string' && record.assetId.trim()) {
                next.assetUrl = `http://localhost:5000/worksheets/assets/${record.assetId}/image`;
              }
              return next;
            }
            return node;
          };
          return walk(value) as Record<string, unknown>;
        },
        assetProxyUrl: (id: string) =>
          `http://localhost:5000/worksheets/assets/${id}/image`,
      } as never,
      { normalize: jest.fn() } as never,
      { loadImage: jest.fn() } as never,
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
    expect(result.html).not.toContain('<base ');
  });

  it('fills topic from generated structure and main image from assetId, not the raw request', () => {
    const result = service.composeHtml({
      template: {
        rendererType: 'generic',
        templateHtml:
          '<div class="topic" data-editable="topic">{{TOPIC}}</div>{{GOAT_IMAGE}}',
        backgroundAssetId: null,
      } as never,
      structure: {
        topic: 'Dolphin Fun',
        image: {
          id: 'main_image',
          image_name: 'cute jumping dolphins in the ocean',
          assetId: 'dolphin-1',
        },
      },
      request: {
        topic: 'Generate worksheet on dolphins',
        query: 'Generate worksheet on dolphins',
      },
      mode: 'editor',
    });

    expect(result.html).toContain('Dolphin Fun');
    expect(result.html).not.toContain('Generate worksheet on dolphins');
    expect(result.html).toContain('data-image-slot="main_image"');
    expect(result.html).toContain('data-field-path="image"');
    expect(result.html).toContain('/worksheets/assets/dolphin-1/image');
    expect(result.html).not.toContain('data-image-slot="GOAT"');
  });

  it('rejects an unsupported format', async () => {
    await expect(service.render('ws-1', 'gif')).rejects.toMatchObject({
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
