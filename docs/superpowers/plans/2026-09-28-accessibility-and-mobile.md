# Accessibility and Mobile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every chart value is reachable by keyboard and screen reader (View data tables), the phone sheet's tabs follow the WAI-ARIA tabs pattern with an always-visible collapse control, the History plot uses the full width on narrow panels, a Fit globe pill restores the whole-Earth view (and the globe re-fits on layout switches), and the piece-4 carry-overs are fixed.

**Architecture:** Pure helpers first (table rows, tab keyboard movement, fit distance and refit rules) with unit tests; then four UI tasks: charts (disclosure + tables, narrow History), panels/sheet/picker (order, soon tag, ARIA tabs, picker focus/scroll), Fit globe (store flags, GlobeScene detection/fit/auto-refit, pill), and Reset focus + announcer + compact short-layout pill + status-pill wrapping.

**Tech Stack:** Next.js 16 / React 19 / zustand 5 / React Three Fiber (web only), vitest 5 (node env, `web/tests/unit/**/*.test.ts`), Playwright 1.63 (`web/e2e/`, mocked API).

**Spec:** `docs/superpowers/specs/2026-09-28-accessibility-and-mobile-design.md`

## Global Constraints

- Web only; no API changes. Read `web/AGENTS.md` before writing code. React Strict Mode is on.
- Checks from `web/`: `npx vitest run`, `npx tsc --noEmit`, `npx eslint src tests e2e`; UI tasks (2–5) also `npx playwright test` (next dev on port 3100, reused if running; if held by something else, report NEEDS_CONTEXT). In e2e, locate the owner picker with `page.getByRole("combobox", { name: "Owner" })`.
- Panel order (dock and sheet): Search, Filters, Overview, History, Owners, Ask AI. The phone sheet opens on Search. Ask AI carries a `soon` tag.
- Copy, exactly: `View data` / `Hide data`; captions `Objects in orbit at the end of each year` and `Objects in orbit by owner and type`; History columns `Year`, type labels, `Total`; Owners columns `#`, `Owner`, type labels, `Total`; the selected owner's row label ends with ` (selected)`; `Fit globe` (accessible name; visible `⤢ Fit globe`, `⤢ Fit` in the sheet layout); announcement `Filters reset`; compact summary `Filtered`.
- Numbers: History narrow mode below 420 px chart width (right margin 118 → 12 px); data table scroll area max height 240 px (`max-h-60`); tabs at least 40 px tall (`min-h-10`); collapse button 44 × 44 px; Fit tolerance 5% (`FIT_TOLERANCE = 0.05`).
- Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (an implementer may name its actual model). Never push or deploy.

## Review Focus

1. The auto-refit must never fight the user's zoom when only the phone top bar changes height (e.g. a pill appears) — pinned by `shouldRefit` "keeps a user-zoomed camera when only the top bar changes" (Task 1).
2. A data table for an empty or filtered-to-nothing chart must render its headers without crashing — pinned by `historyTable` "handles no years" (Task 1).
3. The Owners table when the selected owner has no objects under the filters (no rank) must show it with `—` — pinned by `ownersTable` "an owner with none under the filters" (Task 1).
4. Arrow keys on a collapsed phone sheet's tabs must expand it — pinned by the e2e step "ArrowRight on a collapsed sheet expands it" (Task 3).
5. After Reset with the Filters panel hidden, focus must land on what opens Filters (not on `<body>`) — pinned by the e2e "Reset with Filters hidden focuses the dock's Filters button" (Task 5).

For the reviewer's eye: pressing Fit during a search fly-to cancels that flight (`startFlight` already cancels a running flight); the sheet's overflow fades update on resize.

---

### Task 1: Pure helpers — tables, tabs, fit

**Files:**
- Create: `web/src/lib/chartTables.ts`, `web/src/lib/tabs.ts`
- Modify: `web/src/lib/camera.ts` (append `fittedDistance`, `FIT_TOLERANCE`, `isOffFit`, `shouldRefit`)
- Test: `web/tests/unit/chartTables.test.ts`, `web/tests/unit/tabs.test.ts` (create), `web/tests/unit/camera.test.ts` (extend)

**Interfaces:**
- Consumes: `visibleTypeSeries`, `ownerHighlight`, `ownerLabel`, `TYPE_ORDER` (`@/lib/chartData`); `initialDistance`, `sheetInitialDistance` (`@/lib/camera`).
- Produces:
  - `chartTables.ts`: `historyTable(ts): { columns: ObjectType[]; rows: { year: number; values: number[]; total: number }[] }` (newest first); `ownersTable(data, owners, selected, rankFor, types): { columns: ObjectType[]; rows: OwnersTableRow[] }` (`rankFor` = the owner `data` asked `rank_of` for, as `BarChart` gets it) with `OwnersTableRow { key: string; rank: number | null; label: string; values: number[]; total: number; selected: boolean }`; `latestValues(ts): { key: ObjectType; value: number }[]`.
  - `tabs.ts`: `nextTabIndex(key: string, current: number, count: number): number | null`.
  - `camera.ts`: `fittedDistance(sheetLayout: boolean, width: number, height: number, topBarBottom: number | null): number | null`; `FIT_TOLERANCE = 0.05`; `isOffFit(distance: number, fitted: number, tolerance?: number): boolean`; `type FitState = { sheet: boolean; fitted: number }`; `shouldRefit(prev: FitState | null, next: FitState, distance: number): boolean`.

- [ ] **Step 1: Write the failing tests**

```ts
// web/tests/unit/chartTables.test.ts
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
```

```ts
// web/tests/unit/tabs.test.ts
import { describe, expect, it } from "vitest";
import { nextTabIndex } from "@/lib/tabs";

describe("nextTabIndex", () => {
  it("moves right and left, wrapping", () => {
    expect(nextTabIndex("ArrowRight", 0, 6)).toBe(1);
    expect(nextTabIndex("ArrowRight", 5, 6)).toBe(0);
    expect(nextTabIndex("ArrowLeft", 0, 6)).toBe(5);
    expect(nextTabIndex("ArrowLeft", 3, 6)).toBe(2);
  });

  it("jumps to the first and last", () => {
    expect(nextTabIndex("Home", 4, 6)).toBe(0);
    expect(nextTabIndex("End", 1, 6)).toBe(5);
  });

  it("ignores other keys", () => {
    expect(nextTabIndex("Enter", 2, 6)).toBeNull();
    expect(nextTabIndex("ArrowDown", 2, 6)).toBeNull();
  });
});
```

