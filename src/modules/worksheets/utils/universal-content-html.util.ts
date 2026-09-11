/**
 * Universal template: fixed chrome (title / subtopic / Name / Date) +
 * STRICTLY dynamic LLM HTML for the content viewport.
 *
 * No layout catalog. The model invents structure + content each request.
 * We only sanitize, fix image slots, and inject into #content-region.
 */

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
    if (prop === 'position' && !/^(static|relative|absolute)$/i.test(val)) continue;
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
  if (block.tag === 'section' || block.tag === 'article') return true;
  if (/\bws-section\b/i.test(block.attrs)) return true;
  if (hasBorderStyle(block.attrs) || hasBorderStyle(block.openTag)) return true;
  const styleMatch = block.attrs.match(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i);
  const style = styleMatch?.[2] ?? styleMatch?.[3] ?? '';
  return hasBorderStyle(`style="${style}"`) || hasBorderStyle(style);
}

function fitSectionOrStackStyle(rawStyle: string, kind: 'section' | 'stack'): string {
  const map = parseStyleMap(rawStyle);
  scrubViewportFightingStyles(map);
  map.set('flex', '1 1 0');
  map.set('min-height', '0');
  map.set('overflow', 'hidden');
  // Let the host flex algorithm assign height — fixed/percent heights leave a
  // dead gap above the footer and squash middle sections.
  map.delete('height');
  map.delete('max-height');
  if (kind === 'stack') {
    if (!map.has('display')) map.set('display', 'flex');
    if (!map.has('flex-direction')) map.set('flex-direction', 'column');
    if (!map.has('gap')) map.set('gap', '10px');
    if (!map.has('width')) map.set('width', '100%');
  } else {
    ensureCompleteBorder(map);
  }
  return styleMapToString(map);
}

function retagBlock(block: TopBlock, kind: 'section' | 'stack'): string {
  const open = rewriteOpenTag(
    block.tag,
    block.attrs,
    (style) => fitSectionOrStackStyle(style, kind),
    kind === 'section' ? 'ws-section' : 'ws-stack',
  );
  return `${open}${block.inner}</${block.tag}>`;
}

/**
 * Force activity sections to share the viewport and keep closed outlines.
 * Fixes clipped last-section borders when model HTML uses height:100% + overflow.
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

  return blocks
    .map((block) => {
      if (isInstructionBlock(block)) {
        const open = rewriteOpenTag(block.tag, block.attrs, (style) => {
          const map = parseStyleMap(style);
          scrubViewportFightingStyles(map);
          map.set('flex', '0 0 auto');
          map.delete('overflow');
          return styleMapToString(map);
        }, 'ws-instruction');
        return `${open}${block.inner}</${block.tag}>`;
      }
      if (isActivitySectionBlock(block)) {
        return retagBlock(block, 'section');
      }
      // Nested stack (model root kept) — still scrub height:100%.
      if (block.tag === 'div' || block.tag === 'section') {
        const innerBlocks = splitTopLevelElementBlocks(block.inner);
        if (innerBlocks.some((b) => isActivitySectionBlock(b))) {
          const fittedInner = innerBlocks
            .map((child) =>
              isActivitySectionBlock(child)
                ? retagBlock(child, 'section')
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
      return `${open}${block.inner}</${block.tag}>`;
    })
    .join('');
}

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

  return html.trim().slice(0, 32000);
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
 * Header aliases + ensure images[] aligns with {{IMAGE_N}} usage.
 * Does NOT impose any layout catalog.
 */
export function normalizeUniversalStructure(
  structure: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...structure };
  next.worksheet_type = 'universal_template';

  const mainTopic =
    readString(next.main_topic, 80) ||
    readString(next.topic, 80) ||
    readString(next.title, 80);
  let subTopic =
    readString(next.sub_topic, 80) ||
    readString(next.badge_label, 80) ||
    readString(next.skill_label, 80) ||
    'Practice';
  if (subTopic.includes('?')) subTopic = 'Practice';

  next.main_topic = mainTopic || 'Worksheet';
  next.sub_topic = subTopic;
  next.instruction_text =
    readString(next.instruction_text, 220) ||
    readString(next.instruction, 220) ||
    '';

  const contentHtml =
    typeof next.content_html === 'string'
      ? next.content_html
      : typeof next.contentHtml === 'string'
        ? next.contentHtml
        : '';
  next.content_html = contentHtml;

  // Drop catalog leftovers if an older prompt still emitted them
  delete next.layout;
  delete next.layout_type;
  delete next.cards;
  delete next.items;
  delete next.sections;
  delete next.blocks;

  // Sanitize early so stored structure matches what will render
  const sanitized = sanitizeUniversalContentHtml(contentHtml);
  next.content_html = sanitized;

  const existing = Array.isArray(next.images) ? next.images : [];
  const tokenNums = new Set<number>();
  const collectTokens = (html: string) => {
    const re = /\{\{\s*IMAGE[_:]?(\d+)\s*\}\}/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) != null) {
      tokenNums.add(Number(m[1]));
    }
  };
  collectTokens(contentHtml);
  collectTokens(sanitized);
  const rawImgCount = (contentHtml.match(/<img\b/gi) || []).length;
  const maxToken = tokenNums.size
    ? Math.max(...tokenNums)
    : rawImgCount > 0
      ? rawImgCount
      : existing.length;

  const images: Array<Record<string, unknown>> = [];
  for (let i = 0; i < Math.max(maxToken, existing.length, 0); i += 1) {
    const prior = isRecord(existing[i]) ? existing[i] : {};
    const imageQuery =
      readString(prior.imageQuery, 120) ||
      readString(prior.image_query, 120) ||
      `age appropriate educational illustration ${i + 1}`;
    images.push({
      imageQuery,
      ...(typeof prior.assetId === 'string' ? { assetId: prior.assetId } : {}),
      ...(typeof prior.assetUrl === 'string' ? { assetUrl: prior.assetUrl } : {}),
    });
  }
  next.images = images;
  return next;
}

export function buildUniversalSkeletonHtml(
  structure: Record<string, unknown>,
): string {
  const normalized = normalizeUniversalStructure(structure);
  const instruction = readString(normalized.instruction_text, 220);
  let fragment = expandUniversalImagePlaceholders(
    sanitizeUniversalContentHtml(String(normalized.content_html || '')),
  );
  fragment = fitUniversalContentLayout(fragment);

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

  // Re-fit after instruction injection so top-level sections stay host flex children.
  fragment = fitUniversalContentLayout(fragment);

  // Full-height flex host so activity sections can stretch and close above footer.
  return (
    `<div class="ws-dynamic" style="display:flex;flex-direction:column;gap:10px;width:100%;height:100%;min-height:0;max-height:100%;box-sizing:border-box;overflow:hidden;">` +
    fragment +
    `</div>`
  );
}

export function injectUniversalContentHtml(
  templateHtml: string,
  structure: Record<string, unknown>,
): string {
  if (!templateHtml) return templateHtml;
  const fragment = buildUniversalSkeletonHtml(structure);

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

export function isUniversalStructure(structure: unknown): boolean {
  if (!isRecord(structure)) return false;
  const type = String(structure.worksheet_type ?? '').toLowerCase();
  if (type === 'universal_template' || type === 'universal') return true;
  return (
    typeof structure.content_html === 'string' ||
    typeof structure.contentHtml === 'string'
  );
}
