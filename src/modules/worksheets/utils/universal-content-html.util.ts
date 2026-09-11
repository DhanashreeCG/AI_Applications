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

function sanitizeStyleValue(raw: string): string {
  const decoded = decodeBasicEntities(raw).trim();
  const parts: string[] = [];
  for (const chunk of decoded.split(';')) {
    const idx = chunk.indexOf(':');
    if (idx <= 0) continue;
    const prop = chunk.slice(0, idx).trim().toLowerCase();
    const val = chunk.slice(idx + 1).trim();
    if (!SAFE_STYLE_PROPS.has(prop) || !val) continue;
    if (/expression\s*\(|javascript:|url\s*\(/i.test(val)) continue;
    if (prop === 'position' && !/^(static|relative|absolute)$/i.test(val)) continue;
    parts.push(`${prop}:${val}`);
  }
  return parts.join(';');
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

  if (instruction) {
    const already =
      /class=["'][^"']*\bws-instruction\b/i.test(fragment) ||
      (instruction.length >= 12 &&
        fragment.toLowerCase().includes(instruction.toLowerCase().slice(0, 40)));
    if (!already) {
      fragment =
        `<div class="ws-instruction" style="margin:0 0 14px;padding:12px 16px;border:2px solid #f0b429;border-radius:14px;background:#fff8e1;font-size:20px;font-weight:600;color:#2a1b4a;line-height:1.35;">` +
        `${escapeText(instruction)}</div>` +
        fragment;
    }
  }

  // Neutral full-size host — model owns layout inside content_html.
  return (
    `<div class="ws-dynamic" style="width:100%;height:100%;min-height:100%;box-sizing:border-box;">` +
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
