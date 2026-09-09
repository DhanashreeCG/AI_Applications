import {
  ExtractionResult,
  JsonObject,
  JsonValue,
} from '../interfaces/translation.interfaces';

/**
 * Keys that must never be sent to GCP Translation.
 * Covers flashcard assembled payloads, LLM intermediate image queries,
 * and worksheet structure / asset enrichment fields.
 */
export const NON_TRANSLATABLE_KEYS = new Set([
  // Identifiers
  'id',
  'assetId',
  'cardId',
  'componentId',
  'ruleId',
  'ruleName',
  'templateId',
  'requestId',
  'executionId',
  'correlationId',
  'slotId',
  'pairId',
  'userUploadedKey',
  's3ObjectKey',
  'userUploadedImages',

  // URLs / paths / storage
  'signedUrl',
  'imageUrl',
  'assetUrl',
  'thumbnail',
  'uri',
  'path',
  'fileName',
  'outputLocation',
  'storageBackend',
  'apiBaseUrl',

  // Image retrieval / search (English canonical)
  'searchQuery',
  'imageSearch',
  'imageQuery',
  'queryUsed',
  'attempts',
  'expectedObjects',
  'preferredStyle',
  'preferredBackground',
  'orientation',
  'educationalUse',

  // Structural / enum-like / layout
  'type',
  'componentType',
  'templateType',
  'layoutType',
  'rendererType',
  'pageSize',
  'mimeType',
  'status',
  'slug',
  'difficulty',
  'templateVersion',
  'promptVersion',
  'contentModel',
  'workflow',
  'stage',
  'provider',
  'model',
  'selectionMode',

  // Visual / numeric metadata
  'color',
  'colors',
  'similarity',
  'left',
  'top',
  'width',
  'height',
  'x',
  'y',
  'z',
  'score',
  'priority',
  'count',
  'cardIndex',
  'ageMin',
  'ageMax',
  'imageConcurrency',
  'generatedAt',

  // Pre-rendered artifacts handled separately (html via text/html mime)
  'canvas',
  'fieldPrompts',
]);

/** Entire subtrees skipped (template/layout/request metadata). */
export const SKIP_SUBTREE_KEYS = new Set([
  'layoutDefinition',
  'selection',
  'metadata',
  'renderingMetadata',
  'renderedOutput',
  'request',
  'template',
  'validationRules',
  'regions',
  'aiEdit',
  'aiConfig',
  'editableFields',
  'aiEditable',
  'editable_fields',
  'linkedFields',
  'fieldPrompts',
]);

const IMAGE_COMPONENT_TYPES = new Set([
  'image',
  'illustration',
  'photo',
  'asset',
]);

const URL_PATTERN = /^(https?:\/\/|data:|\/[a-z0-9_-]+\/)/i;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_COLOR_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const PURE_NUMBER_PATTERN = /^-?\d+(\.\d+)?$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(T[\d:.+-Z]+)?$/i;
const S3_KEY_PATTERN = /^(assets\/|flashcards\/|worksheets\/|uploads\/)/i;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeLanguageCode(raw: string): string {
  return raw.trim().toLowerCase().replace(/_/g, '-');
}

/**
 * Accepts BCP-47-ish codes: `en`, `mr`, `hi`, `pt-br`, `zh-cn`.
 * Rejects empty / garbage input before hitting GCP.
 */
export function isValidLanguageCode(raw: string): boolean {
  const code = normalizeLanguageCode(raw);
  if (!code || code.length > 16) {
    return false;
  }
  return /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(code);
}

export function shouldSkipStringValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }
  if (URL_PATTERN.test(trimmed)) {
    return true;
  }
  if (UUID_PATTERN.test(trimmed)) {
    return true;
  }
  if (HEX_COLOR_PATTERN.test(trimmed)) {
    return true;
  }
  if (PURE_NUMBER_PATTERN.test(trimmed)) {
    return true;
  }
  if (ISO_DATE_PATTERN.test(trimmed)) {
    return true;
  }
  if (S3_KEY_PATTERN.test(trimmed) && !/\s/.test(trimmed)) {
    return true;
  }
  return false;
}

function keyLooksTechnical(key: string): boolean {
  if (NON_TRANSLATABLE_KEYS.has(key)) {
    return true;
  }
  if (/Id$|Ids$|Key$|Keys$|Url$|Uri$|Path$|Hash$|Token$|Mime$/i.test(key)) {
    return true;
  }
  return false;
}

function isImageComponent(node: JsonObject): boolean {
  const type = String(node.componentType ?? node.type ?? '').toLowerCase();
  return IMAGE_COMPONENT_TYPES.has(type);
}

/**
 * Flashcard assembled cards: only translate user-facing component `content`
 * (non-image) and optional image `caption`. Everything else under cards that
 * is structural stays English.
 */
