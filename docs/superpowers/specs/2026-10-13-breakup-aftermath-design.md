# Breakup aftermath: survival curves and Gabbard diagrams

Date: 2026-10-13. Status: design approved by the owner in conversation, section by section; this spec awaits their
review.

Part 3 of 4 in the analysis roadmap agreed on 2026-09-25: (1) orbit-history archive (live), (2) crowding (live since
2026-09-29), (3) this breakup view, (4) orbital lifetime and disposal compliance.

## Owner decisions

- The view answers: which breakups made today's debris, how fast each cloud is clearing, and how spread out each
  cloud is today. That is option D from the brainstorm: survival curves over the full timeline as the core, plus a
  Gabbard diagram of each event's pieces today.
- Events: the 10 hand-picked rows in `api/app/seeds/breakup_events.csv`, unchanged. No new events, no new sources.
- Pieces: the existing link rule (`api/app/domain/catalog.py` `link_event`), unchanged. Only DEB objects whose
  `parent_cospar` matches are linked, so rocket bodies and payloads never count as pieces.
- Globe link: direction A. Selecting an event highlights its surviving pieces on the globe; hovering a Gabbard mark
  highlights that one piece; clicking a mark opens its ObjectCard.
- Survival chart: option A. One chart with all events, y = share of catalogued pieces still in orbit, x = years since
  the event; the selected event is bold. Raw counts go in the headline and the data table.
- Architecture: approach 1. A breakups file is published inside each globe generation and the maths runs in the
  browser. No live database queries per visitor and no separate job.

## Success criteria

- On the live data of 2026-10-12, the view's counts match `/api/events`: Fengyun-1C 3,533 catalogued and 2,313 in
  orbit; Cosmos 2251 1,714 and 610; Kosmos 1408 1,805 and 4; Long March 6A (2024) 705 and 574. Allow for real change
  since then.
- With an event selected and no filters, the globe highlights exactly the event's in-orbit pieces that are in the globe
  snapshot, and the view says how many in-orbit pieces are not plotted.
- Gabbard apogee, perigee and period agree with SATCAT's own `APOGEE`, `PERIGEE` and `PERIOD` within 10 km and 0.5 min
  on the test fixture.
- The survival chart, the Gabbard diagram, the highlight and the ObjectCard always come from the same globe
  generation.
- Keyboard and screen-reader users can reach every figure through the data tables.

## Data

Today's numbers (from `https://kessler.kudayyurter.dev/api/events`, 2026-10-12):

| Event | Date | Catalogued | In orbit |
|---|---|---:|---:|
| Transit 4A Ablestar | 1961-06-29 | 316 | 181 |
| Pegasus HAPS | 1996-06-03 | 753 | 56 |
| Fengyun-1C | 2007-01-11 | 3,533 | 2,313 |
| USA-193 | 2008-02-21 | 174 | 0 |
| Cosmos 2251 | 2009-02-10 | 1,714 | 610 |
| Iridium 33 | 2009-02-10 | 656 | 115 |
| Microsat-R | 2019-03-27 | 129 | 0 |
| Kosmos 1408 | 2021-11-15 | 1,805 | 4 |
| Long March 6A | 2022-11-12 | 800 | 613 |
| Long March 6A | 2024-08-06 | 705 | 574 |

In total 10,585 pieces, 4,466 still in orbit.

- Survival needs no orbit history. Each piece's `decay_date` comes from SATCAT, so every curve runs from the event
  date to today.
- SATCAT does not record when a piece was first catalogued. The share's denominator is therefore every piece
  catalogued so far. Old events are fully catalogued; recent ones (Long March 6A 2024) are still growing, which
  flatters their survival. The method note says so.
- The Gabbard diagram uses the elements the browser already loaded for the globe. A piece is plotted when it is in
  orbit and in the snapshot (regime LEO, MEO, GEO or HEO, with a row in `gp_elements`).

## Backend

### The breakups file

`publish_generation` (`api/app/ingest/snapshot.py`) writes one more file in the generation folder:
`globe/gen/<generation>/breakups.json.gz`. It reads the rows in the same REPEATABLE READ transaction as the globe rows,
so the file and the snapshots always describe the same database state. The existing retention and cleanup
(`remove_old_generations`) cover the file with no change, since they work on whole generation folders.

```json
{
  "generated_at": "2026-10-13T06:41:00+00:00",
  "events": [
    {
      "id": "fengyun-1c-2007",
      "name": "Fengyun-1C anti-satellite test",
      "event_date": "2007-01-11",
      "kind": "ASAT",
      "parent_cospar": "1999-025",
      "description": "China destroyed its Fengyun-1C weather satellite ...",
      "source_url": "https://en.wikipedia.org/wiki/...",
      "pieces": [[29713, null], [29714, "2015-03-02"]]
    }
  ]
}
```

- `events` is ordered by `event_date`, then `id`. Every row of `breakup_events` is listed, including events with no
  linked pieces.
