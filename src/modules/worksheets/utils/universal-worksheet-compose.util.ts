/**
 * Universal worksheet compositor.
 *
 * Parse LLM JSON/HTML → UniversalWorksheetModel → allocate space → emit
 * deterministic semantic HTML. The LLM must not own pixel layout.
 */

import { resolveUniversalActivityPolicy } from './universal-activity-policy.util';
import {
  allocateUniversalPageSpace,
  estimateActivityLayoutRequirement,
  estimateImageGrid,
  UNIVERSAL_VIEWPORT_CONTENT_H,
  UNIVERSAL_VIEWPORT_CONTENT_W,
  type UniversalActivityLayoutAllocation,
  type UniversalDynamicLayoutPlan,
} from './universal-dynamic-layout.util';
import {
  inferPreferredLayout,
  isColoringCompatibleQuery,
  normalizeActivityType,
  type UniversalActivityItem,
  type UniversalActivityModel,
  type UniversalImageModel,
  type UniversalLayoutPrimitive,
  type UniversalWorksheetModel,
} from './universal-worksheet.model';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown, max = 220): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
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

function scrubTitle(text: string): string {
  return readString(text, 80).replace(/[!?]+/g, '').trim();
}

function buildSignature(
  type: string,
  title: string,
  instruction: string,
  imageCount: number,
  layout: string,
  imageIndexes: number[] = [],
): string {
  const rawText = `${title} ${instruction}`
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Ignore placeholder titles like "activity 1" so distinct image sets don't collapse
  const text = /^activity\s*\d*$/i.test(rawText)
    ? ''
    : rawText.slice(0, 64);
  const bucket =
    imageCount <= 0 ? '0i' : imageCount <= 2 ? 'few-i' : imageCount <= 4 ? 'mid-i' : 'many-i';
  const indexKey = imageIndexes.length
    ? imageIndexes.slice().sort((a, b) => a - b).join(',')
    : '';
  return `${type}|${layout}|${bucket}|${indexKey}|${text}`;
}

function signaturesNearDuplicate(a: string, b: string): boolean {
  if (a === b) return true;
  const [typeA, layoutA, bucketA, indexA = '', textA = ''] = a.split('|');
  const [typeB, layoutB, bucketB, indexB = '', textB = ''] = b.split('|');
  if (typeA !== typeB) return false;
  // Distinct image sets are not duplicates
  if (indexA && indexB && indexA !== indexB) return false;
  if (textA && textB) {
    if (textA === textB) return true;
    const shorter = textA.length <= textB.length ? textA : textB;
    const longer = textA.length <= textB.length ? textB : textA;
    if (longer.includes(shorter) && shorter.length >= 10) return true;
    if (layoutA === layoutB && bucketA === bucketB) {
      const wa = new Set(textA.split(/\s+/).filter((w) => w.length > 2));
      const wb = new Set(textB.split(/\s+/).filter((w) => w.length > 2));
      if (wa.size && wb.size) {
        let overlap = 0;
        for (const w of wa) if (wb.has(w)) overlap += 1;
        if (overlap / Math.min(wa.size, wb.size) >= 0.8) return true;
      }
    }
  }
  // No usable instruction/title: only duplicate when type+layout+indexes match
  if (!textA && !textB && layoutA === layoutB && indexA === indexB && indexA) {
    return true;
  }
  return false;
}

function collectImageIndexes(act: {
  items: UniversalActivityItem[];
  leftItems?: UniversalActivityItem[];
  rightItems?: UniversalActivityItem[];
}): number[] {
  return [...act.items, ...(act.leftItems || []), ...(act.rightItems || [])]
    .map((i) => i.imageIndex)
    .filter((n): n is number => typeof n === 'number' && n >= 1);
}

function parseItem(raw: unknown): UniversalActivityItem | null {
  if (!isRecord(raw)) return null;
  const kindRaw = readString(raw.kind || raw.type, 24).toLowerCase();
  let kind: UniversalActivityItem['kind'] = 'image';
  if (kindRaw.includes('word') || kindRaw === 'label') kind = 'word';
  else if (kindRaw.includes('trace')) kind = 'trace';
  else if (kindRaw.includes('choice')) kind = 'choice';
  else if (kindRaw.includes('left')) kind = 'pair-left';
  else if (kindRaw.includes('right')) kind = 'pair-right';
  else if (kindRaw.includes('image') || kindRaw.includes('picture')) kind = 'image';

  const label = scrubTitle(readString(raw.label || raw.text || raw.word, 40));
  let imageIndex: number | undefined;
  const idx =
    Number(raw.imageIndex ?? raw.image_index ?? raw.imageN ?? raw.image_n) || 0;
  if (idx >= 1) imageIndex = idx;
  const token = readString(raw.imageToken || raw.token, 24);
  const tokenMatch = token.match(/IMAGE[_:]?(\d+)/i);
  if (tokenMatch) imageIndex = Number(tokenMatch[1]);

  const role = readString(raw.role, 24).toLowerCase() || undefined;
  return {
    kind,
    ...(label ? { label } : {}),
    ...(imageIndex ? { imageIndex } : {}),
    ...(role
      ? {
          role: role as UniversalActivityItem['role'],
        }
      : {}),
  };
}

function countImagesInItems(items: UniversalActivityItem[]): number {
  return items.filter((i) => typeof i.imageIndex === 'number' && i.imageIndex >= 1)
    .length;
}

