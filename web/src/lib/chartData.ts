import type { ObjectType, OwnerSummary, TimeseriesResponse, BreakdownResponse } from "@/lib/types";

export const ANNOTATIONS: { year: number; label: string; row: 0 | 1 }[] = [
  { year: 2007, label: "Fengyun-1C ASAT test", row: 0 },
  { year: 2009, label: "Iridium–Cosmos collision", row: 1 },
  { year: 2019, label: "Starlink launches begin", row: 0 },
  { year: 2021, label: "Kosmos 1408 ASAT test", row: 1 },
];

/** Display order for type chips, legends, lines and stacks. */
export const TYPE_ORDER: ObjectType[] = ["PAY", "DEB", "R/B", "UNK"];

export function visibleTypeSeries(ts: TimeseriesResponse): { key: ObjectType; values: number[] }[] {
  return TYPE_ORDER.flatMap((key) => {
    const s = ts.series.find((x) => x.key === key);
    return s ? [{ key, values: s.values }] : [];
  });
}

export function crossoverYear(ts: TimeseriesResponse): number | null {
  const pay = ts.series.find((s) => s.key === "PAY")?.values;
  const deb = ts.series.find((s) => s.key === "DEB")?.values;
  if (!pay || !deb) return null;
  let debrisLed = false;
  for (let i = 0; i < ts.years.length; i++) {
    if (deb[i] > pay[i]) debrisLed = true;
    else if (debrisLed && pay[i] > deb[i]) return ts.years[i];
  }
  return null;
}

export function chartTitle(ts: TimeseriesResponse): string {
  const year = crossoverYear(ts);
  return year ? `Payloads overtook debris in ${year}` : "Objects in orbit by type";
}

export function ownerLabel(key: string, owners: OwnerSummary[]): string {
  if (key === "_other") return "Other";
  return owners.find((o) => o.code === key)?.name ?? key;
}

export interface ExtraRow {
  key: string;
  rank: number | null;
  counts: Partial<Record<ObjectType, number>>;
  total: number;
}

/** Which Owners row to highlight, and — when the selected owner isn't among the ranked rows — the
 * extra row to show under them (from the response's `rank_of`; empty when it has none).
 *
 * `rankFor` is the owner `data` actually asked `rank_of` for — the selected owner can change
 * (or be cleared) before a slower-to-arrive response for a previous owner lands, and `data` is
 * kept on screen until a newer one does. Trusting `data.rank_of` for a `selected` it wasn't
 * fetched for would show a stale rank ("Germany #9" while UAE is selected) or, worse, a false
 * "none under these filters" (`rank_of: null` for a previous owner, misread as confirming that
 * *this* owner has none) — so while `rankFor !== selected` there is no extra row at all, only the
 * highlight rule for rows already ranked. */
export function ownerHighlight(
  data: BreakdownResponse,
  selected: string | null,
  rankFor: string | null,
): { highlight: string | null; extra: ExtraRow | null } {
  if (selected === null) return { highlight: null, extra: null };
  if (data.rows.some((r) => r.key === selected)) return { highlight: selected, extra: null };
  if (rankFor !== selected) return { highlight: selected, extra: null };
  const r = data.rank_of;
  return {
    highlight: selected,
    extra: r && r.key === selected ? { key: r.key, rank: r.rank, counts: r.counts, total: r.total } : { key: selected, rank: null, counts: {}, total: 0 },
  };
}
