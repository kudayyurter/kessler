import { api } from "@/lib/api";

type Group = "LEO" | "HIGH";
type Entry = { map: Map<number, string> | null; pending: Promise<Map<number, string> | null> | null; failedAt: number | null };

export function createNameCache(
  fetcher: (g: Group, generation?: string) => Promise<Record<string, string>>,
  now: () => number = Date.now,
  cooldownMs = 60_000,
) {
  const GROUPS: Group[] = ["LEO", "HIGH"];
  const fresh = (): Record<Group, Entry> => ({
    LEO: { map: null, pending: null, failedAt: null },
    HIGH: { map: null, pending: null, failedAt: null },
  });
  let generation: string | undefined;
  let entries = fresh();
  // Per group, the last GOOD (successfully loaded) map, kept only until that group's map for the
  // CURRENT generation loads. Without it, LabelDriver's next reselect finds peek() null the
  // instant the generation switches and drops every label until the new names file arrives —
  // names are keyed by NORAD ID, so the old map still reads right for objects present in both
  // generations. Updated on every switch (not replaced with the outgoing entries wholesale): a
  // group with nothing loaded yet keeps whatever fallback it already had, so switching twice
  // before a load still serves the last good map instead of losing it.
  const fallback: Record<Group, Map<number, string> | null> = { LEO: null, HIGH: null };
  return {
    /** Names belong to one snapshot generation: switching keeps each group's last good map as a
     * fallback (see `fallback` above) until that group's own map for the new generation loads. */
    useGeneration(next: string | undefined) {
      if (next === generation) return;
      generation = next;
      for (const g of GROUPS) if (entries[g].map) fallback[g] = entries[g].map;
      entries = fresh();
    },
    peek: (g: Group) => entries[g].map ?? fallback[g],
    /** Whether `g`'s map for the CURRENT generation (not a fallback) has loaded. LabelDriver uses
     * this to decide whether to request it — independent of whether `peek()` already has
     * something to show via the fallback. */
    ready: (g: Group) => entries[g].map !== null,
    get(g: Group): Promise<Map<number, string> | null> {
      const e = entries[g];
      if (e.map) return Promise.resolve(e.map);
      if (e.pending) return e.pending;
      if (e.failedAt !== null && now() - e.failedAt < cooldownMs) return Promise.resolve(null);
      e.pending = fetcher(g, generation)
        .then((names) => {
          e.map = new Map(Object.entries(names).map(([k, v]) => [Number(k), v]));
          e.failedAt = null;
          fallback[g] = null; // this generation now has its own map; drop the stand-in
          return e.map;
        })
        .catch(() => {
          e.failedAt = now();
          return null;
        })
        .finally(() => {
          e.pending = null;
        });
      return e.pending;
    },
  };
}

export const nameCache = createNameCache((g, generation) => api.names(g, generation));
