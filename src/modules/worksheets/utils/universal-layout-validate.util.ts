/**
 * Provider-independent layout quality validator for universal_template.
 * Structural checks work without a browser; browser metrics can be passed in
 * from Playwright measurement when available.
 */

import { minimumReadableImageSize } from './universal-dynamic-layout.util';

export type UniversalLayoutIssueType =
  | 'ACTIVITY_OVERFLOW'
  | 'ACTIVITY_OVERLAP'
  | 'IMAGE_OVERFLOW'
  | 'IMAGE_TOO_SMALL'
  | 'EMPTY_ACTIVITY'
  | 'ORPHAN_IMAGE_TOKEN'
  | 'ORPHAN_IMAGE_QUERY'
  | 'DUPLICATE_ACTIVITY'
  | 'MISSING_IMAGE'
  | 'CONTENT_OUTSIDE_REGION'
  | 'HUGE_WHITESPACE'
  | 'EXCESSIVE_WHITESPACE'
  | 'INVALID_MATCHING_LAYOUT'
  | 'INVALID_ASSET_FOR_ACTIVITY'
  | 'MISSING_ACTIVITY_META';

export type UniversalLayoutIssue = {
  type: UniversalLayoutIssueType;
  activityId?: string;
  message: string;
  actual?: number;
  minimum?: number;
  overflowPx?: number;
  details?: Record<string, unknown>;
};

export type UniversalLayoutValidationResult = {
  valid: boolean;
  issues: UniversalLayoutIssue[];
};

export type UniversalBrowserLayoutMetrics = {
  contentRegion?: { top: number; bottom: number; height: number; width: number };
  activities?: Array<{
    id: string;
    top: number;
    bottom: number;
    height: number;
    width: number;
    imageCount: number;
    textLength: number;
  }>;
  images?: Array<{
    activityId?: string;
    width: number;
    height: number;
    top: number;
    bottom: number;
  }>;
};

function readAttr(attrs: string, name: string): string {
  const re = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    'i',
  );
  const m = attrs.match(re);
  return (m?.[1] ?? m?.[2] ?? '').trim();
}

function splitTopActivities(html: string): Array<{
  full: string;
  attrs: string;
  inner: string;
}> {
  const out: Array<{ full: string; attrs: string; inner: string }> = [];
  const re =
    /<(section|div|article)\b([^>]*\b(?:ws-activity|ws-section)\b[^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) != null) {
    const tag = m[1];
    const attrs = m[2] || '';
    if (/\bws-instruction\b/i.test(attrs)) continue;
    const openEnd = m.index + m[0].length;
    // naive depth match
    const openRe = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
    const closeRe = new RegExp(`</${tag}\\s*>`, 'gi');
    let depth = 1;
    let cursor = openEnd;
    let closeAt = -1;
    while (cursor < html.length && depth > 0) {
      openRe.lastIndex = cursor;
      closeRe.lastIndex = cursor;
      const o = openRe.exec(html);
      const c = closeRe.exec(html);
      const oi = o ? o.index : Number.POSITIVE_INFINITY;
      const ci = c ? c.index : Number.POSITIVE_INFINITY;
      if (ci === Number.POSITIVE_INFINITY) break;
      if (oi < ci) {
        depth += 1;
        cursor = oi + (o as RegExpExecArray)[0].length;
      } else {
        depth -= 1;
        if (depth === 0) {
          closeAt = ci;
          break;
        }
        cursor = ci + (c as RegExpExecArray)[0].length;
      }
    }
    if (closeAt < 0) continue;
    const closeMatch = html.slice(closeAt).match(new RegExp(`^</${tag}\\s*>`, 'i'));
    const closeLen = closeMatch ? closeMatch[0].length : tag.length + 3;
    const full = html.slice(m.index, closeAt + closeLen);
    const inner = html.slice(openEnd, closeAt);
    out.push({ full, attrs, inner });
    re.lastIndex = closeAt + closeLen;
  }
  return out;
}

function countImageTokens(html: string): number {
  return (html.match(/\{\{\s*IMAGE[_:]?\d+\s*\}\}/gi) || []).length;
}

