/**
 * Row pattern for "circle the things" layouts (e.g. 7 → 2-3-2 like reference worksheets).
 */
export function circleGridRowPattern(count: number): number[] {
  if (count <= 0) {
    return [];
  }
  switch (count) {
    case 1:
      return [1];
    case 2:
      return [2];
    case 3:
      return [3];
    case 4:
      return [2, 2];
    case 5:
      return [2, 3];
    case 6:
      return [2, 2, 2];
    case 7:
      return [2, 3, 2];
    case 8:
      return [3, 2, 3];
    case 9:
      return [3, 3, 3];
    default: {
      const rows: number[] = [];
      let remaining = count;
      while (remaining > 0) {
        const take = Math.min(3, remaining);
        rows.push(take);
        remaining -= take;
      }
      return rows;
    }
  }
}

/**
 * Hand-tuned horizontal placement + within-row vertical stagger for the classic
 * 7-item Clean Habits-style layout (2-3-2). Vertical band centers are computed
 * separately so row gaps stay ~90px regardless of box height.
 *
 * Order: top-left, top-right, mid-left, mid-center, mid-right, bottom-left, bottom-right.
 */
const CIRCLE_SEVEN_SLOTS: ReadonlyArray<{
  row: 0 | 1 | 2;
  x: number;
  /** Extra offset in px relative to the row band center (negative = higher). */
  dyPx: number;
}> = [
  { row: 0, x: 0.22, dyPx: -12 },
  { row: 0, x: 0.76, dyPx: 14 },
  { row: 1, x: 0.15, dyPx: 10 },
  { row: 1, x: 0.5, dyPx: -16 },
  { row: 1, x: 0.83, dyPx: 12 },
  { row: 2, x: 0.34, dyPx: -8 },
  { row: 2, x: 0.66, dyPx: 12 },
];

/** Target clear space between consecutive row item boxes (px). */
const CIRCLE_ROW_GAP_PX = 90;

/**
 * Normalized (0–1) vertical centers for each row band, spaced so the clear gap
 * between item boxes is about CIRCLE_ROW_GAP_PX (falls back if the box is short).
 */
export function circleRowBandCenters(
  rowCount: number,
  boxHeight: number,
  itemHeight: number,
  gapPx = CIRCLE_ROW_GAP_PX,
): number[] {
  if (rowCount <= 0) {
    return [];
  }
  if (rowCount === 1) {
    return [0.5];
  }

  const idealTotal =
    rowCount * itemHeight + (rowCount - 1) * gapPx;
  let gap = gapPx;
  if (idealTotal > boxHeight) {
    // Shrink gap evenly so rows still fit with a little edge padding.
    const padding = Math.min(24, Math.max(8, boxHeight * 0.03));
    gap = Math.max(
      40,
      (boxHeight - padding * 2 - rowCount * itemHeight) / (rowCount - 1),
    );
  }

  const total = rowCount * itemHeight + (rowCount - 1) * gap;
  const start = Math.max(0, (boxHeight - total) / 2);
  return Array.from({ length: rowCount }, (_, r) => {
    const centerPx = start + r * (itemHeight + gap) + itemHeight / 2;
    return centerPx / boxHeight;
  });
}

function clampItemTopLeft(
  centerX: number,
  centerY: number,
  box: { left: number; top: number; width: number; height: number },
  itemSize: { width: number; height: number },
): { top: number; left: number } {
  const left = Math.round(
    Math.min(
      box.left + box.width - itemSize.width,
      Math.max(box.left, box.left + centerX * box.width - itemSize.width / 2),
    ),
  );
  const top = Math.round(
    Math.min(
      box.top + box.height - itemSize.height,
      Math.max(box.top, box.top + centerY * box.height - itemSize.height / 2),
    ),
  );
  return { top, left };
}

/** Deterministic -1..1 hash from integer seeds (stable across renders). */
function layoutNoise(a: number, b: number, c = 0): number {
  const n = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453;
  return (n - Math.floor(n)) * 2 - 1;
}

/**
 * Places items in a natural 2-3-2-style layout (for 7 items) with slight
 * stagger — keeps row zones but avoids rigid alignment like the reference.
 */
