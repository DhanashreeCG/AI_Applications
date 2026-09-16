/**
 * Deterministic page-space allocator for universal_template.
 * LLM designs semantic HTML; this engine owns physical sizing.
 *
 * Core rule: IMAGE SIZE and ACTIVITY HEIGHT adapt to each activity's
 * required content. Never force equal sizes. Never clip required items.
 */

export const UNIVERSAL_VIEWPORT_CONTENT_W = 936;
export const UNIVERSAL_VIEWPORT_CONTENT_H = 1104;

export type UniversalImageImportance = 'high' | 'normal' | 'low';
export type UniversalImageRole =
  | 'primary'
  | 'option'
  | 'matching'
  | 'decorative'
  | 'unknown';

export type UniversalActivityLayoutRequirement = {
  activityId: string;
  activityType: string;
  imageCount: number;
  /** Matching pair rows (when hasMatch). */
  pairCount: number;
  hasLabel: boolean;
  hasTrace: boolean;
  hasMatch: boolean;
  hasChoices: boolean;
  importanceWeight: number;
  minHeight: number;
  idealHeight: number;
  maxHeight: number;
  minImageSize: number;
  idealImageSize: number;
  maxImageSize: number;
  gridColumns: number;
  gridRows: number;
};

export type UniversalActivityLayoutAllocation = UniversalActivityLayoutRequirement & {
  allocatedHeight: number;
  /** Content-hugging height used for borders (may be < allocated when leftover unused). */
  contentHeight: number;
  imageSize: number;
  imageGap: number;
  activityGap: number;
};

export type UniversalDynamicLayoutPlan = {
  viewportContentH: number;
  availableHeight: number;
  instructionHeight: number;
  interActivityGap: number;
  allocations: UniversalActivityLayoutAllocation[];
};

const INSTRUCTION_ESTIMATE_PX = 72;
/** One question line + internal gaps + top/bottom padding (no separate title). */
const ACTIVITY_QUESTION_PX = 36;
const ACTIVITY_PAD_PX = 32;
const ACTIVITY_CHROME_PX = ACTIVITY_QUESTION_PX + ACTIVITY_PAD_PX; // ~68
const LABEL_ROW_PX = 32;
const DEFAULT_GAP_PX = 10;
const ABSOLUTE_MIN_IMAGE_PX = 72;
/** Soft ceiling — single-activity pages may use up to this when width allows. */
const ABSOLUTE_MAX_IMAGE_PX = 280;
const MATCH_CONNECTOR_W = 48;
const ACTIVITY_INNER_PAD_X = 40; // section pad + card pad — keep grids inside viewport width
/** Multi-activity pages: leave a small margin so we never scrollbar. */
const PAGE_FILL_TARGET = 0.86;
/** Age 2–3 / single activity: fill almost the whole content viewport. */
const SINGLE_ACTIVITY_FILL_TARGET = 0.94;
const CARD_PAD_X = 16; // ws-picture-card horizontal padding budget per cell

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Evaluate candidate grid arrangements; pick the one with the largest
 * readable square cells that still fit.
 */
export function chooseBestGridLayout(input: {
  itemCount: number;
  availableWidth: number;
  availableHeight: number;
  labelHeight?: number;
  gap?: number;
  minImage?: number;
  maxImage?: number;
  preferColumns?: number;
}): { columns: number; rows: number; imageSize: number } {
  const n = Math.max(1, input.itemCount);
  const gap = input.gap ?? DEFAULT_GAP_PX;
  const labelH = input.labelHeight ?? LABEL_ROW_PX;
  const minImg = input.minImage ?? ABSOLUTE_MIN_IMAGE_PX;
  const maxImg = input.maxImage ?? ABSOLUTE_MAX_IMAGE_PX;
  const availW = Math.max(80, input.availableWidth);
  const availH = Math.max(80, input.availableHeight);

  const candidates = new Set<number>();
  if (input.preferColumns) candidates.add(input.preferColumns);
  candidates.add(1);
  if (n >= 2) candidates.add(2);
  if (n >= 3) candidates.add(3);
  if (n >= 4) candidates.add(4);
  candidates.add(Math.min(n, Math.max(1, Math.floor(availW / (minImg + gap)))));

  let best = { columns: 1, rows: n, imageSize: minImg };
  let bestScore = -1;

  for (const columns of candidates) {
    const cols = clamp(columns, 1, n);
    const rows = Math.ceil(n / cols);
    const cellW = Math.floor((availW - gap * Math.max(0, cols - 1)) / cols);
    const cellH = Math.floor(
      (availH - gap * Math.max(0, rows - 1) - rows * labelH) / rows,
    );
    const size = clamp(Math.min(cellW, cellH), minImg, maxImg);
    // Prefer larger images; slight preference for fewer rows (less stacked)
    const score = size * 10 - rows * 3 + (cols === input.preferColumns ? 5 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = { columns: cols, rows, imageSize: size };
    }
  }

  return best;
}

/**
 * Fit a square image size so ALL required rows remain visible.
 */
