import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@generated/prisma/client';
import { getErrorMessage } from '../../../common/utils/error-message';
import {
  PIPELINE_STAGES,
  PipelineTelemetryContext,
} from '../../../common/events/pipeline-tracker.events';
import { PrismaService } from '../../database/prisma.service';
import {
  WORKSHEET_REGENERATE_STAGE,
  WORKSHEET_WORKFLOW_REGENERATE,
} from '../constants/worksheet.constants';
import {
  WorksheetPipelineEmitter,
  createTelemetryContext,
  runTrackedStage,
} from '../telemetry/worksheet-pipeline.events';
import {
  assertGenerationRequestAllowed,
  throwContentNotAllowed,
} from '../../../common/content-safety/assert-user-query';
import { containsForbiddenContent } from '../../flashcards/utils/content-restriction.registry';
import { EditWorksheetDto } from '../dto/edit-worksheet.dto';
import { GenerateWorksheetDto } from '../dto/generate-worksheet.dto';
import { SaveWorksheetDto } from '../dto/save-worksheet.dto';
import { RegenerateWorksheetDto } from '../dto/regenerate-worksheet.dto';
import { WorksheetException } from '../errors/worksheet.exception';
import { GenerateWorksheetResponse } from '../types/worksheet.types';
import {
  asStructureRecord,
  collectImageQueries,
  collectImageSlots,
  getValueAtPath,
  isEditableField,
  looksLikeHtml,
  resolveAliasFieldPath,
  setValueAtPath,
  visualQueryFromImageRecord,
} from '../utils/structure.util';
import { applyNumberMatchOverrides } from '../utils/number-match.util';
import { WorksheetAssetService } from './worksheet-asset.service';
import { WorksheetContentService } from './worksheet-content.service';
import { WorksheetRenderService } from './worksheet-render.service';
import {
  WorksheetTemplateRecord,
  WorksheetTemplateService,
} from './worksheet-template.service';
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
    private readonly renderService: WorksheetRenderService,
    eventEmitter: EventEmitter2,
  ) {
    this.emitter = new WorksheetPipelineEmitter(eventEmitter);
  }

  public async edit(
    worksheetId: string,
    dto: EditWorksheetDto,
    _options: EditWorksheetOptions = {},
  ): Promise<GenerateWorksheetResponse> {
    return this.runEdit(worksheetId, dto);
  }

  private async runEdit(
    worksheetId: string,
    dto: EditWorksheetDto,
  ): Promise<GenerateWorksheetResponse> {
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
    assertGenerationRequestAllowed({
      query: instruction,
      countryCode: dto.countryCode,
    });
    const worksheet = await this.prisma.worksheet.findUnique({
      where: { id: worksheetId },
    });
    const inMemory =
      !worksheet &&
      worksheetId.startsWith('temp-') &&
      dto.templateId &&
      dto.structure &&
      typeof dto.structure === 'object';
    if (!worksheet && !inMemory) {
      throw new WorksheetException(
        'WORKSHEET_NOT_FOUND',
        `Worksheet "${worksheetId}" was not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    const template = worksheet
      ? await this.templateService.getById(worksheet.templateId)
      : await this.templateService.getActiveByIdOrSlug(String(dto.templateId));

    const aiConfig = this.templateService.parseAiConfig(template);
    const structure = asStructureRecord(
      worksheet ? worksheet.structure : dto.structure,
    );
    const fieldPath = resolveAliasFieldPath(structure, path);
    const currentValue = getValueAtPath(structure, fieldPath);
    const declared = isEditableField(fieldPath, aiConfig.editableFields);
    const leaf =
      typeof currentValue === 'string' || typeof currentValue === 'number';
    if (!declared && !leaf) {
      throw new WorksheetException(
        'FIELD_NOT_EDITABLE',
        `Field "${fieldPath}" is not editable for this template`,
      );
    }
    const resolved = {
      structure,
      currentValue,
      fieldPrompts: this.templateService.parseFieldPrompts(template),
      linkedValues: this.resolveLinkedValues(
        structure,
        fieldPath,
        aiConfig.linkedFields,
      ),
    };

    const replacement = await this.contentService.generateFieldReplacement({
      systemPrompt: template.aiSystemPrompt,
      fieldPath,
      fieldPrompt:
        resolved.fieldPrompts[path] ||
        resolved.fieldPrompts[fieldPath] ||
        resolved.fieldPrompts[String(fieldPath.split(/[.[]/)[0])],
      instruction: dto.instruction.trim(),
      currentValue: resolved.currentValue,
      worksheetStructure: resolved.structure,
      linkedValues: resolved.linkedValues,
      countryCode: dto.countryCode,
    });

    let next = setValueAtPath(resolved.structure, fieldPath, replacement);
    next = await this.validationService.validateGeneratedStructure(
      this.assetService.persistableStructure(next),
      template,
      { allowEnrichmentKeys: true },
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
      for (const item of changed) {
        const slot = await this.assetService.resolveSlot(
          item.query,
          item.parentPath,
          { grades: meta.grades },
        );
        next = this.assetService.applySlot(next, slot);
      }
      this.logger.log('image query edit triggered asset re-resolution');
    }

    if (!worksheet) {
      return this.toResponse(
        {
          id: worksheetId,
          status: 'GENERATED',
          request: {},
          structure: this.assetService.persistableStructure(next),
        },
        template,
      );
    }

    const updated = await this.prisma.worksheet.update({
      where: { id: worksheet.id },
      data: {
        structure: this.assetService.persistableStructure(
          next,
        ) as Prisma.InputJsonValue,
      },
    });

    return this.toResponse(updated, template);
  }

  public async replaceImage(
    worksheetId: string,
    path: string,
    assetId: string,
  ): Promise<GenerateWorksheetResponse> {
    const worksheet = await this.requireWorksheet(worksheetId);
    const template = await this.templateService.getById(worksheet.templateId);
    await this.assetService.resolveAsset(assetId);

    const structure = asStructureRecord(worksheet.structure);
    const targetPath = path.trim();
    if (!targetPath) {
      throw new WorksheetException('INVALID_FIELD', 'path is required');
    }

    const parent = getValueAtPath(structure, targetPath);
    if (!parent || typeof parent !== 'object' || Array.isArray(parent)) {
      throw new WorksheetException(
        'INVALID_FIELD',
        `Field path "${targetPath}" is not an image slot`,
      );
    }

    const next = this.assetService.applyLibraryImage(structure, targetPath, assetId);
    const updated = await this.prisma.worksheet.update({
      where: { id: worksheet.id },
      data: { structure: next as Prisma.InputJsonValue },
    });
    return this.toResponse(updated, template);
  }

  public async updateField(
    worksheetId: string,
    fieldPath: string,
    value: unknown,
  ): Promise<GenerateWorksheetResponse> {
    const worksheet = await this.requireWorksheet(worksheetId);
    const template = await this.templateService.getById(worksheet.templateId);
    const aiConfig = this.templateService.parseAiConfig(template);
    const path = fieldPath.trim();
    const structure = asStructureRecord(worksheet.structure);
    const current = getValueAtPath(structure, path);
    const leaf = typeof current === 'string' || typeof current === 'number';
    if (
      aiConfig.editableFields?.length &&
      !isEditableField(path, aiConfig.editableFields) &&
      !leaf
    ) {
      throw new WorksheetException(
        'FIELD_NOT_EDITABLE',
        `Field "${path}" is not editable for this template`,
      );
    }
    if (typeof value === 'string' && looksLikeHtml(value)) {
      throw new WorksheetException(
        'INVALID_STRUCTURE',
        `${path} must be inserted as text, not HTML`,
      );
    }

    let next = setValueAtPath(structure, path, value);
    next = this.validationService.validateGeneratedStructure(next, template, {
      allowEnrichmentKeys: true,
    });

    const previousQueries = new Map(
      collectImageQueries(structure).map((item) => [item.path, item.query]),
    );
    const changed = collectImageQueries(next).filter(
      (item) => previousQueries.get(item.path) !== item.query,
    );
    if (changed.length) {
      const meta = this.templateService.parseMeta(template);
      for (const item of changed) {
        const slot = await this.assetService.resolveSlot(item.query, item.parentPath, {
          grades: meta.grades,
        });
        next = this.assetService.applySlot(next, slot);
      }
    }

    const updated = await this.prisma.worksheet.update({
      where: { id: worksheet.id },
      data: {
        structure: this.assetService.persistableStructure(
          next,
        ) as Prisma.InputJsonValue,
      },
    });
    return this.toResponse(updated, template);
  }

  public async searchImages(
    worksheetId: string,
    options: { query?: string; path?: string; limit?: number; countryCode?: string },
  ): Promise<{
    query: string;
    results: Array<{
      assetId: string;
      caption: string;
      searchDescription: string;
      imageUrl: string;
    }>;
  }> {
    const worksheet = await this.requireWorksheet(worksheetId);
    let query = options.query?.trim() || '';
    if (!query && options.path?.trim()) {
      const structure = asStructureRecord(worksheet.structure);
      const requested = options.path.trim();
      const node = getValueAtPath(structure, requested);
      if (node && typeof node === 'object' && !Array.isArray(node)) {
        query = visualQueryFromImageRecord(node as Record<string, unknown>) || '';
      }
      if (!query) {
        const match = collectImageSlots(structure).find(
          (slot) => slot.path === requested || slot.slotId === requested,
        );
        query = match?.imageQuery || '';
      }
    }
    if (!query) {
      return { query: '', results: [] };
    }
    const results = await this.assetService.searchCandidates(
      query,
      options.limit,
      options.countryCode,
    );
    return { query, results };
  }

  public async searchLibrary(options: {
    query?: string;
    limit?: number;
    countryCode?: string;
  }): Promise<{
    query: string;
    results: Array<{
      assetId: string;
      caption: string;
      searchDescription: string;
      imageUrl: string;
    }>;
  }> {
    const query = options.query?.trim() || '';
    if (!query) {
      return { query: '', results: [] };
    }
    const results = await this.assetService.searchCandidates(
      query,
      options.limit,
      options.countryCode,
    );
    return { query, results };
  }

  public async uploadImage(
    worksheetId: string,
    path: string,
    file: { buffer: Buffer; mimetype?: string; originalname?: string; size?: number },
  ): Promise<{
    path: string;
    userUploadedKey: string;
    imageUrl: string;
    contentType: string;
  }> {
    const worksheet = await this.requireWorksheet(worksheetId);
    const targetPath = path.trim();
    if (!targetPath) {
      throw new WorksheetException('INVALID_FIELD', 'path is required');
    }
    const parent = getValueAtPath(asStructureRecord(worksheet.structure), targetPath);
    if (!parent || typeof parent !== 'object' || Array.isArray(parent)) {
      throw new WorksheetException(
        'INVALID_FIELD',
        `Field path "${targetPath}" is not an image slot`,
      );
    }
    const uploaded = await this.assetService.uploadUserImage(worksheetId, file);
    return {
      path: targetPath,
      userUploadedKey: uploaded.key,
      imageUrl: uploaded.imageUrl,
      contentType: uploaded.contentType,
    };
  }

  public async loadUserUpload(worksheetId: string, uploadId: string) {
    await this.requireWorksheet(worksheetId);
    return this.assetService.loadUserUpload(worksheetId, uploadId);
  }

  public async saveEdits(
    worksheetId: string,
    dto: SaveWorksheetDto,
  ): Promise<GenerateWorksheetResponse> {
    const worksheet = await this.requireWorksheet(worksheetId);
    const template = await this.templateService.getById(worksheet.templateId);
    const aiConfig = this.templateService.parseAiConfig(template);
    let next = asStructureRecord(worksheet.structure);

    for (const field of dto.fields ?? []) {
      const path = field.path?.trim();
      if (!path) continue;
      if (typeof field.value === 'string' && looksLikeHtml(field.value)) {
        throw new WorksheetException(
          'INVALID_STRUCTURE',
          `${path} must be inserted as text, not HTML`,
        );
      }
      if (
        aiConfig.editableFields?.length &&
        !isEditableField(path, aiConfig.editableFields)
      ) {
        const current = getValueAtPath(next, path);
        const leaf = typeof current === 'string' || typeof current === 'number';
        if (!leaf) {
          this.logger.debug(`save skipped non-editable field ${path}`);
          continue;
        }
      }
      try {
        next = setValueAtPath(next, path, field.value);
      } catch (error) {
        this.logger.debug(
          `save skipped missing field ${path}: ${getErrorMessage(error)}`,
        );
      }
    }

    for (const image of dto.images ?? []) {
      const path = image.path?.trim();
      if (!path) continue;
      if (image.userUploadedKey?.trim()) {
        next = this.assetService.applyUserUploadedImage(next, path, {
          key: image.userUploadedKey.trim(),
        });
        continue;
      }
      if (image.assetId?.trim()) {
        await this.assetService.resolveAsset(image.assetId.trim());
        next = this.assetService.applyLibraryImage(next, path, image.assetId.trim());
      }
    }

    next = this.validationService.validateGeneratedStructure(next, template, {
      allowEnrichmentKeys: true,
    });
    next = this.assetService.persistableStructure(next);

    const updated = await this.prisma.worksheet.update({
      where: { id: worksheet.id },
      data: { structure: next as Prisma.InputJsonValue },
    });
    return this.toResponse(updated, template);
  }

  public async regenerate(
    worksheetId: string,
    dto: RegenerateWorksheetDto,
    options: EditWorksheetOptions = {},
  ): Promise<GenerateWorksheetResponse> {
    const telemetry = createTelemetryContext({
      correlationId: options.correlationId,
      workflowType: WORKSHEET_WORKFLOW_REGENERATE,
    });
    this.emitter.emitStarted({
      ...telemetry,
      metadata: {
        operation: 'regenerate',
        worksheetId,
        topic: dto.topic ?? dto.fields?.topic ?? null,
        ageGroup: dto.ageGroup ?? null,
        fields: dto.fields ?? {},
      },
    });
    try {
      const response = await this.runRegenerate(worksheetId, dto, telemetry);
      this.emitter.emitCompleted({
        ...telemetry,
        status: 'completed',
        metadata: {
          operation: 'regenerate',
          worksheetId: response.id,
          templateId: response.template.id,
          templateSlug: response.template.slug,
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

  private async runRegenerate(
    worksheetId: string,
    dto: RegenerateWorksheetDto,
    telemetry: PipelineTelemetryContext,
  ): Promise<GenerateWorksheetResponse> {
    const fields = this.inferMatchFields(this.normalizeFields(dto.fields));
    const query =
      dto.query?.trim() ||
      this.instructionFromFields(fields);
    if (!query) {
      throw new WorksheetException(
        'INVALID_REQUEST',
        'Provide requirements to regenerate this worksheet',
      );
    }
    const topic = dto.topic?.trim() || fields.topic || undefined;
    this.assertSafeUserText(query, 'query', dto.countryCode);
    this.assertSafeUserText(topic, 'topic', dto.countryCode);
    for (const [key, value] of Object.entries(fields)) {
      this.assertSafeUserText(value, `fields.${key}`, dto.countryCode);
    }
    assertGenerationRequestAllowed({
      query,
      topic,
      countryCode: dto.countryCode,
    });

    const worksheet = await this.prisma.worksheet.findUnique({
      where: { id: worksheetId },
    });
    const inMemory =
      !worksheet &&
      worksheetId.startsWith('temp-') &&
      Boolean(dto.templateId);
    if (!worksheet && !inMemory) {
      throw new WorksheetException(
        'WORKSHEET_NOT_FOUND',
        `Worksheet "${worksheetId}" was not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    const template = worksheet
      ? await this.templateService.getById(worksheet.templateId)
      : await this.templateService.getActiveByIdOrSlug(String(dto.templateId));

    const previousRequest = asStructureRecord(
      worksheet?.request ?? dto.request ?? {},
    );
    const currentStructure = asStructureRecord(
      dto.structure ?? worksheet?.structure ?? {},
    );
    const generateDto = {
      ...previousRequest,
      query,
      topic: topic || query,
      ageGroup: dto.ageGroup?.trim() || previousRequest.ageGroup,
      age: dto.age ?? previousRequest.age,
      countryCode: dto.countryCode || previousRequest.countryCode,
      templateId: template.id,
      fields,
    } as GenerateWorksheetDto & { fields?: Record<string, string> };

    const generated = await runTrackedStage(
      this.emitter,
      telemetry,
      PIPELINE_STAGES.LLM_CONTENT_GENERATION,
      () =>
        this.contentService.generateStructure(template, generateDto, telemetry, {
          currentStructure,
          systemPrompt: template.aiSystemPrompt,
          stage: WORKSHEET_REGENERATE_STAGE,
        }),
      {
        startMetadata: { fields, query },
        completeMetadata: { templateSlug: template.slug },
      },
    );
    const leaked = this.findForbiddenTerm(generated, generateDto.countryCode);
    if (leaked) {
      throwContentNotAllowed(leaked, 'generated content', generateDto.countryCode);
    }
    const meta = this.templateService.parseMeta(template);
    const attached = await runTrackedStage(
      this.emitter,
      telemetry,
      PIPELINE_STAGES.IMAGE_RETRIEVAL,
      () =>
        this.assetService.attachAssets(
          generated,
          {
            grades: generateDto.grade ? [String(generateDto.grade)] : meta.grades,
            ageGroups: generateDto.ageGroup ? [String(generateDto.ageGroup)] : undefined,
          },
          telemetry,
        ),
    );
    const validated = await runTrackedStage(
      this.emitter,
      telemetry,
      PIPELINE_STAGES.CONTENT_VALIDATION,
      () =>
        this.applyFieldOverrides(
          this.validationService.validateGeneratedStructure(
            this.assetService.persistableStructure(attached.structure),
            template,
            { allowEnrichmentKeys: true },
          ),
          fields,
        ),
    );
    if (!worksheet) {
      return this.toResponse(
        {
          id: worksheetId,
          status: 'GENERATED',
          request: generateDto,
          structure: validated,
        },
        template,
      );
    }
    const updated = await this.prisma.worksheet.update({
      where: { id: worksheet.id },
      data: {
        request: generateDto as Prisma.InputJsonValue,
        structure: validated as Prisma.InputJsonValue,
        status: 'GENERATED',
      },
    });
    return this.toResponse(updated, template);
  }

  private async requireWorksheet(worksheetId: string) {
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
  }

  private toResponse(
    worksheet: {
      id: string;
      status: string;
      request: unknown;
      structure: unknown;
    },
    template: WorksheetTemplateRecord,
  ): GenerateWorksheetResponse {
    const composed = this.renderService.composeHtml({
      template,
      structure: asStructureRecord(worksheet.structure),
      request: asStructureRecord(worksheet.request),
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
      request: asStructureRecord(worksheet.request),
      structure: asStructureRecord(worksheet.structure),
      html: composed.html,
      canvas: composed.canvas,
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

  private normalizeFields(fields?: Record<string, string>): Record<string, string> {
    if (!fields || typeof fields !== 'object') return {};
    const next: Record<string, string> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (typeof value === 'string' && value.trim()) {
        next[key] = value.trim();
      }
    }
    return next;
  }

  private inferMatchFields(fields: Record<string, string>): Record<string, string> {
    const next = { ...fields };
    if (!next.matchType && next.topic) {
      const topic = next.topic.toLowerCase();
      if (/roman/.test(topic)) next.matchType = 'roman_numerals';
      else if (/ordinal/.test(topic)) next.matchType = 'ordinals';
      else if (/addition|\+/.test(topic)) next.matchType = 'addition';
      else if (/subtract|minus/.test(topic)) next.matchType = 'subtraction';
      else if (/multipl|times|×/.test(topic)) next.matchType = 'multiplication';
      else if (/division|÷/.test(topic)) next.matchType = 'division';
    }
    return next;
  }

  private applyFieldOverrides(
    structure: Record<string, unknown>,
    fields: Record<string, string>,
  ): Record<string, unknown> {
    return applyNumberMatchOverrides(structure, fields);
  }

  private instructionFromFields(fields: Record<string, string>): string {
    const parts = Object.entries(fields).map(([key, value]) =>
      key === 'topic' ? `Change the topic to "${value}".` : `For ${key}: ${value}.`,
    );
    return parts.join(' ');
  }

  private assertSafeUserText(
    value: string | undefined,
    field: string,
    countryCode?: string,
  ): void {
    if (!value?.trim()) return;
    const matched = containsForbiddenContent(value, countryCode);
    if (matched) {
      throwContentNotAllowed(matched, field, countryCode);
    }
  }

  private findForbiddenTerm(
    value: unknown,
    countryCode?: string,
  ): string | undefined {
    if (typeof value === 'string') {
      return containsForbiddenContent(value, countryCode);
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const matched = this.findForbiddenTerm(item, countryCode);
        if (matched) return matched;
      }
      return undefined;
    }
    if (value && typeof value === 'object') {
      for (const item of Object.values(value)) {
        const matched = this.findForbiddenTerm(item, countryCode);
        if (matched) return matched;
      }
    }
    return undefined;
  }
}
