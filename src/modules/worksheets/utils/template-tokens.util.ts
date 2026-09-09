import {
  collectImageSlots,
  filenameToSearchQuery,
  isBeforeAfterNumbersWorksheet,
  resolveAliasFieldPath,
  resolveAliasImagePath,
  unifyBeforeAfterSharedMascot,
  visualQueryFromImageRecord,
} from './structure.util';

export { isBeforeAfterNumbersWorksheet };
import { ImageSlotRef } from '../types/worksheet.types';
import { generateCircleGridPositions } from './scatter-layout.util';

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
          // matching_single_letter: {{LEFT_1}} / {{RIGHT_1}} from left_letters[].letter
          const column = key.match(/^(left|right)_letters$/i);
          if (column && (field === 'letter' || field === 'text' || field === 'value')) {
            addToken(tokens, `${column[1]}_${n}`, value);
            addToken(tokens, `${column[1].toUpperCase()}_${n}`, value);
          }
          // look_and_say_circle_the_letters: {{CL_1}}… from circle_letters[].letter
          if (
            /^circle_letters$/i.test(key) &&
            (field === 'letter' || field === 'text' || field === 'value')
          ) {
            addToken(tokens, `CL_${n}`, value);
            addToken(tokens, `cl_${n}`, value);
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

  // look_and_say_circle_the_letters: {{TARGET_LETTER_UPPER}} / {{TARGET_LETTER_LOWER}}
  const rawTarget =
    (typeof tokens.letter_upper === 'string' && tokens.letter_upper) ||
    (typeof tokens.target_letter === 'string' && tokens.target_letter) ||
    (typeof tokens.TARGET_LETTER === 'string' && tokens.TARGET_LETTER) ||
    '';
  const upper =
    (typeof tokens.letter_upper === 'string' && tokens.letter_upper) ||
    (typeof tokens.LETTER_UPPER === 'string' && tokens.LETTER_UPPER) ||
    (rawTarget ? String(rawTarget).toUpperCase() : '');
  const lower =
    (typeof tokens.letter_lower === 'string' && tokens.letter_lower) ||
    (typeof tokens.LETTER_LOWER === 'string' && tokens.LETTER_LOWER) ||
    (rawTarget ? String(rawTarget).toLowerCase() : '');
  if (upper) {
    addToken(tokens, 'TARGET_LETTER_UPPER', upper);
  }
  if (lower) {
    addToken(tokens, 'TARGET_LETTER_LOWER', lower);
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
  // numbers_after_and_before items also have `number` but use a blank/mascot grid.
  if ('blank_position' in item) {
    return false;
  }
  // picture_graph bars use name + count (+ color); not matching-pair rows.
  if ('count' in item) {
    return false;
  }
  return ['number', 'name', 'left', 'right', 'match'].some((key) => key in item);
}

export function isPictureGraphWorksheet(
  structure: Record<string, unknown>,
): boolean {
  const type = String(structure.worksheet_type ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return type === 'picturegraph' || type.includes('picturegraph');
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
): {
  startTop: number;
  numberTop: number;
  numberLeft: number;
  nameLeft: number;
  rowHeight: number;
} {
  const layout = isRecord(structure.layout) ? structure.layout : {};
  const count = Math.max(pairCount, 1);
  const isNumberNames = structure.worksheet_type === 'number_names';
  // number_names constants below are calibrated against the actual background
  // artwork's circle/pill centers (measured in px on the 1016x1316 canvas),
  // not guessed. startTop/nameLeft assume a 70px-tall / 230px-wide item box
  // that is vertically+horizontally centered via CSS flex (see .number-item /
  // .name-item in the template). If the background artwork changes, re-measure
  // pill/circle centers and update these four numbers together.
  // numberTop is 8px below startTop so digits sit in the circle centers
  // (font metrics sit high without this nudge; name pills keep startTop).
  const startTop = Number(layout.start_top) || (isNumberNames ? 335 : 280);
  const numberTop =
    Number(layout.number_top) ||
    (isNumberNames ? startTop + 8 : startTop);
  return {
    startTop,
    numberTop,
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
  const { startTop, numberTop, numberLeft, nameLeft, rowHeight } = matchingPairLayout(
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
      const top = (isNumber ? numberTop : startTop) + renderIndex * rowHeight;
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
  const { startTop, numberTop, numberLeft, nameLeft, rowHeight } = matchingPairLayout(
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
      const top = numberTop + index * rowHeight;
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
/** Image-only tile size for circle-the-things (no under-image labels). */
const SCATTER_ITEM_SIZE = { width: 165, height: 145 };

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
    (typeof node.imageUrl === 'string' && node.imageUrl) ||
    (typeof node.assetUrl === 'string' && node.assetUrl) ||
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
    const slotId = path;
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
    const slotId = path;
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
  if (isPictureGraphWorksheet(structure)) {
    return html;
  }

  const itemsHtml = isBeforeAfterNumbersWorksheet(structure)
    ? buildBeforeAfterItemsMarkup(structure, pencilIconUrl)
    : itemsUseAbsolutePositions(structure)
      ? buildPositionedItemsMarkup(structure, pencilIconUrl)
      : buildScatterItemsMarkup(structure, pencilIconUrl, html);

  let next = html
    .replace(/\{\{\s*ITEMS_HTML\s*\}\}/gi, itemsHtml)
    .replace(/\{\{\s*ITEMS_PLACEHOLDER\s*\}\}/g, itemsHtml)
    .replace(/\{\{\s*ITEMS\s*\}\}/gi, itemsHtml);

  if (/\{\{\s*NUMBER_LINE_DIGITS\s*\}\}/i.test(next)) {
    next = next.replace(
      /\{\{\s*NUMBER_LINE_DIGITS\s*\}\}/gi,
      buildNumberLineDigitsMarkup(structure),
    );
  }

  if (
    itemsHtml &&
    !/data-item-id=/i.test(next) &&
    /class=["'][^"']*\bactivity-box\b/i.test(next)
  ) {
    next = next.replace(
      /(<(?:[a-z0-9-]+)[^>]*class=["'][^"']*\bactivity-box\b[^"']*["'][^>]*>)/i,
      `$1\n${itemsHtml}\n`,
    );
  }
  return next;
}

/** Calibrated to the picture_graph background grid (y ticks 1–10, unit = 32px). */
const PICTURE_GRAPH_UNIT_H = 32;
const PICTURE_GRAPH_DEFAULT_COUNTS = [9, 7, 3, 5];
const PICTURE_GRAPH_DEFAULT_NAMES = ['Ant', 'Bee', 'Ladybug', 'Spider'];
const PICTURE_GRAPH_DEFAULT_COLORS = [
  '#85cbf4',
  '#f03a3e',
  '#fecd59',
  '#67bd47',
];
const PICTURE_GRAPH_COLUMNS = [
  { barLeft: 228, barWidth: 82, iconLeft: 227, color: '#85cbf4', baseY: 708 },
  { barLeft: 388, barWidth: 82, iconLeft: 387, color: '#f03a3e', baseY: 704 },
  { barLeft: 548, barWidth: 82, iconLeft: 547, color: '#fecd59', baseY: 704 },
  { barLeft: 708, barWidth: 82, iconLeft: 707, color: '#67bd47', baseY: 708 },
] as const;

/** Count-write layout: row1 item0+item3, row2 item1+item2 (matches dashed boxes). */
const PICTURE_GRAPH_COUNT_LAYOUT = [
  { itemIdx: 0, imgLeft: 135, imgTop: 818, boxLeft: 288, boxTop: 818 },
  { itemIdx: 3, imgLeft: 580, imgTop: 818, boxLeft: 718, boxTop: 818 },
  { itemIdx: 1, imgLeft: 140, imgTop: 934, boxLeft: 288, boxTop: 932 },
  { itemIdx: 2, imgLeft: 580, imgTop: 940, boxLeft: 718, boxTop: 932 },
] as const;

const PICTURE_GRAPH_CAMERA_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';

type PictureGraphItem = {
  id: string;
  name: string;
  count: number;
  color: string;
  path: string;
  src: string;
  alt: string;
};

function resolvePictureGraphItems(
  structure: Record<string, unknown>,
): PictureGraphItem[] {
  const raw = Array.isArray(structure.items) ? structure.items : [];
  return [0, 1, 2, 3].map((index) => {
    const existing = isRecord(raw[index]) ? raw[index] : {};
    const id =
      (typeof existing.id === 'string' && existing.id.trim()) ||
      `item_${index + 1}`;
    const name =
      (typeof existing.name === 'string' && existing.name.trim()) ||
      PICTURE_GRAPH_DEFAULT_NAMES[index];
    const parsed = Number(existing.count);
    const count = Number.isFinite(parsed)
      ? parsed
      : PICTURE_GRAPH_DEFAULT_COUNTS[index];
    const color =
      (typeof existing.color === 'string' && existing.color.trim()) ||
      PICTURE_GRAPH_DEFAULT_COLORS[index];
    const src =
      (typeof existing.assetUrl === 'string' && existing.assetUrl.trim()) ||
      (typeof existing.imageUrl === 'string' && existing.imageUrl.trim()) ||
      (typeof existing.signedUrl === 'string' && existing.signedUrl.trim()) ||
      (typeof existing.uploadedImage === 'string' &&
        existing.uploadedImage.trim()) ||
      '';
    const alt =
      visualQueryFromImageRecord(existing) ||
      (typeof existing.image_name === 'string' ? existing.image_name : '') ||
      name;
    return {
      id,
      name,
      count,
      color,
      path: `items[${index}]`,
      src,
      alt,
    };
  });
}

function pictureGraphCameraControls(slotId: string): string {
  const id = escapeAttr(slotId);
  return `<div class="img-zone-box" onclick="selectWorksheetImage('${id}')" title="Click to replace image"></div><button type="button" class="img-camera-btn" onclick="selectWorksheetImage('${id}')" title="Replace image">${PICTURE_GRAPH_CAMERA_SVG}</button>`;
}

function pictureGraphImgTag(item: PictureGraphItem): string {
  const srcAttr = item.src ? ` src="${escapeHtml(item.src)}"` : '';
  return `<img class="worksheet-image picture-graph-img"${srcAttr} alt="${escapeHtml(item.alt)}" data-item-id="${escapeAttr(item.id)}" data-image-slot="${escapeAttr(item.id)}" data-field-path="${escapeAttr(item.path)}" />`;
}

export function buildPictureGraphBarsMarkup(
  structure: Record<string, unknown>,
): string {
  const items = resolvePictureGraphItems(structure);
  return items
    .map((item, index) => {
      const cfg = PICTURE_GRAPH_COLUMNS[index];
      const count = Math.max(0, Math.min(10, Math.round(item.count) || 0));
      if (count === 0) {
        return '';
      }
      const totalH = count * PICTURE_GRAPH_UNIT_H;
      const topY = cfg.baseY - totalH;
      const color = item.color || cfg.color;
      let innerTicks = '';
      for (let t = 1; t < count; t += 1) {
        const tickY = totalH - t * PICTURE_GRAPH_UNIT_H;
        innerTicks += `<div style="position:absolute;left:0;right:0;top:${tickY}px;border-top:1.5px dashed rgba(255,255,255,0.7);pointer-events:none;"></div>`;
      }
      return `<div style="position:absolute;left:${cfg.barLeft}px;width:${cfg.barWidth}px;top:${topY}px;height:${totalH}px;background:${escapeAttr(color)};box-sizing:border-box;border-left:1.5px dashed #4fa3d1;border-right:1.5px dashed #4fa3d1;border-top:2px solid ${escapeAttr(color)};z-index:5;">${innerTicks}</div>`;
    })
    .join('\n');
}

export function buildPictureGraphIconsMarkup(
  structure: Record<string, unknown>,
): string {
  const items = resolvePictureGraphItems(structure);
  return items
    .map((item, index) => {
      const cfg = PICTURE_GRAPH_COLUMNS[index];
      return `<div class="graph-icon-item" style="left:${cfg.iconLeft}px;" data-item-id="${escapeAttr(item.id)}" data-field-path="${escapeAttr(item.path)}">${pictureGraphImgTag(item)}${pictureGraphCameraControls(item.id)}</div>`;
    })
    .join('\n');
}

export function buildPictureGraphCountItemsMarkup(
  structure: Record<string, unknown>,
): string {
  const items = resolvePictureGraphItems(structure);
  return PICTURE_GRAPH_COUNT_LAYOUT.map((pos) => {
    const item = items[pos.itemIdx];
    return `<div class="count-row-item" style="left:${pos.imgLeft}px;top:${pos.imgTop}px;" data-item-id="${escapeAttr(item.id)}" data-field-path="${escapeAttr(item.path)}"><div class="count-item-img-box">${pictureGraphImgTag(item)}${pictureGraphCameraControls(item.id)}</div></div><div class="count-answer-box" style="left:${pos.boxLeft}px;top:${pos.boxTop}px;" data-editable="item_count_${pos.itemIdx + 1}" data-field-path="${escapeAttr(item.path)}.count"></div>`;
  }).join('\n');
}

export function buildPictureGraphBottomChoicesMarkup(
  structure: Record<string, unknown>,
): string {
  const items = resolvePictureGraphItems(structure);
  return items
    .map(
      (item) =>
        `<div class="bottom-choice-item" data-item-id="${escapeAttr(item.id)}" data-field-path="${escapeAttr(item.path)}">${pictureGraphImgTag(item)}${pictureGraphCameraControls(item.id)}</div>`,
    )
    .join('\n');
}

/**
 * Port of legacy picture_graph rendererJs: bars on the empty grid, category
 * icons under columns, count-write images, and bottom circle-choice row.
 */
export function injectPictureGraphMarkup(
  html: string,
  structure: Record<string, unknown>,
): string {
  const needsGraph =
    /\{\{\s*GRAPH_BARS_HTML\s*\}\}/i.test(html) ||
    /\{\{\s*GRAPH_ICONS_HTML\s*\}\}/i.test(html) ||
    /\{\{\s*COUNT_ITEMS_HTML\s*\}\}/i.test(html) ||
    /\{\{\s*BOTTOM_CHOICES_HTML\s*\}\}/i.test(html) ||
    isPictureGraphWorksheet(structure);
  if (!needsGraph) {
    return html;
  }

  return html
    .replace(
      /\{\{\s*GRAPH_BARS_HTML\s*\}\}/gi,
      buildPictureGraphBarsMarkup(structure),
    )
    .replace(
      /\{\{\s*GRAPH_ICONS_HTML\s*\}\}/gi,
      buildPictureGraphIconsMarkup(structure),
    )
    .replace(
      /\{\{\s*COUNT_ITEMS_HTML\s*\}\}/gi,
      buildPictureGraphCountItemsMarkup(structure),
    )
    .replace(
      /\{\{\s*BOTTOM_CHOICES_HTML\s*\}\}/gi,
      buildPictureGraphBottomChoicesMarkup(structure),
    );
}

/**
 * Grid calibrated to the numbers_after_and_before background art
 * (asset 596×795 stretched onto the 1016×1316 canvas).
 *
 * Teal circle centers on canvas ≈ (191,605), (404,605) | (615,605), (828,605)
 * with rowStride ≈ 171. Tune these if overlays drift:
 * - originLeft/originTop: top-left of the left circle in cell 0
 * - rightCircle.left: distance from left-circle left edge → right-circle left edge
 * - mascot.left: left edge of the image between the two circles
 * - colStride / rowStride: cell-to-cell steps
 */
const BEFORE_AFTER_GRID = {
  originLeft: 137,
  originTop: 551,
  colStride: 424,
  rowStride: 171,
  leftCircle: { left: 0, top: 0 },
  mascot: { left: 113, top: 4 },
  rightCircle: { left: 213, top: 0 },
  circleSize: 108,
  mascotSize: { width: 90, height: 100 },
};

/**
 * Number-line digit anchors under the printed ticks.
 * `.nl-digit` uses margin-left:-22px, so `left` is the tick center.
 */
const NUMBER_LINE_LAYOUT = {
  top: 430,
  startLeft: 191,
  endLeft: 599,
  digitWidth: 44,
  digitHeight: 34,
};

function numberLineValues(structure: Record<string, unknown>): number[] {
  if (Array.isArray(structure.number_line_numbers)) {
    return structure.number_line_numbers
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n));
  }
  const line = isRecord(structure.number_line) ? structure.number_line : null;
  if (line && Array.isArray(line.numbers)) {
    return line.numbers.map((n) => Number(n)).filter((n) => Number.isFinite(n));
  }
  if (line && typeof line.start === 'number' && typeof line.end === 'number') {
    const out: number[] = [];
    for (let n = line.start; n <= line.end; n += 1) {
      out.push(n);
    }
    return out;
  }
  return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
}

export function buildNumberLineDigitsMarkup(
  structure: Record<string, unknown>,
): string {
  const values = numberLineValues(structure);
  if (values.length === 0) {
    return '';
  }
  const { top, startLeft, endLeft, digitWidth, digitHeight } = NUMBER_LINE_LAYOUT;
  const span = Math.max(1, values.length - 1);
  const step = (endLeft - startLeft) / span;

  return values
    .map((value, index) => {
      const left = Math.round(startLeft + index * step);
      const path = `number_line_numbers[${index}]`;
      return `<div class="nl-digit" style="left:${left}px;top:${top}px;width:${digitWidth}px;height:${digitHeight}px;" data-editable="nl_digit_${index}" data-field-path="${escapeAttr(path)}">${escapeHtml(String(value))}</div>`;
    })
    .join('');
}

/**
 * Before/after number grid: blank circle | mascot | given number (or swapped).
 * Circles on the background art are underlays; we paint the given digit + penguin.
 */
export function buildBeforeAfterItemsMarkup(
  structure: Record<string, unknown>,
  pencilIconUrl = '',
): string {
  const unified = unifyBeforeAfterSharedMascot(structure);
  const items = Array.isArray(unified.items) ? unified.items : [];
  if (items.length === 0) {
    return '';
  }
  const icon = pencilIconUrl.trim();
  const {
    originLeft,
    originTop,
    colStride,
    rowStride,
    leftCircle,
    mascot,
    rightCircle,
    circleSize,
    mascotSize,
  } = BEFORE_AFTER_GRID;

  // One shared clipart URL for every cell (first resolved asset wins).
  let sharedSrc = '';
  let sharedAlt = 'mascot';
  for (const item of items) {
    if (!isRecord(item)) {
      continue;
    }
    const src =
      (typeof item.assetUrl === 'string' && item.assetUrl.trim()) ||
      (typeof item.imageUrl === 'string' && item.imageUrl.trim()) ||
      (typeof item.signedUrl === 'string' && item.signedUrl.trim()) ||
      '';
    if (src) {
      sharedSrc = src;
      sharedAlt =
        visualQueryFromImageRecord(item) ||
        (typeof item.image_name === 'string' ? item.image_name : '') ||
        'mascot';
      break;
    }
  }

  return items
    .map((item, index) => {
      if (!isRecord(item)) {
        return '';
      }
      const col = index % 2;
      const row = Math.floor(index / 2);
      const cellLeft = originLeft + col * colStride;
      const cellTop = originTop + row * rowStride;
      const blankOnLeft =
        String(item.blank_position ?? 'left').toLowerCase() !== 'right';
      const givenLeft = cellLeft + (blankOnLeft ? rightCircle.left : leftCircle.left);
      const givenTop = cellTop + (blankOnLeft ? rightCircle.top : leftCircle.top);
      const mascotLeft = cellLeft + mascot.left;
      const mascotTop = cellTop + mascot.top;
      const path = `items[${index}]`;
      const slotId =
        (typeof item.id === 'string' && item.id.trim()) || `item_${index + 1}`;
      const value = escapeHtml(pairField(item, 'number'));
      const rawSrc =
        sharedSrc ||
        (typeof item.assetUrl === 'string' && item.assetUrl) ||
        (typeof item.imageUrl === 'string' && item.imageUrl) ||
        '';
      const srcAttr = rawSrc ? ` src="${escapeHtml(rawSrc)}"` : '';
      const alt = escapeHtml(
        sharedAlt ||
          visualQueryFromImageRecord(item) ||
          (typeof item.image_name === 'string' ? item.image_name : '') ||
          'mascot',
      );
      const pencil = icon
        ? `<button class="ai-pencil" data-pencil-for="${escapeAttr(path)}.number" type="button" title="AI regenerate" style="top:${givenTop - 8}px;left:${givenLeft + circleSize - 6}px;"><img src="${escapeAttr(icon)}" width="26" height="26" alt=""></button>`
        : '';

      return `${pencil}<div class="number-circle" style="left:${givenLeft}px;top:${givenTop}px;width:${circleSize}px;height:${circleSize}px;display:flex;align-items:center;justify-content:center;line-height:1;text-align:center;padding-top:6px;box-sizing:border-box;" data-editable="${escapeAttr(slotId)}" data-field-path="${escapeAttr(path)}.number">${value}</div><div class="item-mascot-box" style="left:${mascotLeft}px;top:${mascotTop}px;width:${mascotSize.width}px;height:${mascotSize.height}px;background:transparent;" data-item-id="${escapeAttr(slotId)}" data-field-path="${escapeAttr(path)}"><div class="img-zone-box" onclick="selectWorksheetImage('${escapeAttr(slotId)}')" title="Click to replace image"></div><button type="button" class="img-camera-btn" onclick="selectWorksheetImage('${escapeAttr(slotId)}')" title="Replace image"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></button><img class="item-mascot-img worksheet-image"${srcAttr} alt="${alt}" data-image-slot="${escapeAttr(slotId)}" data-field-path="${escapeAttr(path)}" style="background:transparent;mix-blend-mode:multiply;" /></div>`;
    })
    .join('');
}

type AbsoluteBox = { left: number; top: number; width: number; height: number };

/** storytime_maze sample anchors (start / obstacle / finish). */
const DEFAULT_MAZE_POSITIONS_BY_ROLE: Record<string, AbsoluteBox> = {
  // Start/finish sit slightly below the path openings; obstacle stays compact
  // inside the maze so it does not cover the white walls.
  start_character: { left: 35, top: 910, width: 200, height: 140 },
  start: { left: 35, top: 910, width: 200, height: 140 },
  story_element: { left: 630, top: 560, width: 155, height: 155 },
  obstacle: { left: 630, top: 560, width: 155, height: 155 },
  goal: { left: 840, top: 905, width: 125, height: 145 },
  finish: { left: 840, top: 905, width: 125, height: 145 },
};

const DEFAULT_MAZE_POSITIONS_BY_INDEX: AbsoluteBox[] = [
  DEFAULT_MAZE_POSITIONS_BY_ROLE.start_character,
  DEFAULT_MAZE_POSITIONS_BY_ROLE.story_element,
  DEFAULT_MAZE_POSITIONS_BY_ROLE.goal,
];

function absoluteBoxFromUnknown(value: unknown): AbsoluteBox | null {
  if (!isRecord(value)) {
    return null;
  }
  const left = Number(value.left);
  const top = Number(value.top);
  const width = Number(value.width);
  const height = Number(value.height);
  if (![left, top, width, height].every(Number.isFinite)) {
    return null;
  }
  return { left, top, width, height };
}

function resolveMazeItemPosition(
  item: Record<string, unknown>,
  index: number,
): AbsoluteBox {
  // Prefer calibrated anchors by role/id so LLM positions cannot reintroduce
  // oversized obstacles or float start/finish above the maze openings.
  const roleKey =
    typeof item.role === 'string' ? item.role.trim().toLowerCase() : '';
  if (roleKey && DEFAULT_MAZE_POSITIONS_BY_ROLE[roleKey]) {
    return DEFAULT_MAZE_POSITIONS_BY_ROLE[roleKey];
  }
  const idKey =
    typeof item.id === 'string'
      ? item.id.replace(/^item[_-]?/i, '').trim().toLowerCase()
      : '';
  if (idKey && DEFAULT_MAZE_POSITIONS_BY_ROLE[idKey]) {
    return DEFAULT_MAZE_POSITIONS_BY_ROLE[idKey];
  }
  return (
    absoluteBoxFromUnknown(item.position) ||
    DEFAULT_MAZE_POSITIONS_BY_INDEX[index] ||
    DEFAULT_MAZE_POSITIONS_BY_INDEX[0]
  );
}

export function itemsUseAbsolutePositions(
  structure: Record<string, unknown>,
): boolean {
  const items = Array.isArray(structure.items) ? structure.items : [];
  if (items.length === 0 || looksLikeMatchingPair(items[0])) {
    return false;
  }
  const type = String(structure.worksheet_type ?? '').toLowerCase();
  if (type === 'storytime_maze' || type.includes('maze')) {
    return true;
  }
  return items.some(
    (item) => isRecord(item) && absoluteBoxFromUnknown(item.position) != null,
  );
}

/**
 * Absolute-positioned maze / story clipart (no scatter labels).
 * Uses structure.items[].position when present; falls back by role/index.
 */
export function buildPositionedItemsMarkup(
  structure: Record<string, unknown>,
  pencilIconUrl = '',
): string {
  const items = Array.isArray(structure.items) ? structure.items : [];
  if (items.length === 0 || looksLikeMatchingPair(items[0])) {
    return '';
  }
  const icon = pencilIconUrl.trim();

  return items
    .map((item, index) => {
      if (!isRecord(item)) {
        return '';
      }
      const pos = resolveMazeItemPosition(item, index);
      const path = `items[${index}]`;
      const slotId =
        (typeof item.id === 'string' && item.id.trim()) || `item_${index + 1}`;
      const label =
        (typeof item.label === 'string' && item.label) ||
        (typeof item.role === 'string' && item.role) ||
        slotId;
      const rawSrc =
        (typeof item.assetUrl === 'string' && item.assetUrl) ||
        (typeof item.imageUrl === 'string' && item.imageUrl) ||
        '';
      const srcAttr = rawSrc ? ` src="${escapeHtml(rawSrc)}"` : '';
      const alt = escapeHtml(
        visualQueryFromImageRecord(item) || label || slotId,
      );
      const pencil = icon
        ? `<button class="ai-pencil" data-pencil-for="${escapeAttr(path)}" type="button" title="AI regenerate" style="top:-12px;left:-12px;"><img src="${escapeAttr(icon)}" width="26" height="26" alt=""></button>`
        : '';
      // Transparent container + multiply blend so white clipart plates do not
      // paint opaque boxes over the grassy maze background.
      return `<div class="maze-item-container" style="left:${pos.left}px;top:${pos.top}px;width:${pos.width}px;height:${pos.height}px;background:transparent;" data-item-id="${escapeAttr(slotId)}" data-field-path="${escapeAttr(path)}">${pencil}<div class="img-zone-box" onclick="selectWorksheetImage('${escapeAttr(slotId)}')" title="Click to replace image"></div><button type="button" class="img-camera-btn" onclick="selectWorksheetImage('${escapeAttr(slotId)}')" title="Replace image"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></button><img class="maze-item-img worksheet-image"${srcAttr} alt="${alt}" data-image-slot="${escapeAttr(slotId)}" data-field-path="${escapeAttr(path)}" style="background:transparent;mix-blend-mode:multiply;" /></div>`;
    })
    .join('');
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
  const positions = generateCircleGridPositions(items.length, box, itemSize);
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
      const slotId = path;
      const rawSrc =
        (typeof item.assetUrl === 'string' && item.assetUrl) ||
        (typeof item.imageUrl === 'string' && item.imageUrl) ||
        '';
      const srcAttr = rawSrc ? ` src="${escapeHtml(rawSrc)}"` : '';
      // Labels stay in structure for answer keys / AI; canvas shows images only.
      const alt = slotMatch?.imageQuery || visualQueryFromImageRecord(item) || label || slotId;
      const isCorrect = item.is_correct === true;
      const pencil = icon
        ? `<button class="ai-pencil" data-pencil-for="${escapeHtml(path)}" type="button" title="AI regenerate" style="position:absolute;top:-10px;right:-10px;width:30px;height:30px;z-index:3;"><img src="${escapeHtml(icon)}" width="30" height="30" alt=""></button>`
        : '';
      return `<div class="item" style="position:absolute;top:${pos.top}px;left:${pos.left}px;width:${itemSize.width}px;height:${itemSize.height}px;display:flex;align-items:center;justify-content:center;" data-item-id="${escapeHtml(path)}" data-correct="${isCorrect}" data-field-path="${escapeHtml(path)}">${pencil}<img class="worksheet-image"${srcAttr} alt="${escapeHtml(alt)}" data-image-slot="${escapeHtml(slotId)}" data-field-path="${escapeHtml(path)}" style="max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;" /></div>`;
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
  if (
    [
      'goat',
      'main',
      'main_image',
      'hero',
      'primary',
      'scene',
      'scene_image',
    ].includes(needle)
  ) {
    return (
      slots.find(
        (slot) =>
          slot.slotId === 'main_image' ||
          slot.slotId === 'scene_image' ||
          slot.path === 'image' ||
          slot.path.endsWith('.image'),
      ) || null
    );
  }
  const pairSide = parsePairSideSlot(needle);
  if (pairSide) {
    const path = `pairs[${pairSide.index}].${pairSide.side}_image`;
    return (
      slots.find((slot) => slot.path === path) || {
        slotId: path,
        path,
        assetId: null,
        imageQuery: '',
      }
    );
  }
  const indexMatch = needle.match(/^(?:item|image|img|slot)[_-]?(\d+)$/);
  if (indexMatch) {
    const index = Number(indexMatch[1]) - 1;
    return (
      slots.find((slot) => slot.path === `items[${index}]`) ||
      slots.find((slot) => slot.slotId.toLowerCase() === `item_${index + 1}`) ||
      slots.find((slot) => slot.path.endsWith(`[${index}]`)) ||
      null
    );
  }
  if (Array.isArray(structure.items)) {
    const byId = structure.items.findIndex(
      (item) => isRecord(item) && typeof item.id === 'string' && item.id.toLowerCase() === needle,
    );
    if (byId >= 0) {
      return (
        slots.find((slot) => slot.path === `items[${byId}]`) || {
          slotId: String((structure.items[byId] as Record<string, unknown>).id),
          path: `items[${byId}]`,
          assetId: null,
          imageQuery: '',
        }
      );
    }
  }
  return null;
}

/** IMAGE_1_LEFT / pair_2.right / pairs[0].left_image → { index, side }. */
export function parsePairSideSlot(
  slotId: string,
): { index: number; side: 'left' | 'right' } | null {
  const needle = slotId.trim().toLowerCase();
  const match =
    needle.match(/^image[_-]?(\d+)[_-](left|right)$/i) ||
    needle.match(/^pair[_-]?(\d+)[_./-](left|right)(?:_image)?$/i) ||
    needle.match(/^pairs\[(\d+)\]\.(left|right)_image$/i);
  if (!match) {
    return null;
  }
  const fromPairsPath = /^pairs\[/i.test(needle);
  const index = fromPairsPath ? Number(match[1]) : Number(match[1]) - 1;
  if (!Number.isFinite(index) || index < 0) {
    return null;
  }
  return { index, side: match[2].toLowerCase() as 'left' | 'right' };
}

export type ImageZoneBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * Quadrant boxes measured against the background artwork: the green ring
 * renders at x 324-690 / y 479-835 on the 1016x1316 canvas, so the top row
 * stays above it and the bottom row stays beside it. Keep every box clear of
 * that rect or pictures cover the letter circle.
 */
const DEFAULT_LOOK_AND_SAY_ZONES: Record<string, ImageZoneBox> = {
  item_1: { left: 55, top: 245, width: 265, height: 230 },
  item_2: { left: 696, top: 245, width: 265, height: 230 },
  item_3: { left: 55, top: 700, width: 265, height: 275 },
  item_4: { left: 696, top: 700, width: 265, height: 275 },
};

function stylePx(style: string, prop: string): number | undefined {
  const found = style.match(new RegExp(`${prop}\\s*:\\s*([\\d.]+)px`, 'i'));
  return found ? Number(found[1]) : undefined;
}

/**
 * Image boxes from prototype .img-zone-box overlays
 * (selectWorksheetImage / selectPairImage).
 */
export function parseImageZoneBoxes(html: string): Record<string, ImageZoneBox> {
  const zones: Record<string, ImageZoneBox> = {};
  const tagRe = /<(?:div|button)\b[^>]*class=["'][^"']*\b(?:img-zone-box|img-camera-btn)\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html))) {
    const tag = match[0];
    const pairCall = tag.match(
      /selectPairImage\(\s*['"]([^'"]+)['"]\s*,\s*['"](left|right)['"]\s*\)/i,
    );
    const worksheetCall = tag.match(
      /selectWorksheetImage\(\s*['"]([^'"]+)['"]\s*\)/i,
    );
    const dataSlot = tag.match(/data-image-slot=["']([^"']+)["']/i)?.[1];
    const dataItem = tag.match(/data-item-id=["']([^'"]+)["']/i)?.[1];
    const style = tag.match(/\bstyle=["']([^"']+)["']/i)?.[1] || '';
    const left = stylePx(style, 'left');
    const top = stylePx(style, 'top');
    const width = stylePx(style, 'width');
    const height = stylePx(style, 'height');
    // camera buttons only carry left/top — skip unless a zone box already set size
    const hasBox = [left, top, width, height].every(Number.isFinite);
    if (!hasBox && !pairCall && !worksheetCall && !dataSlot) {
      continue;
    }

    const keys: string[] = [];
    if (pairCall) {
      const pairId = pairCall[1];
      const side = pairCall[2].toLowerCase() as 'left' | 'right';
      const n = pairId.match(/(\d+)$/)?.[1];
      keys.push(`${pairId}.${side}`, `${pairId}_${side}`);
      if (n) {
        keys.push(
          `IMAGE_${n}_${side.toUpperCase()}`,
          `image_${n}_${side}`,
          `pairs[${Number(n) - 1}].${side}_image`,
        );
      }
    }
    const id = worksheetCall?.[1] || dataSlot || dataItem;
    if (id) {
      keys.push(id);
      const n = id.match(/(\d+)$/)?.[1];
      if (n) {
        keys.push(`item_${n}`, `IMAGE_${n}`);
      }
    }

    if (!keys.length || !Number.isFinite(left) || !Number.isFinite(top)) {
      continue;
    }
    if (hasBox) {
      const box = { left: left!, top: top!, width: width!, height: height! };
      for (const key of keys) {
        zones[key] = box;
        zones[key.toLowerCase()] = box;
      }
    }
  }
  return zones;
}

/**
 * Tracing image boxes — square per pair (1:1), shared top so left/right
 * stay horizontally center-aligned on the pair line. Columns centered on
 * x≈252 / x≈764. Pairs 1–2 are 15px below the original prototype tops.
 */
const DEFAULT_TRACING_ZONES: Record<string, ImageZoneBox> = {
  IMAGE_1_LEFT: { left: 205, top: 370, width: 95, height: 95 },
  IMAGE_1_RIGHT: { left: 717, top: 370, width: 95, height: 95 },
  IMAGE_2_LEFT: { left: 187, top: 520, width: 130, height: 130 },
  IMAGE_2_RIGHT: { left: 699, top: 520, width: 130, height: 130 },
  IMAGE_3_LEFT: { left: 187, top: 885, width: 130, height: 130 },
  IMAGE_3_RIGHT: { left: 699, top: 885, width: 130, height: 130 },
  IMAGE_4_LEFT: { left: 205, top: 1090, width: 95, height: 95 },
  IMAGE_4_RIGHT: { left: 717, top: 1090, width: 95, height: 95 },
};

export function imageZoneForSlot(
  html: string,
  slotId: string,
): ImageZoneBox | undefined {
  const zones = parseImageZoneBoxes(html);
  const pairSide = parsePairSideSlot(slotId);
  const aliases = [
    slotId,
    slotId.toLowerCase(),
    pairSide
      ? `IMAGE_${pairSide.index + 1}_${pairSide.side.toUpperCase()}`
      : '',
    pairSide ? `pairs[${pairSide.index}].${pairSide.side}_image` : '',
    pairSide ? `pair_${pairSide.index + 1}.${pairSide.side}` : '',
  ].filter(Boolean);

  for (const key of aliases) {
    if (zones[key]) {
      return zones[key];
    }
  }

  const n = slotId.match(/^(?:item|image|img|slot)[_-]?(\d+)$/i)?.[1];
  if (n && zones[`item_${n}`]) {
    return zones[`item_${n}`];
  }

  for (const key of aliases) {
    const fallback =
      DEFAULT_TRACING_ZONES[key] || DEFAULT_TRACING_ZONES[key.toUpperCase()];
    if (fallback) {
      return fallback;
    }
  }

  const isLookAndSay =
    /\{\{\s*IMAGE[_:]\d+\s*\}\}/i.test(html) ||
    /caption-q[1-4]/i.test(html) ||
    /look_and_say/i.test(html);
  // Never apply look-and-say quadrant defaults to other templates (e.g.
  // numbers_after_and_before item_1..item_8 mascots already have parent boxes).
  if (!isLookAndSay) {
    return undefined;
  }

  for (const key of aliases) {
    if (DEFAULT_LOOK_AND_SAY_ZONES[key]) {
      return DEFAULT_LOOK_AND_SAY_ZONES[key];
    }
  }
  if (n) {
    return DEFAULT_LOOK_AND_SAY_ZONES[`item_${n}`];
  }
  return undefined;
}

export function highlightCaptionLetter(text: string, letter: string): string {
  const escaped = escapeHtml(text);
  const raw = letter.trim();
  if (!raw) {
    return escaped;
  }
  const re = new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  return escaped.replace(re, (match) => `<span class="hl-letter">${match}</span>`);
}

function upsertHtmlAttr(attrs: string, name: string, value: string): string {
  if (new RegExp(`\\b${name}\\s*=`, 'i').test(attrs)) {
    return attrs;
  }
  return `${attrs} ${name}="${escapeAttr(value)}"`;
}

/**
 * Prototype templates use item_1 / selectWorksheetImage(). Wire the same
 * data-field-path / data-image-slot hooks every editor already understands.
 */
export function bindGenericEditorHooks(
  html: string,
  structure: Record<string, unknown>,
): string {
  let next = html.replace(
    /<(div|button|span)(\s[^>]*?(?:img-zone-box|img-camera-btn)[^>]*)>/gi,
    (full, tag: string, attrs: string) => {
      const pairCall = attrs.match(
        /selectPairImage\(\s*['"]([^'"]+)['"]\s*,\s*['"](left|right)['"]\s*\)/i,
      );
      if (pairCall) {
        const pairId = pairCall[1];
        const side = pairCall[2].toLowerCase();
        const n = pairId.match(/(\d+)$/)?.[1];
        const path = n
          ? `pairs[${Number(n) - 1}].${side}_image`
          : resolveAliasImagePath(structure, `${pairId}.${side}`);
        const slotId = n
          ? `IMAGE_${n}_${side.toUpperCase()}`
          : `${pairId}_${side}`;
        let out = upsertHtmlAttr(attrs, 'data-image-slot', slotId);
        out = upsertHtmlAttr(out, 'data-field-path', path);
        return `<${tag}${out}>`;
      }
      const id =
        attrs.match(/selectWorksheetImage\(\s*['"]([^'"]+)['"]/i)?.[1] ||
        attrs.match(/data-image-slot=["']([^"']+)["']/i)?.[1];
      if (!id) {
        return full;
      }
      const path = resolveAliasImagePath(structure, id);
      let out = upsertHtmlAttr(attrs, 'data-image-slot', id);
      out = upsertHtmlAttr(out, 'data-field-path', path);
      return `<${tag}${out}>`;
    },
  );

  next = next.replace(
    /<([a-z0-9]+)(\s[^>]*\bdata-editable=["']([^"']+)["'][^>]*)>/gi,
    (full, tag: string, attrs: string, editable: string) => {
      if (/\bdata-field-path=/i.test(attrs)) {
        return full;
      }
      const resolved = resolveAliasFieldPath(structure, editable);
      if (resolved === editable) {
        return full;
      }
      return `<${tag}${upsertHtmlAttr(attrs, 'data-field-path', resolved)}>`;
    },
  );

  next = next.replace(
    /(\sdata-pencil-for=["'])([^"']+)(["'])/gi,
    (_match, open: string, path: string, close: string) => {
      return `${open}${resolveAliasFieldPath(structure, path)}${close}`;
    },
  );

  return next;
}

export function injectLookAndSayCaptions(
  html: string,
  structure: Record<string, unknown>,
): string {
  const items = Array.isArray(structure.items) ? structure.items : [];
  const target =
    typeof structure.target_letter === 'string' ? structure.target_letter : '';
  let next = html;

  if (/class=["'][^"']*\bcaption\b/i.test(next)) {
    next = next.replace(
      /(<div\b[^>]*class=["'][^"']*\bcaption\b[^>]*>)([\s\S]*?)(<\/div>)/gi,
      (full, open: string, inner: string, close: string) => {
        const editable = open.match(/data-editable=["']([^"']+)["']/i)?.[1] || '';
        const indexMatch = editable.match(/item[_-]?(\d+)/i);
        const index = indexMatch ? Number(indexMatch[1]) - 1 : -1;
        const item = index >= 0 && isRecord(items[index]) ? items[index] : null;
        const letter =
          (item && typeof item.letter === 'string' && item.letter) || target;
        const caption =
          (item && typeof item.caption === 'string' && item.caption) ||
          inner.replace(/<[^>]+>/g, '').trim();
        if (!caption || !letter) {
          return full;
        }
        return `${open}${highlightCaptionLetter(caption, letter)}${close}`;
      },
    );
  }

  // look_and_say_circle_the_letters: first letter of each vocab word in red
  if (/class=["'][^"']*\bvocab-word\b/i.test(next)) {
    next = next.replace(
      /(<div\b[^>]*class=["'][^"']*\bvocab-word\b[^>]*>)([\s\S]*?)(<\/div>)/gi,
      (full, open: string, inner: string, close: string) => {
        if (/hl-letter/i.test(inner)) {
          return full;
        }
        const editable = open.match(/data-editable=["']([^"']+)["']/i)?.[1] || '';
        const indexMatch = editable.match(/word[_-]?(\d+)/i);
        const index = indexMatch ? Number(indexMatch[1]) - 1 : -1;
        const item = index >= 0 && isRecord(items[index]) ? items[index] : null;
        const text =
          (item && typeof item.word === 'string' && item.word.trim()) ||
          inner.replace(/<[^>]+>/g, '').trim();
        if (!text) {
          return full;
        }
        const first = escapeHtml(text.charAt(0));
        const rest = escapeHtml(text.slice(1));
        return `${open}<span class="hl-letter">${first}</span>${rest}${close}`;
      },
    );
  }

  return next;
}