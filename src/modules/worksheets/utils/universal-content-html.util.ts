import { resolveUniversalActivityPolicy } from './universal-activity-policy.util';
import {
  allocateUniversalPageSpace,
  estimateActivityLayoutRequirement,
  resolveActivityImageBoxBudget,
  UNIVERSAL_VIEWPORT_CONTENT_H,
  type UniversalActivityLayoutAllocation,
  type UniversalImageRole,
} from './universal-dynamic-layout.util';
import { composeUniversalWorksheet } from './universal-worksheet-compose.util';

/**
 * Universal template: fixed chrome (title / subtopic) +
 * LLM semantic design for the content viewport.
 *
 * Composition path: activities[] or content_html → UniversalWorksheetModel
 * → dynamic layout allocation → deterministic HTML emit.
 */

export type UniversalNormalizeOptions = {
  age?: number | null;
  ageGroup?: string | null;
  grade?: string | null;
  viewportContentH?: number;
};

function policyFromNormalizeOptions(options?: UniversalNormalizeOptions) {
  return resolveUniversalActivityPolicy({
    age: options?.age ?? undefined,
    ageGroup: options?.ageGroup ?? undefined,
    grade: options?.grade ?? undefined,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown, max = 220): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&amp;/gi, '&');
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const ALLOWED_TAGS = new Set([
  'div',
  'span',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
  'br',
  'hr',
  'strong',
  'em',
  'u',
  'b',
  'i',
  'label',
  'section',
  'article',
  'header',
  'footer',
]);

const VOID_TAGS = new Set(['br', 'hr']);

const FORBIDDEN_TAGS = new Set([
  'script',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'link',
  'base',
  'meta',
  'style',
  'svg',
  'math',
  'textarea',
  'select',
  'option',
  'html',
  'head',
  'body',
  'noscript',
  'img', // converted to {{IMAGE_N}} first
]);

const SAFE_STYLE_PROPS = new Set([
  'display',
  'flex',
  'flex-direction',
  'flex-wrap',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'justify-content',
  'align-items',
  'align-content',
  'align-self',
  'gap',
  'row-gap',
  'column-gap',
  'grid',
  'grid-template-columns',
  'grid-template-rows',
  'grid-column',
  'grid-row',
  'grid-auto-flow',
  'place-items',
  'place-content',
  'justify-items',
  'order',
  'width',
  'height',
  'max-width',
  'max-height',
  'min-width',
  'min-height',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-decoration',
  'text-transform',
  'color',
  'background',
  'background-color',
  'border',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-width',
  'border-style',
  'border-color',
  'border-radius',
  'border-collapse',
  'border-spacing',
  'box-shadow',
  'vertical-align',
  'object-fit',
  'overflow',
  'overflow-x',
  'overflow-y',
  'box-sizing',
  'position',
  'left',
  'top',
  'right',
  'bottom',
  'z-index',
  'white-space',
  'opacity',
  'aspect-ratio',
  // Layout engine CSS variables (compositor-owned)
  '--activity-height',
  '--image-size',
  '--image-gap',
  '--activity-gap',
  '--grid-columns',
]);

function parseStyleMap(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const chunk of raw.split(';')) {
    const idx = chunk.indexOf(':');
    if (idx <= 0) continue;
    const prop = chunk.slice(0, idx).trim().toLowerCase();
    const val = chunk.slice(idx + 1).trim();
    if (prop && val) map.set(prop, val);
  }
  return map;
}

function styleMapToString(map: Map<string, string>): string {
  return [...map.entries()].map(([prop, val]) => `${prop}:${val}`).join(';');
}

/**
 * Drop height:100% / max-height:100% — those fight the host flex budget when an
 * instruction sibling is injected and clip the last section's bottom border.
 */
function scrubViewportFightingStyles(map: Map<string, string>): void {
  for (const prop of ['height', 'max-height', 'min-height'] as const) {
    const val = map.get(prop);
    if (!val) continue;
    if (/^100%$|^100vh$|^100dvh$/i.test(val.trim())) {
      map.delete(prop);
    }
  }
  map.set('box-sizing', 'border-box');
}

function ensureCompleteBorder(map: Map<string, string>): void {
  if (map.has('border') || map.has('border-bottom')) return;
  const edge =
    map.get('border-top') || map.get('border-left') || map.get('border-right');
  if (edge) map.set('border-bottom', edge);
}

function sanitizeStyleValue(raw: string): string {
  const decoded = decodeBasicEntities(raw).trim();
  const map = parseStyleMap(decoded);
  const parts: string[] = [];
  for (const [prop, val] of map) {
    if (!SAFE_STYLE_PROPS.has(prop) || !val) continue;
    if (/expression\s*\(|javascript:|url\s*\(/i.test(val)) continue;
    // Absolute / fixed / sticky causes overlap + crop across sections
    if (prop === 'position' && !/^(static|relative)$/i.test(val)) continue;
    // Negative margins pull sections on top of each other
    if (/^margin/.test(prop) && /-\d/.test(val)) continue;
    if (prop === 'z-index' && /^-?\d+$/.test(val.trim()) && Number(val) > 2) {
      continue;
    }
    parts.push(`${prop}:${val}`);
  }
  return parts.join(';');
}

function hasBorderStyle(style: string): boolean {
  return /(?:^|;|\s|=|"|')\s*border(?:-top|-right|-left|-bottom)?\s*:/i.test(
    style,
  );
}

function mergeClassAttr(existing: string | null, extra: string): string {
  const tokens = new Set(
    `${existing ?? ''} ${extra}`
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean),
  );
  return [...tokens].join(' ');
}

/**
 * Find the matching closing tag index for an open tag at `openEnd`
 * (index just after `>` of the opening tag). Returns index of `</tag>`.
 */
function findMatchingCloseTag(
  html: string,
  tag: string,
  openEnd: number,
): number {
  const openRe = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
  const closeRe = new RegExp(`</${tag}\\s*>`, 'gi');
  let depth = 1;
  let cursor = openEnd;
  while (cursor < html.length && depth > 0) {
    openRe.lastIndex = cursor;
    closeRe.lastIndex = cursor;
    const openM = openRe.exec(html);
    const closeM = closeRe.exec(html);
    const openAt = openM ? openM.index : Number.POSITIVE_INFINITY;
    const closeAt = closeM ? closeM.index : Number.POSITIVE_INFINITY;
    if (closeAt === Number.POSITIVE_INFINITY) return -1;
    if (openAt < closeAt) {
      depth += 1;
      cursor = openAt + (openM as RegExpExecArray)[0].length;
    } else {
      depth -= 1;
      if (depth === 0) return closeAt;
      cursor = closeAt + (closeM as RegExpExecArray)[0].length;
    }
  }
  return -1;
}

type TopBlock = {
  full: string;
  tag: string;
  openTag: string;
  inner: string;
  attrs: string;
};

function splitTopLevelElementBlocks(html: string): TopBlock[] {
  const blocks: TopBlock[] = [];
  const s = html.trim();
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i += 1;
    if (i >= s.length) break;
    if (s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i);
      i = end < 0 ? s.length : end + 3;
      continue;
    }
    if (s[i] !== '<') {
      while (i < s.length && s[i] !== '<') i += 1;
      continue;
    }
    const openMatch = s
      .slice(i)
      .match(/^<([a-zA-Z][\w-]*)\b([^>]*)>/);
    if (!openMatch) {
      i += 1;
      continue;
    }
    const tag = openMatch[1].toLowerCase();
    const attrs = openMatch[2] || '';
    const openTag = openMatch[0];
    const openEnd = i + openTag.length;
    if (VOID_TAGS.has(tag) || /\/\s*>$/.test(openTag)) {
      blocks.push({ full: openTag, tag, openTag, inner: '', attrs });
      i = openEnd;
      continue;
    }
    const closeAt = findMatchingCloseTag(s, tag, openEnd);
    if (closeAt < 0) {
      blocks.push({ full: openTag, tag, openTag, inner: '', attrs });
      i = openEnd;
      continue;
    }
    const closeMatch = s.slice(closeAt).match(new RegExp(`^</${tag}\\s*>`, 'i'));
    const closeLen = closeMatch ? closeMatch[0].length : tag.length + 3;
    const full = s.slice(i, closeAt + closeLen);
    const inner = s.slice(openEnd, closeAt);
    blocks.push({ full, tag, openTag, inner, attrs });
    i = closeAt + closeLen;
  }
  return blocks;
}

function rewriteOpenTag(
  tag: string,
  attrs: string,
  stylePatch: (style: string) => string,
  classExtra?: string,
): string {
  let nextAttrs = attrs;
  let style = '';
  const styleMatch = attrs.match(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i);
  if (styleMatch) {
    style = styleMatch[2] ?? styleMatch[3] ?? '';
    nextAttrs = nextAttrs.replace(styleMatch[0], '');
  }
  const patched = stylePatch(style);
  if (patched) nextAttrs += ` style="${escapeAttr(patched)}"`;

  if (classExtra) {
    const classMatch = nextAttrs.match(/\sclass\s*=\s*("([^"]*)"|'([^']*)')/i);
    if (classMatch) {
      const merged = mergeClassAttr(classMatch[2] ?? classMatch[3], classExtra);
      nextAttrs = nextAttrs.replace(
        classMatch[0],
        ` class="${escapeAttr(merged)}"`,
      );
    } else {
      nextAttrs += ` class="${escapeAttr(classExtra)}"`;
    }
  }
  return `<${tag}${nextAttrs}>`;
}

function isInstructionBlock(block: TopBlock): boolean {
  return /\bws-instruction\b/i.test(block.attrs) || /\bws-instruction\b/i.test(block.openTag);
}

