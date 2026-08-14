import { HttpStatus } from '@nestjs/common';
import { WorksheetException } from '../errors/worksheet.exception';
import { ENRICHMENT_KEYS } from '../constants/worksheet.constants';
import { JsonSchemaNode } from '../types/worksheet.types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asStructureRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new WorksheetException(
      'INVALID_STRUCTURE',
      'Worksheet structure must be a JSON object',
    );
  }
  return value;
}

export function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }
  return value;
}

export function parseJsonField(
  value: unknown,
  field: string,
  required = false,
): Record<string, unknown> | null {
  if (value === undefined || value === null || value === '') {
    if (required) {
      throw new WorksheetException(
        'INVALID_REQUEST',
        `${field} is required`,
        HttpStatus.BAD_REQUEST,
        { field },
      );
    }
    return null;
  }
  if (isRecord(value)) {
    return value;
  }
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (!isRecord(parsed)) {
        throw new Error('not an object');
      }
      return parsed;
    } catch {
      throw new WorksheetException(
        'INVALID_REQUEST',
        `${field} must be a JSON object`,
        HttpStatus.BAD_REQUEST,
        { field },
      );
    }
  }
  throw new WorksheetException(
    'INVALID_REQUEST',
    `${field} must be a JSON object`,
    HttpStatus.BAD_REQUEST,
    { field },
  );
}

export function validateAgainstSchema(
  value: unknown,
  schema: JsonSchemaNode | null,
  path: string,
  options: { allowEnrichmentKeys?: boolean } = {},
): void {
  if (!schema) {
    if (!isRecord(value)) {
      throw new WorksheetException(
        'INVALID_STRUCTURE',
        `${path} must be an object`,
      );
    }
    return;
  }

  const type = schema.type;
  if (type === 'object' || (!type && schema.properties)) {
    if (!isRecord(value)) {
      throw new WorksheetException(
        'INVALID_STRUCTURE',
        `${path} must be an object`,
      );
    }
    const required = schema.required ?? [];
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        throw new WorksheetException(
          'INVALID_STRUCTURE',
          `${path} missing required field "${key}"`,
          HttpStatus.BAD_REQUEST,
          { path, field: key },
        );
      }
    }

    const properties = schema.properties ?? {};
    const additional = schema.additionalProperties ?? true;
    for (const key of Object.keys(value)) {
      if (properties[key]) {
        continue;
      }
      if (options.allowEnrichmentKeys && ENRICHMENT_KEYS.has(key)) {
        continue;
      }
      if (additional === false) {
        throw new WorksheetException(
          'INVALID_STRUCTURE',
          `${path} has unexpected field "${key}"`,
          HttpStatus.BAD_REQUEST,
          { path, field: key },
        );
      }
    }

    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        validateAgainstSchema(
          value[key],
          childSchema,
          path ? `${path}.${key}` : key,
          options,
        );
      }
    }
    return;
  }

  if (type === 'array') {
    if (!Array.isArray(value)) {
      throw new WorksheetException(
        'INVALID_STRUCTURE',
        `${path} must be an array`,
      );
    }
    if (schema.minItems != null && value.length < schema.minItems) {
      throw new WorksheetException(
        'INVALID_STRUCTURE',
        `${path} must have at least ${schema.minItems} items`,
        HttpStatus.BAD_REQUEST,
        { path, length: value.length },
      );
    }
    if (schema.maxItems != null && value.length > schema.maxItems) {
      throw new WorksheetException(
        'INVALID_STRUCTURE',
        `${path} must have at most ${schema.maxItems} items`,
        HttpStatus.BAD_REQUEST,
        { path, length: value.length },
      );
    }
    value.forEach((item, index) => {
      if (schema.items) {
        validateAgainstSchema(
          item,
          schema.items,
          `${path}[${index}]`,
          options,
        );
      }
    });
    return;
  }

  if (type === 'string') {
    if (typeof value !== 'string') {
      throw new WorksheetException(
        'INVALID_STRUCTURE',
        `${path} must be a string`,
      );
    }
    const trimmed = value.trim();
    if (schema.minLength != null && trimmed.length < schema.minLength) {
      throw new WorksheetException(
        'INVALID_STRUCTURE',
        `${path} is too short`,
      );
    }
    if (schema.maxLength != null && value.length > schema.maxLength) {
      throw new WorksheetException(
        'INVALID_STRUCTURE',
        `${path} is too long`,
      );
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      throw new WorksheetException(
        'INVALID_STRUCTURE',
        `${path} does not match the required pattern`,
      );
    }
    if (schema.enum && !schema.enum.includes(value)) {
      throw new WorksheetException(
        'INVALID_STRUCTURE',
        `${path} has an unsupported value`,
      );
    }
    if (looksLikeHtml(value)) {
      throw new WorksheetException(
        'INVALID_STRUCTURE',
        `${path} must not contain HTML`,
      );
    }
    return;
  }

  if (type === 'integer' || type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new WorksheetException(
        'INVALID_STRUCTURE',
        `${path} must be a number`,
      );
    }
    if (type === 'integer' && !Number.isInteger(value)) {
      throw new WorksheetException(
        'INVALID_STRUCTURE',
        `${path} must be an integer`,
      );
    }
    if (schema.minimum != null && value < schema.minimum) {
      throw new WorksheetException(
        'INVALID_STRUCTURE',
        `${path} is below the minimum`,
      );
    }
    if (schema.maximum != null && value > schema.maximum) {
      throw new WorksheetException(
        'INVALID_STRUCTURE',
        `${path} is above the maximum`,
      );
    }
    return;
  }

  if (type === 'boolean' && typeof value !== 'boolean') {
    throw new WorksheetException(
      'INVALID_STRUCTURE',
      `${path} must be a boolean`,
    );
  }
}

