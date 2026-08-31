import { Injectable } from '@nestjs/common';
import {
  EditableField,
  JsonSchemaNode,
  WorksheetAiConfig,
  WorksheetEditableFieldType,
} from '../types/worksheet.types';
import { collectImageSlots, parseJsonObject } from '../utils/structure.util';
import { WorksheetTemplateRecord } from './worksheet-template.service';

@Injectable()
export class WorksheetFieldMetadataService {
  public normalize(
    template: WorksheetTemplateRecord,
    structure: Record<string, unknown>,
  ): EditableField[] {
    const storedAi = (parseJsonObject(template.aiConfig) ?? {}) as WorksheetAiConfig;
    const schema = parseJsonObject(template.structureDefinition) as JsonSchemaNode | null;
    const definitionAi = (schema && typeof schema === 'object'
      ? ((schema as Record<string, unknown>).ai_config as WorksheetAiConfig | undefined)
      : undefined) ?? {};
    const definitionEditable = (schema && typeof schema === 'object'
      ? ((schema as Record<string, unknown>).editable_fields as WorksheetAiConfig['editable_fields'])
      : undefined) ?? {};
    const fields = new Map<string, EditableField>();

    const declared = storedAi.editableFields ?? [];
    const aiEditableList =
      storedAi.aiEditable ??
      (Array.isArray((definitionAi as Record<string, unknown>).ai_editable)
        ? ((definitionAi as Record<string, unknown>).ai_editable as string[])
        : definitionAi.aiEditable) ??
      declared;
    const prototypeMap = {
      ...definitionEditable,
      ...(storedAi.editable_fields ?? {}),
    };

    for (const [id, raw] of Object.entries(prototypeMap)) {
      const path =
        (typeof raw.path === 'string' && raw.path) ||
        (typeof raw.key === 'string' && raw.key) ||
        id;
      const type = this.asType(raw.type) ?? this.inferType(structure, path, schema);
      fields.set(path, {
        type,
        path,
        editable: raw.editable !== false,
        aiEditable:
          raw.aiEditable === true ||
          aiEditableList.includes(id) ||
          aiEditableList.includes(path),
        selector: typeof raw.selector === 'string' ? raw.selector : undefined,
      });
    }

    for (const path of declared) {
      if (fields.has(path)) {
        const existing = fields.get(path)!;
        fields.set(path, {
          ...existing,
          editable: true,
          aiEditable: existing.aiEditable || aiEditableList.includes(path),
        });
        continue;
      }
      fields.set(path, {
        type: this.inferType(structure, path, schema),
        path,
        editable: true,
        aiEditable: aiEditableList.includes(path),
        selector: `[data-editable='${path}']`,
      });
    }

    for (const slot of collectImageSlots(structure)) {
      const path = slot.path || slot.slotId;
      const existing = fields.get(path) ?? fields.get(slot.slotId);
      const parentEditable =
        declared.includes(path) ||
        declared.includes(slot.slotId) ||
        declared.some((item) => path === item || path.startsWith(`${item}[`) || path.startsWith(`${item}.`));
      fields.set(path, {
        type: 'image',
        path,
        editable: existing?.editable ?? parentEditable ?? true,
        aiEditable: existing?.aiEditable ?? parentEditable,
        selector: `[data-image-slot='${slot.slotId}']`,
      });
    }

    return [...fields.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  private asType(value: unknown): WorksheetEditableFieldType | null {
    if (
      value === 'text' ||
      value === 'number' ||
      value === 'array' ||
      value === 'image' ||
      value === 'object'
    ) {
      return value;
    }
    if (value === 'word_bank' || value === 'nested_array') {
      return 'array';
    }
    return null;
  }

  private inferType(
    structure: Record<string, unknown>,
    path: string,
    schema: JsonSchemaNode | null,
  ): WorksheetEditableFieldType {
    const schemaNode = this.schemaAt(schema, path);
    if (schemaNode?.type === 'array') return 'array';
    if (schemaNode?.type === 'integer' || schemaNode?.type === 'number') return 'number';
    if (schemaNode?.type === 'object') return 'object';
    if (schemaNode?.type === 'string') return 'text';

    const value = this.valueAt(structure, path);
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'number') return 'number';
    if (value && typeof value === 'object') {
      if ('imageQuery' in (value as Record<string, unknown>)) return 'image';
      return 'object';
    }
    return 'text';
  }

  private schemaAt(schema: JsonSchemaNode | null, path: string): JsonSchemaNode | null {
    if (!schema) {
      return null;
    }
    const first = path.split(/[.[\]]/).filter(Boolean)[0];
    return schema.properties?.[first] ?? null;
  }

  private valueAt(structure: Record<string, unknown>, path: string): unknown {
    const first = path.split(/[.[\]]/).filter(Boolean)[0];
    return structure[first];
  }
}
