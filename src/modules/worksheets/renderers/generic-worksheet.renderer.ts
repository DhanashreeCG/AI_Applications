import { Injectable } from '@nestjs/common';
import { GENERIC_RENDERER_TYPE } from '../constants/worksheet.constants';
import { WorksheetRenderInput, WorksheetRenderMode } from '../types/worksheet.types';
import { flattenTemplateTokens, resolveImageSlot } from '../utils/template-tokens.util';
import { WorksheetRenderer } from './worksheet-renderer.interface';

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const FIELD_ALIASES: Record<string, string> = {
  BACKGROUND_IMAGE: 'backgroundAssetUrl',
  BODY_CLASS: 'bodyClass',
  FONT_PATH: 'fontPath',
};

const EDITOR_CHROME = `
<style data-editor-chrome="true">
body.editor-mode [data-editable] {
  cursor: pointer;
  outline: 2px dashed rgba(106, 13, 173, 0.45);
}
body.export-mode [data-editor-control],
body.export-mode .ai-pencil,
body.export-mode .img-camera-btn,
body.export-mode .img-zone-box {
  display: none !important;
}
img[data-image-slot] {
  object-fit: contain;
}
</style>
`;

const EDITOR_BRIDGE = `
<script data-editor-bridge="true">
(function () {
  function emit(type, detail) {
    try { parent.postMessage(Object.assign({ type: type }, detail), '*'); } catch (e) {}
  }
  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!(target instanceof Element)) return;
    var slot = target.closest('[data-image-slot], [data-editor-control][data-image-slot]');
    if (slot) {
      emit('worksheet-replace-image', {
        slotId: slot.getAttribute('data-image-slot'),
        path: slot.getAttribute('data-field-path') || undefined
      });
      return;
    }
    var field = target.closest('[data-editable]');
    if (field) {
      emit('worksheet-select-field', {
        path: field.getAttribute('data-field-path') || field.getAttribute('data-editable')
      });
    }
  });
})();
</script>
`;

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char] ?? char);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function lookup(context: unknown, path: string): unknown {
  const aliased = FIELD_ALIASES[path] ?? path;
  if (aliased === 'this' || aliased === '.') {
    return context;
  }
  const parts = aliased.split(/[.[\]]/).filter(Boolean);
  let current: unknown = context;
  for (const part of parts) {
    if (Array.isArray(current) && /^\d+$/.test(part)) {
      current = current[Number(part)];
      continue;
    }
    if (!isRecord(current)) {
      return undefined;
    }
    if (part in current) {
      current = current[part];
      continue;
    }
    const match = Object.keys(current).find(
      (key) => key.toLowerCase() === part.toLowerCase(),
    );
    if (!match) {
      return undefined;
    }
    current = current[match];
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

function slotUrl(
  structure: Record<string, unknown>,
  slotId: string,
): { src: string; alt: string; path: string; slotId: string } {
  const match = resolveImageSlot(structure, slotId);
  const node = match?.path
    ? lookup(structure, match.path.replace(/\[(\d+)\]/g, '.$1'))
    : lookup(structure, slotId);
  const record = isRecord(node) ? node : {};
  const src =
    (typeof record.assetUrl === 'string' && record.assetUrl) ||
    (typeof record.imageUrl === 'string' && record.imageUrl) ||
    '';
  return {
    src,
    alt:
      (match?.imageQuery ||
        (typeof record.imageQuery === 'string' ? record.imageQuery : slotId)) ??
      slotId,
    path: match?.path || slotId,
    slotId: match?.slotId || slotId,
  };
}

function imageTag(
  slotId: string,
  resolved: { src: string; alt: string; path: string; slotId: string },
  positioned: boolean,
): string {
  const style = positioned
    ? 'position:absolute;left:70px;top:300px;width:200px;height:200px;object-fit:contain;'
    : 'object-fit:contain;';
  return `<img class="worksheet-image" data-image-slot="${escapeHtml(resolved.slotId || slotId)}" data-field-path="${escapeHtml(resolved.path)}" src="${escapeHtml(resolved.src)}" alt="${escapeHtml(resolved.alt)}" style="${style}" />`;
}

function applyImageSlots(html: string, structure: Record<string, unknown>): string {
  const withTokens = html.replace(/\{\{IMAGE:([A-Za-z0-9_]+)\}\}/g, (_match, slotId: string) => {
    return imageTag(slotId, slotUrl(structure, slotId), false);
  });

  const withNamed = withTokens.replace(
    /\{\{([A-Za-z0-9]+_IMAGE)\}\}/g,
    (full, name: string) => {
      if (name === 'BACKGROUND_IMAGE') {
        return full;
      }
      const slotId = name.replace(/_IMAGE$/i, '');
      return imageTag(slotId, slotUrl(structure, slotId), true);
    },
  );

  return withNamed.replace(
    /<img\b([^>]*\bdata-image-slot=["']([^"']+)["'][^>]*)>/gi,
    (full, attrs: string, slotId: string) => {
      if (/\bsrc=/i.test(attrs) && !/\bsrc=["']\s*["']/i.test(attrs)) {
        return full;
      }
      const resolved = slotUrl(structure, slotId);
      let next = attrs;
      if (/\bsrc=/i.test(next)) {
        next = next.replace(/\bsrc=(["']).*?\1/i, `src="${escapeHtml(resolved.src)}"`);
      } else {
        next += ` src="${escapeHtml(resolved.src)}"`;
      }
      if (!/\balt=/i.test(next)) {
        next += ` alt="${escapeHtml(resolved.alt)}"`;
      }
      if (!/\bdata-field-path=/i.test(next)) {
        next += ` data-field-path="${escapeHtml(resolved.path)}"`;
      }
      return `<img${next}>`;
    },
  );
}

function applyBodyClass(html: string, mode: WorksheetRenderMode): string {
  const className = mode === 'editor' ? 'editor-mode' : 'export-mode';
  if (/<body\b/i.test(html)) {
    return html.replace(/<body([^>]*)>/i, (_match, attrs: string) => {
      if (/\bclass=/i.test(attrs)) {
        const next = attrs.replace(
          /\bclass=(["'])(.*?)\1/i,
          (_m, quote: string, value: string) => {
            const classes = value
              .split(/\s+/)
              .filter((item) => item && item !== 'editor-mode' && item !== 'export-mode');
            classes.push(className);
            return `class=${quote}${classes.join(' ')}${quote}`;
          },
        );
        return `<body${next}>`;
      }
      return `<body${attrs} class="${className}">`;
    });
  }
  return `<body class="${className}">${html}</body>`;
}

function applyCanvasSize(
  html: string,
  canvas: { width: number; height: number },
): string {
  const rule = `html,body{width:${canvas.width}px;height:${canvas.height}px;margin:0;overflow:hidden;}`;
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `<style data-worksheet-canvas="true">${rule}</style></head>`);
  }
  return `<style data-worksheet-canvas="true">${rule}</style>${html}`;
}

function injectBaseHref(html: string, baseHref: string): string {
  const tag = `<base href="${escapeHtml(baseHref.endsWith('/') ? baseHref : `${baseHref}/`)}" />`;
  if (/<head\b/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${tag}`);
  }
  return `${tag}${html}`;
}

function injectChrome(html: string, mode: WorksheetRenderMode): string {
  const extras = mode === 'editor' ? `${EDITOR_CHROME}${EDITOR_BRIDGE}` : EDITOR_CHROME;
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${extras}</head>`);
  }
  return `${extras}${html}`;
}

@Injectable()
export class GenericWorksheetRenderer implements WorksheetRenderer {
  readonly type = GENERIC_RENDERER_TYPE;

  render(input: WorksheetRenderInput): string {
    const mode: WorksheetRenderMode = input.mode ?? 'export';
    const extras: Record<string, unknown> = {
      backgroundAssetUrl: input.backgroundAssetUrl ?? '',
      BACKGROUND_IMAGE: input.backgroundAssetUrl ?? '',
      bodyClass: mode === 'editor' ? 'editor-mode' : 'export-mode',
      BODY_CLASS: mode === 'editor' ? 'editor-mode' : 'export-mode',
      fontPath: '',
      FONT_PATH: '',
    };
    if (input.topic) {
      extras.topic = input.topic;
    }
    const context = flattenTemplateTokens(input.structure, extras);
    let html = this.renderTemplate(input.templateHtml, context);
    html = applyImageSlots(html, {
      ...input.structure,
      ...context,
    });
    html = applyBodyClass(html, mode);
    if (input.canvas) {
      html = applyCanvasSize(html, input.canvas);
    }
    if (input.baseHref) {
      html = injectBaseHref(html, input.baseHref);
    }
    html = injectChrome(html, mode);
    return html;
  }

  private renderTemplate(template: string, context: unknown): string {
    const withSections = template.replace(
      /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
      (_match, key: string, inner: string) => {
        const value = lookup(context, key);
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
      if (!path || path.includes('(') || path.includes(';') || path.startsWith('IMAGE:') || (/_IMAGE$/i.test(path) && path !== 'BACKGROUND_IMAGE')) {
        return path.startsWith('IMAGE:') || (/_IMAGE$/i.test(path) && path !== 'BACKGROUND_IMAGE')
          ? `{{${path}}}`
          : '';
      }
      return stringifyValue(lookup(context, path));
    });
  }
}