Extend `web/tests/unit/camera.test.ts`: add `FIT_TOLERANCE`, `fittedDistance`, `isOffFit` and `shouldRefit` to its existing `@/lib/camera` import, then append:

```ts

describe("fittedDistance", () => {
  it("uses the desktop framing outside the sheet layout", () => {
    expect(fittedDistance(false, 1280, 720, null)).toBe(initialDistance(1280 / 720));
  });

  it("uses the sheet framing, and waits for the top bar", () => {
    expect(fittedDistance(true, 390, 844, 60)).toBe(sheetInitialDistance(390, 844, 60));
    expect(fittedDistance(true, 390, 844, null)).toBeNull();
  });
});

describe("isOffFit", () => {
  it("is off only beyond the tolerance either way", () => {
    expect(FIT_TOLERANCE).toBe(0.05);
    expect(isOffFit(3.1, 3)).toBe(false);
    expect(isOffFit(3.2, 3)).toBe(true);
    expect(isOffFit(2.8, 3)).toBe(true);
  });
});

describe("shouldRefit", () => {
  it("never on the first measurement", () => {
    expect(shouldRefit(null, { sheet: false, fitted: 3 }, 3)).toBe(false);
  });

  it("always when switching between desktop and sheet layouts", () => {
    expect(shouldRefit({ sheet: false, fitted: 3 }, { sheet: true, fitted: 4 }, 1.5)).toBe(true);
    expect(shouldRefit({ sheet: true, fitted: 4 }, { sheet: false, fitted: 3 }, 4)).toBe(true);
  });

  it("follows a sheet top-bar change when the camera was at the old fitted distance", () => {
    expect(shouldRefit({ sheet: true, fitted: 4 }, { sheet: true, fitted: 4.5 }, 4)).toBe(true);
  });

  it("keeps a user-zoomed camera when only the top bar changes", () => {
    expect(shouldRefit({ sheet: true, fitted: 4 }, { sheet: true, fitted: 4.5 }, 1.8)).toBe(false);
  });

  it("ignores small changes and desktop resizes", () => {
    expect(shouldRefit({ sheet: true, fitted: 4 }, { sheet: true, fitted: 4.1 }, 4)).toBe(false);
    expect(shouldRefit({ sheet: false, fitted: 3 }, { sheet: false, fitted: 3.6 }, 3)).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd web && npx vitest run tests/unit/chartTables.test.ts tests/unit/tabs.test.ts tests/unit/camera.test.ts`
Expected: FAIL — modules/exports missing.

- [ ] **Step 3: Implement**

```ts
// web/src/lib/chartTables.ts
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
 * owner when it isn't among them (with its rank, or none), columns = the selected types. */
export function ownersTable(
  data: BreakdownResponse,
  owners: OwnerSummary[],
  selected: string | null,
  rankFor: string | null,
  types: readonly ObjectType[],
): { columns: ObjectType[]; rows: OwnersTableRow[] } {
  const columns = TYPE_ORDER.filter((t) => types.includes(t));
  // Same rows as BarChart: its first six response rows (Other included), then ownerHighlight's extra.
  const { extra } = ownerHighlight(data, selected, rankFor);
  const row = (key: string, rank: number | null, counts: Partial<Record<ObjectType, number>>, total: number): OwnersTableRow => {
    const isSelected = key === selected;
    const name = ownerLabel(key, owners);
    return { key, rank, label: isSelected ? `${name} (selected)` : name, values: columns.map((t) => counts[t] ?? 0), total, selected: isSelected };
  };
  let rank = 0;
  const rows = data.rows.slice(0, 6).map((r) => row(r.key, r.key === "_other" ? null : ++rank, r.counts, r.total));
  if (extra) rows.push(row(extra.key, extra.rank, extra.counts, extra.total));
  return { columns, rows };
}
```

```ts
// web/src/lib/tabs.ts
/** WAI-ARIA tabs keyboard movement: ←/→ wrap, Home/End jump; null for any other key. */
export function nextTabIndex(key: string, current: number, count: number): number | null {
  switch (key) {
    case "ArrowRight":
      return (current + 1) % count;
    case "ArrowLeft":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
```

Append to `web/src/lib/camera.ts`:

```ts
/** The whole-Earth camera distance for the current layout, or null in the sheet layout before
 * the top bar has been measured. */
export function fittedDistance(sheetLayout: boolean, width: number, height: number, topBarBottom: number | null): number | null {
  if (sheetLayout) return topBarBottom === null ? null : sheetInitialDistance(width, height, topBarBottom);
  return initialDistance(width / Math.max(height, 1));
}

/** How far (as a fraction) the camera distance may drift from the fitted one before the view counts as "moved away". */
export const FIT_TOLERANCE = 0.05;

export function isOffFit(distance: number, fitted: number, tolerance = FIT_TOLERANCE): boolean {
  return Math.abs(distance - fitted) / fitted > tolerance;
}

export type FitState = { sheet: boolean; fitted: number };

/** Whether a layout change should re-fit the camera: always on a desktop↔sheet switch; for a sheet
 * top-bar change only when the fitted distance moved beyond the tolerance AND the camera was still
 * at the old fitted distance (never fight the user's zoom); never on the first measurement. */
export function shouldRefit(prev: FitState | null, next: FitState, distance: number): boolean {
  if (!prev) return false;
  if (prev.sheet !== next.sheet) return true;
  return next.sheet && isOffFit(next.fitted, prev.fitted) && !isOffFit(distance, prev.fitted);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run && npx tsc --noEmit && npx eslint src tests e2e`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/chartTables.ts web/src/lib/tabs.ts web/src/lib/camera.ts web/tests/unit/chartTables.test.ts web/tests/unit/tabs.test.ts web/tests/unit/camera.test.ts