function isActivitySectionBlock(block: TopBlock): boolean {
  if (isInstructionBlock(block)) return false;
  if (/\bws-activity\b/i.test(block.attrs) || /\bws-activity\b/i.test(block.openTag)) {
    return true;
  }
  if (block.tag === 'section' || block.tag === 'article') return true;
  if (/\bws-section\b/i.test(block.attrs)) return true;
  if (hasBorderStyle(block.attrs) || hasBorderStyle(block.openTag)) return true;
  const styleMatch = block.attrs.match(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i);
  const style = styleMatch?.[2] ?? styleMatch?.[3] ?? '';
  return hasBorderStyle(`style="${style}"`) || hasBorderStyle(style);
}

function readDataAttr(attrs: string, name: string): string {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
  const m = attrs.match(re);
  return (m?.[1] ?? m?.[2] ?? '').trim();
}

function setOrReplaceDataAttr(attrs: string, name: string, value: string): string {
  const re = new RegExp(`\\s${name}\\s*=\\s*("[^"]*"|'[^']*')`, 'i');
  if (re.test(attrs)) {
    return attrs.replace(re, ` ${name}="${escapeAttr(value)}"`);
  }
  return `${attrs} ${name}="${escapeAttr(value)}"`;
}

/** Infer learning interaction type from markup (not visual appearance). */
export function inferUniversalActivityType(innerHtml: string, attrs = ''): string {
  const fromAttr = readDataAttr(attrs, 'data-activity-type').toLowerCase();
  if (fromAttr) return fromAttr.replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'identify';
  const text = `${innerHtml}`.toLowerCase();
  if (/\bws-trace-word\b|trace|dotted|letter-spacing/i.test(text)) return 'trace';
  if (/\bws-match-area\b|match|pair|connect|draw a line/i.test(text)) return 'match';
  if (/\bws-choice-group\b|circle|tick|odd.?one/i.test(text)) return 'circle';
  if (/count|how many/i.test(text)) return 'count';
  if (/sort|classify|group/i.test(text)) return 'classify';
  if (/sequence|order|first.*next/i.test(text)) return 'sequence';
  if (/compare|bigger|smaller/i.test(text)) return 'compare';
  if (/colour|color.?in|color the/i.test(text)) return 'color';
  if (/label|name the/i.test(text)) return 'label';
  if (/complete|fill.?in|missing/i.test(text)) return 'complete';
  const imgs = countImageSlots(innerHtml);
  if (imgs === 1) return 'recognize';
  if (imgs >= 4) return 'identify';
  return 'identify';
}

