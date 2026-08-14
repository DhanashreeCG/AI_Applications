import { HttpStatus, Injectable } from '@nestjs/common';
import { JsonSchemaNode } from '../types/worksheet.types';
import { WorksheetException } from '../errors/worksheet.exception';
import {
  asStructureRecord,
  collectImageQueries,
  parseJsonObject,
  validateAgainstSchema,
} from '../utils/structure.util';
import { WorksheetTemplateRecord } from './worksheet-template.service';

@Injectable()
export class WorksheetValidationService {
  public parseStructureDefinition(
    template: WorksheetTemplateRecord,
  ): JsonSchemaNode {
    const schema = parseJsonObject(template.structureDefinition);
    if (!schema) {
      throw new WorksheetException(
        'INVALID_STRUCTURE',
        'Template structureDefinition must be a JSON object',
      );
    }
    return schema as JsonSchemaNode;
  }

  public validateGeneratedStructure(
    structure: unknown,
    template: WorksheetTemplateRecord,
    options: { allowEnrichmentKeys?: boolean } = {},
  ): Record<string, unknown> {
    const record = asStructureRecord(structure);
    const schema = this.parseStructureDefinition(template);
    validateAgainstSchema(record, schema, 'structure', {
      allowEnrichmentKeys: options.allowEnrichmentKeys ?? false,
    });
    collectImageQueries(record);
    return record;
  }

  public validateRequest(request: {
    query?: string;
    topic?: string;
    templateId?: string;
    age?: number;
  }): void {
    const hasQuery = Boolean(request.query?.trim());
    const hasTopic = Boolean(request.topic?.trim());
    const hasTemplate = Boolean(request.templateId?.trim());
    if (!hasQuery && !hasTopic && !hasTemplate) {
      throw new WorksheetException(
        'INVALID_REQUEST',
        'Provide a query, topic, or templateId',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (request.age != null && (!Number.isFinite(request.age) || request.age < 0)) {
      throw new WorksheetException(
        'INVALID_REQUEST',
        'age must be a non-negative number',
      );
    }
  }
}
