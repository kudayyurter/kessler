import { describe, expect, it } from "vitest";
import { historyTable, latestValues, ownersTable } from "@/lib/chartTables";
import type { BreakdownResponse, ObjectType, OwnerSummary, TimeseriesResponse } from "@/lib/types";

const TS = {
  metric: "in_orbit", group_by: "type", years: [2024, 2025, 2026],
  series: [
    { key: "DEB", values: [5, 6, 7] }, { key: "PAY", values: [1, 2, 3] }, { key: "UNK", values: [0, 1, 1] },
  ],
} as unknown as TimeseriesResponse;
const ALL: ObjectType[] = ["PAY", "R/B", "DEB", "UNK"];
const OWNERS: OwnerSummary[] = [
  { code: "US", name: "United States", flag_emoji: "🇺🇸", in_orbit: 10, total: 12 },
  { code: "GER", name: "Germany", flag_emoji: "🇩🇪", in_orbit: 3, total: 3 },
];
const BARS = (extra: Partial<BreakdownResponse> = {}): BreakdownResponse => ({
  at: 2026, by: "owner",
  rows: [
    { key: "US", counts: { PAY: 8, DEB: 2 }, total: 10 },
    { key: "_other", counts: { PAY: 4, DEB: 1 }, total: 5 },
  ],
  ...extra,
});

describe("historyTable", () => {
  it("lists years newest first with the chart's series in display order and a total", () => {
    expect(historyTable(TS)).toEqual({
      columns: ["PAY", "DEB", "UNK"],
      rows: [
        { year: 2026, values: [3, 7, 1], total: 11 },
        { year: 2025, values: [2, 6, 1], total: 9 },
        { year: 2024, values: [1, 5, 0], total: 6 },
      ],
    });
  });

  it("handles no years", () => {
    expect(historyTable({ ...TS, years: [], series: [] } as unknown as TimeseriesResponse)).toEqual({ columns: [], rows: [] });
  });
});

describe("latestValues", () => {
  it("gives each shown series' latest value", () => {
    expect(latestValues(TS)).toEqual([{ key: "PAY", value: 3 }, { key: "DEB", value: 7 }, { key: "UNK", value: 1 }]);
  });
});

describe("ownersTable", () => {
  it("ranks the rows, keeps Other unranked, and uses the selected types as columns", () => {
    const t = ownersTable(BARS(), OWNERS, null, null, ["PAY", "DEB"]);
    expect(t.columns).toEqual(["PAY", "DEB"]);
    expect(t.rows).toEqual([
      { key: "US", rank: 1, label: "United States", values: [8, 2], total: 10, selected: false },
      { key: "_other", rank: null, label: "Other", values: [4, 1], total: 5, selected: false },
    ]);
  });

  it("marks a selected ranked owner", () => {
    const t = ownersTable(BARS(), OWNERS, "US", "US", ALL);
    expect(t.rows[0]).toMatchObject({ key: "US", selected: true, label: "United States (selected)" });
  });

  it("adds the selected owner outside the ranked rows with its rank", () => {
    const t = ownersTable(BARS({ rank_of: { key: "GER", rank: 9, counts: { PAY: 3 }, total: 3 } }), OWNERS, "GER", "GER", ALL);
    expect(t.rows.at(-1)).toEqual({ key: "GER", rank: 9, label: "Germany (selected)", values: [3, 0, 0, 0], total: 3, selected: true });
  });

  it("an owner with none under the filters gets a row with no rank and zeros", () => {
    const t = ownersTable(BARS({ rank_of: null }), OWNERS, "GER", "GER", ALL);
    expect(t.rows.at(-1)).toEqual({ key: "GER", rank: null, label: "Germany (selected)", values: [0, 0, 0, 0], total: 0, selected: true });
  });

  it("adds no extra row while the response was fetched for a different owner", () => {
    const t = ownersTable(BARS({ rank_of: null }), OWNERS, "GER", "US", ALL);
    expect(t.rows.map((r) => r.key)).toEqual(["US", "_other"]);
  });
});
