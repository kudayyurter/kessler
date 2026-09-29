/** A comparison window in days, or everything since the first day. */
export type Gap = number | "all";
export const CHIP_GAPS: readonly Gap[] = [1, 7, 30, "all"];

export const gapLabel = (g: Gap): string => (g === "all" ? "All" : `${g} d`);
export const gapHint = (g: Gap): string => `needs ${g === "all" ? 2 : g} days of history`;

const DAY_MS = 86_400_000;
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/** A window is usable once the history spans it. */
export function gapEnabled(g: Gap, days: readonly string[]): boolean {
  if (days.length < 2) return false;
  return g === "all" || daysBetween(days[0], days[days.length - 1]) >= g;
}

export function defaultGap(days: readonly string[]): Gap {
  return gapEnabled(7, days) ? 7 : "all";
}

/** The latest available day on or before `target`; the earliest day when `target` precedes them all. */
export function snapDay(target: string, days: readonly string[]): string | null {
  if (days.length === 0) return null;
  let best: string | null = null;
  for (const d of days) if (d <= target) best = d;
  return best ?? days[0];
}

/** The window that ends on `to`, or null when it would be empty (nothing earlier to compare with). */
export function windowFor(to: string, gap: Gap, days: readonly string[]): { from: string; to: string } | null {
  const from = gap === "all" ? days[0] : snapDay(addDays(to, -gap), days);
  return from !== undefined && from !== null && from < to ? { from, to } : null;
}

/** The days Play shows: every day (Now) or every day with an earlier one to compare with (Change),
 * at most `max` of them, evenly spaced and always ending on the latest day. */
export function playFrames(days: readonly string[], mode: "now" | "change", gap: Gap, max = 60): string[] {
  const candidates = mode === "now" ? [...days] : days.filter((d) => windowFor(d, gap, days) !== null);
  if (candidates.length <= max) return candidates;
  const step = Math.ceil(candidates.length / max);
  const out: string[] = [];
  for (let i = candidates.length - 1; i >= 0; i -= step) out.unshift(candidates[i]);
  return out;
}