function readImageBoxSizes(html: string): number[] {
  const sizes: number[] = [];
  const re = /<div\b([^>]*\bws-img-box\b[^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) != null) {
    const attrs = m[1] || '';
    const style = readAttr(attrs, 'style');
    const w = style.match(/(?:^|;)\s*width\s*:\s*(\d+)px/i);
    const cssVar = style.match(/--image-size\s*:\s*(\d+)px/i);
    if (w) sizes.push(Number(w[1]));
    else if (cssVar) sizes.push(Number(cssVar[1]));
  }
  return sizes;
}

function hasMeaningfulLearnerContent(inner: string): boolean {
  if (countImageTokens(inner) > 0) return true;
  if (/\bws-img-box\b/i.test(inner)) return true;
  if (
    /\bws-answer-option\b|\bws-trace-word\b|\bws-match-area\b|\bws-choice-group\b|\bws-word\b|\bws-label\b|\bws-picture-card\b|\bws-item\b/i.test(
      inner,
    )
  ) {
    return true;
  }
  const text = inner
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 60;
}

function normalizeInstruction(inner: string): string {
  const text = inner
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '');
  return text.slice(0, 80);
}

function structuralSignature(inner: string, activityType: string): string {
  const imgs = countImageTokens(inner);
  const flags = [
    /\bws-match-area\b|match/i.test(inner) ? 'm' : '',
    /\bws-trace-word\b|trace|dotted/i.test(inner) ? 't' : '',
    /\bws-choice-group\b|\bws-answer-option\b|circle|tick/i.test(inner)
      ? 'c'
      : '',
    imgs > 0 ? `${imgs}i` : '0i',
  ]
    .filter(Boolean)
    .join('-');
  return `${activityType}|${flags}|${normalizeInstruction(inner)}`;
}

/**
 * Structural + optional browser-metric validation.
 */
