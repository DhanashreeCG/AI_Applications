import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WorksheetRenderService } from './worksheet-render.service';

export type WorksheetRenderNotifyPayload = {
  templateId?: string;
  structure?: Record<string, unknown>;
  request?: Record<string, unknown>;
  auth?: string;
  grade?: unknown;
};

export type WorksheetRenderNotifyResource = {
  url: string;
  signedUrl: string;
  s3Key: string;
  folder: string;
  fileName: string;
  mediaId?: string;
};

@Injectable()
export class WorksheetRenderNotifyService {
  constructor(
    private readonly renderService: WorksheetRenderService,
    private readonly configService: ConfigService,
  ) {}

  public async renderAndNotify(
    body: WorksheetRenderNotifyPayload,
    options: { correlationId?: string } = {},
  ): Promise<{
    success: true;
    type: 'worksheets:saved';
    grade: unknown;
    resources: WorksheetRenderNotifyResource[];
    cards: WorksheetRenderNotifyResource[];
    parentOrigin: string;
  }> {
    const parentOrigin =
      this.configService.get<string>('worksheets.parentOrigin') ?? '*';
    const templateId = body.templateId;
    const structure = body.structure;
    const request = body.request;

    if (!templateId || !structure) {
      throw new HttpException(
        'Missing templateId or structure',
        HttpStatus.BAD_REQUEST,
      );
    }

    const uploadApiUrl =
      this.configService.get<string>('worksheets.upload.apiUrl') ||
      'https://gyan-dev-api.creativegalileo.com/api/gyan/V1/media/upload-media';
    const entityName =
      this.configService.get<string>('worksheets.upload.entityName') || 'GYAN';
    const entityType =
      this.configService.get<string>('worksheets.upload.entityType') ||
      'ai_worksheets';
    const folderName =
      this.configService.get<string>('worksheets.upload.folderName') ||
      'ai_worksheets';

    try {
      const result = await this.renderService.renderFromPayload(
        { templateId, structure, request },
        'png',
        { correlationId: options.correlationId, mode: 'export' },
      );

      if (!result.buffer) {
        throw new HttpException(
          'Failed to render/upload worksheet: Failed to generate PNG buffer',
          HttpStatus.BAD_GATEWAY,
        );
      }

      const filename = `worksheet-${Date.now()}.png`;
      const bytes = Uint8Array.from(result.buffer);
      const form = new FormData();
      form.append(
        'files',
        new Blob([bytes], { type: 'image/png' }),
        filename,
      );
      form.append('entityName', entityName);
      form.append('entityType', entityType);
      form.append('folderName', folderName);

      const headers: Record<string, string> = {};
      if (body.auth) headers.Authorization = `Bearer ${body.auth}`;
      const uploadRes = await fetch(uploadApiUrl, {
        method: 'POST',
        headers,
        body: form,
      });

      if (!uploadRes.ok) {
        const errorText = await uploadRes.text();
        throw new HttpException(
          `Failed to render/upload worksheet: ${errorText}`,
          HttpStatus.BAD_GATEWAY,
        );
      }

      const uploadResult = (await uploadRes.json()) as {
        success?: boolean;
        data?: Array<{
          Location?: string;
          key?: string;
          Key?: string;
          mediaId?: string;
        }>;
      };
      if (!uploadResult.success || !uploadResult.data?.[0]) {
        throw new HttpException(
          `Failed to render/upload worksheet: Invalid response from upload media API`,
          HttpStatus.BAD_GATEWAY,
        );
      }

      const mediaData = uploadResult.data[0];
      const resource: WorksheetRenderNotifyResource = {
        url: mediaData.Location || '',
        signedUrl: mediaData.Location || '',
        s3Key: mediaData.key || mediaData.Key || '',
        folder: folderName,
        fileName: filename,
        mediaId: mediaData.mediaId,
      };

      return {
        success: true,
        type: 'worksheets:saved',
        grade: body.grade ?? null,
        resources: [resource],
        cards: [resource],
        parentOrigin,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        `Failed to render/upload worksheet: ${
          error instanceof Error ? error.message : 'Render and notify failed'
        }`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