export function fitActivityImageSize(input: {
  availableWidth: number;
  availableHeight: number;
  columns: number;
  rows: number;
  labelHeight?: number;
  gap?: number;
  minImage?: number;
  maxImage?: number;
}): number {
  const gap = input.gap ?? DEFAULT_GAP_PX;
  const labelH = input.labelHeight ?? LABEL_ROW_PX;
  const cols = Math.max(1, input.columns);
  const rows = Math.max(1, input.rows);
  const minImg = input.minImage ?? ABSOLUTE_MIN_IMAGE_PX;
  const maxImg = input.maxImage ?? ABSOLUTE_MAX_IMAGE_PX;

  const maxByW = Math.floor(
    (input.availableWidth - gap * Math.max(0, cols - 1)) / cols,
  );
  const maxByH = Math.floor(
    (input.availableHeight - gap * Math.max(0, rows - 1) - rows * labelH) / rows,
  );
  return clamp(Math.min(maxByW, maxByH), minImg, maxImg);
}

/**
 * Matching: N rows × (left card | connector | right card).
 * Image size must leave room for every row.
 * Prefer readable minimum, but drop toward absolute floor rather than clip a row.
 */
export function fitMatchingImageSize(input: {
  pairCount: number;
  availableWidth: number;
  availableHeight: number;
  labelHeight?: number;
  gap?: number;
  minImage?: number;
  maxImage?: number;
}): number {
  const pairs = Math.max(1, input.pairCount);
  const gap = input.gap ?? DEFAULT_GAP_PX;
  const labelH = input.labelHeight ?? LABEL_ROW_PX;
  const preferredMin = input.minImage ?? 80;
  const maxImg = input.maxImage ?? 160;

  const sideW = Math.floor(
    (input.availableWidth - MATCH_CONNECTOR_W - gap * 2) / 2,
  );
  const maxByW = Math.max(40, sideW - 8);
  const maxByH = Math.floor(
    (input.availableHeight - gap * Math.max(0, pairs - 1) - pairs * labelH) /
      pairs,
  );

  let size = Math.min(maxByW, Math.max(0, maxByH), maxImg);
  if (size >= preferredMin) {
    size = clamp(size, preferredMin, maxImg);
  } else {
    // Cannot keep preferred readable min without clipping a row — drop toward floor
    size = clamp(size, 40, maxImg);
  }

  const fits = (img: number) => {
    const rowH = Math.max(img + labelH, 36);
    return (
      pairs * rowH + Math.max(0, pairs - 1) * gap <= input.availableHeight + 1
    );
  };
  while (size > 40 && !fits(size)) size -= 2;
  return Math.max(40, size);
}

export function contentHeightForGrid(input: {
  imageSize: number;
  rows: number;
  labelHeight?: number;
  gap?: number;
  chrome?: number;
}): number {
  const labelH = input.labelHeight ?? LABEL_ROW_PX;
  const gap = input.gap ?? DEFAULT_GAP_PX;
  const chrome = input.chrome ?? ACTIVITY_CHROME_PX;
  const rows = Math.max(1, input.rows);
  return (
    chrome +
    rows * (input.imageSize + labelH) +
    Math.max(0, rows - 1) * gap
  );
}

export function contentHeightForMatching(input: {
  imageSize: number;
  pairCount: number;
  labelHeight?: number;
  gap?: number;
  chrome?: number;
}): number {
  const labelH = input.labelHeight ?? LABEL_ROW_PX;
  const gap = input.gap ?? DEFAULT_GAP_PX;
  const chrome = input.chrome ?? ACTIVITY_CHROME_PX;
  const pairs = Math.max(1, input.pairCount);
  const rowH = Math.max(input.imageSize + labelH, 36);
  return chrome + pairs * rowH + Math.max(0, pairs - 1) * gap;
}

export function estimateImageGrid(
  imageCount: number,
  activityType: string,
  viewportW = UNIVERSAL_VIEWPORT_CONTENT_W,
): { columns: number; rows: number } {
  const n = Math.max(0, imageCount);
  if (n <= 0) return { columns: 1, rows: 1 };
  if (/match|connect|pair/i.test(activityType)) {
    // Matching uses pair rows, not a flat image grid
    const pairs = Math.max(1, Math.ceil(n / 2));
    return { columns: 2, rows: pairs };
  }
  const availW = viewportW - ACTIVITY_INNER_PAD_X;
  const chosen = chooseBestGridLayout({
    itemCount: n,
    availableWidth: availW,
    availableHeight: 400,
    preferColumns: n <= 3 ? n : n <= 6 ? 3 : 3,
  });
  return { columns: chosen.columns, rows: chosen.rows };
}

/**
 * Content-aware image size targets (square 1:1).
 */