export function buildUniversalActivitySignature(
  activityType: string,
  innerHtml: string,
): string {
  const type = (activityType || 'identify').toLowerCase();
  const imgs = countImageSlots(innerHtml);
  const flags = [
    /\bws-match-area\b|match|pair/i.test(innerHtml) ? 'm' : '',
    /\bws-trace-word\b|trace|dotted/i.test(innerHtml) ? 't' : '',
    /\bws-choice-group\b|\bws-answer-option\b|circle|tick/i.test(innerHtml)
      ? 'c'
      : '',
    // Bucket image counts so "circle fox" with 1 vs 1 image still collide;
    // exact count alone should not make near-duplicates look different.
    imgs === 0 ? '0i' : imgs <= 2 ? 'few-i' : imgs <= 4 ? 'mid-i' : 'many-i',
  ]
    .filter(Boolean)
    .join('-');
  const instruction = innerHtml
    .replace(/\{\{\s*IMAGE[_:]?\d+\s*\}\}/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .slice(0, 64);
  return `${type}|${flags}|${instruction}`;
}

function signaturesNearDuplicate(a: string, b: string): boolean {
  if (a === b) return true;
  const [typeA, flagsA, textA = ''] = a.split('|');
  const [typeB, flagsB, textB = ''] = b.split('|');
  if (typeA !== typeB) return false;
  // Same interaction + identical / nested instruction → duplicate
  if (textA && textB) {
    if (textA === textB) return true;
    const shorter = textA.length <= textB.length ? textA : textB;
    const longer = textA.length <= textB.length ? textB : textA;
    if (longer.includes(shorter) && shorter.length >= 10) return true;
    // Same type + same structural flags + high token overlap
    if (flagsA === flagsB) {
      const wa = new Set(textA.split(/\s+/).filter((w) => w.length > 2));
      const wb = new Set(textB.split(/\s+/).filter((w) => w.length > 2));
      if (wa.size && wb.size) {
        let overlap = 0;
        for (const w of wa) if (wb.has(w)) overlap += 1;
        const ratio = overlap / Math.min(wa.size, wb.size);
        if (ratio >= 0.8) return true;
      }
    }
  }
  // No usable instruction text: fall back to identical structural flags only
  if (!textA && !textB && flagsA === flagsB) return true;
  return false;
}

function fitSectionOrStackStyle(rawStyle: string, kind: 'section' | 'stack'): string {
  const map = parseStyleMap(rawStyle);
  scrubViewportFightingStyles(map);
  // Dynamic layout engine owns height — never equal-flex all activities.
  map.set('flex', '0 0 auto');
  map.set('min-height', '0');
  map.set('overflow', 'visible');
  map.set('margin', '0');
  map.delete('margin-top');
  map.delete('margin-bottom');
  map.delete('margin-left');
  map.delete('margin-right');
  map.delete('height');
  map.delete('max-height');
  if (kind === 'stack') {
    if (!map.has('display')) map.set('display', 'flex');
    if (!map.has('flex-direction')) map.set('flex-direction', 'column');
    if (!map.has('gap')) map.set('gap', '10px');
    if (!map.has('width')) map.set('width', '100%');
  } else {
    ensureCompleteBorder(map);
    if (!map.has('display')) map.set('display', 'flex');
    if (!map.has('flex-direction')) map.set('flex-direction', 'column');
    if (!map.has('gap')) map.set('gap', '8px');
    if (!map.has('width')) map.set('width', '100%');
    if (!map.has('padding')) map.set('padding', '8px 10px');
    if (!map.has('border-radius')) map.set('border-radius', '14px');
    if (!map.has('background') && !map.has('background-color')) {
      map.set('background', '#ffffff');
    }
  }
  return styleMapToString(map);
}

/**
 * LLM often wraps pictures in tall flex:1 / height:100% cards — the card grows
 * empty while the .ws-img-box (and image) stay tiny. Force those wrappers to
 * hug content so the picture is the visual focus.
 */
export function scrubNestedCardGrowth(html: string): string {
  if (!html) return html;
  return html.replace(
    /<(div|section|article)\b([^>]*)>/gi,
    (full, tag: string, attrs: string) => {
      if (
        /\bws-section\b|\bws-activity\b|\bws-instruction\b|\bws-dynamic\b|\bws-stack\b|\bws-img-box\b|\bws-picture-card\b|\bws-item\b/i.test(
          attrs,
        )
      ) {
        return full;
      }
      const styleMatch = attrs.match(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i);
      if (!styleMatch) return full;
      const style = styleMatch[2] ?? styleMatch[3] ?? '';
      const map = parseStyleMap(style);
      let changed = false;
      const flex = map.get('flex');
      if (flex && /^1(\s|$)/i.test(flex.trim())) {
        map.set('flex', '0 0 auto');
        changed = true;
      }
      if (map.get('flex-grow') === '1') {
        map.set('flex-grow', '0');
        changed = true;
      }
      if (/stretch/i.test(map.get('align-self') ?? '')) {
        map.set('align-self', 'flex-start');
        changed = true;
      }
      for (const prop of ['height', 'min-height', 'max-height'] as const) {
        const val = map.get(prop);
        if (!val) continue;
        const t = val.trim();
        if (/^100%$|^100vh$|^100dvh$|flex/i.test(t)) {
          map.delete(prop);
          changed = true;
          continue;
        }
        // Tall fixed shells around tiny art (e.g. height:320px with an 80px icon)
        const px = t.match(/^(\d+)px$/i);
        if (px && Number(px[1]) >= 220) {
          map.delete(prop);
          changed = true;
        }
      }
      if (!changed) return full;
      map.set('height', 'auto');
      map.set('align-self', map.get('align-self') || 'flex-start');
      let nextAttrs = attrs.replace(styleMatch[0], '');
      const nextStyle = styleMapToString(map);
      if (nextStyle) nextAttrs += ` style="${escapeAttr(nextStyle)}"`;
      return `<${tag}${nextAttrs}>`;
    },
  );
}

/** Injected so stale DB template CSS cannot force equal-height flex or clip text. */
export const UNIVERSAL_IMAGE_LAYOUT_CSS = `
#content-region .ws-dynamic{gap:var(--activity-gap,14px)!important;justify-content:flex-start!important;align-content:flex-start!important}
#content-region .ws-dynamic>.ws-instruction{flex:0 0 auto!important;height:auto!important;max-height:none!important;overflow:visible!important}
#content-region .ws-dynamic>.ws-activity,#content-region .ws-dynamic>.ws-section{flex:0 0 auto!important;flex-grow:0!important;height:auto!important;min-height:var(--activity-height,auto)!important;max-height:none!important;overflow:visible!important;position:relative;z-index:0;box-sizing:border-box!important;margin:0!important;width:100%;padding:12px 14px 16px!important}
#content-region .ws-activity-title{display:none!important}
#content-region .ws-activity-instruction{flex:0 0 auto;margin:0 0 4px 0;line-height:1.3;font-size:18px;font-weight:700;color:#2a1b4a;overflow:visible}
#content-region .ws-row,#content-region .ws-grid{display:flex;flex-wrap:wrap;gap:var(--image-gap,10px);align-items:flex-start;justify-content:flex-start;width:100%}
#content-region .ws-match-area{display:flex;flex-direction:column;gap:var(--image-gap,12px);width:100%;flex:0 0 auto;overflow:visible}
#content-region .ws-match-row{display:grid;grid-template-columns:1fr 48px 1fr;gap:var(--image-gap,10px);align-items:center;width:100%;flex:0 0 auto;overflow:visible}
#content-region .ws-match-connector{flex:0 0 auto;height:2px;background:#85cbf4;opacity:0.55}
#content-region .ws-image-grid,#content-region .ws-choice-group{display:grid;gap:var(--image-gap,10px);width:100%;align-items:start;justify-items:center;overflow:visible}
#content-region .ws-trace-row{display:flex;flex-wrap:wrap;gap:14px;align-items:center}
#content-region .ws-column{display:flex;flex-direction:column;gap:8px;flex:0 0 auto;height:auto}
#content-region .ws-item,#content-region .ws-picture-card,#content-region .ws-answer-option{flex:0 0 auto!important;flex-grow:0!important;height:auto!important;max-height:none;align-self:flex-start;box-sizing:border-box;padding:6px 8px;overflow:visible}
#content-region .ws-card-label{flex:0 0 auto;width:100%;text-align:center;margin-top:4px;min-height:26px;line-height:1.25;overflow:visible}
#content-region .ws-section>div,#content-region .ws-activity>div,#content-region .ws-section>section,#content-region .ws-activity>section,#content-region .ws-section>article,#content-region .ws-activity>article,#content-region .ws-activity div[style*="flex:1"],#content-region .ws-section div[style*="flex:1"],#content-region .ws-activity div[style*="flex: 1"],#content-region .ws-section div[style*="flex: 1"]{flex:0 0 auto!important;flex-grow:0!important;flex-basis:auto!important;height:auto!important;max-height:none;align-self:flex-start;box-sizing:border-box;overflow:visible}
#content-region .ws-img-box{display:flex!important;align-items:center;justify-content:center;overflow:hidden;flex:0 0 auto!important;flex-shrink:0!important;width:var(--image-size,160px)!important;height:var(--image-size,160px)!important;min-width:0;min-height:0;max-width:min(300px,100%)!important;max-height:min(300px,100%)!important;aspect-ratio:1/1;box-sizing:border-box}
#content-region .ws-img-box img.worksheet-image,#content-region .ws-img-box>img,#content-region img.worksheet-image{width:100%!important;height:100%!important;max-width:100%!important;max-height:100%!important;object-fit:contain!important;display:block!important;aspect-ratio:1/1}
#content-region .ws-label,#content-region .ws-word,#content-region .ws-trace-word{flex:0 0 auto;text-align:center;overflow:visible;line-height:1.25}
`.replace(/\s+/g, ' ').trim();


function retagBlock(block: TopBlock, kind: 'section' | 'stack'): string {
  const open = rewriteOpenTag(
    block.tag,
    block.attrs,
    (style) => fitSectionOrStackStyle(style, kind),
    kind === 'section' ? 'ws-activity ws-section' : 'ws-stack',
  );
  return `${open}${block.inner}</${block.tag}>`;
}

/**
 * Tag activity sections and scrub viewport-fighting styles.
 * Does NOT equal-height flex activities — dynamic layout owns sizing.
 */
export function fitUniversalContentLayout(html: string): string {
  if (!html || !html.trim()) return html;
  let blocks = splitTopLevelElementBlocks(html);
  if (!blocks.length) return html;

  // Unwrap a single non-instruction column root so sections become host flex children.
  if (blocks.length === 1 && !isInstructionBlock(blocks[0])) {
    const root = blocks[0];
    const innerBlocks = splitTopLevelElementBlocks(root.inner);
    const sectionKids = innerBlocks.filter((b) => isActivitySectionBlock(b));
    if (sectionKids.length >= 2) {
      blocks = innerBlocks;
    } else if (sectionKids.length === 0 && isActivitySectionBlock(root)) {
      return retagBlock(root, 'section');
    } else {
      const fittedInner = (innerBlocks.length ? innerBlocks : [])
        .map((child) => {
          if (isInstructionBlock(child)) return child.full;
          if (isActivitySectionBlock(child)) return retagBlock(child, 'section');
          return child.full;
        })
        .join('');
      const open = rewriteOpenTag(
        root.tag,
        root.attrs,
        (style) => fitSectionOrStackStyle(style, 'stack'),
        'ws-stack',
      );
      return `${open}${fittedInner || root.inner}</${root.tag}>`;
    }
  }

  const fitted = blocks
    .map((block) => {
      if (isInstructionBlock(block)) {
        const open = rewriteOpenTag(block.tag, block.attrs, (style) => {
          const map = parseStyleMap(style);
          scrubViewportFightingStyles(map);
          map.set('flex', '0 0 auto');
          map.delete('overflow');
          return styleMapToString(map);
        }, 'ws-instruction');
        return `${open}${scrubShortPhrasePunctuation(block.inner)}</${block.tag}>`;
      }
      if (isActivitySectionBlock(block)) {
        return retagBlock(
          { ...block, inner: scrubShortPhrasePunctuation(block.inner) },
          'section',
        );
      }
      // Nested stack (model root kept) — still scrub height:100%.
      if (block.tag === 'div' || block.tag === 'section') {
        const innerBlocks = splitTopLevelElementBlocks(block.inner);
        if (innerBlocks.some((b) => isActivitySectionBlock(b))) {
          const fittedInner = innerBlocks
            .map((child) =>
              isActivitySectionBlock(child)
                ? retagBlock(
                    {
                      ...child,
                      inner: scrubShortPhrasePunctuation(child.inner),
                    },
                    'section',
                  )
                : child.full,
            )
            .join('');
          const open = rewriteOpenTag(
            block.tag,
            block.attrs,
            (style) => fitSectionOrStackStyle(style, 'stack'),
            'ws-stack',
          );
          return `${open}${fittedInner}</${block.tag}>`;
        }
      }
      const open = rewriteOpenTag(block.tag, block.attrs, (style) => {
        const map = parseStyleMap(style);
        scrubViewportFightingStyles(map);
        return styleMapToString(map);
      });
      return `${open}${scrubShortPhrasePunctuation(block.inner)}</${block.tag}>`;
    })
    .join('');

  return fitted;
}

/**
 * Exclamation / question marks only belong on real sentences — strip them from
 * short titles, single words, and numbered section headings that are ≤3 words.
 */
export function scrubShortPhrasePunctuation(text: string): string {
  if (!text) return text;
  return text.replace(/>([^<>]+)</g, (full, raw: string) => {
    const original = String(raw);
    const trimmed = original.trim();
    if (!trimmed || !/[!?]/.test(trimmed)) return full;

    const withoutNumbering = trimmed.replace(
      /^(?:\(?\d+\)?[.)]|[①②③④⑤⑥⑦⑧⑨⑩])\s*/u,
      '',
    );
    const words = withoutNumbering.split(/\s+/).filter(Boolean);
    // Keep sentence punctuation when there are enough words to read as a sentence
    if (words.length >= 5) return full;
    const cleaned = original.replace(/[!?]+/g, '');
    return `>${cleaned}<`;
  });
}

/** Title / skill labels: never keep ? or ! */
export function scrubTitlePunctuation(text: string): string {
  return readString(text, 80).replace(/[!?]+/g, '').trim();
}

function clampPxInStyle(
  style: string,
  maxPx: number,
  minPx?: number,
  targetPx?: number,
  options?: { uniform?: boolean },
): string {
  const map = parseStyleMap(style);
  const floor = minPx ?? 0;
  const target = targetPx ?? maxPx;
  // Same section → identical frames (avoids dog/rabbit/bone looking uneven).
  if (options?.uniform) {
    map.set('width', `${target}px`);
    map.set('height', `${target}px`);
    map.delete('min-width');
    map.delete('min-height');
    map.delete('max-width');
    map.delete('max-height');
    map.set('box-sizing', 'border-box');
    return styleMapToString(map);
  }
  for (const prop of [
    'width',
    'height',
    'min-width',
    'min-height',
    'max-width',
    'max-height',
  ]) {
    const val = map.get(prop);
    if (!val) continue;
    const m = val.trim().match(/^(\d+(?:\.\d+)?)px$/i);
    if (!m) continue;
    const n = Number(m[1]);
    if (n > maxPx) map.set(prop, `${maxPx}px`);
    else if (floor > 0 && n < floor) map.set(prop, `${target}px`);
  }
  if (!map.has('width')) map.set('width', `${target}px`);
  if (!map.has('height')) map.set('height', `${target}px`);
  map.set('box-sizing', 'border-box');
  return styleMapToString(map);
}

/**
 * Activity-aware image box budget.
 * Uses this section's height + image count (not a global equal share).
 */
export function resolveSectionImageBoxBudget(
  sectionHeightPx: number,
  imagesInSection: number,
  options?: {
    activityType?: string;
    hasMatch?: boolean;
    pairCount?: number;
  },
): { minPx: number; maxPx: number; targetPx: number } {
  return resolveActivityImageBoxBudget({
    activityHeightPx: Math.max(120, sectionHeightPx),
    imagesInActivity: Math.max(1, imagesInSection),
    activityType: options?.activityType,
    hasMatch: options?.hasMatch,
    pairCount: options?.pairCount,
  });
}

/**
 * Fallback when HTML has no section structure — still content-aware defaults.
 */
export function resolveUniversalImageBoxBudget(
  imageCount: number,
  sectionCount: number,
): { minPx: number; maxPx: number; targetPx: number } {
  const sections = Math.max(1, sectionCount);
  const approxSectionH = Math.floor(960 / sections);
  return resolveSectionImageBoxBudget(approxSectionH, Math.max(1, imageCount));
}

