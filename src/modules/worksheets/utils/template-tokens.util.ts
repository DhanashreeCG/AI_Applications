import {
  collectImageSlots,
  filenameToSearchQuery,
  visualQueryFromImageRecord,
} from './structure.util';
import { ImageSlotRef } from '../types/worksheet.types';
import { generateScatterPositions } from './scatter-layout.util';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function addToken(
  tokens: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (value == null || key === '') {
    return;
  }
  tokens[key] = value;
  tokens[key.toUpperCase()] = value;
  const snake = key.replace(/[A-Z]/g, (char) => `_${char}`).replace(/^_/, '');
  tokens[snake.toUpperCase()] = value;
}

function singular(key: string): string {
  if (key.endsWith('ies')) {
    return `${key.slice(0, -3)}y`;
  }
  if (key.endsWith('s') && key.length > 1) {
    return key.slice(0, -1);
  }
  return key;
}

/**
 * Flatten worksheet JSON so prototype-style placeholders resolve:
 * {{TOPIC}}, {{INSTRUCTION_TEXT}}, {{QUESTION_1}}, {{OPTION_1}}, ...
 */
export function flattenTemplateTokens(
  structure: Record<string, unknown>,
  extras: Record<string, unknown> = {},
): Record<string, unknown> {
  const tokens: Record<string, unknown> = { ...structure, ...extras };
  let optionIndex = 1;

  const walkArray = (key: string, items: unknown[]) => {
    items.forEach((item, index) => {
      const n = index + 1;
      if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
        addToken(tokens, `${key}_${n}`, item);
        addToken(tokens, `${singular(key)}_${n}`, item);
        return;
      }
      if (!isRecord(item)) {
        return;
      }
      for (const [field, value] of Object.entries(item)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          addToken(tokens, `${key}_${n}_${field}`, value);
          addToken(tokens, `${field}_${n}`, value);
          if (field === 'question') {
            addToken(tokens, `QUESTION_${n}`, value);
          }
        }
        if (field === 'options' && Array.isArray(value)) {
          value.forEach((option) => {
            const text = isRecord(option) ? option.text : option;
            if (typeof text === 'string' || typeof text === 'number') {
              addToken(tokens, `OPTION_${optionIndex}`, text);
              optionIndex += 1;
            }
          });
        }
        if (Array.isArray(value) && field !== 'options') {
          walkArray(field, value);
        }
      }
    });
  };

  for (const [key, value] of Object.entries({ ...structure, ...extras })) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      addToken(tokens, key, value);
    } else if (Array.isArray(value)) {
      tokens[key] = value;
      walkArray(key, value);
    }
  }

  return tokens;
}

