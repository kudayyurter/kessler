# Crowding by altitude × inclination

Date: 2026-09-28. Status: design approved by the owner in conversation (mockups in the visual companion,
`.superpowers/brainstorm/130528-1790616653/`); this spec awaits their review.

Part 2 of 4 in the analysis roadmap agreed on 2026-09-25: (1) orbit-history archive (live), (2) this crowding view,
(3) breakup aftermath, (4) orbital lifetime and disposal compliance.

## Owner decisions

- The view answers: where it is crowded now, how risky each shell is, and how crowding is changing.
- Long-term history (1957 onward) waits for the multi-year GP backfill, which is parked. SATCAT cannot stand in for it:
  it keeps each re-entered object's final orbit (median perigee 199 km for the 35,627 re-entered objects vs 623 km for
  the 35,186 in orbit), so a SATCAT rebuild would put every dead object at ~200 km. Re-entry prediction ("will this
  object re-enter, and when") belongs to part 4. The "age of today's population" view was offered and declined.
- Range: a LEO map (200–2,000 km, linear) plus a compact high-orbit strip.
- Placement: each object is spread over the altitudes it passes through, weighted by time spent there.
- Risk measure: spatial density per altitude shell, split by type (which also gives the debris share). No collision
  proxy and no drag clearing time.
- Change: both a comparison between two dates with a breakdown by cause, and a day-by-day playback.
- Filters (type, owner, orbit) apply everywhere: the now map, the change view and the playback.
- Architecture: daily state files in S3, with the maths in the browser (approach A). Postgres is out: the Neon free
  plan caps the branch at 512 MB and per-object daily state would add ~3 MB a day.
- Layout: direction C, a small "Crowding" panel that expands into a large view over the globe.
- Globe link: direction B, where hovering a cell highlights its objects and draws the shell around the globe, and
  clicking pins the cell as a filter.
- The expanded Change view as mocked (orange = gained, blue = lost, cause card, two-handle timeline).

## Success criteria

- On the 2026-09-28 12:41 UTC data the view reproduces the reference numbers: busiest cell 450–475 km × 52.5–54.5°
  at ≈ 4,370 objects; busiest shell 450–475 km at ≈ 418 per 10⁹ km³.
- Every number follows the type, owner and orbit filters.
- Every cell's change is explained by cause, and sub-threshold jitter never shows as movement.
- A pinned cell changes the globe and the filter summary; Reset clears it.
- Keyboard and screen-reader users can reach every figure (cell navigation plus a data table).
- Past days never change once closed, and the history has no gaps except days on which every run failed.

## Measurements

**Population.** Exactly the globe's: objects with a row in `objects`, `decay_date IS NULL`, and a current element set
(the globe's `GROUP_ROWS_SQL`, both groups). The raw GP feed also carries objects SATCAT doesn't list (analyst IDs
270000+/290000+ and others), so using the feed as-is would show hundreds of fake losses. In the prototype, 692 objects
were in the archive baseline but not on the globe, and only 9 of them had re-entered.

**Orbit geometry.** The semi-major axis comes from the mean motion, with μ = 398600.4418 km³/s². Altitude is
r − 6378.137 km (a spherical Earth, the same convention as SATCAT's perigee and apogee). Objects with e ≥ 1, a
non-positive mean motion, or any non-finite element are skipped and counted, and the Method note shows that count.

**Grid.**
- LEO rows: 25 km from 200 to 2,000 km (72 rows), plus a floor row "< 200 km" that takes everything below 200 km,
  including perigees under the surface.
- High strip, six rows: 2,000–8,000; 8,000–18,000; 18,000–25,000 (GNSS); 25,000–35,586; 35,586–35,986 (GEO belt);
  above 35,986 km.
- Inclination: 91 columns of 2°, with edges on half degrees. Column c = min(floor((i − 0.5) / 2) + 1, 90) covers
  [2c − 1.5, 2c + 0.5): column 0 is [0, 0.5) and column 90 is [178.5, 180]. This puts 43°, 53.05°, 70°, 87.9° and 97.6°
  mid-bin. The prototype measured 1,008 objects within 0.05° of an edge, against 3,307 with edges on even degrees and
  5,784 with edges on odd degrees. The altitude edges (200, 225, …) are already the better phase: 1,537 objects within
  1 km of an edge, against 4,292 with a 12.5 km offset.

**Time weighting.** The fraction of an orbit spent at radius ≤ R is F(R) = (E − e sin E) / π, where
cos E = (1 − R/a) / e and E ∈ [0, π]. F is 0 below perigee and 1 above apogee. An object's weight in a row is
F(top) − F(bottom), and its weights sum to 1. Orbits with e < 10⁻⁶ go wholly into the row that holds a − R_E.
Inclination doesn't change around an orbit, so each object sits in one column. A cell's value is the average number
of objects in it at any moment.

**Spatial density.** A LEO shell's summed weight divided by its volume, 4/3 π ((R_E + h₂)³ − (R_E + h₁)³), shown per
10⁹ km³ and split by type (PAY, R/B, DEB, UNK). It is shown for the 72 LEO rows only; the floor row and the high strip
show counts.

**Change between states A (from) and B (to).**
- Present in both: the object *moved* if |Δ(a − R_E)| ≥ 5 km or |Δi| ≥ 0.1°. Its B weights minus its A weights split
  into *moved in* (positive parts) and *moved out* (negative parts). An object that didn't move adds nothing. In the
  prototype this rule removed 42% of the raw moves, which were element jitter.
- Only in B: *newly catalogued* (launches and new fragments), adding its B weights.
- Only in A: *re-entered* if the index's `reentries` map has a decay date on or before B's day, otherwise
  *no longer tracked*. Either way it subtracts its A weights.
- Net = newly catalogued + moved in − moved out − re-entered − no longer tracked. Because of the jitter rule, a cell's
  net can differ slightly from (B map − A map); the Method note says so.
- Filters are evaluated with B's owner and type for objects present in both states, so a reclassification (e.g.
  UNK → DEB) isn't reported as a departure. Objects in only one state use that state's values.

**Days.** A day's state is its last `ingest-gp` run (normally 18:41 UTC). Today's state is the latest run, the same
data as the live globe. History starts on 2026-09-25.

## Backend

**`publish-crowding`** is a job step with its own `run_log` entry (`publish_crowding`). It runs after every
`ingest-gp` and in the `publish-globe` deploy job.
1. Read the globe rows (`GROUP_ROWS_SQL` for both groups, in one REPEATABLE READ transaction) and the current pointer's
   generation.
2. Write `crowding/days/<UTC date of the run>.bin.gz`, overwriting any earlier file for today.
3. Rewrite `crowding/index.json`.

The step holds the existing `GLOBE_LOCK` advisory lock (`advisory_lock(database_url, GLOBE_LOCK)`), and so does
`backfill-crowding`. That way a deploy-time publish, a scheduled ingest and the backfill never interleave their
`index.json` updates. A failure fails the job, so the existing jobs error alarm fires. The globe generation and the `ingest_gp` run log are
already committed, so the globe and the status pill are unaffected, and the next run rewrites today's file.

**Day file, "CRW1".** The magic `CRW1`, a u32 header length, then a JSON header: `version`, `day`, `generated_at`,
`generation`, `source` (`live` | `archive`), `count`, `owners` (codes), `types`, and `columns` (names, dtypes). After it
come little-endian column arrays of length `count`, sorted by NORAD ID:
- `norad_delta` u32 (the first is the absolute ID)
- `owner` u16 (index into `owners`)
- `type` u8 (index into `types`)
- `sma_dkm` u32 (semi-major axis in 0.1 km)
- `ecc_e6` u32 (eccentricity × 10⁶)
- `inc_cdeg` u16 (inclination in 0.01°)

The whole file is gzipped. The prototype measured ~173 KiB for 31,908 objects, about 63 MB a year, kept indefinitely
(the bucket is RETAIN).

**`crowding/index.json`** holds:
- `days`: one entry per file, with `day`, `generated_at`, `count` and `source`, ascending.
- `latest`: `{day, generation}`.
- `history_start`: `"2026-09-25"`.
- `reentries`: NORAD ID → `decay_date`, for objects whose decay date is on or after `history_start`.

Each run updates it from the previous index, adding or replacing the entry for the day it wrote. If the index is
missing or unreadable, it is rebuilt from the day files' headers. `reentries` is recomputed from `objects` on every run,
so decay dates that SATCAT publishes late flow in by themselves.

**`backfill-crowding`** is a one-off, idempotent job for the days before live files exist. It covers every UTC day
from `history_start` to yesterday that has no day file yet, and never overwrites one.
- It folds `read_history` output into each object's latest element set with an epoch at or before the end of that day.
- Population: in `objects`, `decay_date` null or after that day, and a latest epoch no more than 30 days before the
  end of that day.
- Owner and type come from `objects`, and files are written with `source: "archive"`.
- It runs in the jobs Lambda, and the parked multi-year backfill can reuse the same fold.

**API.**
- `GET /api/crowding/index`: `Cache-Control: public, max-age=60, s-maxage=60`; 404 before the first publish.
- `GET /api/crowding/day/{YYYY-MM-DD}`: ETag and 304 like the globe files. The cache header is immutable for a year
  when the day is before `latest.day`, and `public, max-age=60, s-maxage=300` for `latest.day`, where `?gen=<generation>`
  (the existing `GENERATION_PATTERN`) is accepted as a CDN cache-buster. Returns 400 for a malformed or impossible date
  and 404 for a missing day. The body is the stored gzip bytes as `application/octet-stream`, decompressed in the
  browser the way `LEO.bin.gz` is.
- No proxy change: the proxy forwards every `/api/*` path except `/api/ready`. No infrastructure change: same bucket,
  Lambdas and schedules.

## Web

**Pure modules, `web/src/lib/crowding/`:**
- `format.ts`: decode CRW1.
- `grid.ts`: the time-weighted binning, rows, columns, labels and density.
- `change.ts`: the A/B diff with causes and the jitter rule, plus the top movers per cell.

These run in **`workers/crowding.worker.ts`**, which is sent decoded states, filters, and requests for a map or a
change. Filter changes and playback never block the globe.

**`lib/crowdingData.ts`** loads the index, then `latest.day`, then past days on demand for Change and Play. It keeps up
to 60 decoded days in memory, dropping the oldest used first. When the globe swaps in a new generation (`dataVersion`),
it refetches the index and today's file with `?gen=`.

**Store and filters.**
- `shell: {altMin, altMax, incMin, incMax} | null` (the pinned cell) joins the filters. A transient `hoverShell` stays
  outside the filters.
- `isVisible` adds: the orbit's perigee–apogee altitude range overlaps [altMin, altMax) and the inclination lies in
  [incMin, incMax). The floor row uses altMin = −∞ and the top high row altMax = +∞.
- The filter summary shows "Shell 450–475 km · 52.5–54.5°" with ✕, and Reset clears it.
- History and Owners come from server-side yearly stats and can't be cut by shell, so their scope lines don't mention
  the shell.

**Globe.**
- `aVisible` becomes a brightness level: while a cell is hovered, its objects stay at 1 and the rest drop to 0.2; when a
  cell is pinned, the objects outside it are hidden (0).
- Rings, shown while a cell is hovered or pinned:
  - A true-scale ring at the cell's middle altitude, facing the camera.
  - Two dashed latitude circles on that shell at ±φ, where φ is the highest latitude any orbit in the band reaches:
    φ = incMax for a band wholly below 90°, 180° − incMin for a band wholly above 90°, and 90° for a band containing
    90°. These replace the mockup's single tilted ring: a band holds every orbital plane at those inclinations, and
    those orbits fly between those latitudes.
  - High-strip rows draw the ring at the row's middle altitude, and the "above GEO" row doesn't draw one.

## UI

**Small panel "Crowding"** (id `crowding`, after Owners in the dock and the sheet, visible by default):
- The now map (LEO grid and floor row) with the density strip on the shared altitude axis, and a line: "Busiest shell
  450–475 km · 418 per 10⁹ km³".
- Hover shows a tooltip: the cell, average objects present, the split by type, how many objects pass through it, and
  the shell's density.
- Clicking pins the cell; clicking it again or ✕ unpins it. `⤢ Expand` opens the large view.

**Expanded view** covers the globe area, while Search and Filters stay usable. It is a non-modal dialog labelled by its
title: focus moves into it on open, and Esc or ✕ closes it and returns focus to Expand.
- Header: Now | Change, window chips (1 d, 7 d, 30 d, All), ✕.
- Summary line (Change): "Since 09-25 06:41 UTC: +23 newly catalogued · −9 re-entered · 333 moved between cells ·
  net +14".
- Map: the LEO grid, floor row and high strip. Now mode uses the heat ramp, dark to #ff6a3d to #fff4d6, on a log scale.
  Change mode diverges from blue (lost) to orange (gained), also on a log scale.
- The density profile beside the map shares its altitude axis. In Change mode it shows the density change per shell.
- The cell card shows the cell, net and each cause, and the top 5 movers by weight change (names from the globe's names
  file, falling back to the NORAD ID) with before → after mean altitude and inclination, plus **Show on globe** (closes
  the view and pins the cell).
- Timeline:
  - Now mode has one handle, the day shown.
  - Change mode has "from" and "to" handles. A chip sets from = to − gap, and either handle can be dragged. Chips
    longer than the history are disabled ("needs 7 days of history"). The default is 7 d when enabled, otherwise All.
  - Play advances "to", and in Change mode the whole window, from the earliest possible day to the latest. Once the
    span is longer than 60 days it steps ceil(span / 60) days per frame, with a progress indicator while frames load.
  - Labels show the actual state timestamps, e.g. "09-25 06:41 → 09-28 12:41". A missing day snaps to the nearest
    earlier one.
- A **Method** note covers time weighting, bins and edges, the jitter rule and its effect on the net, the population
  rule, "history since 25 Sep 2026", which days were rebuilt from the archive, and the skipped-object count.

**Phone (sheet layout):** Crowding is a sheet tab. Expanding fills the sheet at full height, with the card below the
map and the timeline at the bottom. Tap a cell to inspect it; the card offers Show on globe.

**States:** loading; Unavailable with Retry when the index or a day file fails (via the existing `Unavailable`
component); "No crowding data yet" when the index 404s. Change and Play stay usable with whatever days are loaded.

## Accessibility

- The map is one focusable element (role `group`, `aria-roledescription` "crowding map", with instructions in
  `aria-describedby`).
- Arrow keys move a visible focus cell, Shift+arrow jumps to the next non-empty cell, Enter pins, and Esc unpins.
- The focused cell's summary is announced through the existing `Announcer` (polite).
- **View data** (the `ChartData` pattern) lists the top 20 cells and all shell densities in Now mode, and the top 20
  gains and losses by cause in Change mode.
- Colour is never the only carrier: the tooltip, card and table show the numbers.
- Reduced motion: Play steps frames with no transitions, and nothing autoplays.

## Testing

**API (pytest, testcontainers Postgres, local store, moto for S3):**
- CRW1 round-trip at the stated precision.
- `publish-crowding` writes today's file, overwrites it on a second run the same day, and leaves yesterday's
  untouched. The index lists the days, `latest`, and `reentries` from `objects`.
- A failing write marks `publish_crowding` failed while `ingest_gp` stays OK.
- Backfill folds archive fixtures by day with the population rule, skips existing days, and labels files `archive`.
- Routes: cache headers for past vs latest days, `gen` validation, ETag/304, 400 for a bad date, 404 for a missing one.

**Web (vitest):**
- Decode.
- Binning:
  - A circular orbit puts weight 1 in one cell.
  - Eccentric weights sum to 1 and match F(R) analytically.
  - Inclinations of exactly 0.5°, 52.5°, 54.5° and 180° land in the right columns.
  - Perigee below 200 km goes to the floor row, and GTO spreads into LEO rows and the high strip.
  - Skipped objects are counted.
- A **golden fixture**: ~200 real objects (circular LEO, SSO, retrograde, GTO, GEO, near-edge, decaying) with expected
  cell weights from an independent Python reference in `tools/crowding/` (a uv project like `tools/accuracy`).
- `change.ts`: each cause, the jitter threshold at exactly 5 km and 0.1°, reclassification under a type filter.
- Store: the shell filter with `isVisible`, the filter summary, Reset.

**Playwright:**
- The panel renders, the tooltip appears on hover, and a click pins the cell (summary pill, Reset).
- Expand and close with focus return.
- Disabled chips.
- Keyboard cell navigation with announcements.
- The phone sheet tab and the expanded sheet.

## Rollout

- One branch and PR; the owner merges. API and jobs ship through the GitHub Actions deploy, the web through Vercel.
  The web handles the index 404 while the API is ahead or behind.
- After deploy, run `backfill-crowding` once (the owner runs the command, or it runs in the deploy workflow).
- Check that `index.json` lists 2026-09-25 to today, today's file is `live`, earlier ones `archive`, and the reference
  numbers in Success criteria hold on the day's data (allowing for the day's real change).

## Out of scope

- History before 2026-09-25 (waits for the parked multi-year GP backfill).
- Re-entry prediction (part 4).
- The age-of-population view, a collision-rate index, drag clearing time.
- Cutting the History and Owners charts by shell.
