import { describe, expect, it } from "vitest";
import { chartTitle, crossoverYear, ownerLabel, visibleTypeSeries, ownerHighlight } from "@/lib/chartData";
import type { TimeseriesResponse, BreakdownResponse } from "@/lib/types";

const TS: TimeseriesResponse = {
  metric: "in_orbit", group_by: "type", years: [2022, 2023, 2024, 2025],
  series: [
    { key: "DEB", values: [11375, 10692, 10533, 9994] },
    { key: "PAY", values: [8039, 10204, 11895, 15229] },
    { key: "UNK", values: [40, 45, 50, 52] },
    { key: "R/B", values: [981, 970, 975, 978] },
  ],
};

describe("chartData", () => {
  it("keeps PAY, DEB, R/B in a fixed order and includes Unknown", () => {
    expect(visibleTypeSeries(TS).map((s) => s.key)).toEqual(["PAY", "DEB", "R/B", "UNK"]);
  });
  it("finds the year payloads overtook debris", () => {
    expect(crossoverYear(TS)).toBe(2024);
    expect(chartTitle(TS)).toBe("Payloads overtook debris in 2024");
  });
  it("falls back to a neutral title without a crossover", () => {
    const flat: TimeseriesResponse = { ...TS, series: [{ key: "DEB", values: [5, 5, 5, 5] }, { key: "PAY", values: [1, 1, 1, 1] }] };
    expect(crossoverYear(flat)).toBeNull();
    expect(chartTitle(flat)).toBe("Objects in orbit by type");
  });
  it("labels owners", () => {
    const owners = [{ code: "US", name: "United States", flag_emoji: null, in_orbit: 1, total: 1 }];
    expect(ownerLabel("US", owners)).toBe("United States");
    expect(ownerLabel("_other", owners)).toBe("Other");
    expect(ownerLabel("POR", owners)).toBe("POR");
  });
});

describe("visibleTypeSeries with Unknown", () => {
  it("includes the Unknown series, after the other three", () => {
    const ts = { metric: "in_orbit", group_by: "type", years: [2020], series: [
      { key: "UNK", values: [1] }, { key: "PAY", values: [2] }, { key: "DEB", values: [3] }, { key: "R/B", values: [4] },
    ] } as unknown as Parameters<typeof visibleTypeSeries>[0];
    expect(visibleTypeSeries(ts).map((s) => s.key)).toEqual(["PAY", "DEB", "R/B", "UNK"]);
  });
});

describe("ownerHighlight", () => {
  const bars = (extra: Partial<BreakdownResponse> = {}): BreakdownResponse => ({
    at: 2026, by: "owner",
    rows: [
      { key: "US", counts: { PAY: 10 }, total: 10 },
      { key: "PRC", counts: { DEB: 5 }, total: 5 },
      { key: "_other", counts: { PAY: 3 }, total: 3 },
    ],
    ...extra,
  });

  it("highlights nothing without a selected owner", () => {
    expect(ownerHighlight(bars(), null, null)).toEqual({ highlight: null, extra: null });
  });

  it("highlights a ranked row in place", () => {
    expect(ownerHighlight(bars(), "PRC", "PRC")).toEqual({ highlight: "PRC", extra: null });
  });

  it("adds an extra row with the rank for an owner outside the ranked rows", () => {
    const r = ownerHighlight(bars({ rank_of: { key: "GER", rank: 9, counts: { PAY: 86 }, total: 86 } }), "GER", "GER");
    expect(r).toEqual({ highlight: "GER", extra: { key: "GER", rank: 9, counts: { PAY: 86 }, total: 86 } });
  });

  it("an owner with none under the filters gets an empty extra row", () => {
    expect(ownerHighlight(bars({ rank_of: null }), "GER", "GER")).toEqual({
      highlight: "GER", extra: { key: "GER", rank: null, counts: {}, total: 0 },
    });
  });

  it("shows no extra row while the data was fetched for a different owner (rank_of present but stale)", () => {
    // Germany's rank_of is still in the response while UAE is now selected — must not show
    // Germany's rank under UAE's name, and must not show UAE with no data either.
    const r = ownerHighlight(bars({ rank_of: { key: "GER", rank: 9, counts: { PAY: 86 }, total: 86 } }), "UAE", "GER");
    expect(r).toEqual({ highlight: "UAE", extra: null });
  });

  it("shows no extra row while the data was fetched for a different owner (rank_of null/stale)", () => {
    // rank_of: null for Germany (confirmed zero for Germany) must not be misread as "UAE has
    // none" just because UAE is now selected and the response hasn't caught up yet.
    const r = ownerHighlight(bars({ rank_of: null }), "UAE", "GER");
    expect(r).toEqual({ highlight: "UAE", extra: null });
  });

  it("shows no extra row for a first-ever selection before its rank_of has been fetched", () => {
    // Picking Germany when no owner was selected before: the response on screen never asked for
    // any rank_of (rankFor is null), so there's nothing to show yet — not a false "none".
    const r = ownerHighlight(bars(), "GER", null);
    expect(r).toEqual({ highlight: "GER", extra: null });
  });
});