function pairField(item: unknown, key: string): string {
  if (!isRecord(item)) {
    return '';
  }
  const value = item[key];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function looksLikeMatchingPair(item: unknown): boolean {
  if (!isRecord(item)) {
    return false;
  }
  return ['number', 'name', 'left', 'right', 'match'].some((key) => key in item);
}

export function getMatchingPairs(structure: Record<string, unknown>): unknown[] {
  if (Array.isArray(structure.pairs) && structure.pairs.length > 0) {
    const picturePairs = structure.pairs.every(
      (item) => isRecord(item) && ('left_image' in item || 'right_image' in item),
    );
    if (picturePairs) {
      return [];
    }
    return structure.pairs;
  }
  if (Array.isArray(structure.items) && structure.items.length > 0 && looksLikeMatchingPair(structure.items[0])) {
    return structure.items.map((item, index) => {
      if (!isRecord(item)) {
        return item;
      }
      return {
        ...item,
        id: item.id ?? `pair_${index + 1}`,
        number: item.number ?? item.left ?? item.label ?? '',
        name: item.name ?? item.right ?? item.match ?? '',
      };
    });
  }
  return [];
}

function isNumberNamesTemplate(structure: Record<string, unknown>): boolean {
  return String(structure.worksheet_type ?? '').toLowerCase() === 'number_names';
}

export function matchingPairLayout(
  structure: Record<string, unknown>,
  pairCount: number,
): { startTop: number; numberLeft: number; nameLeft: number; rowHeight: number } {
  const layout = isRecord(structure.layout) ? structure.layout : {};
  const count = Math.max(pairCount, 1);
  const isNumberNames = structure.worksheet_type === 'number_names';
  // number_names constants below are calibrated against the actual background
  // artwork's circle/pill centers (measured in px on the 1016x1316 canvas),
  // not guessed. startTop/nameLeft assume a 70px-tall / 230px-wide item box
  // that is vertically+horizontally centered via CSS flex (see .number-item /
  // .name-item in the template). If the background artwork changes, re-measure
  // pill/circle centers and update these four numbers together.
  return {
    startTop: Number(layout.start_top) || (isNumberNames ? 335 : 280),
    numberLeft: Number(layout.number_left) || (isNumberNames ? 208 : 95),
    nameLeft: Number(layout.name_left) || (isNumberNames ? 607 : 620),
    rowHeight: Number(layout.row_height) || (isNumberNames ? 143 : Math.min(88, Math.max(64, 900 / count))),
  };
}

/**
 * Sets absolute top/left positioning on a style attribute without touching
 * any other declarations (color, font-weight, etc. are left to the
 * template's own CSS class — e.g. .name-item / .number-item — and must
 * never be overridden here).
 */
function upsertStylePosition(attrs: string, top: number, left: number, color?: string): string {
  const apply = (style: string) => {
    let next = style
      .replace(/top\s*:\s*[\d.]*\s*px/gi, `top:${top}px`)
      .replace(/left\s*:\s*[\d.]*\s*px/gi, `left:${left}px`)
      .replace(/top\s*:\s*px/gi, `top:${top}px`)
      .replace(/left\s*:\s*px/gi, `left:${left}px`);
    if (color && /color\s*:\s*(?:;|$)/i.test(next)) {
      next = next.replace(/color\s*:\s*(?:;|$)/gi, `color:${color}`);
    }
    if (!/top\s*:/i.test(next)) {
      next = `${next};top:${top}px`;
    }
    if (!/left\s*:/i.test(next)) {
      next = `${next};left:${left}px`;
    }
    return next.replace(/^;+|;+$/g, '');
  };
  if (/\bstyle\s*=/i.test(attrs)) {
    return attrs.replace(
      /style\s*=\s*(["'])([\s\S]*?)\1/i,
      (_match, quote: string, style: string) => `style=${quote}${apply(style)}${quote}`,
    );
  }
  return `${attrs} style="top:${top}px;left:${left}px"`;
}

/**
 * Absolute .number-item / .name-item with missing or empty top/left all land at 0,0.
 */
export function positionMatchingPairItems(
  html: string,
  structure: Record<string, unknown>,
): string {
  const pairs = getMatchingPairs(structure);
  if (pairs.length === 0 || !/number-item|name-item/.test(html)) {
    return html;
  }
  const { startTop, numberLeft, nameLeft, rowHeight } = matchingPairLayout(
    structure,
    pairs.length,
  );
  let numberIndex = 0;
  let nameIndex = 0;
  const nameIndices = pairs.map((_, i) => i).sort((a, b) => Math.sin(a + 1) - Math.sin(b + 1));

  return html.replace(
    /<(div|span)(\s[^>]*class=["'][^"']*(?:number-item|name-item)[^"']*["'][^>]*)>/gi,
    (full, tag: string, attrs: string) => {
      const isNumber = /number-item/.test(attrs);
      const index = isNumber ? numberIndex++ : nameIndex++;
      const renderIndex = isNumber ? index : nameIndices.indexOf(index);
      const top = startTop + renderIndex * rowHeight;
      const left = isNumber ? numberLeft : nameLeft;
      const color = !isNumber && !isNumberNamesTemplate(structure)
        ? pairField(pairs[index], 'color') || undefined
        : undefined;
      return `<${tag}${upsertStylePosition(attrs, top, left, color)}>`;
    },
  );
}

/**
 * Number-names matching templates expect either {{NUMBERS}}/{{NAMES}}
 * or {{#each pairs}} rows. Prototype CSS uses absolute .number-item / .name-item
 * without top/left, so positions are computed here.
 */
export function buildMatchingPairMarkup(
  structure: Record<string, unknown>,
  pencilIconUrl = '',
): { numbers: string; names: string } {
  const pairs = getMatchingPairs(structure);
  if (pairs.length === 0) {
    return { numbers: '', names: '' };
  }
  const nameFontSize = isNumberNamesTemplate(structure) ? 28 : 32;
  const { startTop, numberLeft, nameLeft, rowHeight } = matchingPairLayout(
    structure,
    pairs.length,
  );
  const icon = pencilIconUrl.trim();

  const pencil = (path: string, top: number, left: number) => {
    if (!icon) {
      return '';
    }
    return `<button type="button" class="ai-pencil" data-pencil-for="${escapeAttr(path)}" style="top:${top + 10}px;left:${left}px;width:20px;height:20px" aria-label="Edit field"><img src="${escapeAttr(icon)}" alt="" style="width:100%;height:100%"/></button>`;
  };

  const numbers = pairs
    .map((item, index) => {
      const top = startTop + index * rowHeight;
      const path = `pairs[${index}].number`;
      const value = escapeHtml(pairField(item, 'number'));
      return `<div class="number-item" style="top:${top}px;left:${numberLeft}px" data-editable="${escapeAttr(path)}" data-field-path="${escapeAttr(path)}">${value}</div>${pencil(path, top, numberLeft + 76)}`;
    })
    .join('');

  const nameIndices = pairs.map((_, i) => i).sort((a, b) => Math.sin(a + 1) - Math.sin(b + 1));

  const names = pairs
    .map((item, originalIndex) => {
      const renderIndex = nameIndices.indexOf(originalIndex);
      const top = startTop + renderIndex * rowHeight;
      const path = `pairs[${originalIndex}].name`;
      const value = escapeHtml(pairField(item, 'name'));
      return `<div class="name-item" style="top:${top}px;left:${nameLeft}px;font-size:${nameFontSize}px" data-editable="${escapeAttr(path)}" data-field-path="${escapeAttr(path)}">${value}</div>${pencil(path, top, nameLeft + 238)}`;
    })
    .join('');

  return { numbers, names };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}

export function injectMatchingPairMarkup(
  html: string,
  structure: Record<string, unknown>,
  pencilIconUrl = '',
): string {
  const { numbers, names } = buildMatchingPairMarkup(structure, pencilIconUrl);
  if (!numbers && !names) {
    return html;
  }

  let next = html
    .replace(/\{\{\s*NUMBERS\s*\}\}/gi, numbers)
    .replace(/\{\{\s*NAMES\s*\}\}/gi, names);

  const replaceIfEmptyLoop = (match: string, inner: string) => {
    const hasItemTokens = /\{\{\s*(number|name|color|@index|this)\s*\}\}/i.test(inner);
    return hasItemTokens ? match : `${numbers}${names}`;
  };

  next = next.replace(/\{\{#each\s+pairs\}\}([\s\S]*?)\{\{\/each\}\}/gi, replaceIfEmptyLoop);
  next = next.replace(/\{\{#pairs\}\}([\s\S]*?)\{\{\/pairs\}\}/gi, replaceIfEmptyLoop);

  if (
    isNumberNamesTemplate(structure) &&
    !/class=["'][^"']*\bnumber-item\b/i.test(next)
  ) {
    next = next.replace(/<\/body>/i, `${numbers}${names}</body>`);
  }
  return next;
}

export function parseActivityBoxRect(
  html: string,
): { left: number; top: number; width: number; height: number } | null {
  const match = html.match(/\.activity-box\s*\{([^}]+)\}/i);
  if (!match) {
    return null;
  }
  const css = match[1];
  const px = (prop: string) => {
    const found = css.match(new RegExp(`${prop}\\s*:\\s*([\\d.]+)px`, 'i'));
    return found ? Number(found[1]) : NaN;
  };
  const left = px('left');
  const top = px('top');
  const width = px('width');
  const height = px('height');
  if (![left, top, width, height].every(Number.isFinite)) {
    return null;
  }
  return { left, top, width, height };
}

const DEFAULT_ACTIVITY_BOX = { left: 80, top: 330, width: 860, height: 760 };
const ACTIVITY_FRAME_INSET = 58;
const SCATTER_ITEM_SIZE = { width: 150, height: 180 };

export function scatterLayoutForTemplate(html = ''): {
  box: { left: number; top: number; width: number; height: number };
  itemSize: { width: number; height: number };
} {
  const frame = parseActivityBoxRect(html) ?? DEFAULT_ACTIVITY_BOX;
  const itemsLiveInsideBox =
    /<[^>]*class=["'][^"']*\bactivity-box\b[^"']*["'][^>]*>[\s\S]*\{\{\s*ITEMS/i.test(html) ||
    html.trim() === '';
  const inset = ACTIVITY_FRAME_INSET;
  if (itemsLiveInsideBox) {
    return {
      box: {
        left: inset,
        top: inset,
        width: Math.max(SCATTER_ITEM_SIZE.width, frame.width - inset * 2),
        height: Math.max(SCATTER_ITEM_SIZE.height, frame.height - inset * 2),
      },
      itemSize: SCATTER_ITEM_SIZE,
    };
  }
  return {
    box: {
      left: frame.left + inset,
      top: frame.top + inset,
      width: Math.max(SCATTER_ITEM_SIZE.width, frame.width - inset * 2),
      height: Math.max(SCATTER_ITEM_SIZE.height, frame.height - inset * 2),
    },
    itemSize: SCATTER_ITEM_SIZE,
  };
}

function wordBankWords(structure: Record<string, unknown>): string[] {
  if (Array.isArray(structure.sight_word_bank)) {
    return structure.sight_word_bank.map((word) =>
      typeof word === 'string' || typeof word === 'number' ? String(word) : '',
    );
  }
  const rows = Array.isArray(structure.rows) ? structure.rows : [];
  return rows.map((row) => pairField(row, 'target_sight_word'));
}

export function buildWordBankMarkup(structure: Record<string, unknown>): string {
  return wordBankWords(structure)
    .map((word, index) => {
      const path = `sight_word_bank[${index}]`;
      return `<span class="word-bank-word" data-editable="sight_word_${index}" data-field-path="${escapeAttr(path)}">${escapeHtml(word)}</span>`;
    })
    .join('\n');
}

export function buildSentenceRowsMarkup(
  structure: Record<string, unknown>,
  pencilIconUrl = '',
): string {
  const rows = Array.isArray(structure.rows) ? structure.rows : [];
  if (rows.length === 0) {
    return '';
  }
  const icon = pencilIconUrl.trim();
  return rows
    .map((row, index) => {
      if (!isRecord(row)) {
        return '';
      }
      const n = index + 1;
      const sentencePath = `rows[${index}].sentence`;
      const imagePath = `rows[${index}]`;
      const sentence = escapeHtml(pairField(row, 'sentence'));
      const rawSrc =
        (typeof row.assetUrl === 'string' && row.assetUrl) ||
        (typeof row.imageUrl === 'string' && row.imageUrl) ||
        '';
      const srcAttr = rawSrc ? ` src="${escapeHtml(rawSrc)}"` : '';
      const alt = escapeHtml(
        visualQueryFromImageRecord(row) || pairField(row, 'image_name') || `row ${n}`,
      );
      const slotMatch = resolveImageSlot(structure, imagePath);
      const slotId = slotMatch?.slotId || (typeof row.id === 'string' ? row.id : imagePath);
      const pencil = icon
        ? `<button class="ai-pencil" data-pencil-for="sentence_${n}" type="button" title="AI regenerate sentence"><img src="${escapeAttr(icon)}" width="22" height="22" alt=""></button>`
        : '';
      return `<div class="worksheet-row row-${n}"><div class="sentence-col" data-editable="sentence_${n}" data-field-path="${escapeAttr(sentencePath)}" data-row-id="${escapeAttr(String(row.id ?? `row_${n}`))}">${sentence}</div><div class="image-col"><img class="worksheet-image"${srcAttr} alt="${alt}" data-image-slot="${escapeAttr(slotId)}" data-field-path="${escapeAttr(imagePath)}" /></div>${pencil}</div>`;
    })
    .join('\n');
}

const MATCH_PAIR_LEFT_POSITIONS = [
  { left: 80, top: 330 },
  { left: 80, top: 520 },
  { left: 80, top: 710 },
  { left: 80, top: 900 },
  { left: 80, top: 1090 },
];

const MATCH_PAIR_RIGHT_POSITIONS = [
  { left: 790, top: 330 },
  { left: 790, top: 520 },
  { left: 790, top: 710 },
  { left: 790, top: 900 },
  { left: 790, top: 1090 },
];

const MATCH_PAIR_RIGHT_ORDER = [3, 4, 0, 2, 1];

function pairImageSrc(node: unknown): { src: string; alt: string } {
  if (typeof node === 'string') {
    return { src: '', alt: filenameToSearchQuery(node) };
  }
  if (!isRecord(node)) {
    return { src: '', alt: '' };
  }
  const src =
    (typeof node.assetUrl === 'string' && node.assetUrl) ||
    (typeof node.imageUrl === 'string' && node.imageUrl) ||
    '';
  const alt =
    visualQueryFromImageRecord(node) ||
    pairField(node, 'image_name') ||
    pairField(node, 'label') ||
    '';
  return { src, alt };
}

export function buildPairImagesMarkup(structure: Record<string, unknown>): string {
  const pairs = Array.isArray(structure.pairs) ? structure.pairs : [];
  if (pairs.length === 0 || !pairs.some((item) => isRecord(item) && ('left_image' in item || 'right_image' in item))) {
    return '';
  }

  const tags: string[] = [];
  pairs.forEach((pair, index) => {
    if (!isRecord(pair)) {
      return;
    }
    const pos = MATCH_PAIR_LEFT_POSITIONS[index];
    if (!pos) {
      return;
    }
    const path = `pairs[${index}].left_image`;
    const resolved = pairImageSrc(pair.left_image);
    const slotMatch = resolveImageSlot(structure, path);
    const slotId = slotMatch?.slotId || path;
    const srcAttr = resolved.src ? ` src="${escapeHtml(resolved.src)}"` : '';
    tags.push(
      `<img class="worksheet-image"${srcAttr} alt="${escapeHtml(resolved.alt)}" style="left:${pos.left}px;top:${pos.top}px" data-image-slot="${escapeAttr(slotId)}" data-field-path="${escapeAttr(path)}" data-side="left" />`,
    );
  });

  MATCH_PAIR_RIGHT_ORDER.filter((pairIndex) => pairIndex < pairs.length).forEach((pairIndex, slotIndex) => {
    const pair = pairs[pairIndex];
    const pos = MATCH_PAIR_RIGHT_POSITIONS[slotIndex];
    if (!isRecord(pair) || !pos) {
      return;
    }
    const path = `pairs[${pairIndex}].right_image`;
    const resolved = pairImageSrc(pair.right_image);
    const slotMatch = resolveImageSlot(structure, path);
    const slotId = slotMatch?.slotId || path;
    const srcAttr = resolved.src ? ` src="${escapeHtml(resolved.src)}"` : '';
    tags.push(
      `<img class="worksheet-image"${srcAttr} alt="${escapeHtml(resolved.alt)}" style="left:${pos.left}px;top:${pos.top}px" data-image-slot="${escapeAttr(slotId)}" data-field-path="${escapeAttr(path)}" data-side="right" />`,
    );
  });

  return tags.join('');
}

export function injectPairImagesMarkup(
  html: string,
  structure: Record<string, unknown>,
): string {
  if (!/\{\{\s*PAIR_IMAGES\s*\}\}/i.test(html)) {
    return html;
  }
  const markup = buildPairImagesMarkup(structure);
  return html.replace(/\{\{\s*PAIR_IMAGES\s*\}\}/gi, markup);
}

export function injectSentenceRowMarkup(
  html: string,
  structure: Record<string, unknown>,
  pencilIconUrl = '',
): string {
  const wordBank = buildWordBankMarkup(structure);
  const rows = buildSentenceRowsMarkup(structure, pencilIconUrl);
  let next = html;
  if (wordBank) {
    next = next.replace(/\{\{\s*WORD_BANK_ITEMS\s*\}\}/gi, wordBank);
  }
  if (rows) {
    next = next.replace(/\{\{\s*ROWS\s*\}\}/gi, rows);
  }
  return next;
}

export function injectWorksheetItemsMarkup(
  html: string,
  structure: Record<string, unknown>,
  pencilIconUrl = '',
): string {
  const itemsHtml = buildScatterItemsMarkup(structure, pencilIconUrl, html);
  if (!itemsHtml) {
    return html;
  }

  let next = html
    .replace(/\{\{\s*ITEMS_PLACEHOLDER\s*\}\}/g, itemsHtml)
    .replace(/\{\{\s*ITEMS\s*\}\}/gi, itemsHtml);

  if (!/data-item-id=/i.test(next) && /class=["'][^"']*\bactivity-box\b/i.test(next)) {
    next = next.replace(
      /(<(?:[a-z0-9-]+)[^>]*class=["'][^"']*\bactivity-box\b[^"']*["'][^>]*>)/i,
      `$1\n${itemsHtml}\n`,
    );
  }
  return next;
}

export function buildScatterItemsMarkup(
  structure: Record<string, unknown>,
  pencilIconUrl = '',
  templateHtml = '',
): string {
  const items = Array.isArray(structure.items) ? structure.items : [];
  if (items.length === 0 || looksLikeMatchingPair(items[0])) {
    return '';
  }

  const { box, itemSize } = scatterLayoutForTemplate(templateHtml);
  const positions = generateScatterPositions(items.length, box, itemSize);
  const icon = pencilIconUrl.trim();

  return items
    .map((item, index) => {
      if (!isRecord(item)) {
        return '';
      }
      const pos = positions[index] || { top: 0, left: 0 };
      const label = typeof item.label === 'string' ? item.label : '';
      const path = `items[${index}]`;
      const slotMatch = resolveImageSlot(structure, path);
      const slotId = slotMatch?.slotId || path;
      const rawSrc =
        (typeof item.assetUrl === 'string' && item.assetUrl) ||
        (typeof item.imageUrl === 'string' && item.imageUrl) ||
        '';
      const srcAttr = rawSrc ? ` src="${escapeHtml(rawSrc)}"` : '';
      const alt = slotMatch?.imageQuery || visualQueryFromImageRecord(item) || label || slotId;
      const isCorrect = item.is_correct === true;
      const pencil = icon
        ? `<button class="ai-pencil" data-pencil-for="${escapeHtml(path)}" type="button" title="AI regenerate" style="position:absolute;top:-10px;right:-10px;width:30px;height:30px;z-index:3;"><img src="${escapeHtml(icon)}" width="30" height="30" alt=""></button>`
        : '';
      return `<div class="item" style="position:absolute;top:${pos.top}px;left:${pos.left}px;width:${itemSize.width}px;height:${itemSize.height}px;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;" data-item-id="${escapeHtml(path)}" data-correct="${isCorrect}">${pencil}<div style="width:100%;height:130px;display:flex;justify-content:center;align-items:center;"><img class="worksheet-image"${srcAttr} alt="${escapeHtml(alt)}" data-image-slot="${escapeHtml(slotId)}" data-field-path="${escapeHtml(path)}" style="max-width:120px;max-height:120px;object-fit:contain;" /></div><div class="item-label" data-editable="${escapeHtml(`${path}.label`)}" data-field-path="${escapeHtml(`${path}.label`)}" style="text-align:center;font-size:22px;font-weight:bold;color:#222;margin-top:4px;height:28px;width:100%;overflow:hidden;">${escapeHtml(label)}</div></div>`;
    })
    .join('');
}

export function resolveImageSlot(
  structure: Record<string, unknown>,
  slotId: string,
): ImageSlotRef | null {
  const slots = collectImageSlots(structure);
  const needle = slotId.trim().toLowerCase();
  const exact =
    slots.find((slot) => slot.slotId.toLowerCase() === needle) ||
    slots.find((slot) => slot.path.toLowerCase() === needle) ||
    slots.find((slot) => slot.path.toLowerCase().endsWith(`.${needle}`));
  if (exact) {
    return exact;
  }
  if (['goat', 'main', 'main_image', 'hero', 'primary'].includes(needle)) {
    return (
      slots.find(
        (slot) =>
          slot.slotId === 'main_image' ||
          slot.path === 'image' ||
          slot.path.endsWith('.image'),
      ) ||
      slots[0] ||
      null
    );
  }
  return slots[0] ?? null;
}