import type { CrowdingDay } from "@/lib/crowding/format";
import { fmtInt } from "@/lib/format";
import { OBJECT_TYPES, type ObjectType } from "@/lib/types";

/** Equatorial radius (km): altitudes are measured from it, like SATCAT's perigee and apogee. */
export const R_EARTH_KM = 6378.137;
const MU_KM3_S2 = 398600.4418;

/** Row edges (km): a floor row below 200 km, 72 LEO shells of 25 km, and six high-orbit rows
 * (see docs/superpowers/specs/2026-09-28-crowding-design.md, Measurements). */
export const ROW_EDGES_KM: readonly number[] = [
  -Infinity,
  ...Array.from({ length: 73 }, (_, k) => 200 + 25 * k),
  8000, 18000, 25000, 35586, 35986, Infinity,
];
export const ROWS = ROW_EDGES_KM.length - 1;
export const COLS = 91;
export const FLOOR_ROW = 0;
export const FIRST_LEO_ROW = 1;
export const LAST_LEO_ROW = 72;
export const FIRST_HIGH_ROW = 73;
export const LAST_HIGH_ROW = 78;
/** Below this eccentricity an orbit goes wholly into the row that holds a − R_E. */
export const CIRCULAR_ECC = 1e-6;

export type Cell = { row: number; col: number };
export const cellIndex = (row: number, col: number): number => row * COLS + col;

export function semiMajorAxisKm(meanMotionRevPerDay: number): number {
  const n = (meanMotionRevPerDay * 2 * Math.PI) / 86400;
  return Math.cbrt(MU_KM3_S2 / (n * n));
}

/** 2° columns with edges on half degrees: column c covers [2c − 1.5, 2c + 0.5). */
export function columnOf(incDeg: number): number {
  return Math.max(0, Math.min(Math.floor((incDeg - 0.5) / 2) + 1, COLS - 1));
}

export function columnRange(col: number): [number, number] {
  return col === 0 ? [0, 0.5] : [2 * col - 1.5, Math.min(2 * col + 0.5, 180)];
}

export function rowOf(altKm: number): number {
  if (altKm < 200) return FLOOR_ROW;
  if (altKm < 2000) return FIRST_LEO_ROW + Math.floor((altKm - 200) / 25);
  let r = FIRST_HIGH_ROW;
  while (r < LAST_HIGH_ROW && altKm >= ROW_EDGES_KM[r + 1]) r++;
  return r;
}

export function rowRange(row: number): [number, number] {
  return [ROW_EDGES_KM[row], ROW_EDGES_KM[row + 1]];
}

/** Fraction of an orbit spent at radius ≤ rKm (Kepler: M = E − e sin E). */
export function timeBelow(aKm: number, e: number, rKm: number): number {
  if (rKm <= aKm * (1 - e)) return 0;
  if (rKm >= aKm * (1 + e)) return 1;
  const E = Math.acos(Math.min(1, Math.max(-1, (1 - rKm / aKm) / e)));
  return (E - e * Math.sin(E)) / Math.PI;
}

export function placeable(aKm: number, e: number, incDeg: number): boolean {
  return Number.isFinite(aKm) && aKm > 0 && Number.isFinite(e) && e >= 0 && e < 1
    && Number.isFinite(incDeg) && incDeg >= 0 && incDeg <= 180;
}

/** Calls add(row, weight) for every row the orbit spends time in; the weights sum to 1. */
export function forEachRow(aKm: number, e: number, add: (row: number, w: number) => void): void {
  if (e < CIRCULAR_ECC) {
    add(rowOf(aKm - R_EARTH_KM), 1);
    return;
  }
  const first = rowOf(aKm * (1 - e) - R_EARTH_KM);
  const last = rowOf(aKm * (1 + e) - R_EARTH_KM);
  if (first === last) {
    add(first, 1);
    return;
  }
  let below = 0;
  for (let r = first; r <= last; r++) {
    const next = r === last ? 1 : timeBelow(aKm, e, R_EARTH_KM + ROW_EDGES_KM[r + 1]);
    if (next - below > 0) add(r, next - below);
    below = next;
  }
}

/** [row, column, weight] for every cell an orbit spends time in, or null when it can't be placed. */
export function cellsOf(aKm: number, e: number, incDeg: number): [number, number, number][] | null {
  if (!placeable(aKm, e, incDeg)) return null;
  const col = columnOf(incDeg);
  const out: [number, number, number][] = [];
  forEachRow(aKm, e, (row, w) => out.push([row, col, w]));
  return out;
}