- `pieces` is every object with `event_id` = the event's id, as `[norad_id, decay_date or null]`, ordered by
  `norad_id`.
- The server sends raw piece data only. The browser derives the curves and counts, so nothing is computed twice.
- The file is gzipped JSON with `mtime=0`, written with `separators=(",", ":")`, like the names files. Expected size is
  60–80 KB gzipped.
- The rows come from a new `BREAKUP_ROWS_SQL` next to `GROUP_ROWS_SQL`. A new `pack_breakups(events, pieces,
  generated_at)` builds the bytes, and a `breakups_file()` helper returns `breakups.json.gz`.
- With no element sets at all, `publish_generation` still writes nothing (existing behaviour), so no breakups file
  appears without a globe.
- The pointer (`globe/current.json`) does not change. Pages already know the generation.

### API

`GET /api/globe/breakups?gen=<generation>` in `api/app/api/routes.py`.

- With `gen`: reads `generation_key(gen, "breakups.json.gz")`. Immutable cache header, ETag/304.
- Without `gen`: reads the current generation from the pointer, with the same short cache as other current globe
  files.
- 404 when the pointer is missing or the generation has no breakups file (generations published before this
  release). `gen` uses the same `Generation` query type as the other globe routes, so a malformed value is rejected
  the same way.
- The route calls `_globe_file` with no legacy key. Its `group` argument only feeds the 404 message, so it becomes an
  optional label (`"breakups"` here) instead of a group; the caching and ETag logic is reused, not copied.
- The body is decompressed and served as `application/json`, as the names route does.

### Unchanged

- `/api/events` stays as it is: the ObjectCard and future chat tools can use it.
- No schema migration, no new job, no new schedule, no infrastructure change.
- After deploy, the first breakups file appears with the next GP ingest (within 6 hours), or at once with a manual
  `publish-globe` run.

## Web

### Logic: `web/src/lib/breakups/`

Pure modules, each unit-tested:

- `format.ts`: parses and checks the file into `BreakupFile` / `BreakupEventData` types.
- `survival.ts`: per event, the step curve `[(years since event, share in orbit, count in orbit)]`, starting at
  (0, 100%) and stepping at each decay. A `decay_date` before the event date is clamped to day 0. Also the headline
  counts: catalogued, in orbit, re-entered, and the share that re-entered within the first year.
- `gabbard.ts`: from a globe record's mean motion and eccentricity, `a = (μ / n²)^(1/3)`, apogee = `a(1 + e) − R`,
  perigee = `a(1 − e) − R`, period = `2π / n` in minutes, with μ = 398600.4418 km³/s² and R = 6378.137 km. Returns
  plotted marks and the count of in-orbit pieces with no globe record.
- `text.ts`: number and share formatting, kind labels, the tooltip and screen-reader strings.
- `tables.ts`: rows for the two data tables.

No worker: about 10,600 pieces is light work on the main thread.

### Data loading

- `api.breakups(gen)` in `web/src/lib/api.ts`: returns the parsed file, or null on 404.
- `BreakupsProvider` (`web/src/components/breakups/`) fetches the file the first time the panel is shown, for the
  generation the globe is on. When the tab refresh (freshness piece 3) moves the globe to a new generation, it
  refetches and keeps the selection by event id.

### Store

New fields in `web/src/lib/store.ts`:

- `breakupEvent: string | null`, the selected event id.
- `hoverPiece: number | null`, the NORAD ID under the Gabbard pointer.
- `breakupsView: boolean`, whether the expanded view is open.
- `dataTablesOpen.breakups`, with `breakups` added to the `DataDisclosure` `which` union
  (`web/src/components/charts/ChartData.tsx`).

### Globe

In `web/src/components/globe/Objects.tsx`, the `highlight` mask becomes, in order:

1. `hoverShell` set: the crowding cell, as today.
2. `hoverPiece` set: that one record.
3. `breakupEvent` set: records whose NORAD ID is one of the event's in-orbit pieces.
4. Otherwise null.

Filters still decide visibility. A highlighted piece hidden by a filter stays hidden. The piece set is a `Set<number>`
memoised on the event and the file.

## UI

### Panel "Breakups"

- `PanelId` `"breakups"` in `web/src/lib/panels.ts`, placed after Crowding and before Ask AI, visible by default, and
  mapped in `web/src/components/panels/panelContent.tsx`.
- Contents:
  - The event list: one row per event with short name, year, kind tag (ASAT / COLLISION / EXPLOSION / UNKNOWN) and
    "2,313 of 3,533 still up". Rows are buttons; the selected row is marked.
  - A small survival chart under the list: all events faint, the selected one bold.
  - An Expand button that opens the view.
- Events with no catalogued pieces show "no catalogued pieces", in grey, and still open their description.

### Expanded view `BreakupsView`

A dialog over the globe, built like `CrowdingView`.

- **Header:** event name, date, kind, description, source link, and counts (catalogued, in orbit, re-entered, share
  re-entered in the first year).
