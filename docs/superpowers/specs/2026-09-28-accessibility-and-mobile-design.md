# Accessibility and mobile

Date: 2026-09-28. Status: design approved by the owner in conversation (mockups in the visual companion); this spec
awaits their review.

Piece 5 of 5 from the repository audit of 2026-09-25 (`/tmp/kessler-repo-audit.md`): findings #10 (chart details have no
keyboard-accessible equivalent) and #11 (mobile sheet hides its collapse control; incomplete tabs), design ideas 1
(Search and Filters primary; Ask AI placement), 4 (wider History plot), 5 (Fit globe / reset view) and 6 (data tables),
plus items carried over from piece 4: focus after Reset, Tab out of the open owner list, the owner picker's highlighted
row off-screen after typing, the status pill overflowing at 320 px, the phone sheet jumping in height while typing, and
the summary pill crowding short landscape phones.

## Owner decisions

- Ask AI: direction A — stays the last tab/dock button with a "soon" tag.
- History on narrow charts: direction A — current values move into the legend; the plot uses the full width.
- Chart data: direction A — a "View data" disclosure below each chart opens a table under it.
- Fit globe: direction C — a "⤢ Fit globe" pill in the control bar that appears only when the camera has moved away
  from the whole-Earth framing.

## Success criteria

- Every value a chart shows can be reached by keyboard and read by a screen reader.
- The phone sheet's tabs behave like the WAI-ARIA tabs pattern; its collapse control is always visible.
- At 320–390 px wide every control is reachable, primary targets are at least 40 px tall, and nothing overflows
  horizontally.
- After any resize or layout switch the Earth is never left clipped; a Fit control restores the whole-Earth view.

## Design

### Charts

- **"View data" disclosure** under the History and Owners charts: a button `View data` / `Hide data` with
  `aria-expanded` and `aria-controls`, opening a table below the chart inside a scroll container (max height ≈ 240 px,
  `tabIndex=0`, labelled) so the region is keyboard-scrollable.
  - History table: caption `Objects in orbit at the end of each year`; columns `Year`, one per shown type (in the chart's
    order, Unknown included when present), `Total`; rows newest year first; the year is the row header (`th scope=row`).
  - Owners table: caption `Objects in orbit by owner and type`; columns `#`, `Owner`, one per type, `Total`; the ranked
    rows, the `Other` row (no rank), and — when the selected owner is outside the ranked rows — its extra row with its rank;
    the selected owner's row is marked `(selected)` and highlighted. Same filters as the chart.
  - Whether each table is open is remembered for the visit (explorer store, not persisted).
- **History on narrow charts:** when the chart is narrower than 420 px, the end-of-line labels are not drawn, the right
  margin shrinks from 118 px to 12 px, and the legend shows each series' current (latest-year) value, e.g.
  `● Payload 17,782`. At 420 px and wider, today's end labels stay. Tooltips unchanged.

### Phone sheet, tabs and Ask AI

- **Order** (dock and sheet): Search, Filters, Overview, History, Owners, Ask AI. Desktop columns keep their layout. The
  phone sheet opens on Search.
- **Ask AI** keeps its panel; its dock button and tab carry a small `soon` tag.
- **Tab strip:** the collapse button (▾/▴) sits outside the horizontally scrolling strip, is 44 × 44 px, and has
  `aria-expanded` + `aria-controls`. Tabs are at least 40 px tall. A fade on the right edge shows when more tabs are
  off-screen (and on the left once scrolled). The active tab is scrolled into view.
- **WAI-ARIA tabs:** `role="tablist"` with an accessible name; each tab `role="tab"`, `id`, `aria-controls`,
  `aria-selected`; roving tabindex (0 on the active tab, -1 on the others); ←/→ move focus and select (wrapping),
  Home/End select the first/last; the panel is `role="tabpanel"`, `aria-labelledby` its tab, `tabIndex=0`.
- **No jumping while typing:** while the owner picker's list is open it has a fixed height (the current max height), so
  the sheet's height doesn't change per keystroke.

### Fit globe and the carry-overs

- **Fit globe pill** (`⤢ Fit globe`; `⤢ Fit` in the phone top bar) beside the status pill, shown only when the camera's
  distance differs from the fitted (whole-Earth) distance for the current layout by more than 5%. Pressing it animates
  the camera to the fitted distance keeping its current direction and the selection (reduced motion: jump). The fitted
  distance is today's initial-distance computation (desktop and sheet layouts).
- **Auto-refit on layout change:** when the layout switches between desktop and the sheet layout (or the sheet layout's
  top bar changes size enough to change the fitted distance by more than 5%), the camera moves to the new fitted
  distance.
- **Reset focus:** after the summary pill's Reset, a polite live region announces `Filters reset`; focus moves to the
  Filters panel's first type chip if that panel is visible, otherwise to the dock's Filters button (desktop) or the
  sheet's Filters tab (phone).
- **Owner picker:** the listbox is not a Tab stop (`tabIndex=-1`), so Tab from the open list moves to the next control;
  the active option scrolls into view when the list opens and while typing (and on arrow keys), but not on hover.
- **Status pill at 320 px:** its status text may wrap, so the pill never overflows.
- **Short landscape (the `short` layout, e.g. 844 × 390):** the filter summary pill shows `Filtered · Reset`; the full
  description stays in its accessible name and `title`.

## Units

- `web/src/components/charts/ChartData.tsx` (new: disclosure + table), `web/src/lib/chartTables.ts` (new, pure: table
  rows for History and Owners), `LineChart.tsx` (narrow mode, legend values), `BarChart.tsx`/`panelContent.tsx`
  (wiring), `web/src/lib/store.ts` (table open state, fit request, off-fit flag, Reset focus target).
- `web/src/lib/panels.ts` (order, soon tag), `web/src/components/layout/MobileSheet.tsx` (tab strip, ARIA tabs, collapse,
  opens on Search), `web/src/lib/tabs.ts` (new, pure: keyboard index movement), `PanelDock.tsx` (order, soon tag).
- `web/src/components/globe/GlobeScene.tsx` (off-fit detection, fit animation, auto-refit), `web/src/lib/camera.ts`
  (pure off-fit check), `web/src/components/globe/FitButton.tsx` (new), `GlobeSection.tsx` (placement),
  `FilterSummary.tsx` (compact short-layout form, Reset focus + announcement), `OwnerPicker.tsx` (tabIndex, scroll rules),
  `StatusPill.tsx` (wrapping).

## Testing

- Unit (vitest): tab keyboard movement (←/→ wrap, Home/End); History and Owners table rows (order, totals, Other, selected
  and extra rows); legend current values; the off-fit check (±5%).
- Browser (Playwright, mocked API): both "View data" tables open and contain the fixture numbers; at 390 × 844 the
  collapse button is in the viewport and ←/→/Home/End move between tabs (focus and selection); the Ask AI `soon` tag
  shows; after a search fly-to the Fit pill appears, and pressing it hides it again; resizing 1280×720 → 390×844 leaves the
  Earth unclipped (its top below the top bar); after Reset focus is on a sensible control and `Filters reset` is announced;
  Tab out of the open owner list keeps focus on a page control; no horizontal overflow at 320 px with a failing HIGH
  group (longest status text); the compact summary pill at 844 × 390.

## Out of scope

The AI analyst itself; API changes; persisting filters or table state across visits.