export interface CrowdingFilter {
  types: readonly ObjectType[];
  owners: readonly string[];
  orbits: { leo: boolean; high: boolean };
}

/** "Low Earth orbit" fills the floor and LEO rows; "Higher orbits" fills the high strip. */
export function rowAllowed(row: number, orbits: CrowdingFilter["orbits"]): boolean {
  return row < FIRST_HIGH_ROW ? orbits.leo : orbits.high;
}

export function passesFilter(day: CrowdingDay, i: number, f: CrowdingFilter): boolean {
  if (!f.types.includes(day.header.types[day.type[i]])) return false;
  return f.owners.length === 0 || f.owners.includes(day.header.owners[day.owner[i]]);
}

export interface CrowdingMap {
  /** Average number of objects in each cell at any moment (ROWS × COLS, see cellIndex). */
  total: Float64Array;
  byType: Record<ObjectType, Float64Array>;
  /** How many objects spend any time in each cell. */
  passing: Uint32Array;
  /** Objects that passed the filters and landed in at least one allowed row. */
  objects: number;
  /** Objects that couldn't be placed (e ≥ 1 …), plus the rows the file itself skipped. */
  skipped: number;
}

export function buildMap(day: CrowdingDay, f: CrowdingFilter): CrowdingMap {
  const total = new Float64Array(ROWS * COLS);
  const passing = new Uint32Array(ROWS * COLS);
  const byType = Object.fromEntries(OBJECT_TYPES.map((t) => [t, new Float64Array(ROWS * COLS)])) as Record<ObjectType, Float64Array>;
  let objects = 0;
  let skipped = day.header.skipped;
  for (let i = 0; i < day.norad.length; i++) {
    const a = day.smaKm[i], e = day.ecc[i], inc = day.incDeg[i];
    if (!placeable(a, e, inc)) {
      skipped++;
      continue;
    }
    if (!passesFilter(day, i, f)) continue;
    const col = columnOf(inc);
    const typed = byType[day.header.types[day.type[i]]];
    let placed = false;
    forEachRow(a, e, (row, w) => {
      if (!rowAllowed(row, f.orbits)) return;
      const k = cellIndex(row, col);
      total[k] += w;
      typed[k] += w;
      passing[k] += 1;
      placed = true;
    });
    if (placed) objects++;
  }
  return { total, byType, passing, objects, skipped };
}

export function rowTotal(map: CrowdingMap, row: number, type?: ObjectType): number {
  const values = type ? map.byType[type] : map.total;
  let s = 0;
  for (let c = 0; c < COLS; c++) s += values[cellIndex(row, c)];
  return s;
}

export function shellVolumeKm3(row: number): number {
  const [lo, hi] = rowRange(row);
  return (4 / 3) * Math.PI * ((R_EARTH_KM + hi) ** 3 - (R_EARTH_KM + lo) ** 3);
}

/** Objects per 10⁹ km³ in a LEO shell (rows 1–72), all types or one; 0 for other rows. */
export function shellDensity(map: CrowdingMap, row: number, type?: ObjectType): number {
  if (row < FIRST_LEO_ROW || row > LAST_LEO_ROW) return 0;
  return (rowTotal(map, row, type) / shellVolumeKm3(row)) * 1e9;
}

export function busiestShell(map: CrowdingMap): { row: number; density: number } | null {
  let best: { row: number; density: number } | null = null;
  for (let r = FIRST_LEO_ROW; r <= LAST_LEO_ROW; r++) {
    const density = shellDensity(map, r);
    if (density > 0 && (best === null || density > best.density)) best = { row: r, density };
  }
  return best;
}

export function rowLabel(row: number): string {
  const [lo, hi] = rowRange(row);
  if (!Number.isFinite(lo)) return `< ${fmtInt(hi)} km`;
  if (!Number.isFinite(hi)) return `> ${fmtInt(lo)} km`;
  return `${fmtInt(lo)}–${fmtInt(hi)} km`;
}

export function columnLabel(col: number): string {
  const [lo, hi] = columnRange(col);
  return `${lo}–${hi}°`;
}

export function cellLabel(cell: Cell): string {
  return `${rowLabel(cell.row)} · ${columnLabel(cell.col)}`;
}
