import { Injectable } from '@nestjs/common';
import { GENERIC_RENDERER_TYPE } from '../constants/worksheet.constants';
import { WorksheetRenderer } from './worksheet-renderer.interface';

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char] ?? char);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function lookup(context: unknown, path: string): unknown {
  if (path === 'this' || path === '.') {
    return context;
  }
  const parts = path.split('.').filter(Boolean);
  let current: unknown = context;
  for (const part of parts) {
    if (Array.isArray(current) && /^\d+$/.test(part)) {
      current = current[Number(part)];
      continue;
    }
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function stringifyValue(value: unknown): string {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return escapeHtml(String(value));
  }
  return escapeHtml(JSON.stringify(value));
}

@Injectable()
export class GenericWorksheetRenderer implements WorksheetRenderer {
  readonly type = GENERIC_RENDERER_TYPE;

  render(input: {
    templateHtml: string;
    structure: Record<string, unknown>;
    rendererConfig?: Record<string, unknown> | null;
    backgroundAssetUrl?: string | null;
  }): string {
    const context: Record<string, unknown> = {
      ...input.structure,
      backgroundAssetUrl: input.backgroundAssetUrl ?? '',
    };
    return this.renderTemplate(input.templateHtml, context);
  }

  private renderTemplate(template: string, context: unknown): string {
    const withSections = template.replace(
      /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
      (_match, key: string, inner: string) => {
        const value = isRecord(context) ? context[key] : undefined;
        if (!Array.isArray(value)) {
          return '';
        }
        return value
          .map((item, index) => {
            const childContext = isRecord(item)
              ? { ...item, '@index': index + 1 }
              : { this: item, '@index': index + 1 };
            return this.renderTemplate(inner, childContext);
          })
          .join('');
      },
    );

    return withSections.replace(/\{\{([^#/][^}]*)\}\}/g, (_match, rawPath: string) => {
      const path = rawPath.trim();
      if (!path || path.includes('(') || path.includes(';')) {
        return '';
      }
      return stringifyValue(lookup(context, path));
    });
  }
}
