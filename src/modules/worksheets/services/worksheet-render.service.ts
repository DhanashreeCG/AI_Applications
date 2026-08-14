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
  WORKSHEET_ASSET_IMAGE_PATH,
  WORKSHEET_WORKFLOW_RENDER,
} from '../constants/worksheet.constants';
import { WorksheetException } from '../errors/worksheet.exception';
import {
  WORKSHEET_RENDER_FORMATS,
  WorksheetRenderFormat,
} from '../types/worksheet.types';
import { asStructureRecord } from '../utils/structure.util';
import {
  WorksheetPipelineEmitter,
  createTelemetryContext,
  runTrackedStage,
} from '../telemetry/worksheet-pipeline.events';
import { WorksheetRendererRegistry } from '../renderers/worksheet-renderer.registry';
import { WorksheetTemplateService } from './worksheet-template.service';

export interface RenderWorksheetResult {
  worksheetId: string;
  format: WorksheetRenderFormat;
  html?: string;
  storageKey?: string;
  uri?: string;
  outputId?: string;
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
    eventEmitter: EventEmitter2,
  ) {
    this.enabled =
      this.configService.get<boolean>('worksheets.renderer.enabled') !== false;
    this.apiBaseUrl =
      this.configService.get<string>('worksheets.renderer.apiBaseUrl') ??
      'http://localhost:3000';
    this.defaultWidth =
      this.configService.get<number>('worksheets.renderer.defaultWidth') ?? 794;
    this.defaultHeight =
      this.configService.get<number>('worksheets.renderer.defaultHeight') ?? 1123;
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

  public async render(
    worksheetId: string,
    format: string,
    options: { correlationId?: string } = {},
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
      const result = await this.runRender(worksheetId, format, telemetry);
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

  private async runRender(
    worksheetId: string,
    format: string,
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
    const html = await runTrackedStage(
      this.emitter,
      telemetry,
      PIPELINE_STAGES.HTML_GENERATION,
      () => {
        const renderer = this.rendererRegistry.get(template.rendererType);
        const structure = this.enrichAssetUrls(
          asStructureRecord(worksheet.structure),
        );
        return renderer.render({
          templateHtml: template.templateHtml,
          structure,
          rendererConfig: rendererConfig as Record<string, unknown>,
          backgroundAssetUrl: template.backgroundAssetId
            ? this.assetProxyUrl(template.backgroundAssetId)
            : null,
        });
      },
      {
        completeMetadata: (markup) => ({
          rendererType: template.rendererType,
          htmlLength: markup.length,
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
      const result = { worksheetId, format: normalized, html };
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
      const width = rendererConfig.width ?? this.defaultWidth;
      const height = rendererConfig.height ?? this.defaultHeight;
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
            storageKey,
            uri,
            outputId: output.id,
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

  private enrichAssetUrls(
    structure: Record<string, unknown>,
  ): Record<string, unknown> {
    const walk = (value: unknown): unknown => {
      if (Array.isArray(value)) {
        return value.map((item) => walk(item));
      }
      if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        const next: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(record)) {
          next[key] = walk(child);
        }
        if (typeof record.assetId === 'string' && record.assetId.trim()) {
          next.assetUrl = this.assetProxyUrl(record.assetId);
        }
        return next;
      }
      return value;
    };
    return walk(structure) as Record<string, unknown>;
  }

  private assetProxyUrl(assetId: string): string {
    return `${this.apiBaseUrl.replace(/\/$/, '')}${WORKSHEET_ASSET_IMAGE_PATH}/${assetId}/image`;
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
