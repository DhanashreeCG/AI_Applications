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