export function resolveImageSizeTargets(
  imageCount: number,
  activityType: string,
  role: UniversalImageRole = 'unknown',
): { min: number; ideal: number; max: number } {
  const n = Math.max(0, imageCount);
  let min = 100;
  let ideal = 160;
  let max = 220;

  if (/match|connect|pair/i.test(activityType)) {
    // Matching: smaller is OK; many pairs need compact cells
    if (n <= 2) {
      min = 100;
      ideal = 140;
      max = 170;
    } else if (n <= 4) {
      min = 90;
      ideal = 120;
      max = 150;
    } else {
      min = 80;
      ideal = 110;
      max = 130;
    }
    return {
      min: clamp(min, ABSOLUTE_MIN_IMAGE_PX, ABSOLUTE_MAX_IMAGE_PX),
      ideal: clamp(ideal, ABSOLUTE_MIN_IMAGE_PX, ABSOLUTE_MAX_IMAGE_PX),
      max: clamp(max, ABSOLUTE_MIN_IMAGE_PX, ABSOLUTE_MAX_IMAGE_PX),
    };
  }

  if (n <= 1) {
    min = 180;
    ideal = 260;
    max = 300;
  } else if (n <= 3) {
    min = 140;
    ideal = 185;
    max = 220;
  } else if (n <= 6) {
    min = 110;
    ideal = 150;
    max = 180;
  } else {
    min = ABSOLUTE_MIN_IMAGE_PX;
    ideal = 120;
    max = 150;
  }

  if (/recognize|identify|look|find/i.test(activityType) && n <= 2) {
    ideal = Math.max(ideal, 220);
    max = Math.max(max, 280);
  }
  if (/circle|choose|odd/i.test(activityType) && n >= 4) {
    ideal = Math.min(ideal, 150);
  }
  if (/trace|complete|write/i.test(activityType)) {
    min = Math.min(min, 100);
    ideal = Math.min(ideal, 140);
    max = Math.min(max, 170);
  }
  if (role === 'primary') {
    ideal = Math.min(max, ideal + 20);
    min = Math.min(ideal, min + 10);
  }
  if (role === 'decorative') {
    min = ABSOLUTE_MIN_IMAGE_PX;
    ideal = Math.min(ideal, 110);
    max = Math.min(max, 130);
  }
  if (role === 'option' || role === 'matching') {
    min = Math.max(ABSOLUTE_MIN_IMAGE_PX, min - 10);
  }

  return {
    min: clamp(min, ABSOLUTE_MIN_IMAGE_PX, ABSOLUTE_MAX_IMAGE_PX),
    ideal: clamp(ideal, ABSOLUTE_MIN_IMAGE_PX, ABSOLUTE_MAX_IMAGE_PX),
    max: clamp(max, ABSOLUTE_MIN_IMAGE_PX, ABSOLUTE_MAX_IMAGE_PX),
  };
}

export function estimateActivityLayoutRequirement(input: {
  activityId: string;
  activityType: string;
  imageCount: number;
  pairCount?: number;
  hasLabel?: boolean;
  hasTrace?: boolean;
  hasMatch?: boolean;
  hasChoices?: boolean;
  textLength?: number;
  imageRole?: UniversalImageRole;
  viewportW?: number;
}): UniversalActivityLayoutRequirement {
  const imageCount = Math.max(0, input.imageCount);
  const activityType = (input.activityType || 'identify').toLowerCase();
  const hasMatch = Boolean(input.hasMatch) || /match|connect|pair/i.test(activityType);
  const pairCount = Math.max(
    1,
    input.pairCount ?? (hasMatch ? Math.max(1, Math.ceil(imageCount / 2)) : 1),
  );

  const grid = hasMatch
    ? { columns: 2, rows: pairCount }
    : estimateImageGrid(
        imageCount,
        activityType,
        input.viewportW ?? UNIVERSAL_VIEWPORT_CONTENT_W,
      );

  const sizes = resolveImageSizeTargets(
    hasMatch ? pairCount * 2 : imageCount,
    activityType,
    input.imageRole ?? (imageCount <= 1 ? 'primary' : hasMatch ? 'matching' : 'unknown'),
  );

  const labelH =
    input.hasLabel || input.hasTrace || input.hasChoices || hasMatch
      ? LABEL_ROW_PX
      : 18;
  const gap = DEFAULT_GAP_PX;

  let chrome = ACTIVITY_CHROME_PX;
  if (input.hasTrace) chrome += 40;
  if (hasMatch) chrome += 8;
  if ((input.textLength ?? 0) > 80) chrome += 16;

  const contentAt = (imgPx: number) => {
    if (hasMatch) {
      return contentHeightForMatching({
        imageSize: imgPx,
        pairCount,
        labelHeight: labelH,
        gap,
        chrome: 0,
      });
    }
    const rows = Math.max(1, grid.rows);
    return contentHeightForGrid({
      imageSize: imgPx,
      rows,
      labelHeight: labelH,
      gap,
      chrome: 0,
    });
  };

  const idealHeight = chrome + (imageCount > 0 || hasMatch ? contentAt(sizes.ideal) : 80);
  const minHeight = chrome + (imageCount > 0 || hasMatch ? contentAt(sizes.min) : 60);
  const maxHeight =
    chrome + (imageCount > 0 || hasMatch ? contentAt(sizes.max) : 120) + 40;

  let importanceWeight = 1;
  if (hasMatch) importanceWeight = 1.4; // matching needs vertical room for every row
  else if (/recognize|identify|look|find/i.test(activityType))
    importanceWeight = 1.25;
  else if (/classify|circle|choose/i.test(activityType)) importanceWeight = 1.1;
  else if (/trace|complete|write/i.test(activityType)) importanceWeight = 0.9;
  if (imageCount === 1 && !hasMatch) importanceWeight += 0.2;
  if (pairCount >= 3) importanceWeight += 0.15;

  return {
    activityId: input.activityId,
    activityType,
    imageCount,
    pairCount: hasMatch ? pairCount : 0,
    hasLabel: Boolean(input.hasLabel),
    hasTrace: Boolean(input.hasTrace),
    hasMatch,
    hasChoices: Boolean(input.hasChoices),
    importanceWeight,
    minHeight: Math.round(minHeight),
    idealHeight: Math.round(idealHeight),
    maxHeight: Math.round(maxHeight),
    minImageSize: sizes.min,
    idealImageSize: sizes.ideal,
    maxImageSize: sizes.max,
    gridColumns: grid.columns,
    gridRows: grid.rows,
  };
}