function activityFromJson(
  raw: Record<string, unknown>,
  index: number,
): UniversalActivityModel | null {
  const id =
    readString(raw.id || raw.activityId || raw.activity_id, 48) ||
    `activity-${index + 1}`;
  const type = normalizeActivityType(
    readString(raw.type || raw.activityType || raw.activity_type, 40),
  );
  const title = scrubTitle(readString(raw.title || raw.heading, 80));
  const instruction = readString(raw.instruction || raw.prompt, 160);

  const items: UniversalActivityItem[] = [];
  if (Array.isArray(raw.items)) {
    for (const it of raw.items) {
      const parsed = parseItem(it);
      if (parsed) items.push(parsed);
    }
  }

  let leftItems: UniversalActivityItem[] | undefined;
  let rightItems: UniversalActivityItem[] | undefined;
  if (Array.isArray(raw.leftItems) || Array.isArray(raw.left_items)) {
    leftItems = [];
    for (const it of (raw.leftItems || raw.left_items) as unknown[]) {
      const parsed = parseItem(it);
      if (parsed) {
        parsed.kind = 'pair-left';
        leftItems.push(parsed);
      }
    }
  }
  if (Array.isArray(raw.rightItems) || Array.isArray(raw.right_items)) {
    rightItems = [];
    for (const it of (raw.rightItems || raw.right_items) as unknown[]) {
      const parsed = parseItem(it);
      if (parsed) {
        parsed.kind = 'pair-right';
        rightItems.push(parsed);
      }
    }
  }

  // Flat images[] on activity
  if (Array.isArray(raw.images)) {
    for (const img of raw.images) {
      if (!isRecord(img)) continue;
      const tokenM = readString(String(img.token ?? ''), 24).match(
        /IMAGE[_:]?(\d+)/i,
      );
      const imageIndex =
        Number(img.imageIndex ?? img.index) ||
        (tokenM ? Number(tokenM[1]) : 0);
      const label = scrubTitle(readString(img.label, 40));
      if (imageIndex >= 1) {
        items.push({
          kind: 'image',
          imageIndex,
          ...(label ? { label } : {}),
          role: (readString(img.role, 24) as UniversalActivityItem['role']) || 'unknown',
        });
      }
    }
  }

  const intentRaw = isRecord(raw.layoutIntent)
    ? raw.layoutIntent
    : isRecord(raw.layout_intent)
      ? raw.layout_intent
      : {};
  const imageCount =
    countImagesInItems(items) +
    countImagesInItems(leftItems || []) +
    countImagesInItems(rightItems || []);
  const hasMatchColumns = Boolean(
    (leftItems && leftItems.length) || (rightItems && rightItems.length),
  );
  const preferredLayout =
    (readString(intentRaw.preferredLayout || intentRaw.layout, 40) as UniversalLayoutPrimitive) ||
    inferPreferredLayout(type, imageCount, hasMatchColumns);

  // Skip empty shells
  const hasContent =
    imageCount > 0 ||
    items.some((i) => i.kind === 'trace' || i.kind === 'word' || i.label) ||
    Boolean(leftItems?.length || rightItems?.length);
  if (!hasContent && !title && !instruction) return null;

  const density =
    (readString(intentRaw.density, 20) as UniversalActivityModel['layoutIntent']['density']) ||
    'comfortable';
  const imageImportance =
    (readString(
      intentRaw.imageImportance || intentRaw.image_importance,
      16,
    ) as UniversalActivityModel['layoutIntent']['imageImportance']) ||
    (imageCount <= 1 ? 'high' : 'normal');

  return {
    id,
    type,
    title,
    instruction,
    items,
    ...(leftItems?.length ? { leftItems } : {}),
    ...(rightItems?.length ? { rightItems } : {}),
    layoutIntent: {
      preferredLayout,
      density,
      imageImportance,
    },
    imageCount,
    itemCount: items.length + (leftItems?.length || 0) + (rightItems?.length || 0),
    signature: buildSignature(
      type,
      title,
      instruction,
      imageCount,
      preferredLayout,
      [
        ...items,
        ...(leftItems || []),
        ...(rightItems || []),
      ]
        .map((i) => i.imageIndex)
        .filter((n): n is number => typeof n === 'number'),
    ),
  };
}

/**
 * Extract activities from legacy content_html when activities[] is absent.
 */
