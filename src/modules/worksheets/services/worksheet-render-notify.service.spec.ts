import { HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WorksheetRenderNotifyService } from './worksheet-render-notify.service';
import { WorksheetRenderService } from './worksheet-render.service';

describe('WorksheetRenderNotifyService', () => {
  const renderService = {
    renderFromPayload: jest.fn(),
  };
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'worksheets.parentOrigin') return 'https://parent.example';
      if (key === 'worksheets.upload.apiUrl') return 'https://upload.example/media';
      if (key === 'worksheets.upload.entityName') return 'worksheets';
      if (key === 'worksheets.upload.entityType') return 'worksheets';
      if (key === 'worksheets.upload.folderName') return 'ai_worksheets';
      return undefined;
    }),
  };

  let service: WorksheetRenderNotifyService;
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WorksheetRenderNotifyService(
      renderService as unknown as WorksheetRenderService,
      configService as unknown as ConfigService,
    );
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('rejects a payload without templateId or structure', async () => {
    await expect(service.renderAndNotify({})).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
    expect(renderService.renderFromPayload).not.toHaveBeenCalled();
  });

  it('renders, uploads, and returns resource rows', async () => {
    renderService.renderFromPayload.mockResolvedValue({
      buffer: Buffer.from('png'),
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: [{ Location: 'https://cdn.example/w.png', key: 'k1', mediaId: 'm1' }],
      }),
    });

    const result = await service.renderAndNotify({
      templateId: 'tmpl-1',
      structure: { instruction: 'Count' },
      request: { topic: 'fruit' },
      grade: { id: 'g1', name: 'FS 1' },
    });

    expect(result.success).toBe(true);
    expect(result.type).toBe('worksheets:saved');
    expect(result.parentOrigin).toBe('https://parent.example');
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].url).toBe('https://cdn.example/w.png');
    expect(result.cards[0].s3Key).toBe('k1');
    expect(result.cards[0].mediaId).toBe('m1');
    expect(result.resources).toEqual(result.cards);
  });

  it('includes the failure reason when render fails', async () => {
    renderService.renderFromPayload.mockRejectedValue(new Error('Playwright timeout'));

    await expect(
      service.renderAndNotify({
        templateId: 'tmpl-1',
        structure: { instruction: 'Count' },
      }),
    ).rejects.toBeInstanceOf(HttpException);

    try {
      await service.renderAndNotify({
        templateId: 'tmpl-1',
        structure: { instruction: 'Count' },
      });
    } catch (error) {
      expect((error as HttpException).message).toContain(
        'Failed to render/upload worksheet',
      );
      expect((error as HttpException).message).toContain('Playwright timeout');
    }
  });
});