git commit -m "feat(web): table rows for the charts, tab keyboard movement, fit-distance rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Charts — View data tables, narrow History

**Files:**
- Create: `web/src/components/charts/ChartData.tsx`
- Modify: `web/src/components/charts/LineChart.tsx`, `web/src/components/panels/panelContent.tsx`, `web/src/lib/store.ts` (`dataTablesOpen`, `toggleDataTable`)
- Test: `web/tests/unit/store.test.ts`, `web/e2e/explorer.spec.ts`

**Interfaces:**
- Consumes: `historyTable`, `ownersTable`, `latestValues` (Task 1).
- Produces: `<DataDisclosure which label>`, `<HistoryDataTable data />`, `<OwnersDataTable data owners selected rankFor types />`; store `dataTablesOpen: { history: boolean; owners: boolean }`, `toggleDataTable(which: "history" | "owners")`.

- [ ] **Step 1: Write the failing tests**

Append to `web/tests/unit/store.test.ts`:

```ts
describe("data tables", () => {
  it("start closed and toggle per chart", () => {
    useExplorer.getState().reset();
    expect(useExplorer.getState().dataTablesOpen).toEqual({ history: false, owners: false });
    useExplorer.getState().toggleDataTable("owners");
    expect(useExplorer.getState().dataTablesOpen).toEqual({ history: false, owners: true });
  });
});
```

Append to `web/e2e/explorer.spec.ts`:

```ts
test("each chart's data is available as a table", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  const history = page.locator('[data-panel="history"]');
  const view = history.getByRole("button", { name: "View data" });
  await expect(view).toHaveAttribute("aria-expanded", "false");
  await view.click();
  await expect(history.getByRole("button", { name: "Hide data" })).toHaveAttribute("aria-expanded", "true");
  const ht = history.getByRole("table", { name: "Objects in orbit at the end of each year" });
  await expect(ht.getByRole("columnheader", { name: "Year" })).toBeVisible();
  await expect(ht.getByRole("columnheader", { name: "Total" })).toBeVisible();
  expect(await ht.getByRole("row").count()).toBeGreaterThan(2);
  const owners = page.locator('[data-panel="owners"]');
  await owners.getByRole("button", { name: "View data" }).click();
  const ot = owners.getByRole("table", { name: "Objects in orbit by owner and type" });
  await expect(ot).toContainText("United States");
  await expect(ot.getByRole("columnheader", { name: "Owner" })).toBeVisible();
});

test("a narrow History chart shows current values in its legend", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.goto("/");
  await page.getByTestId("mobile-sheet").getByRole("tab", { name: "History" }).click();
  const ts = JSON.parse(fx("api/timeseries.json").toString());
  const pay = ts.series.find((s: { key: string }) => s.key === "PAY").values.at(-1) as number;
  await expect(page.getByTestId("history-legend")).toContainText(pay.toLocaleString("en-US"));
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd web && npx vitest run tests/unit/store.test.ts && npx playwright test -g "available as a table|narrow History"`
Expected: FAIL — no store field, no View data button, no `history-legend`.

- [ ] **Step 3: Store**

In `web/src/lib/store.ts`: add to the state interface `dataTablesOpen: { history: boolean; owners: boolean };` and `toggleDataTable: (which: "history" | "owners") => void;`; add `dataTablesOpen: { history: false, owners: false }` to `initial()` (and its picked keys); add the action:

```ts
  toggleDataTable: (which) => set((s) => ({ dataTablesOpen: { ...s.dataTablesOpen, [which]: !s.dataTablesOpen[which] } })),
```

- [ ] **Step 4: The disclosure and tables**

