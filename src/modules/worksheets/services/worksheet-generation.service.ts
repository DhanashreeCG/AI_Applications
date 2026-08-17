import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@generated/prisma/client';
import { getErrorMessage } from '../../../common/utils/error-message';
import {
  PIPELINE_STAGES,
  PipelineTelemetryContext,
} from '../../../common/events/pipeline-tracker.events';
import { PrismaService } from '../../database/prisma.service';
import { GenerateWorksheetDto } from '../dto/generate-worksheet.dto';
import { WorksheetException } from '../errors/worksheet.exception';
import {
  mapWithConcurrency,
  WORKSHEET_WORKFLOW_GENERATE,
} from '../constants/worksheet.constants';
import { GenerateWorksheetResponse } from '../types/worksheet.types';
import { asStructureRecord, collectImageQueries, normalizeImageQueryFields } from '../utils/structure.util';
import {
  WorksheetPipelineEmitter,
  createTelemetryContext,
  runTrackedStage,
} from '../telemetry/worksheet-pipeline.events';
import { WorksheetAssetService } from './worksheet-asset.service';
import { WorksheetContentService } from './worksheet-content.service';
import { WorksheetRenderService } from './worksheet-render.service';
import { WorksheetTemplateSelectionService } from './worksheet-template-selection.service';
import { WorksheetTemplateService } from './worksheet-template.service';
import { WorksheetValidationService } from './worksheet-validation.service';

export interface GenerateWorksheetOptions {
  correlationId?: string;
}

@Injectable()
export class WorksheetGenerationService {
  private readonly logger = new Logger(WorksheetGenerationService.name);
  private readonly emitter: WorksheetPipelineEmitter;
  private readonly workflowType: string;
  private readonly defaultCount: number;
  private readonly maxCount: number;
  private readonly pageSize: number;
  private readonly pageSizeMax: number;
  private readonly pagerMaxButtons: number;
  private readonly apiBaseUrl: string;
  private readonly apiPrefix: string;
  private readonly assetImagePath: string;
  private readonly pencilIconUrl: string;
  private readonly defaultAgeGroup: string;
  private readonly ageGroups: Array<{
    id: string;
    label: string;
    age: number;
    grade: string;
  }>;
  private readonly canvas: { width: number; height: number };

  constructor(
    private readonly prisma: PrismaService,
    private readonly validationService: WorksheetValidationService,
    private readonly templateSelectionService: WorksheetTemplateSelectionService,
    private readonly templateService: WorksheetTemplateService,
    private readonly contentService: WorksheetContentService,
    private readonly assetService: WorksheetAssetService,
    private readonly renderService: WorksheetRenderService,
    private readonly configService: ConfigService,
    eventEmitter: EventEmitter2,
  ) {
    this.emitter = new WorksheetPipelineEmitter(eventEmitter);
    this.workflowType = WORKSHEET_WORKFLOW_GENERATE;
    this.defaultCount = Math.max(
      1,
      this.configService.get<number>('worksheets.generateCountDefault') ?? 1,
    );
    this.maxCount = Math.max(
      this.defaultCount,
      this.configService.get<number>('worksheets.generateCountMax') ?? this.defaultCount,
    );
    this.pageSize = Math.max(
      1,
      this.configService.get<number>('worksheets.listPageSize') ?? 10,
    );
    this.pageSizeMax = Math.max(
      this.pageSize,
      this.configService.get<number>('worksheets.listPageSizeMax') ?? this.pageSize,
    );
    this.pagerMaxButtons = Math.max(
      1,
      this.configService.get<number>('worksheets.pagerMaxButtons') ?? 8,
    );
    this.apiBaseUrl = (
      this.configService.get<string>('worksheets.apiBaseUrl') ?? ''
    ).replace(/\/$/, '');
    this.apiPrefix = (
      this.configService.get<string>('worksheets.apiPrefix') ?? '/worksheets'
    ).replace(/\/$/, '');
    this.assetImagePath = (
      this.configService.get<string>('worksheets.assetImagePath') ??
      '/worksheets/assets'
    ).replace(/\/$/, '');
    this.pencilIconUrl =
      this.configService.get<string>('worksheets.pencilIconUrl') ?? '/pencil.png';
    this.defaultAgeGroup =
      this.configService.get<string>('worksheets.defaultAgeGroup') ?? '';
    this.ageGroups =
      this.configService.get<Array<{ id: string; label: string; age: number; grade: string }>>(
        'worksheets.ageGroups',
      ) ?? [];
    this.canvas = {
      width: this.configService.get<number>('worksheets.renderer.defaultWidth') ?? 1016,
      height: this.configService.get<number>('worksheets.renderer.defaultHeight') ?? 1316,
    };
  }