- **Survival chart (SVG):** y = share still in orbit, 0–100%; x = years since the event, 0 to the oldest event's age.
  One step curve per event. The selected one is bold; the others are faint, and clicking one selects it. Hovering
  shows, for example, "Fengyun-1C, year 9: 87% still up (3,07x)".
- **Gabbard diagram (canvas, selected event only):** x = period in minutes, y = altitude in km. Two marks per piece:
  apogee ▲ and perigee ▼. Hovering a mark shows the piece's name, apogee, perigee and period, and sets `hoverPiece`.
  Clicking selects the object, which opens its ObjectCard. Under the chart: "N in orbit not plotted" when some pieces
  have no globe record, and "N off scale" when a period is above the axis maximum (2,000 min).
- **Method note:** the link rule (DEB only, by international designator), that only tracked pieces count (roughly
  10 cm and larger in LEO), the denominator caveat for recent events, and that the Gabbard diagram uses the globe's
  element sets.
- **Data tables** through `DataDisclosure`: survival by year for the selected event (year, in orbit, share,
  re-entered that year), and the full piece list (NORAD ID, name, apogee, perigee, period, or re-entry date).
- **Phone layout:** a full-screen sheet with Survival and Gabbard tabs.

### Selection lifecycle

- Selecting an event highlights its pieces at once, with the view open or closed.
- Closing the view keeps the event selected and highlighted. `FilterSummary` shows a chip ("Fengyun-1C pieces") with a
  clear button, like the pinned shell. Reset clears it too.
- In `ObjectCard`, the "Created by" row becomes a button that opens the view with that event selected.

## Error handling

- **No breakups file** (404: before the first publish after deploy, or an old generation): the panel says "Breakup
  data appears after the next catalog update." The globe is unaffected.
- **Fetch fails:** an inline error with Retry, as in the crowding panel.
- **Globe not loaded yet, or failed:** the event list and survival chart still work, since they need only the
  breakups file. The Gabbard diagram shows "Waiting for the globe" or the globe's own error.
- **Generation changes:** the provider refetches for the new generation, as above.
- **Bad values:** a decay date before the event date is clamped to day 0. A file that fails `format.ts` checks is
  treated as a failed fetch.

## Accessibility

- Event rows, survival curves and the Clear chip are focusable buttons with visible focus.
- The charts carry `aria-describedby` summaries from `text.ts`. The data tables carry every figure.
- The Gabbard canvas is `aria-hidden`; its content is in the piece table.
- The dialog traps focus and returns it to the Expand button or the ObjectCard row that opened it. Esc closes it.

## Testing

### API (pytest)

- `api/tests/test_breakups_publish.py`: the file is written in the generation folder and read in the same
  transaction as the snapshot rows; events with no pieces are listed; ordering of events and pieces; decayed pieces
  carry their date; nothing is written when there are no element sets.
- The existing cleanup tests also check that old generations' breakups files are removed with them.
- `api/tests/test_api_breakups.py`: with and without `gen`, ETag/304, cache headers, 404 for a missing pointer or file,
  rejection of a malformed `gen`.

### Web unit (vitest)

- `web/tests/unit/breakupsSurvival.test.ts`: steps, shares, clamping, first-year share, events with no pieces.
- `web/tests/unit/breakupsGabbard.test.ts`: the independent check. A fixture
  (`web/tests/fixtures/breakups/gabbard.json`) holds about 50 real pieces from several events, each with its GP
  elements and SATCAT's `APOGEE`, `PERIGEE` and `PERIOD`, taken from CelesTrak on one day and limited to pieces whose
  element epoch is within one day of SATCAT's. `gabbard.ts` must agree within 10 km and 0.5 min. SATCAT computes those
  values on its own, so no separate Python reference is needed.
- `format.ts` parsing and rejection, `tables.ts` rows, and the highlight-mask precedence.

### End to end (Playwright)

In `web/e2e/explorer.spec.ts`, with a fixture breakups file:

- Open the panel and select Fengyun-1C. The highlight count equals the fixture's plotted in-orbit pieces.
- Expand, hover a Gabbard mark and see the tooltip; click it and the ObjectCard opens for that piece.
- Close the view; the chip is in the filter summary; Clear removes the highlight.
- The ObjectCard "Created by" row opens the view with its event selected.

## Rollout

- One branch and PR; the owner merges. API and jobs ship through the GitHub Actions deploy, the web through Vercel.
  The web handles the breakups 404 while the API is ahead or behind.
- After deploy, run `publish-globe` once, or wait for the next GP ingest.
- Check that `/api/globe/breakups` returns all 10 events, and that the counts match `/api/events` as in Success
  criteria.

## Out of scope

- Gabbard animation over time (waits for the parked multi-year GP backfill).
- Detecting new breakups from the daily ingest.
- Linking rocket bodies or payload fragments to events.
- Events beyond the seed file.
- Re-entry prediction (part 4).
- Chat tools (`globe_focus`, `list_breakup_events`).