```tsx
// web/src/components/charts/ChartData.tsx
"use client";

import { useId } from "react";
import { historyTable, ownersTable } from "@/lib/chartTables";
import { fmtInt } from "@/lib/format";
import { useExplorer } from "@/lib/store";
import { TYPE_LABELS, type BreakdownResponse, type ObjectType, type OwnerSummary, type TimeseriesResponse } from "@/lib/types";

/** "View data" / "Hide data" under a chart: the same numbers as a real table for keyboard and
 * screen-reader users. The scroll area is focusable so a keyboard can scroll it. */
export function DataDisclosure({ which, label, children }: { which: "history" | "owners"; label: string; children: React.ReactNode }) {
  const open = useExplorer((s) => s.dataTablesOpen[which]);
  const toggle = useExplorer((s) => s.toggleDataTable);
  const regionId = useId();
  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => toggle(which)}
        className="min-h-8 rounded-full border-2 border-line bg-[#121212] px-3 text-[12px] text-ink-2 hover:text-ink"
      >
        {open ? "Hide data" : "View data"}
      </button>
      <div
        id={regionId}
        role="region"
        aria-label={label}
        hidden={!open}
        tabIndex={open ? 0 : -1}
        className="mt-2 max-h-60 overflow-auto rounded-[10px] border-2 border-line"
      >
        {open && children}
      </div>
    </div>
  );
}

const th = "px-2 py-1 text-right font-normal text-ink-2";
const td = "px-2 py-1 text-right text-ink";

export function HistoryDataTable({ data }: { data: TimeseriesResponse }) {
  const t = historyTable(data);
  return (
    <table className="w-full border-collapse font-mono text-[12px]">
      <caption className="px-2 py-1 text-left text-[11px] text-ink-3">Objects in orbit at the end of each year</caption>
      <thead className="sticky top-0 bg-[#121212]">
        <tr>
          <th scope="col" className={`${th} text-left`}>Year</th>
          {t.columns.map((c) => <th key={c} scope="col" className={th}>{TYPE_LABELS[c]}</th>)}
          <th scope="col" className={th}>Total</th>
        </tr>
      </thead>
      <tbody>
        {t.rows.map((r) => (
          <tr key={r.year} className="even:bg-[#111]">
            <th scope="row" className={`${td} text-left font-normal`}>{r.year}</th>
            {r.values.map((v, i) => <td key={t.columns[i]} className={td}>{fmtInt(v)}</td>)}
            <td className={td}>{fmtInt(r.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function OwnersDataTable({
  data,
  owners,
  selected,
  rankFor,
  types,
}: {
  data: BreakdownResponse;
  owners: OwnerSummary[];
  selected: string | null;
  rankFor: string | null;
  types: readonly ObjectType[];
}) {
  const t = ownersTable(data, owners, selected, rankFor, types);
  return (
    <table className="w-full border-collapse font-mono text-[12px]">
      <caption className="px-2 py-1 text-left text-[11px] text-ink-3">Objects in orbit by owner and type</caption>
      <thead className="sticky top-0 bg-[#121212]">
        <tr>
          <th scope="col" className={th}>#</th>
          <th scope="col" className={`${th} text-left`}>Owner</th>
          {t.columns.map((c) => <th key={c} scope="col" className={th}>{TYPE_LABELS[c]}</th>)}
          <th scope="col" className={th}>Total</th>
        </tr>
      </thead>
      <tbody>
        {t.rows.map((r) => (
          <tr key={r.key} className={r.selected ? "bg-[#1d1d1d]" : "even:bg-[#111]"}>
            <td className={td}>{r.rank ?? (r.key === "_other" ? "" : "—")}</td>
            <th scope="row" className={`${td} text-left font-normal`}>{r.label}</th>
            {r.values.map((v, i) => <td key={t.columns[i]} className={td}>{fmtInt(v)}</td>)}
            <td className={td}>{fmtInt(r.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

In `web/src/components/panels/panelContent.tsx`:
- `history`: after the chart `<div className="mt-2">…<LineChart …/></div>` add
  `{c.ts.data && <DataDisclosure which="history" label="History data"><HistoryDataTable data={c.ts.data} /></DataDisclosure>}`.
- `OwnersChart`: read `types` (already read) and after the BarChart `<div>` add
  `{!c.bars.error && c.bars.data && <DataDisclosure which="owners" label="Owners data"><OwnersDataTable data={c.bars.data} owners={c.meta.data?.owners ?? []} selected={selected} rankFor={c.bars.rankFor} types={types} /></DataDisclosure>}`.
- The History one likewise only when `!c.ts.error`.
- Import the three from `@/components/charts/ChartData`.

- [ ] **Step 5: Narrow History**

In `web/src/components/charts/LineChart.tsx`:
- The file already has `const narrow = width < 520;` (it hides the annotations); leave it. After `const series = visibleTypeSeries(data);` add `const compact = width < 420;` (values move into the legend) and `const latest = latestValues(data);` (import `latestValues` from `@/lib/chartTables`).
- Change the margin line to `const M = { ...M_BASE, r: compact ? 12 : M_BASE.r, l: Math.ceil(maxTickLen * CHAR_W) + 14 };`.
- The legend container gets `data-testid="history-legend"` (keep its existing classes otherwise); each legend item, when `compact`, also shows its value:

```tsx
      <div data-testid="history-legend" className="mb-2 flex flex-wrap gap-4 text-[13px] text-ink-2">
        {series.map((s, i) => (
          <span key={s.key} className="inline-flex items-center gap-2">
            <i className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: CHART_COLORS[s.key] }} />
            {TYPE_LABELS[s.key]}
            {compact && <b className="font-normal text-ink">{fmtInt(latest[i].value)}</b>}
          </span>
        ))}
      </div>
```

- In the end-of-line group, draw the value `<text>` only when `!compact` (keep the circle).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd web && npx vitest run && npx tsc --noEmit && npx eslint src tests e2e && npx playwright test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/charts/ChartData.tsx web/src/components/charts/LineChart.tsx web/src/components/panels/panelContent.tsx web/src/lib/store.ts web/tests/unit/store.test.ts web/e2e/explorer.spec.ts
git commit -m "feat(web): View data tables under the charts; the narrow History chart uses the full width

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Panels, phone sheet tabs, owner picker focus

**Files:**
- Create: `web/src/components/ui/SoonTag.tsx`
- Modify: `web/src/lib/panels.ts` (order, `soon`, `panelLabel`), `web/src/components/layout/PanelDock.tsx`, `web/src/components/layout/MobileSheet.tsx`, `web/src/components/panels/OwnerPicker.tsx`
- Test: `web/tests/unit/panels.test.ts`, `web/e2e/explorer.spec.ts`

**Interfaces:**
- Consumes: `nextTabIndex` (Task 1).
- Produces: `PANELS` entries `{ id, title, soon?: boolean }` in the new order; every dock button and sheet tab has `data-opens="<panel id>"` (Task 5 focuses them); a `soon` panel's button/tab has the accessible name `<title>, soon` (the visible tag is `aria-hidden`, since an inline tag would otherwise run into the title as "Ask AIsoon").

- [ ] **Step 1: Write the failing tests**

In `web/tests/unit/panels.test.ts`, the dock-order expectation becomes the new order, and `panelLabel` gets a test (add it to the import):

```ts
    expect(PANELS.map((p) => p.id)).toEqual(["search", "filters", "overview", "history", "owners", "chat"]);
```

```ts
  it("names a 'soon' panel's button with its tag", () => {
    expect(panelLabel({ title: "Ask AI", soon: true })).toBe("Ask AI, soon");
    expect(panelLabel({ title: "Search" })).toBeUndefined();
  });