export function validateUniversalLayout(input: {
  contentHtml: string;
  images?: Array<Record<string, unknown>>;
  browserMetrics?: UniversalBrowserLayoutMetrics | null;
  viewportContentH?: number;
}): UniversalLayoutValidationResult {
  const issues: UniversalLayoutIssue[] = [];
  const html = input.contentHtml || '';
  const images = Array.isArray(input.images) ? input.images : [];
  const activities = splitTopActivities(html);

  // Empty activities
  for (const act of activities) {
    const id =
      readAttr(act.attrs, 'data-activity-id') ||
      readAttr(act.attrs, 'id') ||
      'unknown';
    if (!hasMeaningfulLearnerContent(act.inner)) {
      issues.push({
        type: 'EMPTY_ACTIVITY',
        activityId: id,
        message: `Activity "${id}" has no meaningful learner content`,
      });
    }
    if (!readAttr(act.attrs, 'data-activity-type')) {
      issues.push({
        type: 'MISSING_ACTIVITY_META',
        activityId: id,
        message: `Activity "${id}" is missing data-activity-type`,
      });
    }
  }

  // Duplicate signatures
  const seen = new Map<string, string>();
  for (const act of activities) {
    const id =
      readAttr(act.attrs, 'data-activity-id') ||
      readAttr(act.attrs, 'id') ||
      'unknown';
    const type =
      readAttr(act.attrs, 'data-activity-type').toLowerCase() || 'unknown';
    const sig = structuralSignature(act.inner, type);
    const prior = seen.get(sig);
    if (prior) {
      issues.push({
        type: 'DUPLICATE_ACTIVITY',
        activityId: id,
        message: `Activity "${id}" duplicates "${prior}"`,
        details: { signature: sig, priorActivityId: prior },
      });
    } else {
      seen.set(sig, id);
    }
  }

  // Image tokens vs images[]
  const tokenNums = new Set<number>();
  const tokenRe = /\{\{\s*IMAGE[_:]?(\d+)\s*\}\}/gi;
  let tm: RegExpExecArray | null;
  while ((tm = tokenRe.exec(html)) != null) {
    tokenNums.add(Number(tm[1]));
  }
  const maxToken = tokenNums.size ? Math.max(...tokenNums) : 0;
  for (const n of tokenNums) {
    if (n < 1 || n > images.length) {
      issues.push({
        type: 'ORPHAN_IMAGE_TOKEN',
        message: `{{IMAGE_${n}}} has no images[] entry`,
        details: { token: n, imagesLength: images.length },
      });
    }
  }
  if (images.length > maxToken) {
    issues.push({
      type: 'ORPHAN_IMAGE_QUERY',
      message: `images[] has ${images.length} entries but only ${maxToken} tokens`,
      actual: images.length,
      minimum: maxToken,
    });
  }
  for (let i = 0; i < images.length; i += 1) {
    const q = String(
      (images[i] as { imageQuery?: unknown })?.imageQuery ?? '',
    ).trim();
    if (!q) {
      issues.push({
        type: 'MISSING_IMAGE',
        message: `images[${i}] missing imageQuery`,
      });
    }
  }

  // Image size checks from HTML
  for (const act of activities) {
    const id =
      readAttr(act.attrs, 'data-activity-id') ||
      readAttr(act.attrs, 'id') ||
      'unknown';
    const imgCount = countImageTokens(act.inner);
    if (imgCount === 0) continue;
    const sizes = readImageBoxSizes(act.inner);
    const minReadable = minimumReadableImageSize(imgCount);
    for (const size of sizes) {
      if (size < minReadable) {
        issues.push({
          type: 'IMAGE_TOO_SMALL',
          activityId: id,
          actual: size,
          minimum: minReadable,
          message: `Image in "${id}" is ${size}px (< ${minReadable}px readable minimum)`,
        });
      }
    }
  }

  // Estimated height overflow from --activity-height
  const viewportH = input.viewportContentH ?? 1104;
  let estimatedTotal = 72; // instruction
  for (const act of activities) {
    const style = readAttr(act.attrs, 'style');
    const hMatch = style.match(/--activity-height\s*:\s*(\d+)px/i);
    const h = hMatch ? Number(hMatch[1]) : 200;
    estimatedTotal += h + 12;
  }
  if (activities.length && estimatedTotal > viewportH + 24) {
    issues.push({
      type: 'ACTIVITY_OVERFLOW',
      overflowPx: estimatedTotal - viewportH,
      actual: estimatedTotal,
      minimum: viewportH,
      message: `Estimated activities exceed content region by ${estimatedTotal - viewportH}px`,
    });
  }

  // Browser metrics (authoritative when present)
  const metrics = input.browserMetrics;
  if (metrics?.contentRegion && metrics.activities?.length) {
    const region = metrics.contentRegion;
    for (const act of metrics.activities) {
      if (act.bottom > region.bottom + 2) {
        issues.push({
          type: 'ACTIVITY_OVERFLOW',
          activityId: act.id,
          overflowPx: Math.round(act.bottom - region.bottom),
          message: `Activity "${act.id}" overflows content region`,
        });
      }
      if (act.top < region.top - 2 || act.bottom < region.top) {
        issues.push({
          type: 'CONTENT_OUTSIDE_REGION',
          activityId: act.id,
          message: `Activity "${act.id}" is outside #content-region`,
        });
      }
      if (
        act.imageCount === 0 &&
        act.textLength < 40 &&
        act.height > region.height * 0.28
      ) {
        issues.push({
          type: 'HUGE_WHITESPACE',
          activityId: act.id,
          actual: Math.round(act.height),
          message: `Activity "${act.id}" is mostly empty whitespace`,
        });
      }
    }
    // Overlaps + excessive inter-activity gaps
    const sorted = [...metrics.activities].sort((a, b) => a.top - b.top);
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].top < sorted[i - 1].bottom - 2) {
        issues.push({
          type: 'ACTIVITY_OVERLAP',
          activityId: sorted[i].id,
          message: `Activity "${sorted[i].id}" overlaps "${sorted[i - 1].id}"`,
          details: { priorActivityId: sorted[i - 1].id },
        });
      }
      const gap = sorted[i].top - sorted[i - 1].bottom;
      if (gap > 120) {
        issues.push({
          type: 'EXCESSIVE_WHITESPACE',
          activityId: sorted[i].id,
          actual: Math.round(gap),
          minimum: 120,
          message: `Excessive gap (${Math.round(gap)}px) before "${sorted[i].id}"`,
          details: {
            priorActivityId: sorted[i - 1].id,
            gapBeforeNextActivity: Math.round(gap),
          },
        });
      }
    }
    // Trailing blank region under last activity
    if (sorted.length) {
      const last = sorted[sorted.length - 1];
      const trailing = region.bottom - last.bottom;
      if (trailing > region.height * 0.35 && last.height < region.height * 0.35) {
        issues.push({
          type: 'EXCESSIVE_WHITESPACE',
          activityId: last.id,
          actual: Math.round(trailing),
          message: `Large unused region (${Math.round(trailing)}px) below last activity`,
        });
      }
    }
  }
  if (metrics?.images?.length && metrics.contentRegion) {
    for (const img of metrics.images) {
      const act = metrics.activities?.find((a) => a.id === img.activityId);
      const imgCount = act?.imageCount ?? 2;
      const minReadable = minimumReadableImageSize(imgCount);
      const size = Math.min(img.width, img.height);
      if (size + 0.5 < minReadable) {
        issues.push({
          type: 'IMAGE_TOO_SMALL',
          activityId: img.activityId,
          actual: Math.round(size),
          minimum: minReadable,
          message: `Rendered image too small (${Math.round(size)}px)`,
        });
      }
      if (act && img.bottom > act.bottom + 2) {
        issues.push({
          type: 'IMAGE_OVERFLOW',
          activityId: img.activityId,
          overflowPx: Math.round(img.bottom - act.bottom),
          message: `Image overflows its activity`,
        });
      }
      if (img.bottom > metrics.contentRegion.bottom + 2) {
        issues.push({
          type: 'CONTENT_OUTSIDE_REGION',
          activityId: img.activityId,
          message: `Image escapes #content-region`,
        });
      }
    }
  }

  // Matching layout structural check
  for (const act of activities) {
    const id =
      readAttr(act.attrs, 'data-activity-id') ||
      readAttr(act.attrs, 'id') ||
      'unknown';
    const type = readAttr(act.attrs, 'data-activity-type').toLowerCase();
    const layout = readAttr(act.attrs, 'data-layout').toLowerCase();
    if (/match|connect/i.test(type) || layout.startsWith('matching')) {
      const hasMatchArea = /\bws-match-area\b/i.test(act.inner);
      const hasRows = /\bws-match-row\b/i.test(act.inner);
      if (!hasMatchArea || !hasRows) {
        issues.push({
          type: 'INVALID_MATCHING_LAYOUT',
          activityId: id,
          message: `Matching activity "${id}" is missing aligned match rows`,
        });
      }
    }
    if (/color/i.test(type)) {
      // Soft diagnostic: coloring without outline role markers in queries is checked at model layer
      if (!/\boutline\b|line\s*art|ws-img-box/i.test(act.inner)) {
        issues.push({
          type: 'INVALID_ASSET_FOR_ACTIVITY',
          activityId: id,
          message: `Color activity "${id}" may lack outline-compatible assets`,
        });
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Playwright page.evaluate body — returns UniversalBrowserLayoutMetrics.
 * Keep as a serializable function string for provider-independent use.
 */
export function measureUniversalLayoutInBrowser(): UniversalBrowserLayoutMetrics {
  const regionEl = document.querySelector('#content-region');
  if (!regionEl) {
    return {};
  }
  const regionBox = regionEl.getBoundingClientRect();
  const contentRegion = {
    top: regionBox.top,
    bottom: regionBox.bottom,
    height: regionBox.height,
    width: regionBox.width,
  };

  const activityEls = Array.from(
    regionEl.querySelectorAll('.ws-activity, .ws-section'),
  ) as HTMLElement[];
  const activities = activityEls.map((el, index) => {
    const box = el.getBoundingClientRect();
    const id =
      el.getAttribute('data-activity-id') ||
      el.getAttribute('id') ||
      `activity-${index + 1}`;
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return {
      id,
      top: box.top,
      bottom: box.bottom,
      height: box.height,
      width: box.width,
      imageCount: el.querySelectorAll('img.worksheet-image, .ws-img-box').length,
      textLength: text.length,
    };
  });

  const images = (
    Array.from(
      regionEl.querySelectorAll('img.worksheet-image, .ws-img-box'),
    ) as HTMLElement[]
  ).map((el) => {
    const box = el.getBoundingClientRect();
    const parent = el.closest('.ws-activity, .ws-section') as HTMLElement | null;
    const activityId =
      parent?.getAttribute('data-activity-id') ||
      parent?.getAttribute('id') ||
      undefined;
    return {
      activityId,
      width: box.width,
      height: box.height,
      top: box.top,
      bottom: box.bottom,
    };
  });

  return { contentRegion, activities, images };
}
