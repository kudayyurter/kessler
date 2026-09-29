import { cellIndex, COLS, FIRST_LEO_ROW, FLOOR_ROW, LAST_LEO_ROW, rowLabel, rowRange, type Cell } from "@/lib/crowding/grid";

type Rgb = readonly [number, number, number];
export const NOW_STOPS: readonly Rgb[] = [[14, 14, 14], [70, 24, 20], [160, 45, 30], [255, 106, 61], [255, 200, 140], [255, 244, 214]];
export const GAIN_STOPS: readonly Rgb[] = [[10, 10, 10], [107, 42, 31], [255, 106, 61], [255, 244, 214]];
export const LOSS_STOPS: readonly Rgb[] = [[10, 10, 10], [31, 63, 120], [127, 176, 255], [207, 226, 255]];
export const EMPTY_FILL = "#0a0a0a";
export const OUTLINE = "#7fd06b";
/** Cells below this (average objects, or net change) are drawn empty and skipped by Shift+arrow. */
const NOW_MIN = 0.02;
const CHANGE_MIN = 0.05;

export function ramp(stops: readonly Rgb[], t: number): string {
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** log10(1 + |v|) / log10(1 + max): 0 for nothing, 1 at the maximum. */
export function logScale(v: number, max: number): number {
  return max <= 0 ? 0 : Math.log10(1 + Math.abs(v)) / Math.log10(1 + max);
}

export function nowColor(v: number, max: number): string | null {
  return v <= NOW_MIN ? null : ramp(NOW_STOPS, logScale(v, max));
}

export function changeColor(v: number, max: number): string | null {
  if (Math.abs(v) < CHANGE_MIN) return null;
  return ramp(v > 0 ? GAIN_STOPS : LOSS_STOPS, logScale(v, max));
}

export function rowsBetween(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, k) => first + k);
}
export const LEO_AND_FLOOR_ROWS: readonly number[] = rowsBetween(FLOOR_ROW, LAST_LEO_ROW);
export const HIGH_STRIP_ROWS: readonly number[] = rowsBetween(LAST_LEO_ROW + 1, LAST_LEO_ROW + 6);
export const ALL_ROWS: readonly number[] = rowsBetween(FLOOR_ROW, LAST_LEO_ROW + 6);
/** Short names that fit the 44 px label margin; the tooltip and card give the exact ranges. */
export const HIGH_ROW_NAMES: Readonly<Record<number, string>> = {
  73: "2–8k", 74: "8–18k", 75: "GNSS", 76: "sub-GEO", 77: "GEO", 78: ">GEO",
};

export function maxAbs(values: Float64Array, rows: readonly number[]): number {
  let m = 0;
  for (const r of rows) for (let c = 0; c < COLS; c++) m = Math.max(m, Math.abs(values[cellIndex(r, c)]));
  return m;
}

export function rowSum(values: Float64Array, row: number): number {
  let s = 0;
  for (let c = 0; c < COLS; c++) s += values[cellIndex(row, c)];
  return s;
}

/** Where cells sit on a canvas: `rows` from the bottom up (altitude grows upwards), columns left to
 * right, after a left margin for labels and above a bottom margin. */
export interface GridLayout {
  rows: readonly number[];
  cellW: number;
  cellH: number;
  padLeft: number;
  padBottom: number;
  width: number;
  height: number;
}

export function gridLayout(rows: readonly number[], cellW: number, cellH: number, padLeft: number, padBottom: number): GridLayout {
  return { rows, cellW, cellH, padLeft, padBottom, width: padLeft + COLS * cellW, height: rows.length * cellH + padBottom };
}

export function cellRect(l: GridLayout, cell: Cell): { x: number; y: number; w: number; h: number } | null {
  const k = l.rows.indexOf(cell.row);
  if (k < 0) return null;
  return { x: l.padLeft + cell.col * l.cellW, y: (l.rows.length - 1 - k) * l.cellH, w: l.cellW, h: l.cellH };
}

export function cellAt(l: GridLayout, x: number, y: number): Cell | null {
  const col = Math.floor((x - l.padLeft) / l.cellW);
  const k = l.rows.length - 1 - Math.floor(y / l.cellH);
  if (x < l.padLeft || col >= COLS || y < 0 || k < 0 || k >= l.rows.length) return null;
  return { row: l.rows[k], col };
}

const STEPS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowUp: [1, 0], ArrowDown: [-1, 0], ArrowRight: [0, 1], ArrowLeft: [0, -1],
};

/** Arrow keys move one cell (up = higher); with Shift, to the next cell that is drawn. Stays put
 * at an edge; null for other keys. */
export function moveCell(key: string, cell: Cell, rows: readonly number[], values: Float64Array | null, shift: boolean): Cell | null {
  const step = STEPS[key];
  if (!step) return null;
  let k = rows.indexOf(cell.row);
  let col = cell.col;
  for (;;) {
    const nk = k + step[0];
    const nc = col + step[1];
    if (nk < 0 || nk >= rows.length || nc < 0 || nc >= COLS) return cell;
    k = nk;
    col = nc;
    if (!shift || !values || Math.abs(values[cellIndex(rows[k], col)]) > NOW_MIN) return { row: rows[k], col };
  }
}

export function strongestCell(values: Float64Array, rows: readonly number[]): Cell | null {
  let best: Cell | null = null;
  let top = 0;
  for (const row of rows) {
    for (let col = 0; col < COLS; col++) {
      const v = Math.abs(values[cellIndex(row, col)]);
      if (v > top) {
        top = v;
        best = { row, col };
      }
    }
  }
  return best;
}

/** Axis text: altitude ticks every 200 km (400 km on small cells), "<200" on the floor row, the
 * unit, and inclination every 30° (60° on small cells); or one name per row for the high strip. */
export function axisLabels(l: GridLayout, axes: "ticks" | "names"): { text: string; x: number; y: number }[] {
  const out: { text: string; x: number; y: number }[] = [];
  const centre = (k: number) => (l.rows.length - 1 - k + 0.5) * l.cellH;
  if (axes === "names") {
    l.rows.forEach((row, k) => out.push({ text: HIGH_ROW_NAMES[row] ?? rowLabel(row), x: 0, y: centre(k) }));
    return out;
  }
  const every = l.cellH >= 4 ? 200 : 400;
  l.rows.forEach((row, k) => {
    const [lo] = rowRange(row);
    if (row === FLOOR_ROW) out.push({ text: "<200", x: 0, y: centre(k) });
    else if (row >= FIRST_LEO_ROW && row <= LAST_LEO_ROW && lo !== 200 && lo % every === 0) {
      out.push({ text: String(lo), x: 0, y: (l.rows.length - k) * l.cellH });
    }
  });
  const base = l.rows.length * l.cellH + l.padBottom / 2 + 1;
  out.push({ text: "km", x: 0, y: base });
  const step = l.cellW >= 4 ? 30 : 60;
  for (let inc = 0; inc <= 180; inc += step) {
    out.push({ text: `${inc}°`, x: Math.min(l.padLeft + ((inc + 1.5) / 2) * l.cellW - 6, l.width - 24), y: base });
  }
  return out;
}