  public uiSettings() {
    return {
      apiBaseUrl: this.apiBaseUrl,
      apiPrefix: this.apiPrefix,
      assetImagePath: this.assetImagePath,
      pencilIconUrl: this.pencilIconUrl,
      defaultCount: this.defaultCount,
      maxCount: this.maxCount,
      pageSize: this.pageSize,
      pagerMaxButtons: this.pagerMaxButtons,
      defaultAgeGroup: this.defaultAgeGroup,
      ageGroups: this.ageGroups,
      canvas: this.canvas,
    };
  }

  public normalizeCount(count?: number): number {
    const raw = count == null || Number.isNaN(Number(count)) ? this.defaultCount : Number(count);
    return Math.min(this.maxCount, Math.max(1, Math.floor(raw)));
  }

  public async generate(
    dto: GenerateWorksheetDto,
    options: GenerateWorksheetOptions = {},
  ): Promise<GenerateWorksheetResponse> {
    const telemetry = createTelemetryContext({
      correlationId: options.correlationId,
      workflowType: this.workflowType,
    });

    this.logger.log('worksheet generation started');
    this.emitter.emitStarted({
      ...telemetry,
      metadata: {
        operation: 'generate',
        query: dto.query ?? null,
        grade: dto.grade ?? null,
        age: dto.age ?? null,
        ageGroup: dto.ageGroup ?? null,
        subject: dto.subject ?? null,
        topic: dto.topic ?? null,
        difficulty: dto.difficulty ?? null,
        language: dto.language ?? null,
        templateId: dto.templateId?.trim() || undefined,
      },
    });

    try {
      const response = await this.runGenerate(dto, telemetry);
      this.emitter.emitCompleted({
        ...telemetry,
        status: 'completed',
        metadata: {
          operation: 'generate',
          worksheetId: response.id,
          templateId: response.template.id,
          templateSlug: response.template.slug,
          topic: dto.topic ?? null,
          grade: dto.grade ?? null,
          age: dto.age ?? null,
          ageGroup: dto.ageGroup ?? null,
          subject: dto.subject ?? null,
        },
      });
      return response;
    } catch (error) {
      this.emitter.emitFailed({
        ...telemetry,
        status: 'failed',
        errorMessage: getErrorMessage(error),
      });
      throw error;
    }
  }

