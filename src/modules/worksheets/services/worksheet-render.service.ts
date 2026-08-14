import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getErrorMessage } from '../../../common/utils/error-message';
import {
  PIPELINE_STAGES,
  PipelineTelemetryContext,
} from '../../../common/events/pipeline-tracker.events';
import { PrismaService } from '../../database/prisma.service';
import { S3StorageService } from '../../storage/s3-storage.service';
import { BrowserPoolService } from '../../flashcards/flashcard-renderer/browser/browser-pool.service';
import {
  DEFAULT_WORKSHEET_CANVAS,
  WORKSHEET_WORKFLOW_RENDER,
} from '../constants/worksheet.constants';
import { WorksheetException } from '../errors/worksheet.exception';
import {
  EditableField,
  WORKSHEET_RENDER_FORMATS,
  WORKSHEET_RENDER_MODES,
  WorksheetRenderFormat,
  WorksheetRenderMode,
} from '../types/worksheet.types';
import { asStructureRecord, parseJsonObject } from '../utils/structure.util';
import {
  WorksheetPipelineEmitter,
  createTelemetryContext,
  runTrackedStage,
} from '../telemetry/worksheet-pipeline.events';
import { WorksheetRendererRegistry } from '../renderers/worksheet-renderer.registry';
import { WorksheetAssetService } from './worksheet-asset.service';
import { WorksheetFieldMetadataService } from './worksheet-field-metadata.service';
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
  private readonly defaultWidth: number;
  private readonly defaultHeight: number;
  private readonly keyPrefix: string;
  private readonly bucket?: string;
  private readonly signedUrlTtlSeconds: number;
  private readonly emitter: WorksheetPipelineEmitter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly templateService: WorksheetTemplateService,
    private readonly rendererRegistry: WorksheetRendererRegistry,
    private readonly browserPool: BrowserPoolService,
    private readonly s3StorageService: S3StorageService,
    private readonly assetService: WorksheetAssetService,
    private readonly fieldMetadataService: WorksheetFieldMetadataService,
    eventEmitter: EventEmitter2,
  ) {
    this.enabled =
      this.configService.get<boolean>('worksheets.renderer.enabled') !== false;
    this.apiBaseUrl = (
      this.configService.get<string>('worksheets.renderer.apiBaseUrl') ??
      'http://localhost:5000'
    ).replace(/\/$/, '');
    this.defaultWidth =
      this.configService.get<number>('worksheets.renderer.defaultWidth') ??
      DEFAULT_WORKSHEET_CANVAS.width;
    this.defaultHeight =
      this.configService.get<number>('worksheets.renderer.defaultHeight') ??
      DEFAULT_WORKSHEET_CANVAS.height;
    this.keyPrefix =
      this.configService.get<string>('worksheets.renderer.s3KeyPrefix') ??
      'worksheets/rendered';
    this.bucket =
      this.configService.get<string>('worksheets.renderer.s3Bucket') || undefined;
    this.signedUrlTtlSeconds =
      this.configService.get<number>('worksheets.renderer.signedUrlTtlSeconds') ??
      3600;
    this.emitter = new WorksheetPipelineEmitter(eventEmitter);
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
    const structure = this.assetService.enrichForRender(
      this.assetService.persistableStructure(input.structure),
    );
    const topic =
      (typeof input.request?.topic === 'string' && input.request.topic) ||
      (typeof structure.topic === 'string' ? structure.topic : undefined);
    const renderer = this.rendererRegistry.get(input.template.rendererType);
    const html = renderer.render({
      templateHtml: input.template.templateHtml,
      structure,
      rendererConfig: rendererConfig as Record<string, unknown>,
      backgroundAssetUrl: input.template.backgroundAssetId
        ? this.assetService.assetProxyUrl(input.template.backgroundAssetId)
        : null,
      mode: input.mode ?? 'editor',
      canvas,
      topic,
      baseHref: this.apiBaseUrl,
    });
    return { html, canvas };
  }

  public async render(
    worksheetId: string,
    format: string,
    options: { correlationId?: string; mode?: string } = {},
  ): Promise<RenderWorksheetResult> {
    const telemetry = createTelemetryContext({
      correlationId: options.correlationId,
      workflowType: WORKSHEET_WORKFLOW_RENDER,
    });
    this.emitter.emitStarted({
      ...telemetry,
      metadata: {
        operation: 'render',
        worksheetId,
        format,
      },
    });
    try {
      const result = await this.runRender(
        worksheetId,
        format,
        options.mode,
        telemetry,
      );
      this.emitter.emitCompleted({
        ...telemetry,
        status: 'completed',
        metadata: {
          operation: 'render',
          worksheetId: result.worksheetId,
          format: result.format,
          outputId: result.outputId ?? null,
        },
      });
      return result;
    } catch (error) {
      this.emitter.emitFailed({
        ...telemetry,
        status: 'failed',
        errorMessage: getErrorMessage(error),
      });
      throw error;
    }
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
    telemetry: PipelineTelemetryContext,
  ): Promise<RenderWorksheetResult> {
    const normalized = await runTrackedStage(
      this.emitter,
      telemetry,
      PIPELINE_STAGES.REQUEST_VALIDATION,
      () => {
        const value = format?.trim().toLowerCase() as WorksheetRenderFormat;
        if (!WORKSHEET_RENDER_FORMATS.includes(value)) {
          throw new WorksheetException(
            'UNSUPPORTED_FORMAT',
            `format must be one of ${WORKSHEET_RENDER_FORMATS.join(', ')}`,
          );
        }
        return value;
      },
    );

    this.logger.log(`render started worksheetId=${worksheetId} format=${normalized}`);

    const worksheet = await runTrackedStage(
      this.emitter,
      telemetry,
      PIPELINE_STAGES.REQUEST_ANALYSIS,
      async () => {
        const row = await this.prisma.worksheet.findUnique({
          where: { id: worksheetId },
        });
        if (!row) {
          throw new WorksheetException(
            'WORKSHEET_NOT_FOUND',
            `Worksheet "${worksheetId}" was not found`,
            HttpStatus.NOT_FOUND,
          );
        }
        return row;
      },
      {
        completeMetadata: (row) => ({
          worksheetId: row.id,
          templateId: row.templateId,
        }),
      },
    );

    const template = await runTrackedStage(
      this.emitter,
      telemetry,
      PIPELINE_STAGES.TEMPLATE_SELECTION,
      () => this.templateService.getById(worksheet.templateId),
      {
        completeMetadata: (selected) => ({
          templateId: selected.id,
          templateSlug: selected.slug,
          rendererType: selected.rendererType,
        }),
      },
    );

    const rendererConfig = this.templateService.parseRendererConfig(template);
    const canvas = {
      width: rendererConfig.width ?? this.defaultWidth,
      height: rendererConfig.height ?? this.defaultHeight,
    };
    const mode = this.resolveMode(rawMode, normalized);
    const html = await runTrackedStage(
      this.emitter,
      telemetry,
      PIPELINE_STAGES.HTML_GENERATION,
      () => {
        const composed = this.composeHtml({
          template,
          structure: asStructureRecord(worksheet.structure),
          request: parseJsonObject(worksheet.request),
          mode,
        });
        return composed.html;
      },
      {
        completeMetadata: (markup) => ({
          rendererType: template.rendererType,
          htmlLength: markup.length,
          mode,
          width: canvas.width,
          height: canvas.height,
        }),
      },
    );

    if (normalized === 'html') {
      this.emitter.emitStageSkipped({
        ...telemetry,
        stageName: PIPELINE_STAGES.WORKSHEET_RENDERING,
        metadata: { reason: 'html_format_does_not_use_playwright' },
      });
      this.emitter.emitStageSkipped({
        ...telemetry,
        stageName: PIPELINE_STAGES.PERSISTENCE,
        metadata: { reason: 'html_returned_inline' },
      });
      this.logger.log('render completed format=html');
      const result = {
        worksheetId,
        format: normalized,
        mode,
        html,
        canvas,
      };
      await runTrackedStage(
        this.emitter,
        telemetry,
        PIPELINE_STAGES.RESPONSE_RETURN,
        () => result,
        { completeMetadata: { format: normalized } },
      );
      return result;
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
      const buffer = await runTrackedStage(
        this.emitter,
        telemetry,
        PIPELINE_STAGES.WORKSHEET_RENDERING,
        () =>
          normalized === 'pdf'
            ? this.renderPdf(html, width, height)
            : this.renderWebp(html, width, height),
        {
          startMetadata: { format: normalized, width, height },
          completeMetadata: { format: normalized, width, height },
        },
      );

      const result = await runTrackedStage(
        this.emitter,
        telemetry,
        PIPELINE_STAGES.PERSISTENCE,
        async () => {
          const contentType =
            normalized === 'pdf' ? 'application/pdf' : 'image/webp';
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

          const output = await this.prisma.worksheetOutput.create({
            data: {
              worksheetId,
              format: normalized.toUpperCase() as 'HTML' | 'WEBP' | 'PDF',
              storageKey,
            },
          });

          await this.prisma.worksheet.update({
            where: { id: worksheetId },
            data: { status: 'COMPLETED' },
          });

          return {
            worksheetId,
            format: normalized,
            mode,
            storageKey,
            uri,
            outputId: output.id,
            canvas,
          };
        },
        {
          completeMetadata: (stored) => ({
            storageKey: stored.storageKey,
            outputId: stored.outputId,
          }),
        },
      );

      this.logger.log(`render completed format=${normalized}`);
      await runTrackedStage(
        this.emitter,
        telemetry,
        PIPELINE_STAGES.RESPONSE_RETURN,
        () => result,
        { completeMetadata: { format: normalized } },
      );
      return result;
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

  private async renderWebp(
    html: string,
    width: number,
    height: number,
  ): Promise<Buffer> {
    const browser = await this.browserPool.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setViewportSize({ width, height });
      await page.setContent(html, { waitUntil: 'networkidle' });
      const screenshot = await page.screenshot({ type: 'webp', fullPage: false });
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
      await page.setContent(html, { waitUntil: 'networkidle' });
      const pdf = await page.pdf({
        width: `${width}px`,
        height: `${height}px`,
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      });
      return Buffer.from(pdf);
    } finally {
      await page.close();
    }
  }
}