/**
 * Allocate page height by activity need, then derive image sizes that keep
 * every required item visible. Activity borders hug content (no empty stretch).
 */
export function allocateUniversalPageSpace(input: {
  requirements: UniversalActivityLayoutRequirement[];
  viewportContentH?: number;
  instructionHeight?: number;
  interActivityGap?: number;
  contentPadding?: number;
  viewportContentW?: number;
  /** Force high page fill (age 2–3 single rich activity). */
  singleActivityFill?: boolean;
}): UniversalDynamicLayoutPlan {
  const viewportContentH =
    input.viewportContentH ?? UNIVERSAL_VIEWPORT_CONTENT_H;
  const viewportW = input.viewportContentW ?? UNIVERSAL_VIEWPORT_CONTENT_W;
  const instructionHeight =
    input.instructionHeight ?? INSTRUCTION_ESTIMATE_PX;
  const interActivityGap = input.interActivityGap ?? 12;
  const contentPadding = input.contentPadding ?? 28;
  const n = input.requirements.length;
  const singleFill = Boolean(input.singleActivityFill) || n === 1;
  const fillRatio = singleFill ? SINGLE_ACTIVITY_FILL_TARGET : PAGE_FILL_TARGET;
  const gaps = Math.max(0, n - 1) * interActivityGap;
  const availableHeight = Math.max(
    120,
    viewportContentH - instructionHeight - gaps - contentPadding,
  );
  const activityInnerW = viewportW - ACTIVITY_INNER_PAD_X;

  if (n === 0) {
    return {
      viewportContentH,
      availableHeight,
      instructionHeight,
      interActivityGap,
      allocations: [],
    };
  }

  const reqs = input.requirements;
  const sumMin = reqs.reduce((a, r) => a + r.minHeight, 0);
  const sumIdeal = reqs.reduce((a, r) => a + r.idealHeight, 0);

  let heights: number[];

  if (sumIdeal <= availableHeight) {
    heights = reqs.map((r) => r.idealHeight);
    let leftover = availableHeight - sumIdeal;
    // Expand activities that benefit (esp. matching / primary images) — up to max
    const order = [...reqs.keys()].sort(
      (a, b) => reqs[b].importanceWeight - reqs[a].importanceWeight,
    );
    while (leftover > 0) {
      let progressed = false;
      for (const i of order) {
        if (leftover <= 0) break;
        const room = reqs[i].maxHeight - heights[i];
        if (room <= 0) continue;
        const give = Math.min(
          room,
          Math.max(1, Math.ceil(leftover / Math.max(1, order.length))),
        );
        heights[i] += give;
        leftover -= give;
        progressed = true;
      }
      if (!progressed) break;
    }
  } else if (sumMin >= availableHeight) {
    const scale = availableHeight / Math.max(1, sumMin);
    heights = reqs.map((r) =>
      Math.max(Math.floor(r.minHeight * 0.9), Math.floor(r.minHeight * scale)),
    );
    let total = heights.reduce((a, b) => a + b, 0);
    let guard = 0;
    while (total > availableHeight && guard < 400) {
      // Shrink activities with lowest importance first, but never below content min*0.85
      const order = [...reqs.keys()].sort(
        (a, b) => reqs[a].importanceWeight - reqs[b].importanceWeight,
      );
      let progressed = false;
      for (const i of order) {
        const floor = Math.floor(reqs[i].minHeight * 0.85);
        if (heights[i] > floor) {
          heights[i] -= 1;
          total -= 1;
          progressed = true;
          break;
        }
      }
      if (!progressed) break;
      guard += 1;
    }
  } else {
    const span = sumIdeal - sumMin;
    const t = span > 0 ? (availableHeight - sumMin) / span : 0;
    heights = reqs.map((r) =>
      Math.round(r.minHeight + (r.idealHeight - r.minHeight) * t),
    );
    let total = heights.reduce((a, b) => a + b, 0);
    let diff = availableHeight - total;
    const order = [...reqs.keys()].sort(
      (a, b) => reqs[b].importanceWeight - reqs[a].importanceWeight,
    );
    let guard = 0;
    while (diff !== 0 && guard < 500) {
      for (const i of order) {
        if (diff === 0) break;
        if (diff > 0 && heights[i] < reqs[i].maxHeight) {
          heights[i] += 1;
          diff -= 1;
        } else if (
          diff < 0 &&
          heights[i] > Math.floor(reqs[i].minHeight * 0.9)
        ) {
          heights[i] -= 1;
          diff += 1;
        }
      }
      guard += 1;
    }
  }

  // Pass 2: derive image sizes that fit ALL required content; hug content height
  const allocations: UniversalActivityLayoutAllocation[] = reqs.map((r, i) => {
    const allocatedHeight = heights[i];
    const labelH =
      r.hasLabel || r.hasTrace || r.hasChoices || r.hasMatch ? LABEL_ROW_PX : 18;
    const chrome =
      ACTIVITY_CHROME_PX + (r.hasTrace ? 40 : 0) + (r.hasMatch ? 8 : 0);
    const usableH = Math.max(60, allocatedHeight - chrome);
    const gap = DEFAULT_GAP_PX;

    let columns = r.gridColumns;
    let rows = r.gridRows;
    let imageSize: number;

    if (r.hasMatch && r.pairCount > 0) {
      rows = r.pairCount;
      columns = 2;
      imageSize = fitMatchingImageSize({
        pairCount: r.pairCount,
        availableWidth: activityInnerW,
        availableHeight: usableH,
        labelHeight: labelH,
        gap,
        minImage: Math.min(r.minImageSize, 80),
        maxImage: r.maxImageSize,
      });
      // If still too tall at min size, shrink further toward absolute floor
      let contentH = contentHeightForMatching({
        imageSize,
        pairCount: r.pairCount,
        labelHeight: labelH,
        gap,
        chrome,
      });
      while (contentH > allocatedHeight && imageSize > ABSOLUTE_MIN_IMAGE_PX) {
        imageSize -= 2;
        contentH = contentHeightForMatching({
          imageSize,
          pairCount: r.pairCount,
          labelHeight: labelH,
          gap,
          chrome,
        });
      }
    } else {
      const preferCols =
        singleFill && r.imageCount >= 4
          ? 2
          : singleFill && r.imageCount === 3
            ? 3
            : r.gridColumns;
      const grid = chooseBestGridLayout({
        itemCount: Math.max(1, r.imageCount),
        availableWidth: activityInnerW,
        availableHeight: usableH,
        labelHeight: labelH,
        gap,
        minImage: Math.min(r.minImageSize, ABSOLUTE_MIN_IMAGE_PX + 8),
        maxImage: singleFill
          ? Math.min(ABSOLUTE_MAX_IMAGE_PX, Math.max(r.maxImageSize, 240))
          : r.maxImageSize,
        preferColumns: preferCols,
      });
      columns = grid.columns;
      rows = grid.rows;
      imageSize = grid.imageSize;
      // Prefer ideal when space allows
      if (imageSize < r.idealImageSize) {
        const boosted = fitActivityImageSize({
          availableWidth: activityInnerW,
          availableHeight: usableH,
          columns,
          rows,
          labelHeight: labelH,
          gap,
          minImage: r.minImageSize,
          maxImage: singleFill
            ? Math.min(ABSOLUTE_MAX_IMAGE_PX, Math.max(r.maxImageSize, 240))
            : r.maxImageSize,
        });
        imageSize = Math.max(imageSize, Math.min(boosted, r.idealImageSize));
      }
    }

    const contentHeight = r.hasMatch
      ? contentHeightForMatching({
          imageSize,
          pairCount: Math.max(1, r.pairCount),
          labelHeight: labelH,
          gap,
          chrome,
        })
      : r.imageCount > 0
        ? contentHeightForGrid({
            imageSize,
            rows,
            labelHeight: labelH,
            gap,
            chrome,
          })
        : chrome + (r.hasTrace ? 80 : 48);

    // Hug content: use content height, but never less than what we need for items.
    // Cap at allocatedHeight so we don't overflow the page plan.
    const hugged = clamp(
      Math.ceil(contentHeight),
      Math.min(contentHeight, allocatedHeight),
      allocatedHeight,
    );

    return {
      ...r,
      gridColumns: columns,
      gridRows: rows,
      allocatedHeight: hugged,
      contentHeight: Math.ceil(contentHeight),
      imageSize,
      imageGap: gap,
      activityGap: interActivityGap,
    };
  });

  // Pass 3: if matching (or any) contentHeight still exceeds hugged allocation,
  // steal height from activities that have spare (allocated > content need).
  const need: number[] = allocations.map((a) =>
    Math.max(0, a.contentHeight - a.allocatedHeight),
  );
  let deficit = need.reduce((s, x) => s + x, 0);
  if (deficit > 0) {
    let stolen = 0;
    const spare = allocations.map((a, i) => ({
      i,
      spare: Math.max(0, a.allocatedHeight - a.contentHeight),
      weight: reqs[i].importanceWeight,
    }));
    spare.sort((a, b) => a.weight - b.weight); // take from low-importance first
    for (const s of spare) {
      if (deficit <= 0) break;
      const give = Math.min(s.spare, deficit);
      if (give <= 0) continue;
      allocations[s.i].allocatedHeight -= give;
      stolen += give;
      deficit -= give;
    }
    for (let i = 0; i < allocations.length && stolen > 0; i += 1) {
      if (need[i] <= 0) continue;
      const take = Math.min(need[i], stolen);
      allocations[i].allocatedHeight += take;
      stolen -= take;
      need[i] -= take;
      const a = allocations[i];
      const labelH =
        a.hasLabel || a.hasTrace || a.hasChoices || a.hasMatch
          ? LABEL_ROW_PX
          : 18;
      const chrome =
        ACTIVITY_CHROME_PX + (a.hasTrace ? 40 : 0) + (a.hasMatch ? 8 : 0);
      const usableH = Math.max(60, a.allocatedHeight - chrome);
      if (a.hasMatch) {
        a.imageSize = fitMatchingImageSize({
          pairCount: Math.max(1, a.pairCount),
          availableWidth: activityInnerW,
          availableHeight: usableH,
          labelHeight: labelH,
          gap: a.imageGap,
          minImage: Math.min(a.minImageSize, 80),
          maxImage: a.maxImageSize,
        });
        a.contentHeight = contentHeightForMatching({
          imageSize: a.imageSize,
          pairCount: Math.max(1, a.pairCount),
          labelHeight: labelH,
          gap: a.imageGap,
          chrome,
        });
      } else if (a.imageCount > 0) {
        a.imageSize = fitActivityImageSize({
          availableWidth: activityInnerW,
          availableHeight: usableH,
          columns: Math.max(1, a.gridColumns),
          rows: Math.max(1, a.gridRows),
          labelHeight: labelH,
          gap: a.imageGap,
          minImage: Math.min(a.minImageSize, ABSOLUTE_MIN_IMAGE_PX),
          maxImage: a.maxImageSize,
        });
        a.contentHeight = contentHeightForGrid({
          imageSize: a.imageSize,
          rows: Math.max(1, a.gridRows),
          labelHeight: labelH,
          gap: a.imageGap,
          chrome,
        });
      }
      // Prefer content fit; pass 4 will shrink images if page overflows
      a.allocatedHeight = Math.max(a.allocatedHeight, a.contentHeight);
    }
  }

  // Final page fit: if total exceeds available, shrink image sizes (never drop rows)
  let totalH = allocations.reduce((s, a) => s + a.allocatedHeight, 0);
  let guard = 0;
  while (totalH > availableHeight && guard < 400) {
    // Shrink largest image-bearing activity's image size
    let idx = -1;
    let best = -1;
    for (let i = 0; i < allocations.length; i += 1) {
      if (allocations[i].imageSize > ABSOLUTE_MIN_IMAGE_PX) {
        if (allocations[i].imageSize > best) {
          best = allocations[i].imageSize;
          idx = i;
        }
      }
    }
    if (idx < 0) break;
    const a = allocations[idx];
    a.imageSize = Math.max(ABSOLUTE_MIN_IMAGE_PX, a.imageSize - 2);
    const labelH =
      a.hasLabel || a.hasTrace || a.hasChoices || a.hasMatch ? LABEL_ROW_PX : 18;
    const chrome =
      ACTIVITY_CHROME_PX + (a.hasTrace ? 40 : 0) + (a.hasMatch ? 8 : 0);
    a.contentHeight = a.hasMatch
      ? contentHeightForMatching({
          imageSize: a.imageSize,
          pairCount: Math.max(1, a.pairCount),
          labelHeight: labelH,
          gap: a.imageGap,
          chrome,
        })
      : contentHeightForGrid({
          imageSize: a.imageSize,
          rows: Math.max(1, a.gridRows),
          labelHeight: labelH,
          gap: a.imageGap,
          chrome,
        });
    a.allocatedHeight = a.contentHeight;
    totalH = allocations.reduce((s, x) => s + x.allocatedHeight, 0);
    guard += 1;
  }

  // If still over after absolute min images, compress allocated heights to the
  // page budget, then re-fit image sizes so every required row still exists.
  totalH = allocations.reduce((s, a) => s + a.allocatedHeight, 0);
  if (totalH > availableHeight && totalH > 0) {
    const pre = allocations.map((a) => a.allocatedHeight);
    const scale = availableHeight / totalH;
    for (let i = 0; i < allocations.length; i += 1) {
      allocations[i].allocatedHeight = Math.max(80, Math.floor(pre[i] * scale));
    }
    let compressed = allocations.reduce((s, a) => s + a.allocatedHeight, 0);
    let drift = compressed - availableHeight;
    let di = 0;
    while (drift > 0 && di < 800) {
      const i = di % allocations.length;
      if (allocations[i].allocatedHeight > 80) {
        allocations[i].allocatedHeight -= 1;
        drift -= 1;
      }
      di += 1;
    }

    for (const a of allocations) {
      const labelH =
        a.hasLabel || a.hasTrace || a.hasChoices || a.hasMatch ? LABEL_ROW_PX : 18;
      const chrome =
        ACTIVITY_CHROME_PX + (a.hasTrace ? 40 : 0) + (a.hasMatch ? 8 : 0);
      const usableH = Math.max(48, a.allocatedHeight - chrome);
      if (a.hasMatch && a.pairCount > 0) {
        a.imageSize = fitMatchingImageSize({
          pairCount: Math.max(1, a.pairCount),
          availableWidth: activityInnerW,
          availableHeight: usableH,
          labelHeight: labelH,
          gap: a.imageGap,
          minImage: ABSOLUTE_MIN_IMAGE_PX,
          maxImage: a.maxImageSize,
        });
        a.contentHeight = contentHeightForMatching({
          imageSize: a.imageSize,
          pairCount: Math.max(1, a.pairCount),
          labelHeight: labelH,
          gap: a.imageGap,
          chrome,
        });
      } else if (a.imageCount > 0) {
        const grid = chooseBestGridLayout({
          itemCount: Math.max(1, a.imageCount),
          availableWidth: activityInnerW,
          availableHeight: usableH,
          labelHeight: labelH,
          gap: a.imageGap,
          minImage: ABSOLUTE_MIN_IMAGE_PX,
          maxImage: a.maxImageSize,
          preferColumns: a.gridColumns,
        });
        a.gridColumns = grid.columns;
        a.gridRows = grid.rows;
        a.imageSize = grid.imageSize;
        a.contentHeight = contentHeightForGrid({
          imageSize: a.imageSize,
          rows: grid.rows,
          labelHeight: labelH,
          gap: a.imageGap,
          chrome,
        });
      }
    }
  }

  // Pass 5: absorb leftover viewport into useful image size / gaps (not empty stretch).
  const targetFill = Math.floor(availableHeight * fillRatio);
  const sumAllocated = () =>
    allocations.reduce((s, a) => s + a.allocatedHeight, 0);
  let used = sumAllocated();
  let leftover = targetFill - used;
  let growGuard = 0;
  const growOrder = [...allocations.keys()].sort(
    (a, b) =>
      allocations[b].importanceWeight - allocations[a].importanceWeight,
  );

  const recalcContent = (a: UniversalActivityLayoutAllocation) => {
    const labelH =
      a.hasLabel || a.hasTrace || a.hasChoices || a.hasMatch ? LABEL_ROW_PX : 18;
    const chrome =
      ACTIVITY_CHROME_PX + (a.hasTrace ? 40 : 0) + (a.hasMatch ? 8 : 0);
    if (a.hasMatch && a.pairCount > 0) {
      a.contentHeight = contentHeightForMatching({
        imageSize: a.imageSize,
        pairCount: Math.max(1, a.pairCount),
        labelHeight: labelH,
        gap: a.imageGap,
        chrome,
      });
    } else if (a.imageCount > 0) {
      a.contentHeight = contentHeightForGrid({
        imageSize: a.imageSize,
        rows: Math.max(1, a.gridRows),
        labelHeight: labelH,
        gap: a.imageGap,
        chrome,
      });
    } else {
      a.contentHeight = chrome + (a.hasTrace ? 80 : 48);
    }
    a.allocatedHeight = Math.ceil(a.contentHeight);
  };

  // Single-activity: if a wide row width-caps images, switch to fewer columns
  // so pictures can grow and the page fills vertically (age 2–3).
  if (singleFill && allocations.length === 1) {
    const a = allocations[0];
    if (!a.hasMatch && a.imageCount >= 3 && a.gridColumns > 2) {
      const labelH =
        a.hasLabel || a.hasTrace || a.hasChoices ? LABEL_ROW_PX : 18;
      const chrome = ACTIVITY_CHROME_PX + (a.hasTrace ? 40 : 0);
      const usableH = Math.max(120, targetFill - chrome);
      const grid = chooseBestGridLayout({
        itemCount: a.imageCount,
        availableWidth: activityInnerW,
        availableHeight: usableH,
        labelHeight: labelH,
        gap: a.imageGap,
        minImage: a.minImageSize,
        maxImage: Math.min(ABSOLUTE_MAX_IMAGE_PX, Math.max(a.maxImageSize, 260)),
        preferColumns: a.imageCount === 3 ? 3 : 2,
      });
      a.gridColumns = grid.columns;
      a.gridRows = grid.rows;
      a.imageSize = Math.max(a.imageSize, grid.imageSize);
      recalcContent(a);
    }
  }

  while (leftover > 28 && growGuard < 250) {
    let progressed = false;
    for (const i of growOrder) {
      if (leftover <= 28) break;
      const a = allocations[i];
      const hardMax = Math.min(
        ABSOLUTE_MAX_IMAGE_PX,
        a.maxImageSize +
          (singleFill && !a.hasMatch ? 40 : 0) +
          (leftover > 100 ? 24 : leftover > 40 ? 12 : 0),
      );
      // Never grow past what fits in the activity width (prevents horizontal scrollbar)
      const cols = Math.max(1, a.hasMatch ? 2 : a.gridColumns);
      const maxByW = a.hasMatch
        ? Math.floor((activityInnerW - MATCH_CONNECTOR_W - a.imageGap * 2) / 2) -
          CARD_PAD_X
        : Math.floor(
            (activityInnerW - a.imageGap * Math.max(0, cols - 1)) / cols,
          ) - CARD_PAD_X;
      const widthCap = Math.max(ABSOLUTE_MIN_IMAGE_PX, maxByW);
      const room = Math.min(hardMax, widthCap) - a.imageSize;
      if (room >= 2 && (a.imageCount > 0 || a.hasMatch)) {
        a.imageSize += 2;
        recalcContent(a);
        // Cap so we don't blow past remaining page target
        const over = sumAllocated() - targetFill;
        if (over > 0) {
          a.imageSize -= 2;
          recalcContent(a);
          continue;
        }
        leftover = targetFill - sumAllocated();
        progressed = true;
        break;
      }
      if (a.hasTrace && a.allocatedHeight < a.maxHeight) {
        a.allocatedHeight += Math.min(12, leftover);
        a.contentHeight = a.allocatedHeight;
        leftover = targetFill - sumAllocated();
        progressed = true;
        break;
      }
      if (a.imageGap < (singleFill ? 28 : 16)) {
        a.imageGap += 1;
        recalcContent(a);
        const over = sumAllocated() - targetFill;
        if (over > 0) {
          a.imageGap -= 1;
          recalcContent(a);
          continue;
        }
        leftover = targetFill - sumAllocated();
        progressed = true;
        break;
      }
    }
    if (!progressed) break;
    growGuard += 1;
    used = sumAllocated();
    leftover = targetFill - used;
  }

  // Single activity: expand section height to fill the content viewport so the
  // page is not half-blank (images already width-maximized).
  if (singleFill && allocations.length === 1) {
    const a = allocations[0];
    const fillH = Math.min(
      Math.max(a.maxHeight, targetFill),
      Math.floor(availableHeight * 0.98),
    );
    if (a.allocatedHeight < fillH) {
      a.allocatedHeight = fillH;
      // Keep contentHeight as true content need; compose centers inside the tall section
    }
  }

  // Modest activity-gap bump with any remaining leftover (visual breathing, not empty boxes)
  if (!singleFill && leftover > 40 && allocations.length >= 2) {
    const bump = Math.min(8, Math.floor(leftover / (allocations.length + 1)));
    if (bump > 0) {
      for (const a of allocations) a.activityGap = interActivityGap + bump;
    }
  }

  // Final width safety: clamp every image so rows cannot exceed the content viewport
  for (const a of allocations) {
    const cols = Math.max(1, a.hasMatch ? 2 : a.gridColumns);
    const maxByW = a.hasMatch
      ? Math.floor((activityInnerW - MATCH_CONNECTOR_W - a.imageGap * 2) / 2) -
        CARD_PAD_X
      : Math.floor(
          (activityInnerW - a.imageGap * Math.max(0, cols - 1)) / cols,
        ) - CARD_PAD_X;
    const widthCap = Math.max(ABSOLUTE_MIN_IMAGE_PX, maxByW);
    if (a.imageSize > widthCap) {
      a.imageSize = widthCap;
      const labelH =
        a.hasLabel || a.hasTrace || a.hasChoices || a.hasMatch
          ? LABEL_ROW_PX
          : 18;
      const chrome =
        ACTIVITY_CHROME_PX + (a.hasTrace ? 40 : 0) + (a.hasMatch ? 8 : 0);
      if (a.hasMatch && a.pairCount > 0) {
        a.contentHeight = contentHeightForMatching({
          imageSize: a.imageSize,
          pairCount: Math.max(1, a.pairCount),
          labelHeight: labelH,
          gap: a.imageGap,
          chrome,
        });
      } else if (a.imageCount > 0) {
        a.contentHeight = contentHeightForGrid({
          imageSize: a.imageSize,
          rows: Math.max(1, a.gridRows),
          labelHeight: labelH,
          gap: a.imageGap,
          chrome,
        });
      }
      // Preserve intentional single-activity page fill height
      a.allocatedHeight = Math.max(a.allocatedHeight, Math.ceil(a.contentHeight));
    }
  }

  // Re-assert single-activity fill after width clamp
  if (singleFill && allocations.length === 1) {
    const a = allocations[0];
    const fillH = Math.min(
      Math.max(a.contentHeight, Math.floor(availableHeight * fillRatio)),
      Math.floor(availableHeight * 0.98),
    );
    a.allocatedHeight = Math.max(a.allocatedHeight, fillH);
  }

  return {
    viewportContentH,
    availableHeight,
    instructionHeight,
    interActivityGap:
      allocations[0]?.activityGap ?? interActivityGap,
    allocations,
  };
}