function readSectionHeightHint(attrs: string, fallbackPx: number): number {
  const styleMatch = attrs.match(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i);
  const style = styleMatch?.[2] ?? styleMatch?.[3] ?? '';
  const map = parseStyleMap(style);
  const cssVar = map.get('--activity-height');
  if (cssVar) {
    const n = Number(String(cssVar).replace(/px/i, ''));
    if (Number.isFinite(n) && n > 40) return Math.round(n);
  }
  for (const key of ['height', 'max-height', 'min-height'] as const) {
    const val = map.get(key);
    if (!val) continue;
    const m = val.trim().match(/^(\d+(?:\.\d+)?)px$/i);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > 40) return Math.round(n);
    }
  }
  return fallbackPx;
}

function countMatchPairsInFragment(fragment: string): number {
  const rows = (fragment.match(/\bws-match-row\b/gi) || []).length;
  if (rows > 0) return rows;
  const imgs = countImageSlots(fragment);
  return Math.max(1, Math.ceil(imgs / 2));
}

function readImgBoxWidths(fragment: string): number[] {
  const widths: number[] = [];
  const re = /<div\b([^>]*\bws-img-box\b[^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fragment)) != null) {
    const attrs = m[1] || '';
    const styleMatch = attrs.match(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i);
    const style = styleMatch?.[2] ?? styleMatch?.[3] ?? '';
    const w = style.match(/(?:^|;)\s*width\s*:\s*(\d+)px/i);
    if (w) {
      const n = Number(w[1]);
      if (Number.isFinite(n) && n > 0) widths.push(n);
    }
  }
  return widths;
}

