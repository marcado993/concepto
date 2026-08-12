import { describe, it, expect } from "vitest";
import { cube, isoToScreen } from "./iso";

// TDD: unit tests for the pure isometric-grid math, written BDD-style
// (Given/When/Then) so the intent reads without needing to trace the SVG
// call sites in Background.svelte.

describe("isoToScreen", () => {
  it("Given the grid origin, When converting (0,0,0), Then it maps to screen origin", () => {
    const result = isoToScreen(0, 0, 0, 64, 32, 16);
    expect(result).toEqual({ x: 0, y: 0 });
  });

  it("Given a column offset, When col > row, Then x is positive (screen-right)", () => {
    const result = isoToScreen(3, 1, 0, 64, 32, 16);
    expect(result.x).toBeGreaterThan(0);
  });

  it("Given a row offset, When row > col, Then x is negative (screen-left)", () => {
    const result = isoToScreen(1, 3, 0, 64, 32, 16);
    expect(result.x).toBeLessThan(0);
  });

  it("Given a higher level, When level increases, Then y decreases (moves up on screen)", () => {
    const ground = isoToScreen(2, 2, 0, 64, 32, 16);
    const raised = isoToScreen(2, 2, 1, 64, 32, 16);
    expect(raised.y).toBeLessThan(ground.y);
  });
});

describe("cube", () => {
  it("Given center (cx, cy) and dimensions, When building a cube, Then the top rhombus is centered on (cx, cy)", () => {
    const { top } = cube(100, 100, 40, 20, 10);
    // top polygon's first point is the back-top vertex, directly above cx
    const [firstX, firstY] = top.split(" ")[0].split(",").map(Number);
    expect(firstX).toBe(100);
    expect(firstY).toBe(90); // cy - h/2
  });

  it("Given a depth, When building a cube, Then the left face spans from the rhombus's side vertex down by `depth`", () => {
    const { left } = cube(0, 0, 40, 20, 12);
    const points = left.split(" ").map((p) => p.split(",").map(Number));
    const ys = points.map(([, y]) => y);
    // left face runs from cy (top rhombus's side vertex) to cy + h/2 + depth
    expect(Math.max(...ys) - Math.min(...ys)).toBe(20 / 2 /* h/2 */ + 12 /* depth */);
  });
});
