import { HttpStatus } from '@nestjs/common';
import { WorksheetException } from '../errors/worksheet.exception';
import {
  ENRICHMENT_KEYS,
  TRANSIENT_ASSET_KEYS,
  USER_UPLOADED_IMAGES_KEY,
} from '../constants/worksheet.constants';
import { ImageSlotRef, JsonSchemaNode } from '../types/worksheet.types';

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

const IMAGE_QUERY_ALIAS_KEYS = [
  'imageQuery',
  'image_name',
  'imageName',
  'searchDescription',
] as const;

const SKIP_IMAGE_WALK_KEYS = new Set([
  'editable_fields',
  'editableFields',
  'fieldPrompts',
  'ai_config',
  'aiConfig',
  'meta',
  USER_UPLOADED_IMAGES_KEY,
]);

export function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(value) || /javascript:/i.test(value);
}

export function looksLikeImageFileName(query: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(query) || query.includes('/');
}

export function filenameToSearchQuery(value: string): string {
  const base = value.split(/[/\\]/).pop() ?? value;
  return base
    .replace(/\.(png|jpe?g|gif|webp|svg)$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
}

export function visualQueryFromImageRecord(
  value: Record<string, unknown>,
): string | null {
  const phrases: string[] = [];
  const files: string[] = [];
  for (const key of IMAGE_QUERY_ALIAS_KEYS) {
    const raw = value[key];
    if (typeof raw !== 'string' || !raw.trim()) {
      continue;
    }
    const query = raw.trim();
    if (looksLikeImageFileName(query)) {
      files.push(query);
    } else {
      phrases.push(query);
    }
  }
  if (phrases[0]) {
    return phrases[0];
  }
  if (files[0]) {
    return filenameToSearchQuery(files[0]) || null;
  }
  return null;
}

export function normalizeImageQueryFields(
  structure: Record<string, unknown>,
): Record<string, unknown> {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      return node.map((item) => walk(item));
    }
    if (!isRecord(node)) {
      return node;
    }
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node)) {
      if (SKIP_IMAGE_WALK_KEYS.has(key)) {
        next[key] = child;
        continue;
      }
      next[key] = walk(child);
    }
    const query = visualQueryFromImageRecord(next);
    if (query) {
      const existing =
        typeof next.imageQuery === 'string' ? next.imageQuery.trim() : '';
      if (!existing || looksLikeImageFileName(existing)) {
        next.imageQuery = query;
      }
    }
    return next;
  };
  return asStructureRecord(walk(structure));
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
    if (looksLikeImageFileName(query)) {
      const hasPhraseAlias = IMAGE_QUERY_ALIAS_KEYS.some((key) => {
        if (key === 'imageQuery') {
          return false;
        }
        const raw = value[key];
        return (
          typeof raw === 'string' &&
          raw.trim().length > 0 &&
          !looksLikeImageFileName(raw.trim())
        );
      });
      if (!hasPhraseAlias) {
        throw new WorksheetException(
          'INVALID_STRUCTURE',
          `${path ? `${path}.` : ''}imageQuery must describe the image, not a file name`,
        );
      }
    }
  }

  const query = visualQueryFromImageRecord(value);
  if (query) {
    found.push({
      path: path ? `${path}.imageQuery` : 'imageQuery',
      query,
      parentPath: path,
    });
  }

  for (const [key, child] of Object.entries(value)) {
    if (IMAGE_QUERY_ALIAS_KEYS.includes(key as (typeof IMAGE_QUERY_ALIAS_KEYS)[number])) {
      continue;
    }
    if (SKIP_IMAGE_WALK_KEYS.has(key)) {
      continue;
    }
    const childPath = path ? `${path}.${key}` : key;
    found.push(...collectImageQueries(child, childPath));
  }

  return found;
}

export function stripTransientAssetFields(
  value: unknown,
): Record<string, unknown> {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      return node.map((item) => walk(item));
    }
    if (!isRecord(node)) {
      return node;
    }
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node)) {
      if ((TRANSIENT_ASSET_KEYS as readonly string[]).includes(key)) {
        continue;
      }
      next[key] = walk(child);
    }
    return next;
  };
  return asStructureRecord(walk(value));
}

