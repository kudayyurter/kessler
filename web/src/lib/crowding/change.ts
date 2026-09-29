import type { CrowdingDay } from "@/lib/crowding/format";
import { cellIndex, cellsOf, COLS, passesFilter, R_EARTH_KM, rowAllowed, ROWS, type CrowdingFilter } from "@/lib/crowding/grid";

/** An object "moved" when its mean altitude changed by at least this much… */
export const MOVE_ALT_KM = 5;
/** …or its inclination by at least this much; smaller changes are element jitter. */
export const MOVE_INC_DEG = 0.1;

export type Cause = "new" | "reentered" | "untracked" | "movedIn" | "movedOut";
export const CAUSES: readonly Cause[] = ["new", "reentered", "untracked", "movedIn", "movedOut"];

export interface CrowdingChange {
  /** Weight per cell for each cause, all non-negative (ROWS × COLS). */
  cause: Record<Cause, Float64Array>;
  /** new + movedIn − movedOut − reentered − untracked, per cell. */
  net: Float64Array;
  /** Objects per cause (moved: objects whose in-view cells changed). */
  counts: { new: number; reentered: number; untracked: number; moved: number };
}

export interface Mover {
  noradId: number;
  cause: Cause;
  before: { altKm: number; incDeg: number } | null;
  after: { altKm: number; incDeg: number } | null;
  /** Signed weight change in the cell. */
  delta: number;
}

/** Compared in the file's own units (0.1 km, 0.01°), so the thresholds are exact. */
export function hasMoved(a: CrowdingDay, ia: number, b: CrowdingDay, ib: number): boolean {
  const dAlt = Math.abs(Math.round((b.smaKm[ib] - a.smaKm[ia]) * 10));
  const dInc = Math.abs(Math.round((b.incDeg[ib] - a.incDeg[ia]) * 100));
  return dAlt >= MOVE_ALT_KM * 10 || dInc >= Math.round(MOVE_INC_DEG * 100);
}

/** Adds an object's in-view weights to `into` (cell → signed weight), scaled by `sign`. */
function addWeights(day: CrowdingDay, i: number, f: CrowdingFilter, sign: number, into: Map<number, number>): void {
  for (const [row, col, w] of cellsOf(day.smaKm[i], day.ecc[i], day.incDeg[i]) ?? []) {
    if (!rowAllowed(row, f.orbits)) continue;
    const k = cellIndex(row, col);
    into.set(k, (into.get(k) ?? 0) + sign * w);
  }
}

type Visit = { cause: "new" | "gone" | "moved"; gone?: "reentered" | "untracked"; ia: number | null; ib: number | null; cells: Map<number, number> };

/** Walks both days in NORAD order and reports every object whose in-view weights changed. */
function walk(a: CrowdingDay, b: CrowdingDay, reentries: Readonly<Record<string, string>>, f: CrowdingFilter, visit: (v: Visit) => void): void {
  let i = 0;
  let j = 0;
  while (i < a.norad.length || j < b.norad.length) {
    const idA = i < a.norad.length ? a.norad[i] : Infinity;
    const idB = j < b.norad.length ? b.norad[j] : Infinity;
    const cells = new Map<number, number>();
    if (idA === idB) {
      if (passesFilter(b, j, f) && hasMoved(a, i, b, j)) {
        addWeights(b, j, f, 1, cells);
        addWeights(a, i, f, -1, cells);
        if ([...cells.values()].some((d) => d !== 0)) visit({ cause: "moved", ia: i, ib: j, cells });
      }
      i++;
      j++;
    } else if (idB < idA) {
      if (passesFilter(b, j, f)) {
        addWeights(b, j, f, 1, cells);
        if (cells.size) visit({ cause: "new", ia: null, ib: j, cells });
      }
      j++;
    } else {
      if (passesFilter(a, i, f)) {
        addWeights(a, i, f, -1, cells);
        const decay = reentries[String(idA)];
        const gone = decay !== undefined && decay <= b.header.day ? "reentered" : "untracked";
        if (cells.size) visit({ cause: "gone", gone, ia: i, ib: null, cells });
      }
      i++;
    }
  }
}

export function buildChange(a: CrowdingDay, b: CrowdingDay, reentries: Readonly<Record<string, string>>, f: CrowdingFilter): CrowdingChange {
  const cause = Object.fromEntries(CAUSES.map((c) => [c, new Float64Array(ROWS * COLS)])) as Record<Cause, Float64Array>;
  const counts = { new: 0, reentered: 0, untracked: 0, moved: 0 };
  walk(a, b, reentries, f, (v) => {
    const kind = v.cause === "gone" ? v.gone! : v.cause;
    counts[kind]++;
    for (const [k, d] of v.cells) {
      if (v.cause === "moved") {
        if (d > 0) cause.movedIn[k] += d;
        else if (d < 0) cause.movedOut[k] -= d;
      } else if (v.cause === "new") cause.new[k] += d;
      else cause[v.gone!][k] -= d;
    }
  });
  const net = new Float64Array(ROWS * COLS);
  for (let k = 0; k < net.length; k++) {
    net[k] = cause.new[k] + cause.movedIn[k] - cause.movedOut[k] - cause.reentered[k] - cause.untracked[k];
  }
  return { cause, net, counts };
}

const at = (day: CrowdingDay, i: number | null) => (i === null ? null : { altKm: day.smaKm[i] - R_EARTH_KM, incDeg: day.incDeg[i] });

export function moversInCell(
  a: CrowdingDay, b: CrowdingDay, reentries: Readonly<Record<string, string>>, f: CrowdingFilter, cell: number, limit = 5,
): Mover[] {
  const out: Mover[] = [];
  walk(a, b, reentries, f, (v) => {
    const delta = v.cells.get(cell);
    if (!delta) return;
    const cause: Cause = v.cause === "moved" ? (delta > 0 ? "movedIn" : "movedOut") : v.cause === "new" ? "new" : v.gone!;
    const noradId = v.ib !== null ? b.norad[v.ib] : a.norad[v.ia!];
    out.push({ noradId, cause, before: at(a, v.ia), after: at(b, v.ib), delta });
  });
  return out.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta) || x.noradId - y.noradId).slice(0, limit);
}