function medianPx(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Prefer large visible art: keep LLM size only when it is already near the
 * space-filling target; otherwise boost toward the section max.
 */
export function resolveRespectedBoxTarget(
  llmWidths: number[],
  budget: { minPx: number; maxPx: number; targetPx: number },
): number {
  const preferred = Math.max(
    budget.minPx,
    Math.round(budget.targetPx * 0.92),
  );
  const llm = medianPx(llmWidths);
  if (llm == null) return preferred;
  return Math.min(budget.maxPx, Math.max(llm, preferred));
}

function countImageSlots(html: string): number {
  const tokens = (html.match(/\{\{\s*IMAGE[_:]?\d+\s*\}\}/gi) || []).length;
  if (tokens > 0) return tokens;
  return (html.match(/data-image-slot=/gi) || []).length;
}

function countActivitySectionsDeep(html: string): number {
  const blocks = splitTopLevelElementBlocks(html);
  let n = 0;
  for (const block of blocks) {
    if (isInstructionBlock(block)) continue;
    if (isActivitySectionBlock(block)) {
      n += 1;
      continue;
    }
    if (block.inner) n += countActivitySectionsDeep(block.inner);
  }
  return n;
}

function rewriteBlockInner(block: TopBlock, nextInner: string): string {
  return `${block.openTag}${nextInner}</${block.tag}>`;
}

function applyBoxBudgetToFragment(
  fragment: string,
  budget: { minPx: number; maxPx: number; targetPx: number },
): string {
  // Respect LLM-chosen size when it fits; only boost tiny / cap overflow.
  const targetPx = resolveRespectedBoxTarget(readImgBoxWidths(fragment), budget);
  const { maxPx, minPx } = budget;
  let out = fragment.replace(
    /<div\b([^>]*\bws-img-box\b[^>]*)>/gi,
    (_full, rawAttrs: string) => {
      const styleMatch = rawAttrs.match(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i);
      const style =
        styleMatch?.[2] ??
        styleMatch?.[3] ??
        `width:${targetPx}px;height:${targetPx}px`;
      const nextStyle = clampPxInStyle(style, maxPx, minPx, targetPx, {
        uniform: true,
      });
      let attrs = rawAttrs;
      if (styleMatch) attrs = attrs.replace(styleMatch[0], '');
      attrs += ` style="${escapeAttr(nextStyle)}"`;
      return `<div${attrs}>`;
    },
  );

  out = out.replace(
    /<(div|span)\b([^>]*)>(\s*(?:\{\{\s*IMAGE[_:]?\d+\s*\}\}|<img\b[^>]*>)[\s\S]*?)<\/\1>/gi,
    (full, tag: string, rawAttrs: string, inner: string) => {
      if (/\bws-img-box\b/i.test(rawAttrs)) return full;
      const styleMatch = rawAttrs.match(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i);
      if (!styleMatch) {
        if (!/\{\{\s*IMAGE|worksheet-image/i.test(inner)) return full;
        return `<${tag}${rawAttrs} style="${escapeAttr(
          `width:${targetPx}px;height:${targetPx}px;box-sizing:border-box`,
        )}">${inner}</${tag}>`;
      }
      const style = styleMatch[2] ?? styleMatch[3] ?? '';
      if (!/(?:^|;)\s*(?:width|height)\s*:/i.test(style)) return full;
      const nextStyle = clampPxInStyle(style, maxPx, minPx, targetPx, {
        uniform: true,
      });
      let attrs = rawAttrs.replace(styleMatch[0], '');
      attrs += ` style="${escapeAttr(nextStyle)}"`;
      return `<${tag}${attrs}>${inner}</${tag}>`;
    },
  );

  return out;
}

/**
 * Fit picture frames per activity using that activity's height + content.
 * Matching activities may use smaller images than recognition activities.
 * Never forces all worksheet images to one global size.
 */
export function clampUniversalImageBoxes(
  html: string,
  options?: { viewportContentH?: number },
): string {
  if (!html) return html;
  const viewportH = options?.viewportContentH ?? 1040;
  const sectionCount = Math.max(1, countActivitySectionsDeep(html));
  // Soft fallback only — real budgets are per activity
  const fallbackShare = Math.floor((viewportH - 80) / sectionCount);
  const pageBudget = resolveSectionImageBoxBudget(fallbackShare, 4);

  // First pass: gather content weights so unequal activities get unequal height hints
  const sectionMetas: Array<{
    imgs: number;
    hasMatch: boolean;
    pairCount: number;
    type: string;
    weight: number;
  }> = [];
  const collectMeta = (fragment: string): void => {
    for (const block of splitTopLevelElementBlocks(fragment)) {
      if (isInstructionBlock(block)) continue;
      const kids = splitTopLevelElementBlocks(block.inner);
      if (
        kids.some((k) => isActivitySectionBlock(k)) &&
        !isActivitySectionBlock(block)
      ) {
        collectMeta(block.inner);
        continue;
      }
      if (!isActivitySectionBlock(block)) continue;
      const imgs = countImageSlots(block.inner);
      const hasMatch =
        /\bws-match-area\b|\bws-match-row\b|match|pair|connect/i.test(
          `${block.attrs} ${block.inner}`,
        );
      const pairCount = hasMatch ? countMatchPairsInFragment(block.inner) : 0;
      const type = inferUniversalActivityType(block.inner, block.attrs);
      const weight = hasMatch
        ? Math.max(2, pairCount) * 1.4
        : Math.max(1, imgs) + (imgs <= 1 ? 0.5 : 0);
      sectionMetas.push({ imgs, hasMatch, pairCount, type, weight });
    }
  };
  collectMeta(html);
  const weightSum = sectionMetas.reduce((s, m) => s + m.weight, 0) || 1;
  const availableForSections = Math.max(200, viewportH - 80);
  let metaIndex = 0;

  const walk = (fragment: string): string => {
    const blocks = splitTopLevelElementBlocks(fragment);
    if (!blocks.length) {
      return countImageSlots(fragment) > 0
        ? applyBoxBudgetToFragment(fragment, pageBudget)
        : fragment;
    }

    return blocks
      .map((block) => {
        if (isInstructionBlock(block)) return block.full;

        const kids = splitTopLevelElementBlocks(block.inner);
        const hasNestedSections = kids.some((k) => isActivitySectionBlock(k));
        if (hasNestedSections && !isActivitySectionBlock(block)) {
          return rewriteBlockInner(block, walk(block.inner));
        }

        if (isActivitySectionBlock(block)) {
          const meta = sectionMetas[metaIndex] || {
            imgs: countImageSlots(block.inner),
            hasMatch: false,
            pairCount: 0,
            type: 'identify',
            weight: 1,
          };
          metaIndex += 1;
          const weightedShare = Math.floor(
            (availableForSections * meta.weight) / weightSum,
          );
          const sectionH = readSectionHeightHint(
            block.attrs,
            Math.max(160, weightedShare),
          );
          const sectionBudget = resolveSectionImageBoxBudget(
            sectionH,
            Math.max(1, meta.imgs),
            {
              activityType: meta.type,
              hasMatch: meta.hasMatch,
              pairCount: meta.pairCount || undefined,
            },
          );
          return rewriteBlockInner(
            block,
            applyBoxBudgetToFragment(block.inner, sectionBudget),
          );
        }

        if (countImageSlots(block.full) > 0) {
          return applyBoxBudgetToFragment(block.full, pageBudget);
        }
        return block.full;
      })
      .join('');
  };

  return walk(html);
}

/**
 * Score an activity section so empty title-only shells rank below picture cards.
 * Used when age-band limits force us to drop extras.
 */
export function scoreUniversalActivitySection(innerHtml: string): number {
  const imgs = countImageSlots(innerHtml);
  if (imgs > 0) return 100 + imgs;
  const hasImgBox = /\bws-img-box\b/i.test(innerHtml);
  if (hasImgBox) return 50;
  if (
    /\bws-answer-option\b|\bws-trace-word\b|\bws-match-area\b|\bws-choice-group\b|\bws-picture-card\b|\bws-item\b|\bws-word\b/i.test(
      innerHtml,
    )
  ) {
    return 40;
  }
  const text = innerHtml
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Short title + one-line instruction only → treat as empty shell
  if (text.length <= 60) return 0;
  if (text.length <= 120) return 5;
  return 15;
}

function isEmptyActivitySection(block: TopBlock): boolean {
  return (
    isActivitySectionBlock(block) &&
    scoreUniversalActivitySection(block.inner) === 0
  );
}

/**
 * Drop title-only / empty bordered activity shells so age-band limits keep
 * sections that actually have pictures (or substantial content).
 * Only prunes when at least one richer section exists (never wipe the page).
 */
export function pruneEmptyUniversalActivitySections(html: string): string {
  if (!html) return html;

  const sections: TopBlock[] = [];
  const collect = (fragment: string): void => {
    for (const block of splitTopLevelElementBlocks(fragment)) {
      if (isInstructionBlock(block)) continue;
      const kids = splitTopLevelElementBlocks(block.inner);
      if (
        kids.some((k) => isActivitySectionBlock(k)) &&
        !isActivitySectionBlock(block)
      ) {
        collect(block.inner);
        continue;
      }
      if (isActivitySectionBlock(block)) sections.push(block);
    }
  };
  collect(html);
  const hasRich = sections.some(
    (s) => scoreUniversalActivitySection(s.inner) > 0,
  );
  if (!hasRich) return html;

  const walk = (fragment: string): string => {
    const blocks = splitTopLevelElementBlocks(fragment);
    if (!blocks.length) return fragment;
    return blocks
      .map((block) => {
        if (isInstructionBlock(block)) return block.full;
        const kids = splitTopLevelElementBlocks(block.inner);
        if (
          kids.some((k) => isActivitySectionBlock(k)) &&
          !isActivitySectionBlock(block)
        ) {
          return rewriteBlockInner(block, walk(block.inner));
        }
        if (isEmptyActivitySection(block)) return '';
        return block.full;
      })
      .join('');
  };

  return walk(html);
}

/**
 * Keep at most `maxSections` activity blocks (age-band hard max).
 * Prefers content-rich sections (images first), preserves relative order.
 */
export function enforceUniversalActivitySectionLimit(
  html: string,
  maxSections: number,
): string {
  if (!html || maxSections < 1) return html;
  const pruned = pruneEmptyUniversalActivitySections(html);

  type Ranked = { index: number; score: number; block: TopBlock };
  const ranked: Ranked[] = [];

  const collect = (fragment: string, path: number[] = []): void => {
    const blocks = splitTopLevelElementBlocks(fragment);
    blocks.forEach((block, i) => {
      if (isInstructionBlock(block)) return;
      const kids = splitTopLevelElementBlocks(block.inner);
      if (
        kids.some((k) => isActivitySectionBlock(k)) &&
        !isActivitySectionBlock(block)
      ) {
        collect(block.inner, [...path, i]);
        return;
      }
      if (isActivitySectionBlock(block)) {
        ranked.push({
          index: ranked.length,
          score: scoreUniversalActivitySection(block.inner),
          block,
        });
      }
    });
  };
  collect(pruned);

  if (ranked.length <= maxSections) return pruned;

  const keepIndexes = new Set(
    [...ranked]
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, maxSections)
      .map((r) => r.index),
  );

  let seen = 0;
  const walk = (fragment: string): string => {
    const blocks = splitTopLevelElementBlocks(fragment);
    if (!blocks.length) return fragment;
    return blocks
      .map((block) => {
        if (isInstructionBlock(block)) return block.full;
        const kids = splitTopLevelElementBlocks(block.inner);
        if (
          kids.some((k) => isActivitySectionBlock(k)) &&
          !isActivitySectionBlock(block)
        ) {
          return rewriteBlockInner(block, walk(block.inner));
        }
        if (isActivitySectionBlock(block)) {
          const idx = seen;
          seen += 1;
          return keepIndexes.has(idx) ? block.full : '';
        }
        return block.full;
      })
      .join('');
  };

  return walk(pruned);
}

/**
 * Ensure every activity is a first-class .ws-activity with type + id metadata,
 * and promote common semantic class aliases. Does not invent educational content.
 */
export function normalizeSemanticActivities(html: string): string {
  if (!html) return html;
  let activityIndex = 0;

  const retagActivity = (block: TopBlock): string => {
    activityIndex += 1;
    const type = inferUniversalActivityType(block.inner, block.attrs);
    const existingId = readDataAttr(block.attrs, 'data-activity-id');
    const id = existingId || `activity-${activityIndex}`;
    let attrs = block.attrs;
    attrs = setOrReplaceDataAttr(attrs, 'data-activity-type', type);
    attrs = setOrReplaceDataAttr(attrs, 'data-activity-id', id);
    // Prefer <section> for activities when the model used a plain div
    const tag = block.tag === 'div' ? 'section' : block.tag;
    const open = rewriteOpenTag(
      tag,
      attrs,
      (style) => fitSectionOrStackStyle(style, 'section'),
      'ws-activity ws-section',
    );
    let inner = scrubShortPhrasePunctuation(block.inner);
    // Promote the first short heading/paragraph as the activity QUESTION (instruction),
    // never as a separate catalog-style title.
    let sawQuestion = /\bws-activity-instruction\b/i.test(inner);
    inner = inner.replace(
      /<(p|h[1-4])\b([^>]*)>([\s\S]*?)<\/\1>/gi,
      (full, t: string, a: string, body: string) => {
        if (/\bws-activity-instruction\b/i.test(a)) {
          sawQuestion = true;
          return full;
        }
        if (/\bws-activity-title\b/i.test(a)) {
          // Convert leftover titles into the question when none exists yet
          if (!sawQuestion) {
            sawQuestion = true;
            const open = rewriteOpenTag(
              'p',
              a.replace(/\bws-activity-title\b/gi, ''),
              (s) => s,
              'ws-activity-instruction',
            );
            return `${open}${body}</p>`;
          }
          return '';
        }
        const text = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (
          !sawQuestion &&
          text &&
          text.length <= 100 &&
          (/^h[1-4]$/i.test(t) ||
            /\b(title|heading|instruction)\b/i.test(a) ||
            /^(?:\d+[.)]\s*)?(point|match|circle|count|trace|find|draw|look)\b/i.test(
              text,
            ))
        ) {
          sawQuestion = true;
          const open = rewriteOpenTag(
            'p',
            a,
            (s) => s,
            'ws-activity-instruction',
          );
          return `${open}${body}</p>`;
        }
        return full;
      },
    );
    inner = collapseDuplicateActivityHeadings(inner);
    return `${open}${inner}</${tag}>`;
  };

  const walk = (fragment: string): string => {
    const blocks = splitTopLevelElementBlocks(fragment);
    if (!blocks.length) return fragment;
    return blocks
      .map((block) => {
        if (isInstructionBlock(block)) return block.full;
        const kids = splitTopLevelElementBlocks(block.inner);
        if (
          kids.some((k) => isActivitySectionBlock(k)) &&
          !isActivitySectionBlock(block)
        ) {
          const open = rewriteOpenTag(
            block.tag,
            block.attrs,
            (style) => fitSectionOrStackStyle(style, 'stack'),
            'ws-stack',
          );
          return `${open}${walk(block.inner)}</${block.tag}>`;
        }
        if (isActivitySectionBlock(block)) return retagActivity(block);
        return block.full;
      })
      .join('');
  };

  return walk(html);
}

/**
 * Remove near-duplicate activities (same interaction signature).
 * Keeps the richer / earlier activity; never wipes the page.
 */
export function dedupeUniversalActivities(html: string): string {
  if (!html) return html;
  type Ranked = { index: number; score: number; signature: string; block: TopBlock };
  const ranked: Ranked[] = [];

  const collect = (fragment: string): void => {
    for (const block of splitTopLevelElementBlocks(fragment)) {
      if (isInstructionBlock(block)) continue;
      const kids = splitTopLevelElementBlocks(block.inner);
      if (
        kids.some((k) => isActivitySectionBlock(k)) &&
        !isActivitySectionBlock(block)
      ) {
        collect(block.inner);
        continue;
      }
      if (isActivitySectionBlock(block)) {
        const type = inferUniversalActivityType(block.inner, block.attrs);
        ranked.push({
          index: ranked.length,
          score: scoreUniversalActivitySection(block.inner),
          signature: buildUniversalActivitySignature(type, block.inner),
          block,
        });
      }
    }
  };
  collect(html);
  if (ranked.length <= 1) return html;

  const drop = new Set<number>();
  for (let i = 0; i < ranked.length; i += 1) {
    if (drop.has(i)) continue;
    for (let j = i + 1; j < ranked.length; j += 1) {
      if (drop.has(j)) continue;
      if (!signaturesNearDuplicate(ranked[i].signature, ranked[j].signature)) {
        continue;
      }
      // Drop the weaker / later duplicate
      if (ranked[j].score > ranked[i].score) {
        drop.add(i);
        break;
      }
      drop.add(j);
    }
  }
  if (!drop.size) return html;

  let seen = 0;
  const walk = (fragment: string): string => {
    const blocks = splitTopLevelElementBlocks(fragment);
    if (!blocks.length) return fragment;
    return blocks
      .map((block) => {
        if (isInstructionBlock(block)) return block.full;
        const kids = splitTopLevelElementBlocks(block.inner);
        if (
          kids.some((k) => isActivitySectionBlock(k)) &&
          !isActivitySectionBlock(block)
        ) {
          return rewriteBlockInner(block, walk(block.inner));
        }
        if (isActivitySectionBlock(block)) {
          const idx = seen;
          seen += 1;
          return drop.has(idx) ? '' : block.full;
        }
        return block.full;
      })
      .join('');
  };
  return walk(html);
}

function inferImageRoleForActivity(
  activityType: string,
  imageCount: number,
): UniversalImageRole {
  if (imageCount <= 1) return 'primary';
  if (/match|pair|connect/i.test(activityType)) return 'matching';
  if (/circle|choose|classify|odd/i.test(activityType)) return 'option';
  return 'unknown';
}

function applyAllocationToActivity(
  block: TopBlock,
  allocation: UniversalActivityLayoutAllocation,
): string {
  const hugH = Math.max(
    allocation.contentHeight || 0,
    allocation.allocatedHeight || 0,
  );
  const open = rewriteOpenTag(
    block.tag,
    setOrReplaceDataAttr(
      setOrReplaceDataAttr(
        setOrReplaceDataAttr(
          block.attrs,
          'data-activity-id',
          allocation.activityId,
        ),
        'data-activity-type',
        allocation.activityType,
      ),
      'data-pair-count',
      String(allocation.pairCount || 0),
    ),
    (style) => {
      const map = parseStyleMap(style);
      scrubViewportFightingStyles(map);
      map.set('flex', '0 0 auto');
      map.set('overflow', 'visible');
      map.set('margin', '0');
      map.set('width', '100%');
      map.set('--activity-height', `${hugH}px`);
      map.set('--image-size', `${allocation.imageSize}px`);
      map.set('--image-gap', `${allocation.imageGap}px`);
      map.set('--grid-columns', String(allocation.gridColumns));
      map.set('height', 'auto');
      map.set('min-height', `${hugH}px`);
      map.delete('max-height');
      map.set('justify-content', 'flex-start');
      map.set('padding', map.get('padding') || '12px 14px 16px');
      ensureCompleteBorder(map);
      return styleMapToString(map);
    },
    'ws-activity ws-section',
  );

  const collapsedInner = collapseDuplicateActivityHeadings(block.inner);
  const sizedInner = applyBoxBudgetToFragment(collapsedInner, {
    minPx: Math.min(allocation.minImageSize, allocation.imageSize),
    maxPx: allocation.imageSize,
    targetPx: allocation.imageSize,
  });
  return `${open}${sizedInner}</${block.tag}>`;
}

/**
 * Keep exactly one learner-facing question per activity.
 * Drops redundant section titles (ws-activity-title / numbered catalog names).
 */
export function collapseDuplicateActivityHeadings(html: string): string {
  if (!html) return html;
  // Remove dedicated title nodes; instruction/question remains.
  let out = html.replace(
    /<(h[1-4]|p|div|span)\b([^>]*\bws-activity-title\b[^>]*)>[\s\S]*?<\/\1>/gi,
    '',
  );
  // If both a title-like heading and an instruction exist without class title,
  // keep the longer actionable line as instruction and drop short catalog names.
  const instr =
    out.match(
      /<(p|div|h[1-4])\b([^>]*\bws-activity-instruction\b[^>]*)>([\s\S]*?)<\/\1>/i,
    )?.[3] || '';
  const instrText = instr.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (instrText) {
    out = out.replace(
      /<(h[1-4]|p|div)\b(?![^>]*ws-activity-instruction)([^>]*)>([\s\S]*?)<\/\1>/gi,
      (full, _tag: string, attrs: string, inner: string) => {
        if (/\bws-img-box\b|\bws-match|\bws-image-grid\b|\bws-label\b|\bws-picture/i.test(attrs + inner)) {
          return full;
        }
        const text = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (!text || text.length > 80) return full;
        const isCatalog =
          /^(?:\d+[.)]\s*)?(look and|meet\b|find the|match |count the|trace\b)/i.test(
            text,
          ) && text.split(/\s+/).length <= 6;
        if (isCatalog && text.toLowerCase() !== instrText.toLowerCase()) {
          return '';
        }
        return full;
      },
    );
  }
  return out;
}

