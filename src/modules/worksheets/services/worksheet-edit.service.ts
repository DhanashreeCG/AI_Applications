import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
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
import { WorksheetAssetService } from './worksheet-asset.service';
import { WorksheetContentService } from './worksheet-content.service';
import { WorksheetTemplateService } from './worksheet-template.service';
import { WorksheetValidationService } from './worksheet-validation.service';

@Injectable()
export class WorksheetEditService {
  private readonly logger = new Logger(WorksheetEditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly templateService: WorksheetTemplateService,
    private readonly contentService: WorksheetContentService,
    private readonly validationService: WorksheetValidationService,
    private readonly assetService: WorksheetAssetService,
  ) {}

  public async edit(
    worksheetId: string,
    dto: EditWorksheetDto,
  ): Promise<GenerateWorksheetResponse> {
    const fieldPath = (dto.fieldPath || dto.field || '').trim();
    const instruction = dto.instruction?.trim();
    if (!fieldPath) {
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
    const aiConfig = this.templateService.parseAiConfig(template);
    if (!isEditableField(fieldPath, aiConfig.editableFields)) {
      throw new WorksheetException(
        'FIELD_NOT_EDITABLE',
        `Field "${fieldPath}" is not editable for this template`,
      );
    }

    const structure = asStructureRecord(worksheet.structure);
    const currentValue = getValueAtPath(structure, fieldPath);
    const fieldPrompts = this.templateService.parseFieldPrompts(template);
    const linkedValues = this.resolveLinkedValues(
      structure,
      fieldPath,
      aiConfig.linkedFields,
    );

    const replacement = await this.contentService.generateFieldReplacement({
      systemPrompt: template.aiSystemPrompt,
      fieldPath,
      fieldPrompt: fieldPrompts[fieldPath] || fieldPrompts[String(fieldPath.split(/[.[]/)[0])],
      instruction,
      currentValue,
      worksheetStructure: structure,
      linkedValues,
    });

    let next = setValueAtPath(structure, fieldPath, replacement);
    next = this.validationService.validateGeneratedStructure(next, template, {
      allowEnrichmentKeys: true,
    });

    const previousQueries = new Map(
      collectImageQueries(structure).map((item) => [item.path, item.query]),
    );
    const nextQueries = collectImageQueries(next);
    const changed = nextQueries.filter(
      (item) => previousQueries.get(item.path) !== item.query,
    );

    if (changed.length) {
      const meta = this.templateService.parseMeta(template);
      for (const item of changed) {
        const slot = await this.assetService.resolveSlot(
          item.query,
          item.parentPath,
          { grades: meta.grades },
        );
        if (slot.assetId) {
          next = setValueAtPath(next, `${item.parentPath}.assetId`, slot.assetId);
        }
      }
      this.logger.log('image query edit triggered asset re-resolution');
    }

    const updated = await this.prisma.worksheet.update({
      where: { id: worksheet.id },
      data: {
        structure: next as Prisma.InputJsonValue,
      },
    });

    return {
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