```

Append to `web/e2e/explorer.spec.ts`:

```ts
test("phone sheet: collapse is always visible and the tabs follow the ARIA tabs pattern", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.goto("/");
  const sheet = page.getByTestId("mobile-sheet");
  const collapse = sheet.getByRole("button", { name: /Collapse panel|Expand panel/ });
  await expect(collapse).toBeInViewport();
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  const search = sheet.getByRole("tab", { name: "Search" });
  await expect(search).toHaveAttribute("aria-selected", "true");
  expect(await sheet.getByRole("tab").evaluateAll((els) => els.filter((e) => e.getAttribute("tabindex") === "0").length)).toBe(1);
  await search.focus();
  await page.keyboard.press("ArrowRight");
  const filters = sheet.getByRole("tab", { name: "Filters" });
  await expect(filters).toBeFocused();
  await expect(filters).toHaveAttribute("aria-selected", "true");
  await expect(sheet.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", (await filters.getAttribute("id"))!);
  await page.keyboard.press("End");
  const ai = sheet.getByRole("tab", { name: "Ask AI, soon" });
  await expect(ai).toBeFocused();
  await expect(ai).toContainText("soon");
  await expect(ai).toBeInViewport();
  await page.keyboard.press("Home");
  await expect(search).toBeFocused();
  // ArrowRight on a collapsed sheet expands it
  await collapse.click();
  await expect(sheet.getByRole("tabpanel")).toHaveCount(0);
  await search.focus();
  await page.keyboard.press("ArrowRight");
  await expect(sheet.getByRole("tabpanel")).toBeVisible();
});

test("the dock lists Search and Filters first and tags Ask AI as soon", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  const dock = page.getByTestId("panel-dock");
  await expect(dock.getByRole("button")).toHaveText(["Search", "Filters", "Overview", "History", "Owners", /^Ask AI\s*soon$/]);
  await expect(dock.getByRole("button", { name: "Ask AI, soon" })).toBeVisible();
});