export function collectImageSlots(
  value: unknown,
  path = '',
): ImageSlotRef[] {
  const found: ImageSlotRef[] = [];

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      found.push(
        ...collectImageSlots(item, path ? `${path}[${index}]` : `[${index}]`),
      );
    });
    return found;
  }

  if (!isRecord(value)) {
    return found;
  }

  const imageQuery = visualQueryFromImageRecord(value);
  if (imageQuery) {
    const explicitId =
      typeof value.id === 'string' && value.id.trim() ? value.id.trim() : null;
    const key = path.split(/[.[\]]/).filter(Boolean).pop() ?? 'image';
    found.push({
      slotId: explicitId || key,
      path,
      assetId: typeof value.assetId === 'string' ? value.assetId : null,
      imageQuery,
    });
  }

  for (const [key, child] of Object.entries(value)) {
    if (IMAGE_QUERY_ALIAS_KEYS.includes(key as (typeof IMAGE_QUERY_ALIAS_KEYS)[number])) {
      continue;
    }
    if (SKIP_IMAGE_WALK_KEYS.has(key)) {
      continue;
    }
    const childPath = path ? `${path}.${key}` : key;
    found.push(...collectImageSlots(child, childPath));
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

export function patchImageSlot(
  structure: Record<string, unknown>,
  path: string,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const current = getValueAtPath(structure, path);
  if (!current || typeof current !== 'object' || Array.isArray(current)) {
    throw new WorksheetException(
      'INVALID_FIELD',
      `Field path "${path}" is not an image slot`,
    );
  }
  const nextSlot: Record<string, unknown> = {
    ...(current as Record<string, unknown>),
    ...patch,
  };
  if (patch.assetId === null) {
    nextSlot.assetId = null;
  }
  if (!patch.userUploadedKey) {
    delete nextSlot.userUploadedKey;
  }
  return setValueAtPath(structure, path, nextSlot);
}

export function setUserUploadedImageIndex(
  structure: Record<string, unknown>,
  path: string,
  entry: { key: string; contentType?: string } | null,
): Record<string, unknown> {
  const current = isRecord(structure[USER_UPLOADED_IMAGES_KEY])
    ? { ...(structure[USER_UPLOADED_IMAGES_KEY] as Record<string, unknown>) }
    : {};
  if (entry) {
    current[path] = entry;
  } else {
    delete current[path];
  }
  const next = { ...structure };
  if (Object.keys(current).length) {
    next[USER_UPLOADED_IMAGES_KEY] = current;
  } else {
    delete next[USER_UPLOADED_IMAGES_KEY];
  }
  return next;
}

function looksLikeSentenceRow(value: unknown): boolean {
  return isRecord(value) && typeof value.sentence === 'string';
}

function looksLikeActivityItem(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  if (
    Array.isArray(value.items) ||
    Array.isArray(value.pairs) ||
    Array.isArray(value.questions)
  ) {
    return false;
  }
  return (
    typeof value.label === 'string' ||
    typeof value.imageQuery === 'string' ||
    typeof value.is_correct === 'boolean'
  );
}

function looksLikeWorksheetStructure(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  if (
    Array.isArray(value.items) ||
    Array.isArray(value.pairs) ||
    Array.isArray(value.questions)
  ) {
    return true;
  }
  return (
    typeof value.instruction === 'string' ||
    typeof value.instruction_text === 'string' ||
    typeof value.topic === 'string' ||
    typeof value.worksheet_type === 'string'
  );
}

/**
 * LLM output for one worksheet often includes items[] (e.g. circle_the_things).
 * That array is content on a single page — never one worksheet per item.
 */
export function normalizeLlmWorksheetPayload(
  parsed: unknown,
  targetCount = 1,
): unknown[] {
  const limit = Math.max(1, targetCount);

  const takeWorksheets = (candidates: unknown[]): unknown[] => {
    if (candidates.length > 0 && candidates.every(looksLikeActivityItem)) {
      return [{ items: candidates }].slice(0, limit);
    }
    if (candidates.length > 0 && candidates.every(looksLikeSentenceRow)) {
      return [{ rows: candidates }].slice(0, limit);
    }
    const worksheets = candidates.filter(looksLikeWorksheetStructure);
    return (worksheets.length ? worksheets : candidates).slice(0, limit);
  };

  if (Array.isArray(parsed)) {
    return takeWorksheets(parsed);
  }
  if (!isRecord(parsed)) {
    return [];
  }

  if (Array.isArray(parsed.worksheets)) {
    return takeWorksheets(parsed.worksheets);
  }

  return [parsed].slice(0, limit);
}
