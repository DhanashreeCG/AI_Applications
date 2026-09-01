import { joinPublicAssetUrl, toondemyFontUrl } from '../../../common/ui/toondemy-font';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getErrorMessage } from '../../../common/utils/error-message';
import { PrismaService } from '../../database/prisma.service';
import { S3StorageService } from '../../storage/s3-storage.service';
import { BrowserPoolService } from '../../flashcards/flashcard-renderer/browser/browser-pool.service';
import { AssetImageService } from '../../flashcards/services/asset-image.service';
import { WorksheetException } from '../errors/worksheet.exception';
import {
  EditableField,
  WORKSHEET_RENDER_FORMATS,
  WORKSHEET_RENDER_MODES,
  WorksheetRenderFormat,
  WorksheetRenderMode,
} from '../types/worksheet.types';
import { asStructureRecord, parseJsonObject } from '../utils/structure.util';
import { WorksheetRendererRegistry } from '../renderers/worksheet-renderer.registry';
import { WorksheetAssetService } from './worksheet-asset.service';
import { WorksheetFieldMetadataService } from './worksheet-field-metadata.service';
import {
  collectAssetIdsFromHtml,
  injectCaptureCss,
  replaceAssetUrlsWithDataUris,
} from '../utils/inline-worksheet-assets.util';
import {
  WorksheetTemplateRecord,
  WorksheetTemplateService,
} from './worksheet-template.service';

export interface RenderWorksheetResult {
  worksheetId: string;
  format: WorksheetRenderFormat;
  mode: WorksheetRenderMode;
  html?: string;
  canvas?: { width: number; height: number };
  storageKey?: string;
  uri?: string;
  outputId?: string;
  buffer?: Buffer;
}

export interface PreviewWorksheetResult {
  worksheetId: string;
  mode: WorksheetRenderMode;
  html: string;
  canvas: { width: number; height: number };
  structure: Record<string, unknown>;
  editableFields: EditableField[];
  fieldPrompts: Record<string, string>;
  template: {
    id: string;
    slug: string;
    name: string;
    rendererType: string;
  };
}

