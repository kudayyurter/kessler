/** The globe status pill's state, derived from the globe data (see createGlobeData) — pure, so
 * every row of the spec's table is unit-tested. */

export type Tone = "green" | "amber" | "red" | "grey";
export type PillGroup = "LEO" | "HIGH";
export type PillGroupStatus = "idle" | "loading" | "ready" | "missing" | "error";

export interface PillInput {
  groups: Record<PillGroup, { status: PillGroupStatus }>;
  /** The groups the orbit filter currently shows. */
  wanted: PillGroup[];
  /** When the shown data was published (ms since epoch), or null before any is shown. */
  generatedAt: number | null;
}

export interface PillStatus {
  tone: Tone;
  word: "LOADING ORBITS…" | "NO DATA YET" | "NO ORBIT DATA" | "LIVE" | "DELAYED";
  /** Replaces the age: a failure ("higher orbits failed") or progress ("loading higher orbits…"). */
  note: string | null;
  /** "2h ago" — the pill prefixes "updated " where there is room. */
  age: string | null;
  /** Groups the Retry button reloads; empty = no Retry. */
  retry: PillGroup[];
  /** Tooltip with the exact publish time. */
  title: string | null;
}

export const STALE_AFTER_MS = 12 * 60 * 60 * 1000;

export const TONE_COLOR: Record<Tone, string> = { green: "#7fd06b", amber: "#e8b04a", red: "#e0604f", grey: "#a8a7a1" };

const LABEL: Record<PillGroup, string> = { LEO: "low orbits", HIGH: "higher orbits" };
const names = (groups: PillGroup[]) => groups.map((g) => LABEL[g]).join(" and ");

export function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function deriveStatus(input: PillInput, now: number): PillStatus {
  const having = (match: (s: PillGroupStatus) => boolean) => input.wanted.filter((g) => match(input.groups[g].status));
  const ready = having((s) => s === "ready");
  const failed = having((s) => s === "error");
  const loading = having((s) => s === "loading" || s === "idle");
  const missing = having((s) => s === "missing");
  const title =
    input.generatedAt === null
      ? null
      : `Elements published ${new Date(input.generatedAt).toISOString().slice(0, 16).replace("T", " ")} UTC`;
  const base = { note: null, age: null, retry: [] as PillGroup[], title };

  if (ready.length === 0) {
    if (loading.length > 0) return { ...base, tone: "grey", word: "LOADING ORBITS…" };
    if (failed.length > 0) return { ...base, tone: "red", word: "NO ORBIT DATA", retry: failed };
    return { ...base, tone: "grey", word: "NO DATA YET" };
  }

  const stale = input.generatedAt !== null && now - input.generatedAt > STALE_AFTER_MS;
  const word = stale ? "DELAYED" : "LIVE";
  if (failed.length > 0) return { ...base, tone: "amber", word, note: `${names(failed)} failed`, retry: failed };
  if (missing.length > 0) return { ...base, tone: "amber", word, note: `${names(missing)} not available` };
  const tone: Tone = stale ? "amber" : "green";
  if (loading.length > 0) return { ...base, tone, word, note: `loading ${names(loading)}…` };
  return { ...base, tone, word, age: input.generatedAt === null ? null : formatAge(now - input.generatedAt) };
}