export function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(value) || /javascript:/i.test(value);
}

export function collectImageQueries(
  value: unknown,
  path = '',
): Array<{ path: string; query: string; parentPath: string }> {
  const found: Array<{ path: string; query: string; parentPath: string }> = [];

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      found.push(
        ...collectImageQueries(item, path ? `${path}[${index}]` : `[${index}]`),
      );
    });
    return found;
  }

  if (!isRecord(value)) {
    return found;
  }

  if (typeof value.imageQuery === 'string') {
    const query = value.imageQuery.trim();
    if (!query) {
      throw new WorksheetException(
        'INVALID_STRUCTURE',
        `${path ? `${path}.` : ''}imageQuery must be a non-empty string`,
      );
    }
    if (/\.(png|jpe?g|gif|webp|svg)$/i.test(query) || query.includes('/')) {
      throw new WorksheetException(
        'INVALID_STRUCTURE',
        `${path ? `${path}.` : ''}imageQuery must describe the image, not a file name`,
      );
    }
    found.push({
      path: path ? `${path}.imageQuery` : 'imageQuery',
      query,
      parentPath: path,
    });
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === 'imageQuery') {
      continue;
    }
    const childPath = path ? `${path}.${key}` : key;
    found.push(...collectImageQueries(child, childPath));
  }

  return found;
}

export function getValueAtPath(root: unknown, fieldPath: string): unknown {
  const tokens = parseFieldPath(fieldPath);
  let current: unknown = root;
  for (const token of tokens) {
    if (typeof token === 'number') {
      if (!Array.isArray(current) || current[token] === undefined) {
        throw new WorksheetException(
          'INVALID_FIELD',
          `Field path "${fieldPath}" does not exist`,
        );
      }
      current = current[token];
      continue;
    }
    if (!isRecord(current) || !(token in current)) {
      throw new WorksheetException(
        'INVALID_FIELD',
        `Field path "${fieldPath}" does not exist`,
      );
    }
    current = current[token];
  }
  return current;
}

export function setValueAtPath(
  root: Record<string, unknown>,
  fieldPath: string,
  value: unknown,
): Record<string, unknown> {
  const clone = structuredClone(root);
  const tokens = parseFieldPath(fieldPath);
  let current: unknown = clone;
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const token = tokens[i];
    if (typeof token === 'number') {
      if (!Array.isArray(current)) {
        throw new WorksheetException(
          'INVALID_FIELD',
          `Field path "${fieldPath}" does not exist`,
        );
      }
      current = current[token];
    } else if (isRecord(current)) {
      current = current[token];
    } else {
      throw new WorksheetException(
        'INVALID_FIELD',
        `Field path "${fieldPath}" does not exist`,
      );
    }
  }

  const last = tokens[tokens.length - 1];
  if (typeof last === 'number') {
    if (!Array.isArray(current)) {
      throw new WorksheetException(
        'INVALID_FIELD',
        `Field path "${fieldPath}" does not exist`,
      );
    }
    current[last] = value;
  } else if (isRecord(current)) {
    current[last] = value;
  } else {
    throw new WorksheetException(
      'INVALID_FIELD',
      `Field path "${fieldPath}" does not exist`,
    );
  }

  return clone;
}

export function parseFieldPath(fieldPath: string): Array<string | number> {
  const trimmed = fieldPath.trim();
  if (!trimmed || /[;{}()]/.test(trimmed)) {
    throw new WorksheetException(
      'INVALID_FIELD',
      'Field path is invalid',
    );
  }

  const tokens: Array<string | number> = [];
  const regex = /([^[.\]]+)|\[(\d+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(trimmed))) {
    if (match[1]) {
      tokens.push(match[1]);
    } else if (match[2]) {
      tokens.push(Number(match[2]));
    }
  }

  if (!tokens.length) {
    throw new WorksheetException('INVALID_FIELD', 'Field path is invalid');
  }
  return tokens;
}

export function fieldPathPrefix(fieldPath: string): string {
  return parseFieldPath(fieldPath)
    .filter((token) => typeof token === 'string')
    .join('.');
}

export function isEditableField(
  fieldPath: string,
  editableFields: string[] | undefined,
): boolean {
  if (!editableFields?.length) {
    return false;
  }
  const normalized = fieldPath.trim();
  if (editableFields.includes(normalized)) {
    return true;
  }
  const first = parseFieldPath(normalized)[0];
  return typeof first === 'string' && editableFields.includes(first);
}