/** Minimum readable size used by validators (content-aware). */
export function minimumReadableImageSize(imageCount: number): number {
  if (imageCount <= 1) return 160;
  if (imageCount <= 3) return 120;
  if (imageCount <= 6) return 90;
  return ABSOLUTE_MIN_IMAGE_PX;
}

/**
 * Per-activity image budget for clampUniversalImageBoxes (legacy HTML path).
 * Uses the activity's own height and image count — NOT equal viewport shares.
 */
export function resolveActivityImageBoxBudget(input: {
  activityHeightPx: number;
  imagesInActivity: number;
  activityType?: string;
  hasMatch?: boolean;
  pairCount?: number;
}): { minPx: number; maxPx: number; targetPx: number } {
  const type = input.activityType || 'identify';
  const imgs = Math.max(1, input.imagesInActivity);
  const hasMatch = Boolean(input.hasMatch) || /match|connect|pair/i.test(type);
  const pairs = input.pairCount ?? Math.max(1, Math.ceil(imgs / 2));
  const targets = resolveImageSizeTargets(
    hasMatch ? pairs * 2 : imgs,
    type,
    hasMatch ? 'matching' : imgs <= 1 ? 'primary' : 'unknown',
  );
  const chrome = ACTIVITY_CHROME_PX;
  const usableH = Math.max(80, input.activityHeightPx - chrome);
  const availW = UNIVERSAL_VIEWPORT_CONTENT_W - ACTIVITY_INNER_PAD_X;

  let targetPx: number;
  if (hasMatch) {
    targetPx = fitMatchingImageSize({
      pairCount: pairs,
      availableWidth: availW,
      availableHeight: usableH,
      minImage: targets.min,
      maxImage: targets.max,
    });
  } else {
    const grid = chooseBestGridLayout({
      itemCount: imgs,
      availableWidth: availW,
      availableHeight: usableH,
      minImage: targets.min,
      maxImage: targets.max,
    });
    targetPx = grid.imageSize;
  }

  return {
    minPx: Math.min(targets.min, targetPx),
    maxPx: Math.max(targetPx, targets.min),
    targetPx,
  };
}