export function generateCircleGridPositions(
  count: number,
  box: { left: number; top: number; width: number; height: number },
  itemSize: { width: number; height: number },
): Array<{ top: number; left: number }> {
  if (count <= 0) {
    return [];
  }

  if (count === 7) {
    const bands = circleRowBandCenters(3, box.height, itemSize.height);
    return CIRCLE_SEVEN_SLOTS.map((slot) => {
      const bandY = bands[slot.row] ?? (slot.row + 0.5) / 3;
      const centerY = bandY + slot.dyPx / box.height;
      return clampItemTopLeft(slot.x, centerY, box, itemSize);
    });
  }

  const rows = circleGridRowPattern(count);
  const rowCount = rows.length;
  const bands = circleRowBandCenters(rowCount, box.height, itemSize.height);
  const positions: Array<{ top: number; left: number }> = [];
  let index = 0;

  for (let r = 0; r < rowCount; r++) {
    const cols = rows[r];
    const bandY = bands[r] ?? (r + 0.5) / rowCount;
    const rowDriftY = (layoutNoise(r, cols, 3) * 10) / box.height;

    // Top row sits wider; bottom 2-item rows pull inward so columns don't stack.
    const isEdgePair = cols === 2;
    const inset =
      isEdgePair && r === rowCount - 1
        ? 0.22
        : isEdgePair && r === 0
          ? 0.1
          : cols === 3
            ? 0.06
            : 0.14;

    for (let c = 0; c < cols; c++) {
      const t = cols === 1 ? 0.5 : c / (cols - 1);
      const baseX = inset + t * (1 - inset * 2);
      const jx = layoutNoise(index, r, c) * 0.045;
      const jy = (layoutNoise(c, index, r + 5) * 12) / box.height;
      const midLift = cols === 3 && c === 1 ? -14 / box.height : 0;
      const midDrop = cols === 3 && c !== 1 ? 10 / box.height : 0;

      positions.push(
        clampItemTopLeft(
          baseX + jx,
          bandY + rowDriftY + jy + midLift + midDrop,
          box,
          itemSize,
        ),
      );
      index += 1;
    }
  }

  return positions;
}

/**
 * Generates non-overlapping pseudo-random positions for n items within a bounding box.
 * Uses a zone-grid approach: divide the box into a grid of cells,
 * assign each item to a cell, then jitter within the cell.
 */
export function generateScatterPositions(
  count: number,
  box: { left: number; top: number; width: number; height: number },
  itemSize: { width: number; height: number },
): Array<{ top: number; left: number }> {
  if (count <= 0) {
    return [];
  }

  // Determine grid dimensions (e.g. 6 items -> 3 cols x 2 rows, 7-9 items -> 3 cols x 3 rows)
  let cols = Math.ceil(Math.sqrt(count));
  let rows = Math.ceil(count / cols);
  
  // Adjust aspect ratio if box is taller than wider
  if (box.height > box.width && cols > rows) {
    const temp = cols;
    cols = rows;
    rows = temp;
  }

  const cellWidth = box.width / cols;
  const cellHeight = box.height / rows;
  
  // Calculate max safe jitter to keep item within cell
  const maxJitterX = Math.max(0, cellWidth - itemSize.width);
  const maxJitterY = Math.max(0, cellHeight - itemSize.height);

  const positions: Array<{ top: number; left: number }> = [];
  
  // Create an array of available cells
  const cells: Array<{ r: number; c: number }> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({ r, c });
    }
  }

  // Deterministic shuffle based on position index to keep layout stable across renders
  for (let i = 0; i < count; i++) {
    // Pick a cell deterministically
    const cellIndex = i % cells.length; // Simplified deterministic pick
    const cell = cells[cellIndex];
    cells.splice(cellIndex, 1);

    // Calculate base position (top-left of cell)
    const baseLeft = box.left + cell.c * cellWidth;
    const baseTop = box.top + cell.r * cellHeight;

    // Pseudo-random jitter based on item index (deterministic)
    const jitterFactorX = Math.abs(Math.sin(i * 12.9898 + 78.233)) % 1;
    const jitterFactorY = Math.abs(Math.cos(i * 4.1414 + 1.414)) % 1;

    const left = Math.round(
      Math.min(
        box.left + box.width - itemSize.width,
        Math.max(box.left, baseLeft + jitterFactorX * maxJitterX),
      ),
    );
    const top = Math.round(
      Math.min(
        box.top + box.height - itemSize.height,
        Math.max(box.top, baseTop + jitterFactorY * maxJitterY),
      ),
    );

    positions.push({ top, left });
  }

  return positions;
}
