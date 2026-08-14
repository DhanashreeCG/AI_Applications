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
    }
    if (Array.isArray(value)) {
      walkArray(key, value);
    }
  }

  return tokens;
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
