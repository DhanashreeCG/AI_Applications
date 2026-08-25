import { collectImageSlots } from './structure.util';
import { ImageSlotRef } from '../types/worksheet.types';

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
    numberLeft: Number(layout.number_left) || (isNumberNames ? 140 : 95),
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
function upsertStylePosition(attrs: string, top: number, left: number): string {
  const apply = (style: string) => {
    let next = style
      .replace(/top\s*:\s*[\d.]*\s*px/gi, `top:${top}px`)
      .replace(/left\s*:\s*[\d.]*\s*px/gi, `left:${left}px`)
      .replace(/top\s*:\s*px/gi, `top:${top}px`)
      .replace(/left\s*:\s*px/gi, `left:${left}px`);
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
 * NOTE: only top/left are set here. Text color and weight come from the
 * template's own .name-item / .number-item CSS class — the `pairs[].color`
 * field is the pill/swatch background color, not text color, and must not
 * be applied inline here.
 */
export function positionMatchingPairItems(
  html: string,
  structure: Record<string, unknown>,
): string {
  const pairs = Array.isArray(structure.pairs) ? structure.pairs : [];
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
      return `<${tag}${upsertStylePosition(attrs, top, left)}>`;
    },
  );
}

/**
 * Number-names matching templates expect either {{NUMBERS}}/{{NAMES}}
 * or {{#each pairs}} rows. Prototype CSS uses absolute .number-item / .name-item
 * without top/left, so positions are computed here.
 * Text styling (color, font-weight, centering) is intentionally left to the
 * template's own .name-item / .number-item CSS class and is never set inline.
 */
export function buildMatchingPairMarkup(
  structure: Record<string, unknown>,
  pencilIconUrl = '',
): { numbers: string; names: string } {
  const pairs = Array.isArray(structure.pairs) ? structure.pairs : [];
  if (pairs.length === 0) {
    return { numbers: '', names: '' };
  }
  const { startTop, numberLeft, nameLeft, rowHeight } = matchingPairLayout(
    structure,
    pairs.length,
  );
  const icon = pencilIconUrl.trim();

  const pencil = (path: string, top: number, left: number) => {
    if (!icon) {
      return '';
    }
    return `<button type="button" class="ai-pencil" data-pencil-for="${escapeAttr(path)}" style="top:${top + 10}px;left:${left}px" aria-label="Edit field"><img src="${escapeAttr(icon)}" alt="" /></button>`;
  };

  // Starting font sizes are set explicitly (not left to the browser default)
  // so shrinkToFit's per-element "max size" is intentional. Longer number
  // names ("seventy-eight") will auto-shrink toward MIN_FONT if needed; short
  // ones stay at this size.
  const NUMBER_FONT_SIZE = 38;
  const NAME_FONT_SIZE = 28;

  const numbers = pairs
    .map((item, index) => {
      const top = startTop + index * rowHeight;
      const path = `pairs[${index}].number`;
      const value = escapeHtml(pairField(item, 'number'));
      return `<div class="number-item" style="top:${top}px;left:${numberLeft}px;font-size:${NUMBER_FONT_SIZE}px" data-editable="${escapeAttr(path)}" data-field-path="${escapeAttr(path)}">${value}</div>${pencil(path, top, numberLeft + 76)}`;
    })
    .join('');

  const nameIndices = pairs.map((_, i) => i).sort((a, b) => Math.sin(a + 1) - Math.sin(b + 1));

  const names = pairs
    .map((item, originalIndex) => {
      const renderIndex = nameIndices.indexOf(originalIndex);
      const top = startTop + renderIndex * rowHeight;
      const path = `pairs[${originalIndex}].name`;
      const value = escapeHtml(pairField(item, 'name'));
      return `<div class="name-item" style="top:${top}px;left:${nameLeft}px;font-size:${NAME_FONT_SIZE}px" data-editable="${escapeAttr(path)}" data-field-path="${escapeAttr(path)}">${value}</div>${pencil(path, top, nameLeft + 238)}`;
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

  let next = html.replace(/\{\{\s*NUMBERS\s*\}\}/gi, numbers).replace(/\{\{\s*NAMES\s*\}\}/gi, names);

  const replaceIfEmptyLoop = (match: string, inner: string) => {
    const hasItemTokens = /\{\{\s*(number|name|color|@index|this)\s*\}\}/i.test(inner);
    return hasItemTokens ? match : `${numbers}${names}`;
  };

  next = next.replace(/\{\{#each\s+pairs\}\}([\s\S]*?)\{\{\/each\}\}/gi, replaceIfEmptyLoop);
  next = next.replace(/\{\{#pairs\}\}([\s\S]*?)\{\{\/pairs\}\}/gi, replaceIfEmptyLoop);
  return next;
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