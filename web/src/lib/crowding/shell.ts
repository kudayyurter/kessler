import {
  CIRCULAR_ECC, cellLabel, columnOf, columnRange, placeable, R_EARTH_KM, rowOf, rowRange, semiMajorAxisKm, type Cell,
} from "@/lib/crowding/grid";

/** A pinned or hovered crowding cell. */
export type Shell = Cell;

export function shellLabel(s: Shell): string {
  return `Shell ${cellLabel(s)}`;
}

/** Whether an orbit spends any time in the cell: its perigee–apogee altitudes overlap the cell's,
 * and its inclination is in the cell's column. `meanMotion` is in revolutions per day. */
export function inShell(r: { meanMotion: number; eccentricity: number; inclination: number }, s: Shell): boolean {
  const a = semiMajorAxisKm(r.meanMotion);
  if (!placeable(a, r.eccentricity, r.inclination) || columnOf(r.inclination) !== s.col) return false;
  if (r.eccentricity < CIRCULAR_ECC) return rowOf(a - R_EARTH_KM) === s.row;
  const [lo, hi] = rowRange(s.row);
  return a * (1 - r.eccentricity) - R_EARTH_KM < hi && a * (1 + r.eccentricity) - R_EARTH_KM >= lo;
}

/** The highest latitude any orbit in the cell's band reaches: orbits at inclination i fly between
 * ±min(i, 180° − i). */
export function latitudeLimitDeg(s: Shell): number {
  const [lo, hi] = columnRange(s.col);
  if (hi <= 90) return hi;
  if (lo >= 90) return 180 - lo;
  return 90;
}

/** Where to draw the shell's ring: the row's middle altitude; 100 km for the floor row; none for
 * the open-ended top row. */
export function ringAltitudeKm(s: Shell): number | null {
  const [lo, hi] = rowRange(s.row);
  if (!Number.isFinite(hi)) return null;
  if (!Number.isFinite(lo)) return hi / 2;
  return (lo + hi) / 2;
}