@Injectable()
export class WorksheetRenderService {
  private readonly logger = new Logger(WorksheetRenderService.name);
  private readonly enabled: boolean;
  private readonly apiBaseUrl: string;
  private readonly pencilIconUrl: string;
  private readonly defaultWidth: number;
  private readonly defaultHeight: number;
  private readonly keyPrefix: string;
  private readonly bucket?: string;
  private readonly signedUrlTtlSeconds: number;
  private readonly assetImagePath: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly templateService: WorksheetTemplateService,
    private readonly rendererRegistry: WorksheetRendererRegistry,
    private readonly browserPool: BrowserPoolService,
    private readonly s3StorageService: S3StorageService,
    private readonly assetService: WorksheetAssetService,
    private readonly fieldMetadataService: WorksheetFieldMetadataService,
    private readonly assetImageService: AssetImageService,
  ) {
    this.enabled =
      this.configService.get<boolean>('worksheets.renderer.enabled') !== false;
    this.apiBaseUrl = (
      this.configService.get<string>('worksheets.renderer.apiBaseUrl') ?? ''
    ).replace(/\/$/, '');
    this.pencilIconUrl = joinPublicAssetUrl(
      this.apiBaseUrl,
      this.configService.get<string>('worksheets.pencilIconUrl') || '/pencil.png',
    );
    this.defaultWidth =
      this.configService.get<number>('worksheets.renderer.defaultWidth') ?? 1016;
    this.defaultHeight =
      this.configService.get<number>('worksheets.renderer.defaultHeight') ?? 1316;
    this.keyPrefix =
      this.configService.get<string>('worksheets.renderer.s3KeyPrefix') ??
      'worksheets/rendered';
    this.bucket =
      this.configService.get<string>('worksheets.renderer.s3Bucket') || undefined;
    this.signedUrlTtlSeconds =
      this.configService.get<number>('worksheets.renderer.signedUrlTtlSeconds') ??
      3600;
    this.assetImagePath = (
      this.configService.get<string>('worksheets.assetImagePath') ??
      '/worksheets/assets'
    ).replace(/\/$/, '');
  }

  public composeHtml(input: {
    template: WorksheetTemplateRecord;
    structure: Record<string, unknown>;
    request?: Record<string, unknown> | null;
    mode?: WorksheetRenderMode;
  }): { html: string; canvas: { width: number; height: number } } {
    const rendererConfig = this.templateService.parseRendererConfig(input.template);
    const canvas = {
      width: rendererConfig.width ?? this.defaultWidth,
      height: rendererConfig.height ?? this.defaultHeight,
    };
    const structure = this.assetService.enrichForRender(input.structure);
    const renderer = this.rendererRegistry.get(
      input.template.rendererType,
      input.template.slug,
    );
    const html = renderer.render({
      templateHtml: input.template.templateHtml,
      structure,
      rendererConfig: rendererConfig as Record<string, unknown>,
      backgroundAssetUrl: input.template.backgroundAssetId
        ? this.assetService.assetProxyUrl(input.template.backgroundAssetId)
        : null,
      mode: input.mode ?? 'editor',
      canvas,
      pencilIconUrl: this.pencilIconUrl,
      fontPath: toondemyFontUrl(this.apiBaseUrl),
    });
    return { html, canvas };
  }

  public async renderFromPayload(
    payload: {
      templateId: string;
      structure: Record<string, unknown>;
      request?: Record<string, unknown>;
    },
    format: string,
    options: { correlationId?: string; mode?: string } = {},
  ): Promise<RenderWorksheetResult> {
    const value = format?.trim().toLowerCase() as WorksheetRenderFormat;
    if (!WORKSHEET_RENDER_FORMATS.includes(value)) {
      throw new WorksheetException(
        'UNSUPPORTED_FORMAT',
        `format must be one of ${WORKSHEET_RENDER_FORMATS.join(', ')}`,
      );
    }
    const normalized = value;

    this.logger.log(`renderFromPayload started format=${normalized}`);

    const template = await this.templateService.getById(payload.templateId);

    const rendererConfig = this.templateService.parseRendererConfig(template);
    const canvas = {
      width: rendererConfig.width ?? this.defaultWidth,
      height: rendererConfig.height ?? this.defaultHeight,
    };
    const mode = this.resolveMode(options.mode, normalized);
    const composed = this.composeHtml({
      template,
      structure: payload.structure,
      request: payload.request,
      mode,
    });
    const html = composed.html;

    if (normalized === 'html') {
      this.logger.log('renderFromPayload completed format=html');
      return {
        worksheetId: 'temp',
        format: normalized,
        mode,
        html,
        canvas,
      };
    }

    if (!this.enabled) {
      throw new WorksheetException(
        'RENDER_FAILED',
        'Worksheet renderer is disabled',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    try {
      const width = canvas.width;
      const height = canvas.height;
      let buffer: Buffer;
      if (normalized === 'pdf') {
        buffer = await this.renderPdf(html, width, height);
      } else if (normalized === 'png') {
        buffer = await this.renderPng(html, width, height);
      } else {
        buffer = await this.renderWebp(html, width, height);
      }

      this.logger.log(`renderFromPayload completed format=${normalized}`);
      return {
        worksheetId: 'temp',
        format: normalized,
        mode,
        canvas,
        buffer,
      };
    } catch (error) {
      if (error instanceof WorksheetException) {
        throw error;
      }
      throw new WorksheetException(
        'RENDER_FAILED',
        'Worksheet rendering failed',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  public async render(
    worksheetId: string,
    format: string,
    options: { correlationId?: string; mode?: string } = {},
  ): Promise<RenderWorksheetResult> {
    return this.runRender(
      worksheetId,
      format,
      options.mode,
    );
  }

  public async preview(
    worksheetId: string,
    mode: string | undefined,
    options: { correlationId?: string } = {},
  ): Promise<PreviewWorksheetResult> {
    const rendered = await this.render(worksheetId, 'html', {
      ...options,
      mode: mode || 'editor',
    });
    const worksheet = await this.prisma.worksheet.findUnique({
      where: { id: worksheetId },
    });
    if (!worksheet) {
      throw new WorksheetException(
        'WORKSHEET_NOT_FOUND',
        `Worksheet "${worksheetId}" was not found`,
        HttpStatus.NOT_FOUND,
      );
    }
    const template = await this.templateService.getById(worksheet.templateId);
    const structure = this.assetService.persistableStructure(
      asStructureRecord(worksheet.structure),
    );
    return {
      worksheetId,
      mode: rendered.mode,
      html: rendered.html ?? '',
      canvas: rendered.canvas ?? {
        width: this.defaultWidth,
        height: this.defaultHeight,
      },
      structure,
      editableFields: this.fieldMetadataService.normalize(template, structure),
      fieldPrompts: this.templateService.parseFieldPrompts(template),
      template: {
        id: template.id,
        slug: template.slug,
        name: template.name,
        rendererType: template.rendererType,
      },
    };
  }

  private async runRender(
    worksheetId: string,
    format: string,
    rawMode: string | undefined,
  ): Promise<RenderWorksheetResult> {
    const value = format?.trim().toLowerCase() as WorksheetRenderFormat;
    if (!WORKSHEET_RENDER_FORMATS.includes(value)) {
      throw new WorksheetException(
        'UNSUPPORTED_FORMAT',
        `format must be one of ${WORKSHEET_RENDER_FORMATS.join(', ')}`,
      );
    }
    const normalized = value;

    this.logger.log(`render started worksheetId=${worksheetId} format=${normalized}`);

    const worksheet = await this.prisma.worksheet.findUnique({
      where: { id: worksheetId },
    });
    if (!worksheet) {
      throw new WorksheetException(
        'WORKSHEET_NOT_FOUND',
        `Worksheet "${worksheetId}" was not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    const template = await this.templateService.getById(worksheet.templateId);

    const rendererConfig = this.templateService.parseRendererConfig(template);
    const canvas = {
      width: rendererConfig.width ?? this.defaultWidth,
      height: rendererConfig.height ?? this.defaultHeight,
    };
    const mode = this.resolveMode(rawMode, normalized);
    const composed = this.composeHtml({
      template,
      structure: asStructureRecord(worksheet.structure),
      request: parseJsonObject(worksheet.request),
      mode,
    });
    const html = composed.html;

    if (normalized === 'html') {
      this.logger.log('render completed format=html');
      return {
        worksheetId,
        format: normalized,
        mode,
        html,
        canvas,
      };
    }

    if (!this.enabled) {
      throw new WorksheetException(
        'RENDER_FAILED',
        'Worksheet renderer is disabled',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    await this.prisma.worksheet.update({
      where: { id: worksheetId },
      data: { status: 'RENDERING' },
    });

    try {
      const width = canvas.width;
      const height = canvas.height;
      let buffer: Buffer;
      if (normalized === 'pdf') {
        buffer = await this.renderPdf(html, width, height);
      } else if (normalized === 'png') {
        buffer = await this.renderPng(html, width, height);
      } else {
        buffer = await this.renderWebp(html, width, height);
      }

      const contentType =
        normalized === 'pdf'
          ? 'application/pdf'
          : normalized === 'png'
            ? 'image/png'
            : 'image/webp';
      const fileName = `worksheet.${normalized}`;
      const storageKey = `${this.keyPrefix}/${worksheetId}/${fileName}`;

      await this.s3StorageService.uploadFile(buffer, {
        bucket: this.bucket,
        key: storageKey,
        contentType,
        metadata: { worksheetId, format: normalized },
      });
      const uri = await this.s3StorageService.getSignedUrl(
        storageKey,
        this.signedUrlTtlSeconds,
        this.bucket,
      );

      let outputId: string | undefined;
      if (normalized === 'pdf' || normalized === 'webp') {
        const output = await this.prisma.worksheetOutput.create({
          data: {
            worksheetId,
            format: normalized.toUpperCase() as 'WEBP' | 'PDF',
            storageKey,
          },
        });
        outputId = output.id;
      }

      await this.prisma.worksheet.update({
        where: { id: worksheetId },
        data: { status: 'COMPLETED' },
      });

      this.logger.log(`render completed format=${normalized}`);
      return {
        worksheetId,
        format: normalized,
        mode,
        storageKey,
        uri,
        outputId,
        canvas,
        buffer,
      };
    } catch (error) {
      await this.prisma.worksheet.update({
        where: { id: worksheetId },
        data: { status: 'FAILED' },
      });
      if (error instanceof WorksheetException) {
        throw error;
      }
      throw new WorksheetException(
        'RENDER_FAILED',
        'Worksheet rendering failed',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  private resolveMode(
    rawMode: string | undefined,
    format: WorksheetRenderFormat,
  ): WorksheetRenderMode {
    if (format !== 'html') {
      return 'export';
    }
    const value = rawMode?.trim().toLowerCase();
    if (value && WORKSHEET_RENDER_MODES.includes(value as WorksheetRenderMode)) {
      return value as WorksheetRenderMode;
    }
    return 'export';
  }

  private async prepareHtmlForCapture(html: string): Promise<string> {
    const ids = collectAssetIdsFromHtml(html, this.assetImagePath);
    const dataUris = new Map<string, string>();
    for (const assetId of ids) {
      try {
        const { buffer, mimeType } = await this.assetImageService.loadImage(assetId);
        const type = mimeType?.trim() || 'image/png';
        dataUris.set(assetId, `data:${type};base64,${buffer.toString('base64')}`);
        this.logger.log(
          `inlined worksheet asset ${assetId} bytes=${buffer.length} mime=${type}`,
        );
      } catch (error) {
        this.logger.warn(
          `Could not inline worksheet asset ${assetId}: ${getErrorMessage(error)}`,
        );
      }
    }
    return injectCaptureCss(
      replaceAssetUrlsWithDataUris(html, dataUris, this.assetImagePath),
    );
  }

  private async waitForPaint(page: {
    evaluate: (fn: () => Promise<void> | void) => Promise<unknown>;
  }): Promise<void> {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        Array.from(document.images).map(
          (img) =>
            img.complete
              ? Promise.resolve()
              : new Promise<void>((resolve) => {
                  img.addEventListener('load', () => resolve(), { once: true });
                  img.addEventListener('error', () => resolve(), { once: true });
                }),
        ),
      );
    });
  }

  private async renderWebp(
    html: string,
    width: number,
    height: number,
  ): Promise<Buffer> {
    const browser = await this.browserPool.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setViewportSize({ width, height });
      const markup = await this.prepareHtmlForCapture(html);
      await page.setContent(markup, { waitUntil: 'load', timeout: 30000 });
      await this.waitForPaint(page);
      const screenshot = await page.screenshot({
        type: 'webp',
        fullPage: false,
        omitBackground: false,
      });
      return screenshot;
    } finally {
      await page.close();
    }
  }

  private async renderPng(
    html: string,
    width: number,
    height: number,
  ): Promise<Buffer> {
    const browser = await this.browserPool.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setViewportSize({ width, height });
      const markup = await this.prepareHtmlForCapture(html);
      await page.setContent(markup, { waitUntil: 'load', timeout: 30000 });
      await this.waitForPaint(page);
      const screenshot = await page.screenshot({
        type: 'png',
        fullPage: false,
        omitBackground: false,
      });
      return screenshot;
    } finally {
      await page.close();
    }
  }

  private async renderPdf(
    html: string,
    width: number,
    height: number,
  ): Promise<Buffer> {
    const browser = await this.browserPool.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setViewportSize({ width, height });
      const markup = await this.prepareHtmlForCapture(html);
      await page.setContent(markup, { waitUntil: 'load', timeout: 30000 });
      await this.waitForPaint(page);
      const pdf = await page.pdf({
        width: `${width}px`,
        height: `${height}px`,
        printBackground: true,
        preferCSSPageSize: false,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      });
      return Buffer.from(pdf);
    } finally {
      await page.close();
    }
  }
}
