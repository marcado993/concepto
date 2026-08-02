export interface CubeFaces {
  top: string;
  left: string;
  right: string;
  seamTop: [number, number, number, number];
}

/**
 * Builds the three visible faces of an isometric cube.
 * (cx, cy) is the top vertex of the top rhombus (the cube's back-top corner).
 */
export function cube(cx: number, cy: number, w: number, h: number, depth: number): CubeFaces {
  const top = `${cx},${cy - h / 2} ${cx + w / 2},${cy} ${cx},${cy + h / 2} ${cx - w / 2},${cy}`;
  const left = `${cx - w / 2},${cy} ${cx},${cy + h / 2} ${cx},${cy + h / 2 + depth} ${cx - w / 2},${cy + depth}`;
  const right = `${cx},${cy + h / 2} ${cx + w / 2},${cy} ${cx + w / 2},${cy + depth} ${cx},${cy + h / 2 + depth}`;
  return { top, left, right, seamTop: [cx, cy - h / 2, cx, cy + h / 2] };
}

/** Converts iso grid coordinates (col, row, level) into screen space. */
export function isoToScreen(col: number, row: number, level: number, w: number, h: number, levelHeight: number) {
  return {
    x: (col - row) * (w / 2),
    y: (col + row) * (h / 2) - level * levelHeight,
  };
}