/**
 * Dynamic page-space allocation + content-aware image sizing.
 * Replaces equal-height flex:1 section sharing.
 */
export function applyUniversalDynamicLayout(
  html: string,
  options?: { viewportContentH?: number; hasInstruction?: boolean },
): string {
  if (!html) return html;
  const viewportH = options?.viewportContentH ?? UNIVERSAL_VIEWPORT_CONTENT_H;
  const activities: TopBlock[] = [];

  const collect = (fragment: string): void => {
    for (const block of splitTopLevelElementBlocks(fragment)) {
      if (isInstructionBlock(block)) continue;
      const kids = splitTopLevelElementBlocks(block.inner);
      if (
        kids.some((k) => isActivitySectionBlock(k)) &&
        !isActivitySectionBlock(block)
      ) {
        collect(block.inner);
        continue;
      }
      if (isActivitySectionBlock(block)) activities.push(block);
    }
  };
  collect(html);
  if (!activities.length) {
    return clampUniversalImageBoxes(html, { viewportContentH: viewportH });
  }

  const requirements = activities.map((block, index) => {
    const type = inferUniversalActivityType(block.inner, block.attrs);
    const id =
      readDataAttr(block.attrs, 'data-activity-id') || `activity-${index + 1}`;
    const imageCount = countImageSlots(block.inner);
    const hasMatch =
      /\bws-match-area\b|\bws-match-row\b|match|pair|connect/i.test(
        `${block.attrs} ${block.inner}`,
      );
    const pairCount = hasMatch ? countMatchPairsInFragment(block.inner) : undefined;
    const text = block.inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return estimateActivityLayoutRequirement({
      activityId: id,
      activityType: type,
      imageCount: hasMatch
        ? Math.max(imageCount, (pairCount || 1) * 2)
        : imageCount,
      pairCount,
      hasLabel: /\bws-label\b|\bdata-editable\b|labels\[/i.test(block.inner),
      hasTrace: /\bws-trace-word\b|trace|dotted/i.test(block.inner),
      hasMatch,
      hasChoices:
        /\bws-choice-group\b|\bws-answer-option\b|circle|tick/i.test(block.inner),
      textLength: text.length,
      imageRole: inferImageRoleForActivity(type, imageCount),
    });
  });

  const plan = allocateUniversalPageSpace({
    requirements,
    viewportContentH: viewportH,
    instructionHeight: options?.hasInstruction === false ? 0 : 72,
  });

  const byId = new Map(
    plan.allocations.map((a) => [a.activityId, a] as const),
  );
  let fallbackIndex = 0;

  const walk = (fragment: string): string => {
    const blocks = splitTopLevelElementBlocks(fragment);
    if (!blocks.length) return fragment;
    return blocks
      .map((block) => {
        if (isInstructionBlock(block)) {
          const open = rewriteOpenTag(
            block.tag,
            block.attrs,
            (style) => {
              const map = parseStyleMap(style);
              scrubViewportFightingStyles(map);
              map.set('flex', '0 0 auto');
              map.delete('overflow');
              return styleMapToString(map);
            },
            'ws-instruction',
          );
          return `${open}${block.inner}</${block.tag}>`;
        }
        const kids = splitTopLevelElementBlocks(block.inner);
        if (
          kids.some((k) => isActivitySectionBlock(k)) &&
          !isActivitySectionBlock(block)
        ) {
          const open = rewriteOpenTag(
            block.tag,
            block.attrs,
            (style) => fitSectionOrStackStyle(style, 'stack'),
            'ws-stack',
          );
          return `${open}${walk(block.inner)}</${block.tag}>`;
        }
        if (isActivitySectionBlock(block)) {
          const id =
            readDataAttr(block.attrs, 'data-activity-id') ||
            plan.allocations[fallbackIndex]?.activityId;
          const allocation =
            (id && byId.get(id)) || plan.allocations[fallbackIndex];
          fallbackIndex += 1;
          if (!allocation) return block.full;
          return applyAllocationToActivity(block, allocation);
        }
        return block.full;
      })
      .join('');
  };

  return walk(html);
}

/**
 * Prefer targetSections for 4–5+ when extras are weak fillers
 * (low score / near-empty), without inventing content.
 */
export function preferTargetActivityCount(
  html: string,
  targetSections: number,
  maxSections: number,
): string {
  if (!html || targetSections >= maxSections) {
    return enforceUniversalActivitySectionLimit(html, maxSections);
  }
  const pruned = pruneEmptyUniversalActivitySections(html);
  type Ranked = { index: number; score: number };
  const ranked: Ranked[] = [];
  const collect = (fragment: string): void => {
    for (const block of splitTopLevelElementBlocks(fragment)) {
      if (isInstructionBlock(block)) continue;
      const kids = splitTopLevelElementBlocks(block.inner);
      if (
        kids.some((k) => isActivitySectionBlock(k)) &&
        !isActivitySectionBlock(block)
      ) {
        collect(block.inner);
        continue;
      }
      if (isActivitySectionBlock(block)) {
        ranked.push({
          index: ranked.length,
          score: scoreUniversalActivitySection(block.inner),
        });
      }
    }
  };
  collect(pruned);
  if (ranked.length <= targetSections) {
    return enforceUniversalActivitySectionLimit(pruned, maxSections);
  }
  if (ranked.length <= maxSections) {
    const weakExtras = ranked
      .slice()
      .sort((a, b) => a.score - b.score)
      .filter((r) => r.score < 40);
    // If we have more than target and weak fillers exist, trim to target
    if (ranked.length > targetSections && weakExtras.length > 0) {
      return enforceUniversalActivitySectionLimit(pruned, targetSections);
    }
  }
  return enforceUniversalActivitySectionLimit(pruned, maxSections);
}

/** Sync labels[] from data-editable spans so chrome editor can change copy. */
export function syncEditableLabels(
  html: string,
  prior: unknown,
): { html: string; labels: string[] } {
  const priorLabels = Array.isArray(prior)
    ? prior.map((v) => readString(v, 80))
    : [];
  const found = new Map<number, string>();
  const re =
    /data-(?:editable|field-path)=["']labels\[(\d+)\]["'][^>]*>([^<]*)</gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) != null) {
    const idx = Number(m[1]);
    const text = scrubTitlePunctuation(m[2] || '');
    if (Number.isFinite(idx) && idx >= 0) found.set(idx, text);
  }

  const maxIdx = Math.max(
    found.size ? Math.max(...found.keys()) : -1,
    priorLabels.length - 1,
  );
  const labels: string[] = [];
  for (let i = 0; i <= maxIdx; i += 1) {
    const fromPrior = priorLabels[i];
    const fromHtml = found.get(i) || '';
    // Prefer structure labels when the array was provided (supports field edits).
    labels.push(
      priorLabels.length > 0 && i < priorLabels.length
        ? scrubTitlePunctuation(fromPrior || fromHtml)
        : fromHtml,
    );
  }
  while (labels.length && !labels[labels.length - 1]) labels.pop();

  let nextHtml = html;
  for (let i = 0; i < labels.length; i += 1) {
    if (!labels[i]) continue;
    const spanRe = new RegExp(
      `(data-(?:editable|field-path)=["']labels\\[${i}\\]["'][^>]*>)([^<]*)(<)`,
      'gi',
    );
    nextHtml = nextHtml.replace(spanRe, `$1${escapeText(labels[i])}$3`);
  }

  return { html: nextHtml, labels };
}

function looksLikeEditableLabelText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 40) return false;
  if (/^\{\{/.test(trimmed)) return false;
  // Never treat image placeholders as editable label copy
  if (/\{\{\s*IMAGE[_:]?\d+\s*\}\}/i.test(trimmed)) return false;
  if (!/[a-zA-Z]/.test(trimmed)) return false;
  const words = trimmed.split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= 6;
}

/**
 * Wrap short leaf labels so the editor can edit them even when the LLM
 * omitted data-editable spans.
 */
export function ensureEditableLabels(html: string): string {
  if (!html) return html;
  const existingIdx = [...html.matchAll(/labels\[(\d+)\]/gi)].map((m) =>
    Number(m[1]),
  );
  let nextIndex = existingIdx.length ? Math.max(...existingIdx) + 1 : 0;

  const wrapLeaf = (
    tag: string,
    attrs: string,
    text: string,
  ): string | null => {
    if (/\bdata-editable\b/i.test(attrs)) return null;
    if (/\bws-instruction\b/i.test(attrs)) return null;
    if (!looksLikeEditableLabelText(text)) return null;
    const cleaned = scrubTitlePunctuation(text.trim()) || text.trim();
    const idx = nextIndex;
    nextIndex += 1;
    return (
      `<${tag}${attrs}>` +
      `<span data-editable="labels[${idx}]" data-field-path="labels[${idx}]">${escapeText(cleaned)}</span>` +
      `</${tag}>`
    );
  };

  let out = html.replace(
    /<(p|h[1-4]|span|label|strong|em|b|i)\b([^>]*)>([^<]{1,40})<\/\1>/gi,
    (full, tag: string, attrs: string, text: string) => {
      const wrapped = wrapLeaf(tag, attrs || '', text);
      return wrapped ?? full;
    },
  );

  out = out.replace(
    /<(div|td|li)\b([^>]*)>([^<]{1,40})<\/\1>/gi,
    (full, tag: string, attrs: string, text: string) => {
      if (
        /\bws-img-box\b|\bws-instruction\b|\bws-dynamic\b|\bws-stack\b|\bws-section\b|\bws-activity\b/i.test(
          attrs,
        )
      ) {
        return full;
      }
      const wrapped = wrapLeaf(tag, attrs || '', text);
      return wrapped ?? full;
    },
  );

  return out;
}

/**
 * Soft-align imageQuery with a nearby single-token label so retrieval matches
 * the printed word (no second LLM call).
 */
export function softAlignImageQueries(
  html: string,
  images: Array<Record<string, unknown>>,
  labels: string[],
): Array<Record<string, unknown>> {
  if (!images.length) return images;
  const next = images.map((img) => ({ ...img }));

  for (let n = 1; n <= next.length; n += 1) {
    const tokenRe = new RegExp(`\\{\\{\\s*IMAGE[_:]?${n}\\s*\\}\\}`, 'i');
    const tokenAt = html.search(tokenRe);
    if (tokenAt < 0) continue;

    const windowStart = Math.max(0, tokenAt - 220);
    const windowEnd = Math.min(html.length, tokenAt + 220);
    const slice = html.slice(windowStart, windowEnd);

    let labelText = '';
    const spanHit = [
      ...slice.matchAll(
        /data-(?:editable|field-path)=["']labels\[(\d+)\]["'][^>]*>([^<]+)</gi,
      ),
    ];
    if (spanHit.length) {
      let best = spanHit[0];
      let bestDist = Number.POSITIVE_INFINITY;
      for (const hit of spanHit) {
        const abs = windowStart + (hit.index ?? 0);
        const dist = Math.abs(abs - tokenAt);
        if (dist < bestDist) {
          bestDist = dist;
          best = hit;
        }
      }
      const idx = Number(best[1]);
      labelText =
        scrubTitlePunctuation(best[2] || '') ||
        scrubTitlePunctuation(labels[idx] || '');
    }

    if (!labelText) continue;
    const words = labelText.split(/\s+/).filter(Boolean);
    if (words.length !== 1) continue;
    const token = words[0].toLowerCase();
    if (token.length < 2) continue;

    const prior = readString(next[n - 1].imageQuery, 120).toLowerCase();
    if (prior.includes(token)) continue;
    const base =
      readString(next[n - 1].imageQuery, 100) ||
      'age appropriate educational illustration';
    next[n - 1] = {
      ...next[n - 1],
      imageQuery: `${base} ${words[0]}`.trim().slice(0, 120),
    };
  }

  return next;
}

/** Drop {{IMAGE_N}} tokens above max and return cleaned HTML. */
export function trimUniversalImageTokens(
  html: string,
  maxImages: number,
): string {
  return html.replace(
    /\{\{\s*IMAGE[_:]?(\d+)\s*\}\}/gi,
    (full, nRaw: string) => {
      const n = Number(nRaw);
      if (!Number.isFinite(n) || n < 1 || n > maxImages) return '';
      return `{{IMAGE_${n}}}`;
    },
  );
}

export const UNIVERSAL_MAX_IMAGES = 10;
export const UNIVERSAL_CONTENT_HTML_SOFT_MAX = 16000;
export const UNIVERSAL_CONTENT_HTML_HARD_MAX = 32000;

function sanitizeClassValue(raw: string): string {
  return decodeBasicEntities(raw)
    .split(/\s+/)
    .filter((token) => /^[a-zA-Z_][\w-]*$/.test(token))
    .join(' ');
}

function parseAttributes(raw: string): Array<{ name: string; value: string | null }> {
  const attrs: Array<{ name: string; value: string | null }> = [];
  const re =
    /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) != null) {
    attrs.push({
      name: match[1].toLowerCase(),
      value: match[2] ?? match[3] ?? match[4] ?? null,
    });
  }
  return attrs;
}