function extractFromFlashcardCards(
  cards: JsonValue[],
  uniqueTexts: string[],
  textIndexByValue: Map<string, number>,
  refs: ExtractionResult['refs'],
  addText: (text: string, pathSegments: Array<string | number>) => void,
): void {
  cards.forEach((card, cardIndex) => {
    if (!isRecord(card)) {
      return;
    }
    const components = card.components;
    if (!Array.isArray(components)) {
      return;
    }
    components.forEach((component, componentIndex) => {
      if (!isRecord(component)) {
        return;
      }
      const basePath: Array<string | number> = [
        'cards',
        cardIndex,
        'components',
        componentIndex,
      ];

      if (!isImageComponent(component)) {
        if (typeof component.content === 'string') {
          addText(component.content, [...basePath, 'content']);
        }
      }

      const asset = component.assetReference;
      if (isRecord(asset) && typeof asset.caption === 'string') {
        addText(asset.caption, [...basePath, 'assetReference', 'caption']);
      }
    });
  });
}

/**
 * Generic recursive walk for worksheet `structure` and other JSON trees.
 * Skips denylisted keys and technical-looking values.
 */
function walkGeneric(
  value: JsonValue,
  pathSegments: Array<string | number>,
  addText: (text: string, pathSegments: Array<string | number>) => void,
): void {
  if (value === null || value === undefined) {
    return;
  }

  if (typeof value === 'string') {
    addText(value, pathSegments);
    return;
  }

  if (typeof value !== 'object') {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      walkGeneric(item as JsonValue, [...pathSegments, index], addText);
    });
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (SKIP_SUBTREE_KEYS.has(key) || keyLooksTechnical(key)) {
      continue;
    }
    walkGeneric(child as JsonValue, [...pathSegments, key], addText);
  }
}

/**
 * Extract translatable strings from flashcard/worksheet JSON without mutating input.
 * Returns a deep clone plus path refs into the deduplicated string list.
 */
export function extractTranslatableFields(content: unknown): ExtractionResult {
  const clone = structuredClone(content) as JsonValue;
  const uniqueTexts: string[] = [];
  const textIndexByValue = new Map<string, number>();
  const refs: ExtractionResult['refs'] = [];

  const addText = (text: string, pathSegments: Array<string | number>) => {
    if (shouldSkipStringValue(text)) {
      return;
    }
    let textIndex = textIndexByValue.get(text);
    if (textIndex === undefined) {
      textIndex = uniqueTexts.length;
      uniqueTexts.push(text);
      textIndexByValue.set(text, textIndex);
    }
    refs.push({ pathSegments, textIndex });
  };

  if (!isRecord(clone)) {
    if (typeof clone === 'string') {
      addText(clone, []);
    } else if (Array.isArray(clone)) {
      walkGeneric(clone, [], addText);
    }
    return { clone, uniqueTexts, refs };
  }

  // Assembled flashcard / generate response
  if (Array.isArray(clone.cards)) {
    extractFromFlashcardCards(
      clone.cards as JsonValue[],
      uniqueTexts,
      textIndexByValue,
      refs,
      addText,
    );
  }

  // Worksheet response: translate structure tree + optional html preview
  let html: string | undefined;
  if (clone.structure !== undefined) {
    walkGeneric(clone.structure as JsonValue, ['structure'], addText);
  }
  if (typeof clone.html === 'string' && clone.html.trim()) {
    html = clone.html;
  }

  // Bare worksheet structure object (no wrapper): walk root excluding skip keys
  if (!Array.isArray(clone.cards) && clone.structure === undefined) {
    walkGeneric(clone, [], addText);
  }

  return { clone, uniqueTexts, refs, html };
}

export function applyTranslations(
  clone: JsonValue,
  refs: ExtractionResult['refs'],
  translations: string[],
): JsonValue {
  for (const ref of refs) {
    const translated = translations[ref.textIndex];
    if (translated === undefined) {
      continue;
    }
    setAtPath(clone, ref.pathSegments, translated);
  }
  return clone;
}

function setAtPath(
  root: JsonValue,
  pathSegments: Array<string | number>,
  value: string,
): void {
  if (pathSegments.length === 0) {
    return;
  }

  let cursor: JsonValue = root;
  for (let i = 0; i < pathSegments.length - 1; i += 1) {
    const segment = pathSegments[i];
    if (Array.isArray(cursor) && typeof segment === 'number') {
      cursor = cursor[segment] as JsonValue;
      continue;
    }
    if (isRecord(cursor) && typeof segment === 'string') {
      cursor = cursor[segment] as JsonValue;
      continue;
    }
    return;
  }

  const last = pathSegments[pathSegments.length - 1];
  if (Array.isArray(cursor) && typeof last === 'number') {
    cursor[last] = value;
    return;
  }
  if (isRecord(cursor) && typeof last === 'string') {
    cursor[last] = value;
  }
}

/**
 * Split unique texts into GCP-safe batches by count and approximate size.
 */
export function chunkTextsForTranslation(
  texts: string[],
  maxBatchSize: number,
  maxBatchCodeUnits: number,
): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let currentUnits = 0;

  const flush = () => {
    if (current.length) {
      batches.push(current);
      current = [];
      currentUnits = 0;
    }
  };

  for (const text of texts) {
    const units = text.length;
    const wouldExceed =
      current.length >= maxBatchSize ||
      (current.length > 0 && currentUnits + units > maxBatchCodeUnits);

    if (wouldExceed) {
      flush();
    }

    current.push(text);
    currentUnits += units;

    if (current.length >= maxBatchSize || currentUnits >= maxBatchCodeUnits) {
      flush();
    }
  }

  flush();
  return batches;
}
