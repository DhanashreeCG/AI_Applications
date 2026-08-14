import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@generated/prisma/client';
import { getErrorMessage } from '../../../common/utils/error-message';
import {
  PIPELINE_STAGES,
  PipelineTelemetryContext,
} from '../../../common/events/pipeline-tracker.events';
import { PrismaService } from '../../database/prisma.service';
import { WORKSHEET_WORKFLOW_EDIT } from '../constants/worksheet.constants';
import { EditWorksheetDto } from '../dto/edit-worksheet.dto';
import { WorksheetException } from '../errors/worksheet.exception';
import { GenerateWorksheetResponse } from '../types/worksheet.types';
import {
  asStructureRecord,
  collectImageQueries,
  getValueAtPath,
  isEditableField,
  setValueAtPath,
} from '../utils/structure.util';
import {
  WorksheetPipelineEmitter,
  createTelemetryContext,
  runTrackedStage,
} from '../telemetry/worksheet-pipeline.events';
import { WorksheetAssetService } from './worksheet-asset.service';
import { WorksheetContentService } from './worksheet-content.service';
import { WorksheetTemplateService } from './worksheet-template.service';
import { WorksheetValidationService } from './worksheet-validation.service';

export interface EditWorksheetOptions {
  correlationId?: string;
}

@Injectable()
export class WorksheetEditService {
  private readonly logger = new Logger(WorksheetEditService.name);
  private readonly emitter: WorksheetPipelineEmitter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly templateService: WorksheetTemplateService,
    private readonly contentService: WorksheetContentService,
    private readonly validationService: WorksheetValidationService,
    private readonly assetService: WorksheetAssetService,
    eventEmitter: EventEmitter2,
  ) {
    this.emitter = new WorksheetPipelineEmitter(eventEmitter);
  }

  public async edit(
    worksheetId: string,
    dto: EditWorksheetDto,
    options: EditWorksheetOptions = {},
  ): Promise<GenerateWorksheetResponse> {
    const telemetry = createTelemetryContext({
      correlationId: options.correlationId,
      workflowType: WORKSHEET_WORKFLOW_EDIT,
    });
    const fieldPath = (dto.fieldPath || dto.field || '').trim();

    this.emitter.emitStarted({
      ...telemetry,
      metadata: {
        operation: 'edit',
        worksheetId,
        fieldPath: fieldPath || null,
      },
    });

    try {
      const response = await this.runEdit(worksheetId, dto, telemetry);
      this.emitter.emitCompleted({
        ...telemetry,
        status: 'completed',
        metadata: {
          operation: 'edit',
          worksheetId: response.id,
          templateId: response.template.id,
          templateSlug: response.template.slug,
          fieldPath,
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

  private async runEdit(
    worksheetId: string,
    dto: EditWorksheetDto,
    telemetry: PipelineTelemetryContext,
  ): Promise<GenerateWorksheetResponse> {
    const fieldPath = await runTrackedStage(
      this.emitter,
      telemetry,
      PIPELINE_STAGES.REQUEST_VALIDATION,
      () => {
        const path = (dto.fieldPath || dto.field || '').trim();
        const instruction = dto.instruction?.trim();
        if (!path) {
          throw new WorksheetException(
            'INVALID_FIELD',
            'Provide field or fieldPath',
          );
        }
        if (!instruction) {
          throw new WorksheetException(
            'INVALID_REQUEST',
            'instruction is required',
          );
        }
        return path;
      },
    );

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
        startMetadata: { worksheetId },
        completeMetadata: (row) => ({
          worksheetId: row.id,
          templateId: row.templateId,
          status: row.status,
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

    const resolved = await runTrackedStage(
      this.emitter,
      telemetry,
      PIPELINE_STAGES.FIELD_RESOLUTION,
      () => {
        const aiConfig = this.templateService.parseAiConfig(template);
        if (!isEditableField(fieldPath, aiConfig.editableFields)) {
          throw new WorksheetException(
            'FIELD_NOT_EDITABLE',
            `Field "${fieldPath}" is not editable for this template`,
          );
        }
        const structure = asStructureRecord(worksheet.structure);
        return {
          structure,
          currentValue: getValueAtPath(structure, fieldPath),
          fieldPrompts: this.templateService.parseFieldPrompts(template),
          linkedValues: this.resolveLinkedValues(
            structure,
            fieldPath,
            aiConfig.linkedFields,
          ),
        };
      },
      {
        completeMetadata: { fieldPath, editable: true },
      },
    );

    const replacement = await this.contentService.generateFieldReplacement({
      systemPrompt: template.aiSystemPrompt,
      fieldPath,
      fieldPrompt:
        resolved.fieldPrompts[fieldPath] ||
        resolved.fieldPrompts[String(fieldPath.split(/[.[]/)[0])],
      instruction: dto.instruction.trim(),
      currentValue: resolved.currentValue,
      worksheetStructure: resolved.structure,
      linkedValues: resolved.linkedValues,
      telemetry,
    });

    let next = setValueAtPath(resolved.structure, fieldPath, replacement);
    next = await runTrackedStage(
      this.emitter,
      telemetry,
      PIPELINE_STAGES.STRUCTURE_VALIDATION,
      () =>
        this.validationService.validateGeneratedStructure(next, template, {
          allowEnrichmentKeys: true,
        }),
    );

    const previousQueries = new Map(
      collectImageQueries(resolved.structure).map((item) => [
        item.path,
        item.query,
      ]),
    );
    const nextQueries = collectImageQueries(next);
    const changed = nextQueries.filter(
      (item) => previousQueries.get(item.path) !== item.query,
    );

    if (changed.length) {
      const meta = this.templateService.parseMeta(template);
      next = await runTrackedStage(
        this.emitter,
        telemetry,
        PIPELINE_STAGES.IMAGE_RETRIEVAL,
        async () => {
          let updated = next;
          for (const item of changed) {
            const slot = await this.assetService.resolveSlot(
              item.query,
              item.parentPath,
              { grades: meta.grades },
              telemetry,
            );
            if (slot.assetId) {
              updated = setValueAtPath(
                updated,
                `${item.parentPath}.assetId`,
                slot.assetId,
              );
            }
          }
          return updated;
        },
        {
          startMetadata: { changedQueryCount: changed.length },
          completeMetadata: { changedQueryCount: changed.length },
        },
      );
      this.logger.log('image query edit triggered asset re-resolution');
    } else {
      this.emitter.emitStageSkipped({
        ...telemetry,
        stageName: PIPELINE_STAGES.IMAGE_RETRIEVAL,
        metadata: { reason: 'image_query_unchanged' },
      });
    }

    const updated = await runTrackedStage(
      this.emitter,
      telemetry,
      PIPELINE_STAGES.PERSISTENCE,
      () =>
        this.prisma.worksheet.update({
          where: { id: worksheet.id },
          data: { structure: next as Prisma.InputJsonValue },
        }),
      {
        completeMetadata: (row) => ({ worksheetId: row.id }),
      },
    );

    const response: GenerateWorksheetResponse = {
      id: updated.id,
      status: updated.status,
      template: {
        id: template.id,
        slug: template.slug,
        name: template.name,
        rendererType: template.rendererType,
      },
      request: asStructureRecord(updated.request),
      structure: asStructureRecord(updated.structure),
    };

    await runTrackedStage(
      this.emitter,
      telemetry,
      PIPELINE_STAGES.RESPONSE_RETURN,
      () => response,
      {
        completeMetadata: { worksheetId: response.id, fieldPath },
      },
    );

    return response;
  }

  private resolveLinkedValues(
    structure: Record<string, unknown>,
    fieldPath: string,
    linkedFields?: Record<string, string[]>,
  ): Record<string, unknown> {
    if (!linkedFields) {
      return {};
    }
    const keys = [
      ...(linkedFields[fieldPath] ?? []),
      ...(linkedFields[fieldPath.split(/[.[]/)[0]] ?? []),
    ];
    const values: Record<string, unknown> = {};
    for (const key of keys) {
      try {
        values[key] = getValueAtPath(structure, key);
      } catch {
        values[key] = null;
      }
    }
    return values;
  }
}
