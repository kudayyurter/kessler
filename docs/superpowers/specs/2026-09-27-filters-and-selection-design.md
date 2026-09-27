# Filters and selection

Date: 2026-09-27. Status: design approved by the owner in conversation (mockups in the visual companion); this spec
awaits their review.

Piece 4 of 5 from the repository audit of 2026-09-25 (`/tmp/kessler-repo-audit.md`): findings #6 (hidden Unknown type),
#7 (owner filter vs the Owners chart), #8 (most owners cannot be selected), #9 (search fly-to can miss), design idea 2
(filter summary), plus search matching of spaces vs hyphens (deferred from piece 3) and proper owner names (added by the
owner during this design).

## Owner decisions

- Unknown (`UNK`) is shown as a real type, "Unknown", everywhere.
- The Owners chart stays a ranking of all owners, labelled as such, with the selected owner highlighted — direction A:
  outline the selected bar and dim the other rows; an owner outside the top 5 gets its own row under a divider.
- Owner picker: direction A — a type-to-filter combobox (largest owners first, then A–Z).
- Filter summary: direction A — a pill beside the status pill, shown only when filters differ from the default, with Reset.
- Selecting a search result whose object is hidden by the filters changes the filters to show it (not a special case that
  ignores them).
- Fly-to: a pending fly-to that waits for the object's position.
- Every owner code gets a proper name.

## Success criteria

- Every filter state is visible and reversible (including Unknown and any owner).
- No chart silently mixes filtered and global numbers: each says its scope.
- Any of the 130 owners can be selected by typing part of its name or code.
- Selecting any search result either flies to the object or the object card says why it can't.
- "starlink 1007" finds STARLINK-1007.

## Design

### Filters and charts (web)

- **Unknown type.** Filters gets a fourth type chip, "Unknown", in its chart colour (`CHART_COLORS.UNK`). The History
  line chart adds an Unknown line and legend entry; the Owners bar chart adds a grey Unknown segment and legend entry. At
  least one type must stay selected (unchanged rule). Type counts in summaries use all four ("3 of 4 types"; all four =
  "all types").