  private async runGenerate(
    dto: GenerateWorksheetDto,
    telemetry: PipelineTelemetryContext,
  ): Promise<GenerateWorksheetResponse> {
    await runTrackedStage(
      this.emitter,
      telemetry,
      PIPELINE_STAGES.REQUEST_VALIDATION,
      () => this.validationService.validateRequest(dto),
    );

    const analyzed = await runTrackedStage(
      this.emitter,
      telemetry,
      PIPELINE_STAGES.REQUEST_ANALYSIS,
      () => ({
        query: dto.query?.trim() || null,
        grade: dto.grade?.trim() || null,
        age: dto.age ?? null,
        ageGroup: dto.ageGroup?.trim() || null,
        subject: dto.subject?.trim() || null,
        topic: dto.topic?.trim() || null,
        difficulty: dto.difficulty?.trim() || null,
        language: dto.language?.trim() || 'English',
        explicitTemplateId: dto.templateId?.trim() || null,
      }),
      {
        completeMetadata: (result) => result,
      },
    );

    const template = await runTrackedStage(
      this.emitter,
      telemetry,
      PIPELINE_STAGES.TEMPLATE_SELECTION,
      () => this.templateSelectionService.select(dto),
      {
        startMetadata: {
          explicitTemplateId: analyzed.explicitTemplateId,
        },
        completeMetadata: (selected) => ({
          templateId: selected.id,
          templateSlug: selected.slug,
          rendererType: selected.rendererType,
          category: selected.category,
          explicitTemplateId: analyzed.explicitTemplateId,
        }),
      },
    );
    this.logger.log(`template selected slug=${template.slug} id=${template.id}`);

    const generated = await this.contentService.generateStructure(
      template,
      dto,
      telemetry,
    );
    this.logger.log('content generation completed');

    const normalized = normalizeImageQueryFields(generated);
    const imageQueries = collectImageQueries(normalized);
    this.logger.log(
      `image queries extracted count=${imageQueries.length} ${JSON.stringify(
        imageQueries.map((item) => ({ path: item.parentPath, query: item.query })),
      )}`,
    );

    const queries = await runTrackedStage(
      this.emitter,
      telemetry,
      PIPELINE_STAGES.IMAGE_QUERY_GENERATION,
      () => imageQueries,
      {
        completeMetadata: (items) => ({
          queryCount: items.length,
          queries: items.map((item) => item.query),
        }),
      },
    );

    const meta = this.templateService.parseMeta(template);
    const ageGroups =
      meta.ageMin != null && meta.ageMax != null
        ? [`${meta.ageMin}-${meta.ageMax}`]
        : undefined;

    const attached = await runTrackedStage(
      this.emitter,
      telemetry,
      PIPELINE_STAGES.IMAGE_RETRIEVAL,
      () =>
        this.assetService.attachAssets(
          normalized,
          {
            grades: dto.grade ? [dto.grade] : meta.grades,
            ageGroups,
          },
          telemetry,
        ),
      {
        startMetadata: { queryCount: queries.length },
        completeMetadata: (result) => ({
          slotCount: result.slots.length,
          resolvedCount: result.slots.filter((slot) => slot.assetId).length,
        }),
      },
    );
    this.logger.log('asset retrieval completed');

    await runTrackedStage(
      this.emitter,
      telemetry,
      PIPELINE_STAGES.IMAGE_MAPPING,
      () => attached.slots,
      {
        completeMetadata: () => ({
          mappings: attached.slots.map((slot) => ({
            path: slot.path,
            imageQuery: slot.imageQuery,
            assetId: slot.assetId,
          })),
        }),
      },
    );

    const validated = await runTrackedStage(
      this.emitter,
      telemetry,
      PIPELINE_STAGES.STRUCTURE_VALIDATION,
      () =>
        this.validationService.validateGeneratedStructure(
          this.assetService.persistableStructure(attached.structure),
          template,
          { allowEnrichmentKeys: true },
        ),
    );

    const worksheet = await runTrackedStage(
      this.emitter,
      telemetry,
      PIPELINE_STAGES.PERSISTENCE,
      () =>
        this.prisma.worksheet.create({
          data: {
            templateId: template.id,
            request: dto as Prisma.InputJsonValue,
            structure: validated as Prisma.InputJsonValue,
            status: 'GENERATED',
          },
        }),
      {
        completeMetadata: (row) => ({
          worksheetId: row.id,
          status: row.status,
        }),
      },
    );
    this.logger.log(`worksheet persisted id=${worksheet.id}`);

    const response = await runTrackedStage(
      this.emitter,
      telemetry,
      PIPELINE_STAGES.RESPONSE_ASSEMBLY,
      () => {
        const composed = this.renderService.composeHtml({
          template,
          structure: asStructureRecord(worksheet.structure),
          request: dto as unknown as Record<string, unknown>,
          mode: 'editor',
        });
        return {
          id: worksheet.id,
          status: worksheet.status,
          template: {
            id: template.id,
            slug: template.slug,
            name: template.name,
            rendererType: template.rendererType,
          },
          request: dto,
          structure: asStructureRecord(worksheet.structure),
          html: composed.html,
          canvas: composed.canvas,
        } satisfies GenerateWorksheetResponse;
      },
    );

    await runTrackedStage(
      this.emitter,
      telemetry,
      PIPELINE_STAGES.FINAL_VALIDATION,
      () => {
        if (!response.id || !response.structure) {
          throw new Error('Assembled worksheet response is incomplete');
        }
        return response;
      },
      {
        completeMetadata: {
          worksheetId: response.id,
          templateId: response.template.id,
        },
      },
    );

    await runTrackedStage(
      this.emitter,
      telemetry,
      PIPELINE_STAGES.RESPONSE_RETURN,
      () => response,
      {
        completeMetadata: {
          worksheetId: response.id,
          templateSlug: response.template.slug,
        },
      },
    );

    return response;
  }