function rebuildAllowedAttributes(tag: string, rawAttrs: string): string {
  const kept: string[] = [];
  for (const { name, value } of parseAttributes(rawAttrs)) {
    if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction') continue;
    if (name === 'style' && value != null) {
      const safe = sanitizeStyleValue(value);
      if (safe) kept.push(`style="${escapeAttr(safe)}"`);
      continue;
    }
    if (name === 'class' && value != null) {
      const safe = sanitizeClassValue(value);
      if (safe) kept.push(`class="${escapeAttr(safe)}"`);
      continue;
    }
    if (
      (name === 'data-editable' || name === 'data-field-path') &&
      value != null &&
      /^(labels\[\d+\]|main_topic|sub_topic|instruction_text)$/i.test(value.trim())
    ) {
      kept.push(`${name}="${escapeAttr(value.trim())}"`);
      continue;
    }
    if (
      (name === 'data-activity-type' ||
        name === 'data-activity-id' ||
        name === 'data-image-role' ||
        name === 'data-importance' ||
        name === 'data-layout') &&
      value != null
    ) {
      const safe = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '')
        .slice(0, 48);
      if (safe) kept.push(`${name}="${escapeAttr(safe)}"`);
      continue;
    }
    if (
      (name === 'colspan' || name === 'rowspan') &&
      value != null &&
      /^\d{1,2}$/.test(value.trim())
    ) {
      kept.push(`${name}="${escapeAttr(value.trim())}"`);
    }
  }
  return kept.length ? ` ${kept.join(' ')}` : '';
}

