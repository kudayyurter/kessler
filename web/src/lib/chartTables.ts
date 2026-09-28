import { ownerHighlight, ownerLabel, TYPE_ORDER, visibleTypeSeries } from "@/lib/chartData";
import type { BreakdownResponse, ObjectType, OwnerSummary, TimeseriesResponse } from "@/lib/types";

/** The History chart's data as table rows: years newest first, one column per shown series. */
export function historyTable(ts: TimeseriesResponse): { columns: ObjectType[]; rows: { year: number; values: number[]; total: number }[] } {
  const series = visibleTypeSeries(ts);
  const rows = ts.years.map((year, i) => {
    const values = series.map((s) => s.values[i] ?? 0);
    return { year, values, total: values.reduce((a, b) => a + b, 0) };
  });
  return { columns: series.map((s) => s.key), rows: rows.reverse() };
}

/** Each shown series' latest (current) value — the narrow History legend. */
export function latestValues(ts: TimeseriesResponse): { key: ObjectType; value: number }[] {
  return visibleTypeSeries(ts).map((s) => ({ key: s.key, value: s.values[s.values.length - 1] ?? 0 }));
}

export interface OwnersTableRow {
  key: string;
  rank: number | null;
  label: string;
  values: number[];
  total: number;
  selected: boolean;
}

/** The Owners chart's data as table rows: the ranked rows (Other unranked), then the selected
 * owner when it isn't among them (with its rank, or none). Columns come from the response itself
 * — the types (in TYPE_ORDER) with any count in the rows the table shows (the ranked rows and the
 * extra row), like the bar chart's legend — never from the store's current type filter, which can
 * disagree with `data` mid-refetch (the rows shown are the previous response's, kept on screen
 * until a newer one lands). */
export function ownersTable(
  data: BreakdownResponse,
  owners: OwnerSummary[],
  selected: string | null,
  rankFor: string | null,
): { columns: ObjectType[]; rows: OwnersTableRow[] } {
  // Same rows as BarChart: its first six response rows (Other included), then ownerHighlight's extra.
  const { extra } = ownerHighlight(data, selected, rankFor);
  const ranked = data.rows.slice(0, 6);
  const shown = extra ? [...ranked, extra] : ranked;
  const columns = TYPE_ORDER.filter((t) => shown.some((r) => (r.counts[t] ?? 0) > 0));
  const row = (key: string, rank: number | null, counts: Partial<Record<ObjectType, number>>, total: number): OwnersTableRow => {
    const isSelected = key === selected;
    const name = ownerLabel(key, owners);
    return { key, rank, label: isSelected ? `${name} (selected)` : name, values: columns.map((t) => counts[t] ?? 0), total, selected: isSelected };
  };
  let rank = 0;
  const rows = ranked.map((r) => row(r.key, r.key === "_other" ? null : ++rank, r.counts, r.total));
  if (extra) rows.push(row(extra.key, extra.rank, extra.counts, extra.total));
  return { columns, rows };
}