  public async generateSet(
    dto: GenerateWorksheetDto,
    options: GenerateWorksheetOptions = {},
  ): Promise<{ items: GenerateWorksheetResponse[]; failed: number }> {
    this.validationService.validateRequest(dto);
    const count = this.normalizeCount(dto.count);
    const matching = await this.templateSelectionService.listMatching(dto, count);
    const pool = matching.length
      ? matching
      : [await this.templateSelectionService.select(dto)];
    const targets = Array.from({ length: count }, (_, index) => pool[index % pool.length]);

    const results: GenerateWorksheetResponse[] = [];
    let failed = 0;
    await mapWithConcurrency(targets, 2, async (template) => {
      try {
        const item = await this.generate(
          { ...dto, templateId: template.id, count: undefined },
          options,
        );
        results.push(item);
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `generate-set skipped template ${template.slug}: ${getErrorMessage(error)}`,
        );
      }
    });

    if (!results.length) {
      throw new WorksheetException(
        'NO_TEMPLATE_FOUND',
        'No worksheets could be generated for this request',
        HttpStatus.NOT_FOUND,
      );
    }
    return { items: results, failed };
  }

  public async list(options: { skip?: number; take?: number } = {}) {
    const skip = Math.max(0, options.skip ?? 0);
    const take = Math.min(
      this.pageSizeMax,
      Math.max(1, options.take ?? this.pageSize),
    );
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.worksheet.findMany({
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          template: true,
        },
      }),
      this.prisma.worksheet.count(),
    ]);
    return {
      total,
      skip,
      take,
      items: rows.map((row) => {
        const item = this.toListItem(row);
        const composed = this.renderService.composeHtml({
          template: row.template,
          structure: asStructureRecord(row.structure),
          request: asStructureRecord(row.request),
          mode: 'export',
        });
        return {
          ...item,
          html: composed.html,
          canvas: composed.canvas,
        };
      }),
    };
  }

  public async getById(worksheetId: string) {
    const row = await this.prisma.worksheet.findUnique({
      where: { id: worksheetId },
      include: {
        template: true,
      },
    });
    if (!row) {
      throw new WorksheetException(
        'WORKSHEET_NOT_FOUND',
        `Worksheet "${worksheetId}" was not found`,
        HttpStatus.NOT_FOUND,
      );
    }
    return {
      ...this.toListItem(row),
      status: row.status,
      request: asStructureRecord(row.request),
      structure: this.assetService.persistableStructure(
        asStructureRecord(row.structure),
      ),
      ...this.renderService.composeHtml({
        template: row.template,
        structure: asStructureRecord(row.structure),
        request: asStructureRecord(row.request),
        mode: 'editor',
      }),
    };
  }

  private toListItem(row: {
    id: string;
    status: string;
    createdAt: Date;
    request: unknown;
    structure: unknown;
    template: {
      id: string;
      name: string;
      slug: string;
      category: string;
      sampleAssetId: string | null;
    };
  }) {
    const request = asStructureRecord(row.request);
    return {
      id: row.id,
      status: row.status,
      createdAt: row.createdAt,
      topic: typeof request.topic === 'string' ? request.topic : '',
      ageGroup: typeof request.ageGroup === 'string' ? request.ageGroup : '',
      template: {
        id: row.template.id,
        name: row.template.name,
        slug: row.template.slug,
        category: row.template.category,
      },
      thumbnailUrl: row.template.sampleAssetId
        ? `${this.assetImagePath}/${row.template.sampleAssetId}/image`
        : null,
    };
  }
}