export function parseActivitiesFromHtml(
  html: string,
): UniversalActivityModel[] {
  if (!html?.trim()) return [];

  const blocks = splitTopLevelBlocks(html);
  const activities: UniversalActivityModel[] = [];

  const candidates = blocks.filter((block) => {
    if (/\bws-instruction\b/i.test(block.attrs)) return false;
    if (/\bws-activity\b|\bws-section\b/i.test(block.attrs)) return true;
    if (/border\s*:/i.test(block.attrs)) return true;
    if (block.tag === 'section' || block.tag === 'article') return true;
    return false;
  });

  const useBlocks =
    candidates.length > 0
      ? candidates
      : /\{\{\s*IMAGE/i.test(html)
        ? [{ tag: 'div', attrs: '', inner: html }]
        : [];

  useBlocks.forEach((block, index) => {
    const typeAttr = (block.attrs.match(
      /data-activity-type\s*=\s*["']([^"']+)["']/i,
    ) || [])[1];
    const idAttr = (block.attrs.match(
      /data-activity-id\s*=\s*["']([^"']+)["']/i,
    ) || [])[1];
    const type = normalizeActivityType(
      typeAttr ||
        (/trace/i.test(block.inner)
          ? 'trace'
          : /match|pair/i.test(block.inner)
            ? 'match'
            : /circle|tick/i.test(block.inner)
              ? 'circle'
              : /color|colour/i.test(block.inner)
                ? 'color'
                : 'identify'),
    );
    const titleMatch = block.inner.match(
      /<(?:h[1-4]|p|div)[^>]*class=["'][^"']*ws-activity-title[^"']*["'][^>]*>([\s\S]*?)<\/(?:h[1-4]|p|div)>/i,
    );
    const title =
      scrubTitle(
        (titleMatch?.[1] || '').replace(/<[^>]+>/g, ' ') ||
          (block.inner.match(/<(?:h[1-4]|strong)[^>]*>([\s\S]*?)<\//i)?.[1] || '')
            .replace(/<[^>]+>/g, ' '),
      ) || `Activity ${index + 1}`;

    const instructionMatch = block.inner.match(
      /class=["'][^"']*ws-activity-instruction[^"']*["'][^>]*>([\s\S]*?)</i,
    );
    const instruction = readString(
      (instructionMatch?.[1] || '').replace(/<[^>]+>/g, ' '),
      160,
    );

    const items: UniversalActivityItem[] = [];
    const tokenRe = /\{\{\s*IMAGE[_:]?(\d+)\s*\}\}/gi;
    let tm: RegExpExecArray | null;
    const seen = new Set<number>();
    while ((tm = tokenRe.exec(block.inner)) != null) {
      const n = Number(tm[1]);
      if (!Number.isFinite(n) || n < 1 || seen.has(n)) continue;
      seen.add(n);
      const window = block.inner.slice(
        Math.max(0, tm.index - 120),
        Math.min(block.inner.length, tm.index + 160),
      );
      const labelMatch = window.match(
        /data-(?:editable|field-path)=["']labels\[\d+\]["'][^>]*>([^<]+)</i,
      );
      const label = scrubTitle(labelMatch?.[1] || '');
      items.push({
        kind: 'image',
        imageIndex: n,
        ...(label ? { label } : {}),
        role: items.length === 0 ? 'primary' : 'option',
      });
    }

    const traceRe =
      /class=["'][^"']*ws-trace-word[^"']*["'][^>]*>([\s\S]*?)</gi;
    let tr: RegExpExecArray | null;
    while ((tr = traceRe.exec(block.inner)) != null) {
      const label = scrubTitle((tr[1] || '').replace(/<[^>]+>/g, ' '));
      if (label) items.push({ kind: 'trace', label });
    }

    let leftItems: UniversalActivityItem[] | undefined;
    let rightItems: UniversalActivityItem[] | undefined;
    if (/match|connect/i.test(type) && items.length >= 2) {
      const mid = Math.ceil(items.length / 2);
      leftItems = items.slice(0, mid).map((i) => ({ ...i, kind: 'pair-left' as const }));
      rightItems = items.slice(mid).map((i) => ({ ...i, kind: 'pair-right' as const }));
    }

    const imageCount =
      countImagesInItems(leftItems || items) +
      countImagesInItems(rightItems || []);
    const meaningful =
      imageCount > 0 ||
      items.some((i) => i.kind === 'trace' || Boolean(i.label));
    if (!meaningful) return;

    const preferredLayout = inferPreferredLayout(
      type,
      imageCount,
      Boolean(leftItems?.length),
    );
    activities.push({
      id: idAttr || `activity-${index + 1}`,
      type,
      title,
      instruction,
      items: leftItems ? [] : items,
      ...(leftItems ? { leftItems, rightItems } : {}),
      layoutIntent: {
        preferredLayout,
        density: 'comfortable',
        imageImportance: imageCount <= 1 ? 'high' : 'normal',
      },
      imageCount,
      itemCount: items.length,
      signature: buildSignature(
        type,
        title,
        instruction,
        imageCount,
        preferredLayout,
        [
          ...(leftItems || items),
          ...(rightItems || []),
        ]
          .map((i) => i.imageIndex)
          .filter((n): n is number => typeof n === 'number'),
      ),
    });
  });

  return activities;
}

type HtmlBlock = { tag: string; attrs: string; inner: string };

function findMatchingClose(html: string, tag: string, openEnd: number): number {
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

function splitTopLevelBlocks(html: string): HtmlBlock[] {
  const blocks: HtmlBlock[] = [];
  const s = html.trim();
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i += 1;
    if (i >= s.length) break;
    if (s[i] !== '<') {
      while (i < s.length && s[i] !== '<') i += 1;
      continue;
    }
    const openMatch = s.slice(i).match(/^<([a-zA-Z][\w-]*)\b([^>]*)>/);
    if (!openMatch) {
      i += 1;
      continue;
    }
    const tag = openMatch[1].toLowerCase();
    const attrs = openMatch[2] || '';
    const openTag = openMatch[0];
    const openEnd = i + openTag.length;
    if (/^(br|hr)$/i.test(tag) || /\/\s*>$/.test(openTag)) {
      i = openEnd;
      continue;
    }
    const closeAt = findMatchingClose(s, tag, openEnd);
    if (closeAt < 0) {
      i = openEnd;
      continue;
    }
    const closeMatch = s.slice(closeAt).match(new RegExp(`^</${tag}\\s*>`, 'i'));
    const closeLen = closeMatch ? closeMatch[0].length : tag.length + 3;
    blocks.push({
      tag,
      attrs,
      inner: s.slice(openEnd, closeAt),
    });
    i = closeAt + closeLen;
  }
  // Unwrap single wrapper stack
  if (blocks.length === 1) {
    const innerBlocks = splitTopLevelBlocks(blocks[0].inner);
    const activityLike = innerBlocks.filter(
      (b) =>
        /\bws-activity\b|\bws-section\b/i.test(b.attrs) ||
        /border\s*:/i.test(b.attrs) ||
        b.tag === 'section',
    );
    if (activityLike.length >= 2) return activityLike;
  }
  return blocks;
}

function parseImages(raw: unknown): UniversalImageModel[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((img) => {
      if (!isRecord(img)) return null;
      const imageQuery =
        readString(img.imageQuery || img.image_query, 120) ||
        'age appropriate educational illustration';
      const row: UniversalImageModel = { imageQuery };
      const role = readString(img.role, 24);
      if (role) row.role = role as UniversalImageModel['role'];
      const importance = readString(img.importance, 16);
      if (importance) {
        row.importance = importance as UniversalImageModel['importance'];
      }
      const activityId = readString(img.activityId || img.activity_id, 48);
      if (activityId) row.activityId = activityId;
      if (typeof img.assetId === 'string') row.assetId = img.assetId;
      if (typeof img.assetUrl === 'string') row.assetUrl = img.assetUrl;
      return row;
    })
    .filter(Boolean) as UniversalImageModel[];
}

/**
 * Rewrite color activities when image queries are not outline/line-art compatible.
 */
export function applyAssetCompatibility(
  model: UniversalWorksheetModel,
): UniversalWorksheetModel {
  const activities = model.activities.map((act) => {
    if (!/color/i.test(act.type)) return act;
    const indexes = [
      ...act.items,
      ...(act.leftItems || []),
      ...(act.rightItems || []),
    ]
      .map((i) => i.imageIndex)
      .filter((n): n is number => typeof n === 'number' && n >= 1);

    const queries = indexes.map((n) => model.images[n - 1]?.imageQuery || '');
    const allCompatible =
      queries.length > 0 && queries.every((q) => isColoringCompatibleQuery(q));
    if (allCompatible) {
      // Ensure queries stay outline-oriented
      return act;
    }

    // Deterministic rewrite: color → find (compatible with colored cartoon assets)
    const nextType = 'find';
    const title = act.title.replace(/colou?r/gi, 'Find').trim() || 'Find the picture';
    const instruction =
      act.instruction.replace(/colou?r\s+(in\s+)?/gi, 'find ').trim() ||
      'Find and point to the picture.';
    const preferredLayout = inferPreferredLayout(
      nextType,
      act.imageCount,
      Boolean(act.leftItems?.length),
    );
    return {
      ...act,
      type: nextType,
      title,
      instruction,
      layoutIntent: {
        ...act.layoutIntent,
        preferredLayout,
        imageImportance: 'high' as const,
      },
      signature: buildSignature(
        nextType,
        title,
        instruction,
        act.imageCount,
        preferredLayout,
        collectImageIndexes(act),
      ),
    };
  });

  // For remaining color activities, force outline queries
  const images = model.images.map((img, idx) => {
    const usedByColor = activities.some(
      (a) =>
        /color/i.test(a.type) &&
        [...a.items, ...(a.leftItems || []), ...(a.rightItems || [])].some(
          (it) => it.imageIndex === idx + 1,
        ),
    );
    if (!usedByColor) return img;
    if (isColoringCompatibleQuery(img.imageQuery)) return img;
    return {
      ...img,
      imageQuery: `${img.imageQuery} black and white outline line art for coloring`
        .trim()
        .slice(0, 120),
      role: 'outline' as const,
    };
  });

  return { ...model, activities, images };
}

export function dedupeActivityModels(
  activities: UniversalActivityModel[],
): UniversalActivityModel[] {
  const kept: UniversalActivityModel[] = [];
  for (const act of activities) {
    const dup = kept.find((k) =>
      signaturesNearDuplicate(k.signature, act.signature),
    );
    if (dup) {
      // Keep richer
      if (act.imageCount > dup.imageCount || act.itemCount > dup.itemCount) {
        const idx = kept.indexOf(dup);
        kept[idx] = act;
      }
      continue;
    }
    kept.push(act);
  }
  return kept;
}

export function enforceActivityCount(
  activities: UniversalActivityModel[],
  maxSections: number,
  targetSections: number,
): UniversalActivityModel[] {
  const nonEmpty = activities.filter(
    (a) =>
      a.imageCount > 0 ||
      a.items.some((i) => i.kind === 'trace' || Boolean(i.label)) ||
      (a.leftItems?.length ?? 0) > 0,
  );
  if (nonEmpty.length <= maxSections) {
    // Prefer target when weak fillers exist beyond target
    if (
      nonEmpty.length > targetSections &&
      targetSections < maxSections
    ) {
      const weak = nonEmpty.filter((a) => a.imageCount === 0 && a.itemCount < 2);
      if (weak.length > 0) {
        return nonEmpty
          .slice()
          .sort((a, b) => b.imageCount - a.imageCount || b.itemCount - a.itemCount)
          .slice(0, targetSections);
      }
    }
    return nonEmpty;
  }
  return nonEmpty
    .slice()
    .sort((a, b) => b.imageCount - a.imageCount || b.itemCount - a.itemCount)
    .slice(0, maxSections)
    .sort((a, b) => {
      // restore relative order by id number if possible
      const na = Number((a.id.match(/\d+/) || [])[0] || 0);
      const nb = Number((b.id.match(/\d+/) || [])[0] || 0);
      return na - nb;
    });
}

/**
 * Age 2–3: one activity must be rich enough to compose the page.
 * We do not invent unrelated activities; we upgrade layout intent + ensure
 * enough choice items when images exist.
 */
export function enrichSingleActivityForToddler(
  model: UniversalWorksheetModel,
  bandKey: string,
): UniversalWorksheetModel {
  if (bandKey !== '2-3' || model.activities.length !== 1) return model;
  const act = model.activities[0];
  const imageIndexes = model.images.map((_, i) => i + 1);

  // If only 1 image but more images[] exist unused, attach as choices when
  // the interaction is a find/choose style (never silently keep orphan retrievals).
  const used = new Set(
    [...act.items, ...(act.leftItems || []), ...(act.rightItems || [])]
      .map((i) => i.imageIndex)
      .filter(Boolean),
  );
  const unused = imageIndexes.filter((n) => !used.has(n));
  let items = [...act.items];
  if (
    act.imageCount <= 1 &&
    unused.length > 0 &&
    /find|choose|circle|point|identify/i.test(act.type)
  ) {
    for (const n of unused.slice(0, 3)) {
      items.push({ kind: 'choice', imageIndex: n, role: 'option' });
    }
  }

  // Promote layout to large-picture or choice-grid
  const imageCount = countImagesInItems(items);
  let preferredLayout = act.layoutIntent.preferredLayout;
  if (imageCount <= 1) preferredLayout = 'large-picture';
  else if (imageCount <= 3) preferredLayout = 'choice-grid';
  else preferredLayout = 'image-grid';

  const next: UniversalActivityModel = {
    ...act,
    items,
    imageCount,
    itemCount: items.length,
    layoutIntent: {
      preferredLayout,
      density: 'spacious',
      imageImportance: 'high',
    },
    signature: buildSignature(
      act.type,
      act.title,
      act.instruction,
      imageCount,
      preferredLayout,
      items
        .map((i) => i.imageIndex)
        .filter((n): n is number => typeof n === 'number'),
    ),
  };

  return { ...model, activities: [next] };
}

export function buildUniversalWorksheetModel(
  structure: Record<string, unknown>,
  options?: { age?: number | null; ageGroup?: string | null; grade?: string | null },
): UniversalWorksheetModel {
  const policy = resolveUniversalActivityPolicy({
    age: options?.age ?? undefined,
    ageGroup: options?.ageGroup ?? undefined,
    grade: options?.grade ?? undefined,
  });

  const main_topic =
    scrubTitle(
      readString(structure.main_topic, 80) ||
        readString(structure.topic, 80) ||
        readString(structure.title, 80),
    ) || 'Worksheet';
  let sub_topic =
    scrubTitle(
      readString(structure.sub_topic, 80) ||
        readString(structure.badge_label, 80) ||
        'Practice',
    ) || 'Practice';
  // Skill labels must never be questions
  if (
    sub_topic.includes('?') ||
    /\b(where|what|how|why|who|when)\b/i.test(sub_topic)
  ) {
    sub_topic = 'Practice';
  }
  const instruction_text = readString(
    structure.instruction_text || structure.instruction,
    220,
  );

  let activities: UniversalActivityModel[] = [];
  if (Array.isArray(structure.activities)) {
    structure.activities.forEach((raw, i) => {
      if (!isRecord(raw)) return;
      const act = activityFromJson(raw, i);
      if (act) activities.push(act);
    });
  }

  const contentHtml =
    typeof structure.content_html === 'string'
      ? structure.content_html
      : typeof structure.contentHtml === 'string'
        ? structure.contentHtml
        : '';

  if (!activities.length && contentHtml) {
    activities = parseActivitiesFromHtml(contentHtml);
  }

  // Last resort: synthesize one activity from images[] only when HTML is empty
  // or still references IMAGE tokens (never keep orphan queries for empty shells).
  const images = parseImages(structure.images);
  const htmlHasImageTokens = /\{\{\s*IMAGE[_:]?\d+\s*\}\}/i.test(contentHtml);
  if (
    !activities.length &&
    images.length &&
    (!contentHtml.trim() || htmlHasImageTokens)
  ) {
    const items: UniversalActivityItem[] = images.map((_, i) => ({
      kind: 'image' as const,
      imageIndex: i + 1,
      role: i === 0 ? 'primary' : 'option',
    }));
    const preferredLayout = inferPreferredLayout('identify', items.length, false);
    activities = [
      {
        id: 'activity-1',
        type: 'identify',
        title: '',
        instruction: instruction_text || 'Look at the pictures.',
        items,
        layoutIntent: {
          preferredLayout,
          density: 'comfortable',
          imageImportance: 'high',
        },
        imageCount: items.length,
        itemCount: items.length,
        signature: buildSignature(
          'identify',
          '',
          instruction_text || 'Look at the pictures.',
          items.length,
          preferredLayout,
          items.map((i) => i.imageIndex!).filter(Boolean),
        ),
      },
    ];
  }

  activities = dedupeActivityModels(activities);
  activities = enforceActivityCount(
    activities,
    policy.maxSections,
    policy.targetSections,
  );

  // Re-id densely
  activities = activities.map((a, i) => ({
    ...a,
    id: a.id || `activity-${i + 1}`,
  }));

  let labels = Array.isArray(structure.labels)
    ? structure.labels.map((v) => scrubTitle(readString(v, 80))).filter(Boolean)
    : [];

  let model: UniversalWorksheetModel = {
    worksheet_type: 'universal_template',
    main_topic,
    sub_topic,
    instruction_text,
    activities,
    labels,
    images,
  };

  model = applyAssetCompatibility(model);
  model = enrichSingleActivityForToddler(model, policy.bandKey);
  model = remapModelImagesDense(model);

  // Collect labels from items if missing
  if (!model.labels.length) {
    const collected: string[] = [];
    for (const act of model.activities) {
      for (const it of [
        ...act.items,
        ...(act.leftItems || []),
        ...(act.rightItems || []),
      ]) {
        if (it.label) collected.push(it.label);
      }
    }
    model = { ...model, labels: collected };
  }

  return model;
}

/** Remap image indexes to dense 1..k and drop unused images. */
export function remapModelImagesDense(
  model: UniversalWorksheetModel,
): UniversalWorksheetModel {
  const used = new Set<number>();
  for (const act of model.activities) {
    for (const it of [
      ...act.items,
      ...(act.leftItems || []),
      ...(act.rightItems || []),
    ]) {
      if (typeof it.imageIndex === 'number' && it.imageIndex >= 1) {
        used.add(it.imageIndex);
      }
    }
  }
  const ordered = [...used].sort((a, b) => a - b).slice(0, 10);
  const remap = new Map<number, number>();
  ordered.forEach((n, i) => remap.set(n, i + 1));

  const images = ordered.map((n) => {
    const prior = model.images[n - 1];
    return (
      prior || {
        imageQuery: `age appropriate educational illustration ${n}`,
      }
    );
  });

  const mapItems = (items: UniversalActivityItem[]) =>
    items.map((it) =>
      typeof it.imageIndex === 'number' && remap.has(it.imageIndex)
        ? { ...it, imageIndex: remap.get(it.imageIndex) }
        : it,
    );

  const activities = model.activities.map((act) => ({
    ...act,
    items: mapItems(act.items),
    ...(act.leftItems ? { leftItems: mapItems(act.leftItems) } : {}),
    ...(act.rightItems ? { rightItems: mapItems(act.rightItems) } : {}),
    imageCount: countImagesInItems(mapItems(act.items)) +
      countImagesInItems(mapItems(act.leftItems || [])) +
      countImagesInItems(mapItems(act.rightItems || [])),
  }));

  return { ...model, activities, images };
}

export function planUniversalComposition(
  model: UniversalWorksheetModel,
  options?: { viewportContentH?: number; viewportContentW?: number },
): UniversalDynamicLayoutPlan {
  const viewportH = options?.viewportContentH ?? UNIVERSAL_VIEWPORT_CONTENT_H;
  const requirements = model.activities.map((act) => {
    const layout = act.layoutIntent.preferredLayout;
    const isMatch =
      layout.startsWith('matching') || /match|connect/i.test(act.type);
    const isTrace = layout === 'trace-row' || /trace/i.test(act.type);
    const isLarge =
      layout === 'large-picture' ||
      layout === 'single-focus' ||
      act.layoutIntent.imageImportance === 'high';

    const pairCount = isMatch
      ? Math.max(
          act.leftItems?.length || 0,
          act.rightItems?.length || 0,
          Math.ceil(Math.max(1, act.items.length) / 2),
          1,
        )
      : 0;

    // Matching image count = left images (or half of flat items)
    const matchImages = isMatch
      ? Math.max(
          (act.leftItems || []).filter((i) => i.imageIndex).length,
          Math.ceil(act.imageCount / 2),
          pairCount,
        )
      : act.imageCount;

    const base = estimateActivityLayoutRequirement({
      activityId: act.id,
      activityType: act.type,
      imageCount: isMatch ? matchImages : Math.max(act.imageCount, 0),
      pairCount: isMatch ? pairCount : undefined,
      hasLabel: [...act.items, ...(act.leftItems || []), ...(act.rightItems || [])].some(
        (i) => Boolean(i.label),
      ),
      hasTrace: isTrace || act.items.some((i) => i.kind === 'trace'),
      hasMatch: isMatch,
      hasChoices:
        /choice|circle|find|choose/i.test(act.type) || layout === 'choice-grid',
      textLength: `${act.title} ${act.instruction}`.length,
      imageRole: isLarge ? 'primary' : isMatch ? 'matching' : 'unknown',
      viewportW: options?.viewportContentW ?? UNIVERSAL_VIEWPORT_CONTENT_W,
    });

    if (model.activities.length === 1 && act.layoutIntent.density === 'spacious') {
      return {
        ...base,
        idealHeight: Math.min(base.maxHeight + 60, Math.floor(viewportH * 0.7)),
        maxHeight: Math.min(base.maxHeight + 100, Math.floor(viewportH * 0.82)),
        importanceWeight: base.importanceWeight + 0.4,
        idealImageSize: Math.min(260, base.idealImageSize + 20),
        maxImageSize: Math.min(260, base.maxImageSize + 20),
      };
    }

    if (act.imageCount === 1 && !isMatch) {
      return {
        ...base,
        maxImageSize: Math.min(base.maxImageSize, 240),
        maxHeight: Math.min(base.maxHeight, 460),
      };
    }

    return base;
  });

  return allocateUniversalPageSpace({
    requirements,
    viewportContentH: viewportH,
    instructionHeight: model.instruction_text ? 72 : 0,
    interActivityGap: model.activities.length <= 2 ? 16 : 12,
    viewportContentW: options?.viewportContentW,
  });
}
function labelSpan(label: string, labelIndex: number): string {
  return (
    `<span class="ws-label" data-editable="labels[${labelIndex}]" ` +
    `data-field-path="labels[${labelIndex}]">${escapeText(label)}</span>`
  );
}

function imgBox(imageIndex: number, size: number): string {
  return (
    `<div class="ws-img-box" style="width:${size}px;height:${size}px;` +
    `flex:0 0 auto;aspect-ratio:1/1;">{{IMAGE_${imageIndex}}}</div>`
  );
}

function pictureCard(
  item: UniversalActivityItem,
  size: number,
  labelIndex: { n: number },
): string {
  const parts: string[] = [];
  if (item.imageIndex) parts.push(imgBox(item.imageIndex, size));
  if (item.label) {
    parts.push(
      `<div class="ws-card-label" style="flex:0 0 auto;width:100%;text-align:center;margin-top:4px;min-height:24px;line-height:1.2;">` +
        labelSpan(item.label, labelIndex.n) +
        `</div>`,
    );
    labelIndex.n += 1;
  } else if (item.imageIndex) {
    // Reserve label band so cards without labels still align with labeled peers
    parts.push(
      `<div class="ws-card-label" style="flex:0 0 auto;width:100%;min-height:24px;"></div>`,
    );
  }
  return (
    `<div class="ws-picture-card ws-item" style="flex:0 0 auto;height:auto;display:flex;` +
    `flex-direction:column;align-items:center;justify-content:flex-start;padding:6px 8px;` +
    `box-sizing:border-box;">${parts.join('')}</div>`
  );
}

function emitGrid(
  items: UniversalActivityItem[],
  columns: number,
  size: number,
  gap: number,
  labelIndex: { n: number },
  className: string,
): string {
  const cells = items.map((it) => pictureCard(it, size, labelIndex)).join('');
  return (
    `<div class="${className}" data-ws-layout="grid" style="display:grid;` +
    `grid-template-columns:repeat(${Math.max(1, columns)},minmax(0,1fr));` +
    `gap:${gap}px;width:100%;align-items:start;justify-items:center;">${cells}</div>`
  );
}

function emitMatchingColumns(
  left: UniversalActivityItem[],
  right: UniversalActivityItem[],
  size: number,
  gap: number,
  labelIndex: { n: number },
): string {
  const rows = Math.max(left.length, right.length, 1);
  const rowHtml: string[] = [];
  for (let i = 0; i < rows; i += 1) {
    const L = left[i];
    const R = right[i];
    // Always emit a full row slot so pairs never collapse
    rowHtml.push(
      `<div class="ws-match-row" data-ws-layout="matching-row" style="display:grid;` +
        `grid-template-columns:minmax(0,1fr) 48px minmax(0,1fr);gap:${gap}px;` +
        `align-items:center;width:100%;flex:0 0 auto;min-height:${size + 32}px;">` +
        `<div class="ws-match-left" style="display:flex;justify-content:center;align-items:center;">` +
        `${L ? pictureCard(L, size, labelIndex) : ''}</div>` +
        `<div class="ws-match-connector" aria-hidden="true" style="height:2px;width:100%;` +
        `background:#85cbf4;opacity:0.55;flex:0 0 auto;"></div>` +
        `<div class="ws-match-right" style="display:flex;justify-content:center;align-items:center;">` +
        `${R ? pictureCard(R, size, labelIndex) : ''}</div>` +
        `</div>`,
    );
  }
  return (
    `<div class="ws-match-area" data-ws-layout="matching" style="display:flex;` +
    `flex-direction:column;gap:${gap}px;width:100%;flex:0 0 auto;">${rowHtml.join('')}</div>`
  );
}

function emitTraceRow(items: UniversalActivityItem[], labelIndex: { n: number }): string {
  const words = items
    .filter((i) => i.kind === 'trace' || i.label)
    .map((i) => {
      const label = i.label || 'WORD';
      const html =
        `<div class="ws-trace-word" style="flex:0 0 auto;padding:10px 16px;border:2px dashed #6d28d9;` +
        `border-radius:12px;letter-spacing:0.35em;font-size:28px;font-weight:700;color:#2a1b4a;">` +
        labelSpan(label, labelIndex.n) +
        `</div>`;
      labelIndex.n += 1;
      return html;
    });
  return `<div class="ws-row ws-trace-row" style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;">${words.join('')}</div>`;
}

/**
 * Exactly ONE learner-facing question per activity.
 * Prefer actionable instruction; fall back to title; never emit both.
 */
export function resolveActivityQuestion(act: {
  title?: string;
  instruction?: string;
  type?: string;
}): string {
  const instruction = readString(act.instruction, 120);
  const title = scrubTitle(readString(act.title, 80));
  const looksLikeSectionName = (text: string) =>
    /^(?:\d+[.)]\s*)?(look and (?:name|say|learn|point)|meet\b|find the|match (?:the |two |sea )?|count the|trace\b)/i.test(
      text,
    ) && text.split(/\s+/).length <= 5;

  if (instruction) {
    // If instruction is weak and title is a better question, prefer title only when
    // title is not a catalog-style section name.
    if (
      instruction.length < 8 &&
      title &&
      !looksLikeSectionName(title) &&
      title.length > instruction.length
    ) {
      return title;
    }
    return instruction;
  }
  if (title && !looksLikeSectionName(title)) return title;
  if (title) return title;
  const type = (act.type || 'look').toLowerCase();
  if (/match|connect|pair/.test(type)) return 'Match each pair.';
  if (/trace/.test(type)) return 'Trace the word.';
  if (/count/.test(type)) return 'Count and circle the answer.';
  if (/circle|choose|odd/.test(type)) return 'Circle the correct pictures.';
  if (/find|point|recognize|identify|look/.test(type)) return 'Point to the correct picture.';
  return 'Complete the activity.';
}

/**
 * Emit deterministic semantic HTML from model + layout plan.
 * Strips LLM pixel decisions; compositor owns sizing.
 * Activity height hugs content — overflow:hidden only after fit is guaranteed.
 */
export function composeUniversalContentHtml(
  model: UniversalWorksheetModel,
  plan: UniversalDynamicLayoutPlan,
): string {
  const byId = new Map(plan.allocations.map((a) => [a.activityId, a]));
  const labelIndex = { n: 0 };
  const parts: string[] = [];
  const accent = ['#85cbf4', '#fecd59', '#67bd47', '#f03a3e', '#6d28d9'];

  model.activities.forEach((act, index) => {
    const alloc: UniversalActivityLayoutAllocation | undefined =
      byId.get(act.id) || plan.allocations[index];
    const height = alloc?.allocatedHeight ?? alloc?.contentHeight ?? 240;
    const cols = alloc?.gridColumns ?? 2;
    const gap = alloc?.imageGap ?? 10;
    // Width-safe cap so a row of N images never exceeds the content viewport
    const widthCap = Math.max(
      72,
      Math.floor(
        (UNIVERSAL_VIEWPORT_CONTENT_W - 40 - gap * Math.max(0, cols - 1)) /
          Math.max(1, cols),
      ) - 16,
    );
    const imageSize = Math.min(alloc?.imageSize ?? 140, widthCap);
    const border = accent[index % accent.length];

    let body = '';
    const layout = act.layoutIntent.preferredLayout;

    if (
      (layout === 'matching-columns' ||
        layout === 'matching-grid' ||
        /match|connect/i.test(act.type)) &&
      (act.leftItems?.length || act.rightItems?.length || act.items.length >= 2)
    ) {
      const left =
        act.leftItems ||
        act.items.slice(0, Math.ceil(act.items.length / 2));
      const right =
        act.rightItems ||
        act.items.slice(Math.ceil(act.items.length / 2));
      // Matching uses its own fitted size (may be smaller than recognition images)
      body = emitMatchingColumns(left, right, imageSize, gap, labelIndex);
    } else if (layout === 'trace-row' || /trace/i.test(act.type)) {
      const traceItems = act.items.filter((i) => i.kind === 'trace' || i.label);
      body = emitTraceRow(traceItems.length ? traceItems : act.items, labelIndex);
      const imgs = act.items.filter((i) => i.imageIndex);
      if (imgs.length) {
        const grid = estimateImageGrid(imgs.length, act.type);
        body =
          emitGrid(
            imgs,
            grid.columns,
            Math.min(imageSize, 140),
            gap,
            labelIndex,
            'ws-image-grid',
          ) + body;
      }
    } else {
      const items =
        act.items.length > 0
          ? act.items
          : [...(act.leftItems || []), ...(act.rightItems || [])];
      const imgItems = items.filter((i) => i.imageIndex || i.kind === 'choice');
      const className =
        layout === 'choice-grid'
          ? 'ws-choice-group ws-image-grid'
          : layout === 'image-row'
            ? 'ws-row ws-image-grid'
            : 'ws-image-grid';
      const useCols =
        layout === 'image-row'
          ? Math.max(imgItems.length, 1)
          : layout === 'large-picture' || layout === 'single-focus'
            ? 1
            : cols;
      body = emitGrid(
        imgItems.length ? imgItems : items,
        useCols,
        imageSize,
        gap,
        labelIndex,
        className,
      );
    }

    const question = resolveActivityQuestion(act);
    const questionHtml = question
      ? `<p class="ws-activity-instruction" data-ws-role="question" style="margin:0 0 4px 0;flex:0 0 auto;font-size:18px;font-weight:700;line-height:1.3;color:#2a1b4a;">${escapeText(question)}</p>`
      : '';

    // height:auto + overflow:visible — never clip labels/questions.
    // --activity-height is a min budget for page fill, not a hard clip box.
    const hugH = Math.max(height, alloc?.contentHeight ?? height);
    parts.push(
      `<section class="ws-activity ws-section" data-activity-id="${escapeAttr(act.id)}" ` +
        `data-activity-type="${escapeAttr(act.type)}" data-layout="${escapeAttr(layout)}" ` +
        `data-image-count="${act.imageCount}" data-pair-count="${alloc?.pairCount ?? 0}" ` +
        `style="flex:0 0 auto;width:100%;height:auto;min-height:${hugH}px;max-height:none;` +
        `--activity-height:${hugH}px;--image-size:${imageSize}px;--image-gap:${gap}px;` +
        `--grid-columns:${cols};box-sizing:border-box;overflow:visible;` +
        `margin:0;padding:12px 14px 16px;border:2px solid ${border};border-radius:14px;` +
        `background:#ffffff;display:flex;flex-direction:column;gap:10px;justify-content:flex-start;">` +
        `${questionHtml}${body}</section>`,
    );
  });

  return parts.join('');
}

/**
 * Full composition: model → plan → HTML + synced images/labels.
 */
export function composeUniversalWorksheet(
  structure: Record<string, unknown>,
  options?: {
    age?: number | null;
    ageGroup?: string | null;
    grade?: string | null;
    viewportContentH?: number;
  },
): {
  model: UniversalWorksheetModel;
  plan: UniversalDynamicLayoutPlan;
  content_html: string;
  images: UniversalImageModel[];
  labels: string[];
} {
  const model = buildUniversalWorksheetModel(structure, options);
  const plan = planUniversalComposition(model, {
    viewportContentH: options?.viewportContentH,
  });
  const content_html = composeUniversalContentHtml(model, plan);

  // Rebuild labels from emitted order preference: model.labels if present
  const labels =
    model.labels.length > 0
      ? model.labels
      : (() => {
          const out: string[] = [];
          for (const act of model.activities) {
            for (const it of [
              ...act.items,
              ...(act.leftItems || []),
              ...(act.rightItems || []),
            ]) {
              if (it.label) out.push(it.label);
            }
          }
          return out;
        })();

  return {
    model,
    plan,
    content_html,
    images: model.images,
    labels,
  };
}