/** Convert every <img> (esp. src="{{IMAGE_N}}") into a bare {{IMAGE_N}} token. */
export function normalizeImgTagsToImageTokens(html: string): string {
  let autoIndex = 0;
  return html.replace(/<img\b[^>]*>/gi, (full) => {
    const fromSrc = full.match(/\{\{\s*IMAGE[_:]?(\d+)\s*\}\}/i);
    if (fromSrc) return `{{IMAGE_${Number(fromSrc[1])}}}`;
    const fromSlot = full.match(
      /data-image-slot\s*=\s*["'](?:IMAGE[_:]?|images\[)?(\d+)\]?["']/i,
    );
    if (fromSlot) {
      const n = full.toLowerCase().includes('images[')
        ? Number(fromSlot[1]) + 1
        : Number(fromSlot[1]);
      return `{{IMAGE_${n}}}`;
    }
    autoIndex += 1;
    return `{{IMAGE_${autoIndex}}}`;
  });
}

export function sanitizeUniversalContentHtml(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  let html = decodeBasicEntities(raw.trim());
  if (!html) return '';

  html = html
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<\/?(html|head|body)[^>]*>/gi, '');
  html = html.replace(
    /<(script|style|iframe|object|embed|link|base|meta|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    '',
  );
  html = html.replace(
    /<(script|style|iframe|object|embed|link|base|meta|noscript|svg|math)\b[^>]*\/?\s*>/gi,
    '',
  );

  html = normalizeImgTagsToImageTokens(html);

  const imageTokens: string[] = [];
  html = html.replace(/\{\{\s*IMAGE[_:]?(\d+)\s*\}\}/gi, (_m, n: string) => {
    const token = `{{IMAGE_${Number(n)}}}`;
    const idx = imageTokens.push(token) - 1;
    return `<!--__WS_IMG_${idx}__-->`;
  });

  html = html.replace(
    /<\/?([a-zA-Z][\w:-]*)\b([^>]*)>/g,
    (full, rawTag: string, rawAttrs: string) => {
      const isClose = full.startsWith('</');
      const tag = rawTag.toLowerCase().replace(/:.*/, '');
      if (FORBIDDEN_TAGS.has(tag) || tag === 'img') return '';
      if (!ALLOWED_TAGS.has(tag)) return '';
      if (isClose) return VOID_TAGS.has(tag) ? '' : `</${tag}>`;
      const attrs = rebuildAllowedAttributes(tag, rawAttrs || '');
      if (VOID_TAGS.has(tag)) return `<${tag}${attrs} />`;
      return `<${tag}${attrs}>`;
    },
  );

  html = html.replace(/<!--__WS_IMG_(\d+)__-->/g, (_m, idx: string) => {
    return imageTokens[Number(idx)] ?? '';
  });
  html = html.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  const trimmed = html.trim();
  if (trimmed.length > UNIVERSAL_CONTENT_HTML_SOFT_MAX) {
    // Soft budget for generation quality; hard truncate only at HARD_MAX.
    // eslint-disable-next-line no-console
    console.warn(
      `[universal_template] content_html length=${trimmed.length} exceeds soft max=${UNIVERSAL_CONTENT_HTML_SOFT_MAX}`,
    );
  }
  if (trimmed.length > UNIVERSAL_CONTENT_HTML_HARD_MAX) {
    // eslint-disable-next-line no-console
    console.warn(
      `[universal_template] content_html truncated from ${trimmed.length} to ${UNIVERSAL_CONTENT_HTML_HARD_MAX}`,
    );
  }
  return trimmed.slice(0, UNIVERSAL_CONTENT_HTML_HARD_MAX);
}

export function expandUniversalImagePlaceholders(html: string): string {
  return html.replace(/\{\{\s*IMAGE[_:]?(\d+)\s*\}\}/gi, (_m, nRaw: string) => {
    const n = Number(nRaw);
    if (!Number.isFinite(n) || n < 1) return '';
    const path = `images[${n - 1}]`;
    // Fill the parent .ws-img-box (LLM sets box px). Assets are 1:1 ~500×500.
    return (
      `<img class="worksheet-image" data-image-slot="${path}" ` +
      `data-field-path="${path}" alt="" ` +
      `style="width:100%;height:100%;max-width:100%;max-height:100%;object-fit:contain;display:block;aspect-ratio:1/1;" />`
    );
  });
}

/**
 * Header aliases + semantic composition pipeline.
 * Prefer activities[] JSON → UniversalWorksheetModel → compose HTML.
 * Falls back to parsing content_html into the same model.
 */
export function normalizeUniversalStructure(
  structure: Record<string, unknown>,
  options?: UniversalNormalizeOptions,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...structure };
  next.worksheet_type = 'universal_template';
  const viewportH = options?.viewportContentH ?? UNIVERSAL_VIEWPORT_CONTENT_H;

  // Drop catalog leftovers if an older prompt still emitted them
  delete next.layout;
  delete next.layout_type;
  delete next.cards;
  delete next.items;
  delete next.sections;
  delete next.blocks;

  const composed = composeUniversalWorksheet(next, {
    age: options?.age,
    ageGroup: options?.ageGroup,
    grade: options?.grade,
    viewportContentH: viewportH,
  });

  next.main_topic = composed.model.main_topic;
  next.sub_topic = composed.model.sub_topic;
  next.instruction_text = composed.model.instruction_text;

  // Sanitize composed HTML (no scripts; keep semantic classes/data attrs)
  let sanitized = scrubShortPhrasePunctuation(
    sanitizeUniversalContentHtml(composed.content_html),
  );
  sanitized = scrubNestedCardGrowth(sanitized);
  sanitized = trimUniversalImageTokens(sanitized, UNIVERSAL_MAX_IMAGES);

  let synced = syncEditableLabels(
    sanitized,
    composed.labels.length ? composed.labels : next.labels,
  );
  sanitized = synced.html;
  next.content_html = sanitized;
  if (synced.labels.length) next.labels = synced.labels;
  else if (composed.labels.length) next.labels = composed.labels;

  // Persist activities[] for consumers / retries (non-breaking)
  next.activities = composed.model.activities.map((a) => {
    const question = a.instruction || a.title || '';
    return {
      id: a.id,
      type: a.type,
      title: '',
      instruction: question,
      layoutIntent: a.layoutIntent,
      items: a.items,
      ...(a.leftItems ? { leftItems: a.leftItems } : {}),
      ...(a.rightItems ? { rightItems: a.rightItems } : {}),
    };
  });
  next.__activityGapPx = composed.plan.interActivityGap;

  const images: Array<Record<string, unknown>> = composed.images.map((img) => {
    const row: Record<string, unknown> = { imageQuery: img.imageQuery };
    if (img.role) row.role = img.role;
    if (img.importance) row.importance = img.importance;
    if (img.activityId) row.activityId = img.activityId;
    if (img.assetId) row.assetId = img.assetId;
    if (img.assetUrl) row.assetUrl = img.assetUrl;
    return row;
  });

  const labelsArr = Array.isArray(next.labels)
    ? (next.labels as unknown[]).map((v) => readString(v, 80))
    : [];
  next.images = softAlignImageQueries(sanitized, images, labelsArr);

  return next;
}

export function buildUniversalSkeletonHtml(
  structure: Record<string, unknown>,
  options?: UniversalNormalizeOptions,
): string {
  const normalized = normalizeUniversalStructure(structure, options);
  const instruction = readString(normalized.instruction_text, 220);
  let fragment = expandUniversalImagePlaceholders(
    sanitizeUniversalContentHtml(String(normalized.content_html || '')),
  );
  fragment = scrubNestedCardGrowth(fragment);

  if (instruction) {
    const already =
      /class=["'][^"']*\bws-instruction\b/i.test(fragment) ||
      (instruction.length >= 12 &&
        fragment.toLowerCase().includes(instruction.toLowerCase().slice(0, 40)));
    if (!already) {
      fragment =
        `<div class="ws-instruction" style="flex:0 0 auto;margin:0;padding:10px 14px;border:2px solid #f0b429;border-radius:14px;background:#fff8e1;font-size:18px;font-weight:600;color:#2a1b4a;line-height:1.3;">` +
        `${escapeText(instruction)}</div>` +
        fragment;
    }
  }

  // Composed activities already carry --activity-height; do not re-equalize.
  const gapPx = Math.max(
    10,
    Math.min(28, Number(normalized.__activityGapPx) || 14),
  );
  return (
    `<style data-universal-img-layout="true">${UNIVERSAL_IMAGE_LAYOUT_CSS}</style>` +
    `<div class="ws-dynamic" style="--activity-gap:${gapPx}px;display:flex;flex-direction:column;gap:var(--activity-gap,${gapPx}px);width:100%;height:100%;min-height:0;max-height:100%;box-sizing:border-box;overflow:auto;justify-content:flex-start;align-content:flex-start;">` +
    fragment +
    `</div>`
  );
}

export function injectUniversalContentHtml(
  templateHtml: string,
  structure: Record<string, unknown>,
  options?: UniversalNormalizeOptions,
): string {
  if (!templateHtml) return templateHtml;
  const fragment = buildUniversalSkeletonHtml(structure, options);

  if (/\{\{\s*CONTENT_HTML\s*\}\}/i.test(templateHtml)) {
    return templateHtml.replace(/\{\{\s*CONTENT_HTML\s*\}\}/gi, () => fragment);
  }
  if (/id=["']content-region["']/i.test(templateHtml)) {
    return templateHtml.replace(
      /(<div\b[^>]*\bid=["']content-region["'][^>]*>)([\s\S]*?)(<\/div>)/i,
      (_m, open: string, _inner: string, close: string) =>
        `${open}${fragment}${close}`,
    );
  }
  return templateHtml;
}

export function isUniversalSlug(slug: string | null | undefined): boolean {
  const s = String(slug ?? '')
    .trim()
    .toLowerCase();
  return s === 'universal_template' || s === 'universal';
}

/**
 * Universal detection must NOT key off a bare content_html field — that would
 * bleed into unrelated templates. Prefer worksheet_type; callers may also pass
 * template slug via isUniversalSlug.
 */
export function isUniversalStructure(structure: unknown): boolean {
  if (!isRecord(structure)) return false;
  const type = String(structure.worksheet_type ?? '').toLowerCase();
  return type === 'universal_template' || type === 'universal';
}