test("Tab out of the open owner list keeps focus on a page control", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await page.getByTestId("panel-dock").getByRole("button", { name: "Filters" }).click();
  await page.getByRole("combobox", { name: "Owner" }).click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");
});
```

Update existing tests for the new default phone tab (Search, not Overview): in the viewport loop (`for (const [w, h] of [[640, 900], …`), replace

```ts
    await expect(page.locator("path[data-series], [data-testid=tile-PAY]").first()).toBeVisible({ timeout: 10_000 });
```

with

```ts
    const sheetLayout = w < 1024 || h < 560;
    await expect(sheetLayout ? page.getByLabel("Find an object") : page.locator("path[data-series]").first()).toBeVisible({ timeout: 10_000 });
```

(and remove the now-duplicated `const sheetLayout = …` line below it). Check any other phone test that expects Overview content without clicking the Overview tab first, and make it click the tab; say which in the report.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd web && npx vitest run tests/unit/panels.test.ts && npx playwright test -g "phone sheet: collapse|dock lists|Tab out of the open owner list"`
Expected: FAIL.

- [ ] **Step 3: Panels and dock**

```tsx
// web/src/components/ui/SoonTag.tsx
/** A small "soon" marker for a feature that isn't built yet (Ask AI). Hidden from assistive tech:
 * the button/tab carrying it says "<title>, soon" in its aria-label instead (see panelLabel). */
export function SoonTag() {
  return (
    <span aria-hidden="true" className="ml-1.5 rounded-[6px] border border-[#333] px-1 text-[10px] leading-4 text-ink-3">
      soon
    </span>
  );
}
```

In `web/src/lib/panels.ts`:

```ts
export const PANELS: readonly { id: PanelId; title: string; soon?: boolean }[] = [
  { id: "search", title: "Search" },
  { id: "filters", title: "Filters" },
  { id: "overview", title: "Overview" },
  { id: "history", title: "History" },
  { id: "owners", title: "Owners" },
  { id: "chat", title: "Ask AI", soon: true },
];

/** The accessible name for a panel's dock button / sheet tab — undefined (use the text) unless it
 * carries the visual-only "soon" tag. */
export function panelLabel(p: { title: string; soon?: boolean }): string | undefined {
  return p.soon ? `${p.title}, soon` : undefined;
}
```

In `PanelDock.tsx`, each button gets `data-opens={p.id}` and `aria-label={panelLabel(p)}`, and renders `{p.title}{p.soon && <SoonTag />}`.

- [ ] **Step 4: Phone sheet**

Rewrite the component body of `web/src/components/layout/MobileSheet.tsx` as below. Keep the existing `selectedId` effect, `panelRequest` effect (with `seenRequestN`) and sheet-top `ResizeObserver` effect exactly as they are, placed after the new declarations; only the initial tab (`"search"`), the new refs/effects/handlers and the returned JSX change:

```tsx
  const [active, setActive] = useState<PanelId>("search");
  const baseId = useId();
  const tabId = (id: PanelId) => `${baseId}-tab-${id}`;
  const panelId = `${baseId}-panel`;
  const tabRefs = useRef<Partial<Record<PanelId, HTMLButtonElement | null>>>({});
  const stripRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ left: false, right: false });

  // The active tab is always scrolled into view within the strip.
  useEffect(() => {
    tabRefs.current[active]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  // Fades on the strip's edges say "more tabs this way".
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const update = () => setFade({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);

  const select = (id: PanelId) => {
    setActive(id);
    setOpen(true);
  };
  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    const next = nextTabIndex(e.key, i, PANELS.length);
    if (next === null) return;
    e.preventDefault();
    select(PANELS[next].id);
    tabRefs.current[PANELS[next].id]?.focus();
  };

  return (
    <div ref={sheetRef} data-testid="mobile-sheet" className="panel fixed inset-x-2 bottom-2 z-20 mx-auto max-h-[60dvh] max-w-[640px] !p-0 short:max-h-[50dvh] wide:hidden">
      <div className="flex items-stretch border-b-2 border-line">
        <div className="relative min-w-0 flex-1">
          <div ref={stripRef} role="tablist" aria-label="Panels" className="flex gap-1 overflow-x-auto px-2 py-1.5 [scrollbar-width:none]">
            {PANELS.map((p, i) => (
              <button
                key={p.id}
                ref={(el) => {
                  tabRefs.current[p.id] = el;
                }}
                id={tabId(p.id)}
                role="tab"
                type="button"
                data-opens={p.id}
                aria-label={panelLabel(p)}
                aria-selected={active === p.id}
                aria-controls={panelId}
                tabIndex={active === p.id ? 0 : -1}
                onClick={() => select(p.id)}
                onKeyDown={(e) => onTabKey(e, i)}
                className={`flex min-h-10 shrink-0 items-center rounded-full px-3 text-[13px] ${active === p.id ? "bg-[#1c1c1c] text-ink" : "text-ink-2"}`}
              >
                {p.title}
                {p.soon && <SoonTag />}
              </button>
            ))}
          </div>
          {fade.left && <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-card to-transparent" />}
          {fade.right && <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-card to-transparent" />}
        </div>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={open ? "Collapse panel" : "Expand panel"}
          className="flex h-11 w-11 shrink-0 items-center justify-center border-l-2 border-line text-ink-2"
        >
          {open ? "▾" : "▴"}
        </button>
      </div>
      {open && showBody && (
        <div id={panelId} role="tabpanel" aria-labelledby={tabId(active)} tabIndex={0} className="max-h-[calc(60dvh-56px)] overflow-y-auto p-3 short:max-h-[calc(50dvh-56px)]">
          {PANEL_CONTENT[active](ctx)}
        </div>
      )}
    </div>
  );
```

(Imports: `useId` from react, `PANELS`/`panelLabel` from `@/lib/panels`, `nextTabIndex` from `@/lib/tabs`, `SoonTag` from `@/components/ui/SoonTag`. `from-card` works: `--color-card` is defined in globals.css. If eslint's set-state-in-effect rule flags `update()` in the fade effect, mirror StatusPill's `useNow` pattern, which passes. The tabpanel no longer needs `aria-label` — `aria-labelledby` names it.)

- [ ] **Step 5: Owner picker focus and scrolling**

In `web/src/components/panels/OwnerPicker.tsx`:
- The `<ul role="listbox">` gets `tabIndex={-1}` (a scrollable list is otherwise a Tab stop in Chrome, and focusing it blurs the input, which closes the list and drops focus to `<body>`), and its class `max-h-64` becomes `h-64` (a fixed height while open, so the phone sheet doesn't change height as matches narrow).
- The active-option scroll effect currently keyed only on `moveTick` also runs when the list opens and while typing: key it on `[moveTick, open, query]` and drop the `moveTick === 0` guard (keep `if (!open) return;`). Hover-driven changes (`onPointerMove`) change none of these, so they still never scroll. Update the comment accordingly.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd web && npx vitest run && npx tsc --noEmit && npx eslint src tests e2e && npx playwright test`
Expected: all pass (including the updated viewport loop and the picker tests from piece 4).

- [ ] **Step 7: Commit**

```bash
git add web/src/components/ui/SoonTag.tsx web/src/lib/panels.ts web/src/components/layout/PanelDock.tsx web/src/components/layout/MobileSheet.tsx web/src/components/panels/OwnerPicker.tsx web/tests/unit/panels.test.ts web/e2e/explorer.spec.ts
git commit -m "feat(web): Search and Filters first, Ask AI tagged soon; phone tabs follow the ARIA pattern; picker keeps focus

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Fit globe

**Files:**
- Create: `web/src/components/globe/FitButton.tsx`
- Modify: `web/src/lib/store.ts` (`offFit`, `setOffFit`, `fitRequest`, `requestFit`), `web/src/components/globe/flyTo.ts` (optional `arc`), `web/src/components/globe/GlobeScene.tsx`, `web/src/components/globe/GlobeSection.tsx`
- Test: `web/tests/unit/store.test.ts`, `web/e2e/explorer.spec.ts`

**Interfaces:**
- Consumes: `fittedDistance`, `isOffFit`, `shouldRefit`, `FitState` (Task 1); GlobeScene's existing `startFlight`.
- Produces: store `offFit: boolean`, `setOffFit(b: boolean)`, `fitRequest: number`, `requestFit()`; `<FitButton />`.

- [ ] **Step 1: Write the failing tests**

Append to `web/tests/unit/store.test.ts`:

```ts
describe("fit globe", () => {
  it("tracks whether the view is off the fitted framing and counts fit requests", () => {
    useExplorer.getState().reset();
    expect(useExplorer.getState().offFit).toBe(false);
    useExplorer.getState().setOffFit(true);
    expect(useExplorer.getState().offFit).toBe(true);
    expect(useExplorer.getState().fitRequest).toBe(0);
    useExplorer.getState().requestFit();
    useExplorer.getState().requestFit();
    expect(useExplorer.getState().fitRequest).toBe(2);
  });
});
```

Append to `web/e2e/explorer.spec.ts`:

```ts
test("the Fit pill appears after a fly-to and brings back the whole-Earth view", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible();
  const fit = page.getByRole("button", { name: "Fit globe" });
  await expect(fit).toHaveCount(0);
  await page.getByLabel("Find an object").fill("ISS");
  await page.getByRole("button", { name: /ISS \(ZARYA\)/ }).click();
  await expect(fit).toBeVisible({ timeout: 10_000 });
  await fit.click();
  await expect(fit).toHaveCount(0, { timeout: 10_000 });
});

test("resizing from desktop to phone width re-fits the Earth", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await mockApi(page);
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible();
  await page.waitForTimeout(500);
  await page.setViewportSize({ width: 390, height: 844 });
  const section = page.locator("section[aria-label='Live globe of tracked objects']");
  await expect
    .poll(
      async () => {
        const top = Number(await section.getAttribute("data-earth-top"));
        const bar = await page.getByTestId("globe-topbar").boundingBox();
        return bar ? top - (bar.y + bar.height) : -1;
      },
      { timeout: 10_000 },
    )
    .toBeGreaterThanOrEqual(0);
  await expect(page.getByRole("button", { name: "Fit globe" })).toHaveCount(0);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd web && npx vitest run tests/unit/store.test.ts && npx playwright test -g "Fit pill|re-fits the Earth"`
Expected: FAIL.

- [ ] **Step 3: Store**

In `web/src/lib/store.ts` add `offFit: boolean` (initial `false`), `fitRequest: number` (initial `0`), and:

```ts
  setOffFit: (offFit) => set({ offFit }),
  requestFit: () => set((s) => ({ fitRequest: s.fitRequest + 1 })),
```

- [ ] **Step 4: flyTo and GlobeScene**

`flyTo` always swings the radius out 0.6 past the larger end (so a flight across the globe never cuts through it). A fit keeps the direction, so that swing would only overshoot and bounce back. Add a fifth parameter `arc = true` to `web/src/components/globe/flyTo.ts`'s `flyTo`, and use it for the radius keyframes:

```ts
    r: arc ? [from.radius, Math.max(from.radius, to.radius) + 0.6, to.radius] : to.radius,
```

In `web/src/components/globe/GlobeScene.tsx`:

1. Change `startFlight` to take the distance and arc: `(target: THREE.Vector3, distance: number, arc = true) => { … flyTo(camera, target, distance, () => { … }, arc) … }` (everything else in it unchanged) and its pending-fly-to caller to `startFlight(found, Math.max(1.35, found.length() + 0.45))`.
2. Compute the fitted distance each render: `const fitted = fittedDistance(sheetLayout, size.width, size.height, topBarBottom);`.
3. Off-fit detection, throttled, inside the existing `useFrame` (after `simClock.tick();`). Skipped while a flight is running, so an automatic re-fit (or the Fit flight itself) never flashes the pill:

```tsx
    offFitElapsed.current += dt;
    if (offFitElapsed.current >= 0.25 && fitted !== null && positioned.current && fly.current === null) {
      offFitElapsed.current = 0;
      const off = isOffFit(camera.position.length(), fitted);
      const st = useExplorer.getState();
      if (st.offFit !== off) st.setOffFit(off);
    }
```

with `const offFitElapsed = useRef(0);` declared with the other refs.

4. Fit on request (keep the current direction; `startFlight` already cancels a running flight):

```tsx
  const fitRequest = useExplorer((s) => s.fitRequest);
  const seenFit = useRef(fitRequest);
  useEffect(() => {
    if (fitRequest === seenFit.current || fitted === null) return;
    seenFit.current = fitRequest;
    startFlight(camera.position.clone(), fitted, false);
  }, [fitRequest, fitted, camera, startFlight]);
```

5. Auto-refit on a layout switch (and a sheet top-bar change while the camera was still fitted), after the initial-positioning effect:

```tsx
  const lastFit = useRef<FitState | null>(null);
  useEffect(() => {
    if (!positioned.current || fitted === null) return;
    const next = { sheet: sheetLayout, fitted };
    if (shouldRefit(lastFit.current, next, camera.position.length())) startFlight(camera.position.clone(), fitted, false);
    lastFit.current = next;
  }, [sheetLayout, fitted, camera, startFlight]);
```

(Imports from `@/lib/camera`: `fittedDistance`, `isOffFit`, `shouldRefit`, `type FitState`. Declare the fit-request and auto-refit effects after `startFlight` and the initial-positioning effect, so `positioned.current` is already set when the auto-refit effect first runs. A fit flight is cancelled like any other: by a new selection's cleanup effect, or by the next `startFlight`.)

- [ ] **Step 5: The pill**

```tsx
// web/src/components/globe/FitButton.tsx
"use client";

import { useExplorer } from "@/lib/store";

/** "⤢ Fit globe" — only while the camera has moved away from the whole-Earth framing. */
export function FitButton() {
  const offFit = useExplorer((s) => s.offFit);
  const requestFit = useExplorer((s) => s.requestFit);
  if (!offFit) return null;
  return (
    <button
      type="button"
      onClick={requestFit}
      aria-label="Fit globe"
      className="label pointer-events-auto inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-full border-2 border-line bg-[#121212] px-3 py-1.5 !text-ink-2 hover:!text-ink"
    >
      <span aria-hidden="true">⤢</span> Fit<span className="sheet:hidden"> globe</span>
    </button>
  );
}
```

In `GlobeSection.tsx`, render `<FitButton />` in the pill row right after the StatusPill, inside the same `webgl === true && !broken` condition.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd web && npx vitest run && npx tsc --noEmit && npx eslint src tests e2e && npx playwright test`
Expected: all pass, including the existing fly-to/labels and viewport tests (the pill is absent in the fitted default view).

- [ ] **Step 7: Commit**

```bash
git add web/src/components/globe/FitButton.tsx web/src/lib/store.ts web/src/components/globe/flyTo.ts web/src/components/globe/GlobeScene.tsx web/src/components/globe/GlobeSection.tsx web/tests/unit/store.test.ts web/e2e/explorer.spec.ts
git commit -m "feat(web): Fit globe pill when the view has moved away; re-fit on layout switches

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Reset focus, announcer, compact pill, status-pill wrapping

**Files:**
- Create: `web/src/components/ui/Announcer.tsx`, `web/src/lib/focusFilters.ts`
- Modify: `web/src/lib/store.ts` (`announcement`, `announce`), `web/src/components/globe/FilterSummary.tsx`, `web/src/components/panels/Filters.tsx` (`data-filters-first`), `web/src/components/globe/StatusPill.tsx`, `web/src/app/page.tsx` (render the announcer)
- Test: `web/tests/unit/store.test.ts`, `web/e2e/explorer.spec.ts`

**Interfaces:**
- Consumes: `data-opens` on dock buttons and sheet tabs (Task 3); `filterScope` (`@/lib/filterSummary`).
- Produces: store `announcement: { text: string; n: number } | null`, `announce(text: string)`; `focusFiltersEntry(doc?: Document)`.

- [ ] **Step 1: Write the failing tests**

Append to `web/tests/unit/store.test.ts`:

```ts
describe("announcements", () => {
  it("replaces the text and counts announcements", () => {
    useExplorer.getState().reset();
    expect(useExplorer.getState().announcement).toBeNull();
    useExplorer.getState().announce("Filters reset");
    useExplorer.getState().announce("Filters reset");
    expect(useExplorer.getState().announcement).toEqual({ text: "Filters reset", n: 2 });
  });
});
```

Append to `web/e2e/explorer.spec.ts`:

```ts
test("Reset announces itself and leaves focus on the first filter chip", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await page.getByTestId("panel-dock").getByRole("button", { name: "Filters" }).click();
  await page.getByRole("button", { name: "Higher orbits" }).click();
  await page.getByTestId("filter-summary").getByRole("button", { name: "Reset filters" }).click();
  await expect(page.getByTestId("announcer")).toHaveText("Filters reset");
  await expect.poll(() => page.evaluate(() => document.activeElement?.hasAttribute("data-filters-first") ?? false)).toBe(true);
});

test("Reset with Filters hidden focuses the dock's Filters button", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  const dockFilters = page.getByTestId("panel-dock").getByRole("button", { name: "Filters" });
  await dockFilters.click();
  await page.getByRole("button", { name: "Higher orbits" }).click();
  await page.getByRole("button", { name: "Hide Filters" }).click();
  await page.getByTestId("filter-summary").getByRole("button", { name: "Reset filters" }).click();
  await expect(dockFilters).toBeFocused();
});

test("no horizontal overflow at 320 px, even with the longest status text", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await mockApi(page);
  await page.goto("/");
  await page.getByTestId("mobile-sheet").getByRole("tab", { name: "Filters" }).click();
  await page.getByRole("button", { name: "Higher orbits" }).click();
  const pill = page.getByTestId("live-badge");
  await expect(pill).toContainText("not available");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  expect(await pill.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test("on short landscape screens the filter summary is compact", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await mockApi(page);
  await page.goto("/");
  await page.getByTestId("mobile-sheet").getByRole("tab", { name: "Filters" }).click();
  await page.getByRole("button", { name: "Higher orbits" }).click();
  const summary = page.getByTestId("filter-summary");
  expect((await summary.innerText()).replace(/\s+/g, " ").trim()).toBe("Filtered Reset");
  await expect(summary.getByRole("button", { name: /^Showing All orbits · All owners · all types$/ })).toBeVisible();
});
```

(`Panel.tsx`'s close button is labelled `Hide ${title}`, hence `Hide Filters`. The fixture's HIGH snapshot is a 404, so turning on Higher orbits gives the longest status text, `… · Higher orbits not available`.)

- [ ] **Step 2: Run them to verify they fail**

Run: `cd web && npx vitest run tests/unit/store.test.ts && npx playwright test -g "Reset announces|Reset with Filters hidden|320 px|short landscape"`
Expected: FAIL.

- [ ] **Step 3: Store, announcer, focus helper**

In `web/src/lib/store.ts`: `announcement: { text: string; n: number } | null` (initial `null`) and

```ts
  announce: (text) => set((s) => ({ announcement: { text, n: (s.announcement?.n ?? 0) + 1 } })),
```

```tsx
// web/src/components/ui/Announcer.tsx
"use client";

import { useExplorer } from "@/lib/store";

/** One polite live region for short status messages (e.g. "Filters reset") whose source may have
 * just unmounted — rendered once, always present, so screen readers hear its changes. */
export function Announcer() {
  const announcement = useExplorer((s) => s.announcement);
  return (
    <p data-testid="announcer" role="status" aria-live="polite" className="sr-only">
      {announcement?.text ?? ""}
    </p>
  );
}
```

Render `<Announcer />` once in `web/src/app/page.tsx` (e.g. first child of `<main>`).

```ts
// web/src/lib/focusFilters.ts
/** Where focus goes after Reset: the Filters panel's first type chip if it is on screen, otherwise
 * whatever opens Filters (the dock button on desktop, the sheet tab on phones). Only rendered,
 * displayed elements count (`offsetParent !== null`): a layout's copy that CSS hides must never
 * take focus. */
export function focusFiltersEntry(doc: Document = document): void {
  const shown = (selector: string) =>
    Array.from(doc.querySelectorAll<HTMLElement>(selector)).find((el) => el.offsetParent !== null);
  (shown("[data-filters-first]") ?? shown("[data-opens='filters']"))?.focus();
}
```

In `web/src/components/panels/Filters.tsx`, the first type chip gets `data-filters-first` (e.g. `data-filters-first={i === 0 ? "" : undefined}` in the chips map).

- [ ] **Step 4: Summary pill and status pill**

In `web/src/components/globe/FilterSummary.tsx`:
- Read `announce` from the store and compute ``const label = `Showing ${filterScope(f, directory)}`;`` after the `isDefaultFilters` early return (import `filterScope` from `@/lib/filterSummary` and `focusFiltersEntry` from `@/lib/focusFilters`).
- The summary button gets `aria-label={label}` and `title={label}` (keep `aria-describedby`), and its visible content becomes two alternatives:

```tsx
        <span className="short:hidden">
          <span className="text-ink-3">Showing </span>
          {orbitsText(f.orbits)}
          <span className="text-ink-3"> · </span>
          <span className="inline-block max-w-[16ch] truncate align-bottom" title={owner}>{owner}</span>
          <span className="text-ink-3"> · </span>
          {typesText(f.types)}
        </span>
        <span className="hidden short:inline">Filtered</span>
```

- Reset's `onClick` becomes:

```tsx
        onClick={() => {
          resetFilters();
          announce("Filters reset");
          // The pill unmounts with the reset; move focus once the page has re-rendered.
          requestAnimationFrame(() => focusFiltersEntry());
        }}
```

In `web/src/components/globe/StatusPill.tsx`, the `role="status"` span loses `whitespace-nowrap` (so a long status wraps inside the pill) and gets `text-center`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npx vitest run && npx tsc --noEmit && npx eslint src tests e2e && npx playwright test`
Expected: all pass (existing filter-summary tests still match: `toContainText("Showing All orbits · All owners · all types")` reads the text content, which includes the hidden alternative).

- [ ] **Step 6: Commit**

```bash
git add web/src/components/ui/Announcer.tsx web/src/lib/focusFilters.ts web/src/lib/store.ts web/src/components/globe/FilterSummary.tsx web/src/components/panels/Filters.tsx web/src/components/globe/StatusPill.tsx web/src/app/page.tsx web/tests/unit/store.test.ts web/e2e/explorer.spec.ts
git commit -m "feat(web): Reset announces and keeps focus; compact summary on short screens; status pill wraps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