- **Owner picker (combobox).** Replaces the `<select>` that lists only the top 8 owners:
  - Closed: shows the selected owner (flag + name) or "All owners".
  - Open: "All owners", then a "Largest" group (the 8 owners with the most objects in orbit), then "All owners A–Z"
    (all 130, sorted by name), each with its in-orbit count; owners with none in orbit are dimmed but selectable.
  - Typing filters by name or code (case-insensitive substring); groups collapse into one filtered list.
  - Keyboard: ↓/↑ move, Enter selects, Escape closes (and clears the typed text); Tab leaves. ARIA combobox pattern
    (`role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, `role="listbox"`/`option`).
  - Single selection, feeding the same `owners` filter as today (globe + History).
- **Owners chart.**
  - Still ranks all owners (the breakdown request does not pass the owner filter) and still follows the type and orbit
    filters.
  - Scope line under the title: `All owners, ranked · <orbits> · <types>` (e.g. "All owners, ranked · Low Earth orbit ·
    all types").
  - With an owner selected: its bar is outlined, its label and number are bright, the other rows are dimmed to about a
    third.
  - If the selected owner is not among the ranked rows (top 5 + Other), a divider and an extra row show it with its rank,
    e.g. "🇩🇪 Germany #9", from the same breakdown request's `rank_of` (see API). "Other" still counts it; the extra row
    is a highlight, not a second count. An owner with no objects under the filters gets the row with "—" and 0.
- **History scope line** under its subtitle: `<orbits> · <owner> · <types>` (e.g. "Higher orbits · United States · 3 of 4
  types"; default "Low Earth orbit · All owners · all types").
- **Filter summary pill** in the globe's control bar next to the status pill (in the phone top bar in the sheet layout):
  - Shown only when a filter differs from the default (Low Earth orbit only, all owners, all four types).
  - Text: `Showing <orbits> · <owner> · <types>` with a Reset button; clicking the text opens the Filters panel (desktop:
    shows the panel; sheet layout: switches to the Filters tab).
  - Reset returns to the default filters. The pill is a labelled group; Reset's accessible name is "Reset filters".
  - Orbit wording: "Low Earth orbit", "Higher orbits", or "All orbits" (both).

### Selection, fly-to and search

- **Selecting a search result makes the object visible first:** turns on its orbit group (LEO → Low Earth orbit; MEO/GEO/
  HEO → Higher orbits), turns on its type, and clears an owner filter that doesn't match its owner; then selects it.
  Objects with regime OTHER, or re-entered, change no filters (they are never on the globe).
- **Pending fly-to.** Any selection (search or clicking a globe label) sets a pending fly-to. Each frame the globe checks
  whether the selected object has a position; the moment one exists it flies there (existing `flyTo`) and clears the
  pending flag. A new selection or clearing the selection cancels it.
- **"Not in this data" vs "not ready yet".** A group's locator distinguishes an object absent from its records from one
  whose position is not computed yet; only "absent" ends the wait (reported to the store as the selection's globe
  status).
- **Object card reason** when there is no position (otherwise unchanged):
  - re-entered: `Re-entered on <date> — no current position.`
  - regime OTHER: `Not shown on the globe: beyond Earth orbit or unknown orbit.`
  - absent from its loaded group: `No current orbit data for this object.`
- **Search matching (API).** Spaces, hyphens and underscores are equivalent in names: the query and the name are both
  normalised (runs of `-`, `_` and whitespace → one space) before the case-insensitive substring match. NORAD (exact) and
  COSPAR (prefix) matching are unchanged.

### Owner names (API data)

- `api/app/seeds/owners.csv` covers all 130 owner codes in the catalogue: the existing 47 rows unchanged; 81 names from
  CelesTrak's SATCAT source list (https://celestrak.org/satcat/sources.php), e.g. `ABS` → "Asia Broadcast Satellite",
  `FGER` → "France/Germany"; four by hand: `SVK` Slovakia, `KWT` Kuwait, `JOR` Jordan, `UGA` Uganda.
- `country_iso` (for the flag) only for single-country owners; organisations and multinational entries have none.
- The daily SATCAT ingest (05:17 UTC) already runs `load_seeds`, so names appear on its first run after deploy — no
  manual job, no runtime fetch.

### API: the selected owner's rank

The extra Owners row needs the owner's rank among all owners under the current type/orbit filters. `GET
/api/stats/breakdown` gains an optional `rank_of=<owner code>`: the response adds `rank_of: {key, rank, counts, total}`
(rank 1-based among all owners; null if the owner has none under the filters). Existing fields and behaviour unchanged.

## Units

- Web: `web/src/components/panels/Filters.tsx` (Unknown chip, combobox), new `web/src/components/panels/OwnerPicker.tsx`
  and pure `web/src/lib/ownerPicker.ts` (ordering, matching); `web/src/lib/filterSummary.ts` (summary/scope text, default
  check) and a `FilterSummary` pill in `GlobeSection`; `web/src/components/charts/BarChart.tsx` (Unknown, highlight, extra
  row), `LineChart.tsx` / `chartData.ts` (Unknown series), `panelContent.tsx` (scope lines); `web/src/lib/store.ts`
  (`selectFromSearch`, pending fly-to, selection globe status, `resetFilters`); `GlobeScene.tsx` / `Objects.tsx` (pending
  fly-to, absent vs not-ready locator); `ObjectCard.tsx` (reason line); `SearchBox.tsx` (uses `selectFromSearch`);
  `web/src/lib/api.ts` (`rank_of`).
- API: `api/app/services/objects.py` (normalised search), `api/app/services/stats.py` (`rank_of`), `api/app/api/routes.py` (query param), `api/app/seeds/owners.csv`.

## Testing

- Web unit (vitest): summary text and "N of 4 types"/"all types"; default detection; owner picker ordering (Largest 8,
  then A–Z by name) and matching (name or code, case-insensitive); the filters a search result turns on (per regime, type,
  owner); Owners highlight rules (in the ranked rows vs extra row with rank); object card reason; chart series including
  Unknown.
- API (pytest): "starlink 1007", "starlink-1007", "STARLINK_1007" all find STARLINK-1007; NORAD/COSPAR unchanged;
  `rank_of` (rank, counts, null when absent, filters respected); owners.csv has 130 unique codes, every name differs from
  its code, `country_iso` values are valid two-letter codes.
- Browser (Playwright, mocked API): the Unknown chip changes the chart requests' `types`; the owner picker finds Germany
  by typing "ger", filters History (`owners=GER`) and shows Germany's highlighted extra row; the summary pill appears and
  Reset restores defaults; searching a higher-orbit object turns on Higher orbits and flies to it; a re-entered object's
  card shows the reason.

## Out of scope

Piece 5: keyboard-accessible chart data, mobile sheet tabs, Ask AI placement, a wider History chart, Fit globe. Multi-owner
selection.
