import { randomUUID } from 'crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@generated/prisma/client';
import {
  assertGenerationRequestAllowed,
  resolveRequestCountryCode,
} from '../../../common/content-safety/assert-user-query';
import { joinPublicAssetUrl } from '../../../common/ui/toondemy-font';
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
  private readonly imagePickerLimit: number;
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
    this.pencilIconUrl = joinPublicAssetUrl(
      this.apiBaseUrl,
      this.configService.get<string>('worksheets.pencilIconUrl') ?? '/pencil.png',
    );
    this.imagePickerLimit = Math.max(
      1,
      this.configService.get<number>('worksheets.imagePickerLimit') ?? 10,
    );
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
      imagePickerLimit: this.imagePickerLimit,
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
      () => {
        const countryCode = resolveRequestCountryCode(
          dto.countryCode,
          this.configService.get<string>('flashcards.defaultCountryCode'),
        );
        assertGenerationRequestAllowed({
          query: dto.query,
          topic: dto.topic,
          countryCode,
        });
        return {
          query: dto.query?.trim() || null,
          grade: dto.grade?.trim() || null,
          age: dto.age ?? null,
          ageGroup: dto.ageGroup?.trim() || null,
          subject: dto.subject?.trim() || null,
          topic: dto.topic?.trim() || null,
          difficulty: dto.difficulty?.trim() || null,
          language: dto.language?.trim() || 'English',
          explicitTemplateId: dto.templateId?.trim() || null,
          countryCode: countryCode ?? null,
        };
      },
      {
        completeMetadata: (result) => result,
      },
    );

    const template = await runTrackedStage(
      this.emitter,
      telemetry,
      PIPELINE_STAGES.TEMPLATE_SELECTION,
      () => this.templateSelectionService.select(dto, telemetry),
      {
        startMetadata: {
          explicitTemplateId: analyzed.explicitTemplateId,
        },
        completeMetadata: (selected) => {
          const outcome = (selected as any)._aiOutcome;
          return {
            templateId: selected.id,
            templateSlug: selected.slug,
            rendererType: selected.rendererType,
            category: selected.category,
            explicitTemplateId: analyzed.explicitTemplateId,
            selectionMode: analyzed.explicitTemplateId
              ? 'explicit'
              : outcome?.usedFallback
                ? 'deterministic'
                : outcome?.result
                  ? 'ai'
                  : 'deterministic',
            aiConfidence: outcome?.result?.confidenceScore,
            aiReasoning: outcome?.result?.reasoning,
            aiFallbackReason: outcome?.fallbackReason,
          };
        },
      },
    );
    this.logger.log(`template selected slug=${template.slug} id=${template.id}`);

    const count = this.normalizeCount(dto.count);
    const generatedList = await this.contentService.generateStructures(
      template,
      dto,
      count,
      telemetry,
    );
    this.logger.log(`content generation completed structuresCount=${generatedList.length}`);

    const meta = this.templateService.parseMeta(template);
    const ageGroups =
      meta.ageMin != null && meta.ageMax != null
        ? [`${meta.ageMin}-${meta.ageMax}`]
        : undefined;

    const attachedBatch = await runTrackedStage(
      this.emitter,
      telemetry,
      PIPELINE_STAGES.IMAGE_RETRIEVAL,
      () =>
        this.assetService.attachAssetsBatch(
          generatedList,
          undefined,
          telemetry,
        ),
      {
        startMetadata: { worksheetCount: generatedList.length },
        completeMetadata: (results) => ({
          worksheetCount: results.length,
          totalSlotCount: results.reduce((acc, r) => acc + r.slots.length, 0),
          resolvedSlotCount: results.reduce(
            (acc, r) => acc + r.slots.filter((s) => s.assetId).length,
            0,
          ),
        }),
      },
    );
    this.logger.log('batch asset retrieval completed');

    // Concurrently validate, persist and compose response for each worksheet in the batch
    const validatedRows = await Promise.all(
      attachedBatch.map(async (attached) => {
        const validated = this.validationService.validateGeneratedStructure(
          this.assetService.persistableStructure(attached.structure),
          template,
          { allowEnrichmentKeys: true },
        );
        return {
          structure: validated,
          slots: attached.slots,
        };
      }),
    );

    this.emitter.emitStageSkipped({
      ...telemetry,
      stageName: PIPELINE_STAGES.PERSISTENCE,
      metadata: { reason: 'DB Persistence disabled as worksheets are saved on explicit action now' },
    });

    const persistedRows = validatedRows.map(row => ({
      id: `temp-${randomUUID()}`,
      templateId: template.id,
      request: dto as Prisma.InputJsonValue,
      structure: row.structure as Prisma.InputJsonValue,
      status: 'DRAFT',
    }));
    
    /*
    const persistedRows = await runTrackedStage(
      this.emitter,
      telemetry,
      PIPELINE_STAGES.PERSISTENCE,
      () =>
        this.prisma.$transaction(
          validatedRows.map((row) =>
            this.prisma.worksheet.create({
              data: {
                templateId: template.id,
                request: dto as Prisma.InputJsonValue,
                structure: row.structure as Prisma.InputJsonValue,
                status: 'GENERATED',
              },
            }),
          ),
        ),
      {
        completeMetadata: (rows) => ({
          count: rows.length,
          worksheetIds: rows.map((r) => r.id),
        }),
      },
    );
    */
    this.logger.log(`batch worksheets persisted count=${persistedRows.length}`);

    const responses = persistedRows.map((worksheet) => {
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
          ...this.templateService.parseAiEditUi(template),
        },
        request: dto,
        structure: asStructureRecord(worksheet.structure),
        html: composed.html,
        canvas: composed.canvas,
        fieldPrompts: this.templateService.parseFieldPrompts(template),
      } satisfies GenerateWorksheetResponse;
    });

    await runTrackedStage(
      this.emitter,
      telemetry,
      PIPELINE_STAGES.RESPONSE_RETURN,
      () => responses[0],
      {
        completeMetadata: {
          worksheetId: responses[0].id,
          totalGenerated: responses.length,
          templateSlug: responses[0].template.slug,
        },
      },
    );

    // Stash full batch responses on the first response for generateSet consumption
    // Use defineProperty to make it non-enumerable and avoid circular JSON serialization issues
    Object.defineProperty(responses[0], '_batchResponses', {
      value: responses,
      enumerable: false,
      configurable: true,
    });

    return responses[0];
  }

  public async generateSet(
    dto: GenerateWorksheetDto,
    options: GenerateWorksheetOptions = {},
  ): Promise<{ items: GenerateWorksheetResponse[]; failed: number }> {
    try {
      const first = await this.generate(dto, options);
      const requestedCount = this.normalizeCount(dto.count);
      const items: GenerateWorksheetResponse[] = (
        (first as any)._batchResponses || [first]
      ).slice(0, requestedCount);
      const failed = Math.max(0, requestedCount - items.length);
      return { items, failed };
    } catch (error) {
      this.logger.error(`generateSet failed: ${getErrorMessage(error)}`);
      throw error;
    }
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
      aiEditPopupHtml?: string | null;
      aiEditConfigJs?: string | null;
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
        ...this.templateService.parseAiEditUi(row.template as never),
      },
      thumbnailUrl: row.template.sampleAssetId
        ? `${this.assetImagePath}/${row.template.sampleAssetId}/image`
        : null,
    };
  }
}
