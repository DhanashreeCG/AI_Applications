import { Injectable } from '@nestjs/common';
import { toondemyFontUrl, toondemyTextCss } from '../../../common/ui/toondemy-font';
import { GENERIC_RENDERER_TYPE } from '../constants/worksheet.constants';
import { WorksheetRenderInput, WorksheetRenderMode } from '../types/worksheet.types';
import {
  flattenTemplateTokens,
  injectMatchingPairMarkup,
  injectPairImagesMarkup,
  injectSentenceRowMarkup,
  injectWorksheetItemsMarkup,
  positionMatchingPairItems,
  resolveImageSlot,
} from '../utils/template-tokens.util';
import { visualQueryFromImageRecord } from '../utils/structure.util';
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
body.editor-mode:not(.edit-mode) [data-editor-control],
body.editor-mode:not(.edit-mode) .ai-pencil,
body.editor-mode:not(.edit-mode) .img-camera-btn,
body.editor-mode:not(.edit-mode) .img-zone-box {
  display: none !important;
  pointer-events: none !important;
}
body.editor-mode.edit-mode [data-editable],
body.editor-mode.edit-mode img[data-image-slot],
body.editor-mode.edit-mode .worksheet-image {
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
  function applySrc(el, src) {
    if (!el || !src) return;
    if (el.tagName === 'IMG') {
      el.setAttribute('src', src);
      el.src = src;
      return;
    }
    var nested = el.querySelector && el.querySelector('img');
    if (nested) {
      nested.setAttribute('src', src);
      nested.src = src;
    }
    try { el.style.backgroundImage = 'url("' + src.replace(/"/g, '\\\\"') + '")'; } catch (e) {}
  }
  window.addEventListener('message', function (event) {
    var data = event.data || {};
    if (data.type !== 'worksheet-set-image') return;
    function cssAttr(name, value) {
      return '[' + name + '="' + String(value || '').replace(/"/g, '') + '"]';
    }
    function asImg(el) {
      if (!el) return null;
      return el.tagName === 'IMG' ? el : (el.querySelector && el.querySelector('img'));
    }
    var node = asImg(document.querySelector('[data-ws-target="active"]'));
    if (!node && data.path) {
      var byPath = document.querySelectorAll('img' + cssAttr('data-field-path', data.path));
      node = byPath.length === 1 ? byPath[0] : asImg(document.querySelector('[data-ws-target="active"]'));
      if (!node && byPath.length) node = byPath[0];
    }
    if (!node && data.slotId) {
      var bySlot = document.querySelectorAll('img' + cssAttr('data-image-slot', data.slotId));
      if (bySlot.length === 1) node = bySlot[0];
    }
    if (!node && (data.path === 'image' || data.slotId === 'image' || data.slotId === 'main_image' || data.slotId === 'goat')) {
      node = asImg(document.querySelector('.image-wrap img:not(.worksheet-bg), .img-zone-box img, img[data-field-path="image"]'));
    }
    if (node) applySrc(node, data.src);
  });
  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!(target instanceof Element)) return;
    if (!document.body.classList.contains('edit-mode')) return;
    var pencil = target.closest('[data-pencil-for], .ai-pencil');
    if (pencil) {
      event.preventDefault();
      event.stopPropagation();
      var path = pencil.getAttribute('data-pencil-for');
      if (!path) {
        var host = pencil.closest('[data-editable]') || pencil.parentElement;
        var field = (host && host.closest && host.closest('[data-editable]')) || (host && host.querySelector && host.querySelector('[data-editable]'));
        if (!field && host && host.previousElementSibling && host.previousElementSibling.matches && host.previousElementSibling.matches('[data-editable]')) {
          field = host.previousElementSibling;
        }
        path = field ? (field.getAttribute('data-field-path') || field.getAttribute('data-editable')) : '';
      }
      if (path) emit('worksheet-ai-field', { path: path });
      return;
    }
    var camera = target.closest('.img-camera-btn, [data-editor-control]');
    var slot = target.closest('[data-image-slot], [data-editor-control][data-image-slot], .worksheet-image, .img-zone-box, img');
    if (slot && (slot.classList.contains('worksheet-bg') || (slot.closest && (slot.closest('.ai-pencil') || slot.closest('.img-camera-btn'))))) {
      slot = null;
    }
    if (camera && !slot) {
      var zone = camera.closest('.img-zone-box, .img-zone, .image-wrap') || camera.parentElement;
      slot = zone && (zone.querySelector('[data-image-slot], img.worksheet-image, img:not(.worksheet-bg)') || zone);
    }
    if (slot) {
      event.preventDefault();
      event.stopPropagation();
      document.querySelectorAll('[data-ws-target]').forEach(function (el) { el.removeAttribute('data-ws-target'); });
      slot.setAttribute('data-ws-target', 'active');
      var img = slot.tagName === 'IMG' ? slot : slot.querySelector('img');
      if (img) img.setAttribute('data-ws-target', 'active');
      emit('worksheet-replace-image', {
        slotId: (slot.getAttribute('data-image-slot') || (img && img.getAttribute('data-image-slot')) || 'image'),
        path: (slot.getAttribute('data-field-path') || (img && img.getAttribute('data-field-path')) || 'image')
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
  if (typeof value === 'string') {
    if (/^(null|undefined)$/i.test(value.trim())) {
      return '';
    }
    return escapeHtml(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return escapeHtml(String(value));
  }
  return '';
}

function isUsableSrc(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && !/^(null|undefined)$/i.test(trimmed);
}

function slotUrl(
  structure: Record<string, unknown>,
  slotId: string,
): { src: string; alt: string; path: string; slotId: string; replaced: boolean } {
  const match = resolveImageSlot(structure, slotId);
  const node = match?.path
    ? lookup(structure, match.path.replace(/\[(\d+)\]/g, '.$1'))
    : lookup(structure, slotId);
  const record = isRecord(node) ? node : {};
  const replacement =
    typeof record.imageUrl === 'string' && isUsableSrc(record.imageUrl)
      ? record.imageUrl
      : '';
  const rawSrc =
    replacement ||
    (typeof record.assetUrl === 'string' && record.assetUrl) ||
    '';
  return {
    src: isUsableSrc(rawSrc) ? rawSrc : '',
    replaced: Boolean(replacement),
    alt:
      match?.imageQuery ||
      visualQueryFromImageRecord(record) ||
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
  const srcAttr = isUsableSrc(resolved.src)
    ? ` src="${escapeHtml(resolved.src)}"`
    : '';
  return `<img class="worksheet-image" data-image-slot="${escapeHtml(resolved.slotId || slotId)}" data-field-path="${escapeHtml(resolved.path)}"${srcAttr} alt="${escapeHtml(resolved.alt)}" style="${style}" />`;
}

function htmlHasImageSlot(html: string, slotId: string): boolean {
  const aliases = [slotId, 'main_image', 'image', 'goat', 'hero'].filter(Boolean);
  return aliases.some((id) =>
    new RegExp(`data-image-slot=["']${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'i').test(
      html,
    ),
  );
}

function applyImageSlots(html: string, structure: Record<string, unknown>): string {
  const withTokens = html.replace(/\{\{IMAGE:([A-Za-z0-9_]+)\}\}/g, (_match, slotId: string) => {
    if (htmlHasImageSlot(html, slotId)) {
      return '';
    }
    return imageTag(slotId, slotUrl(structure, slotId), false);
  });

  const withNamed = withTokens.replace(
    /\{\{([A-Za-z0-9]+_IMAGE)\}\}/g,
    (full, name: string) => {
      if (name === 'BACKGROUND_IMAGE') {
        return full;
      }
      const slotId = name.replace(/_IMAGE$/i, '');
      if (htmlHasImageSlot(withTokens, slotId)) {
        return '';
      }
      return imageTag(slotId, slotUrl(structure, slotId), true);
    },
  );

  return withNamed.replace(
    /<img\b([^>]*\bdata-image-slot=["']([^"']+)["'][^>]*)>/gi,
    (_full, attrs: string, slotId: string) => {
      const resolved = slotUrl(structure, slotId);
      const existingSrc = attrs.match(/\bsrc=(["'])(.*?)\1/i)?.[2] ?? '';
      let next = attrs.replace(/\s*\bsrc=(["']).*?\1/i, '');
      const src = isUsableSrc(resolved.src)
        ? resolved.src
        : existingSrc;
      if (isUsableSrc(src)) {
        next += ` src="${escapeHtml(src)}"`;
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

export function injectBaseHref(html: string, baseHref: string): string {
  if (!isUsableSrc(baseHref)) {
    return html;
  }
  const tag = `<base href="${escapeHtml(baseHref.endsWith('/') ? baseHref : `${baseHref}/`)}" />`;
  if (/<head\b/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${tag}`);
  }
  return `${tag}${html}`;
}

/**
 * Some imported templates had {{TOKEN}} replaced with SQL/JS null, leaving the
 * literal word NULL in the HTML. Restore prototype placeholders so content fills.
 */
export function restoreNullPlaceholders(html: string): string {
  const scripts: string[] = [];
  const withoutScripts = html.replace(
    /<script\b[^>]*>[\s\S]*?<\/script>/gi,
    (block) => {
      scripts.push(block);
      return `<!--__WS_SCRIPT_${scripts.length - 1}__-->`;
    },
  );

  let next = withoutScripts.replace(
    /url\(\s*(['"]?)NULL\1\s*\)/g,
    "url('{{FONT_PATH}}')",
  );
  next = next.replace(/\bclass=(["'])NULL\1/g, 'class=$1{{BODY_CLASS}}$1');
  next = next.replace(
    /(<img\b[^>]*\bclass=["'][^"']*\bworksheet-bg\b[^"']*["'][^>]*\bsrc=["'])NULL(["'])/gi,
    '$1{{BACKGROUND_IMAGE}}$2',
  );
  next = next.replace(
    /(<img\b[^>]*\bsrc=["'])NULL(["'][^>]*\bclass=["'][^"']*\bworksheet-bg\b)/gi,
    '$1{{BACKGROUND_IMAGE}}$2',
  );
  next = next.replace(
    /(data-editable=["']([A-Za-z0-9_]+)["'][^>]*>)\s*NULL\s*</g,
    '$1{{$2}}<',
  );
  next = next.replace(
    /(class=["'][^"']*\bword-bank\b[^"']*["'][^>]*>)\s*NULL\s*</gi,
    '$1{{WORD_BANK_ITEMS}}<',
  );
  next = next.replace(/>\s*NULL\s*(?={{ROWS}}|<div class="worksheet-row)/g, '>{{ROWS}}');
  next = next.replace(/>\s*NULL\s*</g, '>{{GOAT_IMAGE}}<');
  next = next.replace(
    /(<\/div>)\s*NULL\s*(?=<!--|<div|<button|<img)/g,
    '$1{{GOAT_IMAGE}}',
  );

  return next.replace(/<!--__WS_SCRIPT_(\d+)__-->/g, (_match, index: string) => {
    return scripts[Number(index)] ?? '';
  });
}

/**
 * Prototype templates use {{FONT_PATH}} and src="null" placeholders.
 * Empty url()/src values become GET /null once a &lt;base href&gt; is present.
 */
export function sanitizeComposedHtml(
  html: string,
  pencilIconUrl = '',
): string {
  let next = html;
  if (pencilIconUrl.trim()) {
    next = next.replace(/(?:\.\.\/)+pencil\.png/gi, pencilIconUrl.trim());
  }
  next = next.replace(
    /@font-face\s*\{[^{}]*url\(\s*(['"]?)(?:null|undefined)?\1\s*\)[^{}]*\}/gi,
    '',
  );
  next = next.replace(
    /url\(\s*(['"]?)(?:null|undefined)?\1\s*\)/gi,
    'none',
  );
  next = next.replace(
    /(\s(?:src|href))\s*=\s*(['"])(?:null|undefined)?\2/gi,
    '',
  );
  next = next.replace(/<\/body>\s*<\/html>\s*<\/body>\s*<\/html>/gi, '</body></html>');
  return next;
}

function injectChrome(html: string, mode: WorksheetRenderMode, fontPath: string): string {
  const fontStyle = `<style data-toondemy-font="true">${toondemyTextCss(fontPath)}</style>`;
  const extras =
    mode === 'editor'
      ? `${fontStyle}${EDITOR_CHROME}${EDITOR_BRIDGE}`
      : `${fontStyle}${EDITOR_CHROME}`;
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
    const fontPath = input.fontPath?.trim() || toondemyFontUrl();
    const extras: Record<string, unknown> = {
      backgroundAssetUrl: input.backgroundAssetUrl ?? '',
      BACKGROUND_IMAGE: input.backgroundAssetUrl ?? '',
      bodyClass: mode === 'editor' ? 'editor-mode' : 'export-mode',
      BODY_CLASS: mode === 'editor' ? 'editor-mode' : 'export-mode',
      fontPath,
      FONT_PATH: fontPath,
    };
    const context = flattenTemplateTokens(input.structure, extras);
    let html = restoreNullPlaceholders(input.templateHtml);
    html = injectMatchingPairMarkup(html, input.structure, input.pencilIconUrl);
    html = injectPairImagesMarkup(html, input.structure);
    html = injectSentenceRowMarkup(html, input.structure, input.pencilIconUrl);
    html = injectWorksheetItemsMarkup(html, input.structure, input.pencilIconUrl);
    html = this.renderTemplate(html, context);
    html = positionMatchingPairItems(html, input.structure);
    html = applyImageSlots(html, {
      ...input.structure,
      ...context,
    });
    html = applyBodyClass(html, mode);
    if (input.canvas) {
      html = applyCanvasSize(html, input.canvas);
    }
    html = injectChrome(html, mode, fontPath);
    html = sanitizeComposedHtml(html, input.pencilIconUrl);
    if (input.baseHref) {
      html = injectBaseHref(html, input.baseHref);
    }
    return html;
  }

  private renderLoop(inner: string, items: unknown[]): string {
    return items
      .map((item, index) => {
        const childContext = isRecord(item)
          ? { ...item, '@index': index + 1, '@index0': index }
          : { this: item, '@index': index + 1, '@index0': index };
        return this.renderTemplate(inner, childContext);
      })
      .join('');
  }

  private renderTemplate(template: string, context: unknown): string {
    const withEach = template.replace(
      /\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g,
      (_match, key: string, inner: string) => {
        const value = lookup(context, key);
        return Array.isArray(value) ? this.renderLoop(inner, value) : '';
      },
    );
    const withSections = withEach.replace(
      /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
      (_match, key: string, inner: string) => {
        const value = lookup(context, key);
        if (!Array.isArray(value)) {
          return '';
        }
        return this.renderLoop(inner, value);
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
