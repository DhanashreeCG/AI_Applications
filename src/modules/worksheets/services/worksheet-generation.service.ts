import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@generated/prisma/client';
import { getErrorMessage } from '../../../common/utils/error-message';
import {
  PIPELINE_STAGES,
  PipelineTelemetryContext,
} from '../../../common/events/pipeline-tracker.events';
import { PrismaService } from '../../database/prisma.service';
import { GenerateWorksheetDto } from '../dto/generate-worksheet.dto';
import { WORKSHEET_WORKFLOW_GENERATE } from '../constants/worksheet.constants';
import { GenerateWorksheetResponse } from '../types/worksheet.types';
import { asStructureRecord, collectImageQueries } from '../utils/structure.util';
import {
  WorksheetPipelineEmitter,
  createTelemetryContext,
  runTrackedStage,
} from '../telemetry/worksheet-pipeline.events';
import { WorksheetAssetService } from './worksheet-asset.service';
import { WorksheetContentService } from './worksheet-content.service';
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly validationService: WorksheetValidationService,
    private readonly templateSelectionService: WorksheetTemplateSelectionService,
    private readonly templateService: WorksheetTemplateService,
    private readonly contentService: WorksheetContentService,
    private readonly assetService: WorksheetAssetService,
    eventEmitter: EventEmitter2,
  ) {
    this.emitter = new WorksheetPipelineEmitter(eventEmitter);
    this.workflowType = WORKSHEET_WORKFLOW_GENERATE;
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

    const queries = await runTrackedStage(
      this.emitter,
      telemetry,
      PIPELINE_STAGES.IMAGE_QUERY_GENERATION,
      () => collectImageQueries(generated),
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
          generated,
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
            imageUrl: slot.imageUrl,
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
          attached.structure,
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
      () =>
        ({
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
        }) satisfies GenerateWorksheetResponse,
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
}
