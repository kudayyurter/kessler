import { describe, expect, it } from "vitest";
import {
  axisLabels, cellAt, cellRect, changeColor, gridLayout, LEO_AND_FLOOR_ROWS, logScale, maxAbs, moveCell, nowColor, ramp,
  rowsBetween, rowSum, strongestCell, NOW_STOPS,
} from "@/lib/crowding/draw";
import { cellIndex, COLS, ROWS } from "@/lib/crowding/grid";

const grid = (entries: [number, number, number][]) => {
  const v = new Float64Array(ROWS * COLS);
  for (const [r, c, x] of entries) v[cellIndex(r, c)] = x;
  return v;
};

describe("colours", () => {
  it("ramps between stops and clamps", () => {
    expect(ramp(NOW_STOPS, 0)).toBe("rgb(14,14,14)");
    expect(ramp(NOW_STOPS, 1)).toBe("rgb(255,244,214)");
    expect(ramp(NOW_STOPS, 2)).toBe("rgb(255,244,214)");
  });

  it("uses a log scale and leaves near-empty cells unfilled", () => {
    expect(logScale(0, 100)).toBe(0);
    expect(logScale(100, 100)).toBeCloseTo(1, 12);
    expect(logScale(5, 0)).toBe(0);
    expect(nowColor(0.01, 10)).toBeNull();
    expect(nowColor(10, 10)).toBe("rgb(255,244,214)");
  });

  it("colours gains orange and losses blue", () => {
    expect(changeColor(0.01, 5)).toBeNull();
    expect(changeColor(5, 5)).toBe("rgb(255,244,214)");
    expect(changeColor(-5, 5)).toBe("rgb(207,226,255)");
    expect(maxAbs(grid([[11, 27, 3], [14, 35, -7]]), LEO_AND_FLOOR_ROWS)).toBe(7);
  });
});

describe("layout", () => {
  const l = gridLayout(LEO_AND_FLOOR_ROWS, 5, 5, 44, 18);

  it("measures the canvas", () => {
    expect([l.width, l.height]).toEqual([44 + 91 * 5, 73 * 5 + 18]);
    expect(rowsBetween(73, 78)).toEqual([73, 74, 75, 76, 77, 78]);
  });

  it("puts higher rows higher up and maps points back to cells", () => {
    expect(cellRect(l, { row: 72, col: 0 })).toEqual({ x: 44, y: 0, w: 5, h: 5 });
    expect(cellRect(l, { row: 0, col: 90 })).toEqual({ x: 44 + 450, y: 72 * 5, w: 5, h: 5 });
    expect(cellRect(l, { row: 75, col: 0 })).toBeNull();
    const r = cellRect(l, { row: 11, col: 27 })!;
    expect(cellAt(l, r.x + 2, r.y + 2)).toEqual({ row: 11, col: 27 });
    expect(cellAt(l, 10, 10)).toBeNull();
    expect(cellAt(l, 50, l.height - 5)).toBeNull();
  });

  it("labels altitudes, the floor row and inclinations", () => {
    const texts = axisLabels(l, "ticks").map((t) => t.text);
    expect(texts).toEqual(expect.arrayContaining(["<200", "400", "1800", "0°", "90°", "180°", "km"]));
    expect(texts).not.toContain("200");
    const names = axisLabels(gridLayout(rowsBetween(73, 78), 5, 9, 44, 0), "names").map((t) => t.text);
    expect(names).toEqual(["2–8k", "8–18k", "GNSS", "sub-GEO", "GEO", ">GEO"]);
  });
});

describe("keyboard movement", () => {
  const values = grid([[11, 27, 9], [11, 40, 1], [25, 49, 1]]);

  it("moves one cell per arrow and stops at the edges", () => {
    expect(moveCell("ArrowUp", { row: 11, col: 27 }, LEO_AND_FLOOR_ROWS, values, false)).toEqual({ row: 12, col: 27 });
    expect(moveCell("ArrowLeft", { row: 11, col: 0 }, LEO_AND_FLOOR_ROWS, values, false)).toEqual({ row: 11, col: 0 });
    expect(moveCell("ArrowDown", { row: 0, col: 5 }, LEO_AND_FLOOR_ROWS, values, false)).toEqual({ row: 0, col: 5 });
    expect(moveCell("Tab", { row: 11, col: 27 }, LEO_AND_FLOOR_ROWS, values, false)).toBeNull();
  });

  it("jumps to the next non-empty cell with Shift, or stays when there is none", () => {
    expect(moveCell("ArrowRight", { row: 11, col: 27 }, LEO_AND_FLOOR_ROWS, values, true)).toEqual({ row: 11, col: 40 });
    expect(moveCell("ArrowRight", { row: 11, col: 40 }, LEO_AND_FLOOR_ROWS, values, true)).toEqual({ row: 11, col: 40 });
  });

  it("starts from the strongest cell and sums rows", () => {
    expect(strongestCell(values, LEO_AND_FLOOR_ROWS)).toEqual({ row: 11, col: 27 });
    expect(strongestCell(new Float64Array(ROWS * COLS), LEO_AND_FLOOR_ROWS)).toBeNull();
    expect(rowSum(values, 11)).toBe(10);
  });
});
