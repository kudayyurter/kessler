# Freshness and error states

Date: 2026-09-26. Status: design approved by the owner in conversation (mockups in the visual companion); this spec
awaits their review.

Piece 3 of 5 from the repository audit of 2026-09-25 (`/tmp/kessler-repo-audit.md`): finding #4 (open tabs never
refresh orbit snapshots), #5 (a Higher-orbits failure is presented as a live empty sky), #12 (search has no loading
or no-results state), and design ideas 3 (communicate data age) and 6 (meaningful search empty state).

## Owner decisions

- Status badge: direction **A, "smarter pill"** — keep the single pill; its dot colour, word and suffix carry the
  state; Retry sits inside the pill.
- Refresh: **poll the published-generation pointer** (not timed re-downloads, not server push).
- Search: the six states shown in the approved mockup (too short, searching, results, no matches, error,
  capped).
- Stale threshold 12 hours. "Updated" means when the shown globe generation was published.
- Search matching that treats spaces and hyphens alike ("starlink 1007" → STARLINK-1007) is deferred to piece 4.

## Success criteria

- A tab left open overnight shows the current generation without a reload.
- A group that fails to load is named in the pill and can be retried from there.
- The pill never says LIVE over data older than 12 hours, nor over a globe with no data.
- Search always says what it is doing: searching, how many matches, no matches, or unavailable.

## Design

### Globe data (`useGlobeData`, new; `GlobeSection` consumes it)

One hook owns globe data and replaces `GlobeSection`'s fetch effects.

- **State:** the shown generation (`string | undefined`), its publish time (`generatedAt`, from the snapshot
  header's `generated_at`, so it is known even when the pointer is unavailable and the unversioned fallback is
  used), a data version number (increments on every swap), and per group (`LEO`, `HIGH`): `idle | loading | ready |
  missing | error` plus its records. A group whose snapshot header names a different generation than the shown one
  (the versioned file had passed its 48-hour retention and the unversioned fallback answered) triggers an immediate
  check, so both groups end up on one generation.
- **First load:** `api.current()` (pointer) → LEO from that generation; `nameCache.useGeneration(generation)`. No
  pointer (404 or error) → unversioned endpoints, as today. HIGH loads from the shown generation when the Higher
  orbits toggle is first turned on.
- **Checks:** every 10 minutes while `document.visibilityState === "visible"`, and immediately when the tab becomes
  visible again. A check reads the pointer; if its generation differs from the shown one, the groups currently
  wanted (LEO; HIGH if enabled) are downloaded for the new generation in the background. Only when all of them
  have arrived: records, generation, publish time and the name cache switch together, and the data version
  increments. A failed or partial background download changes nothing on screen; the next check retries. At most
  one check runs at a time. In the shipped implementation "currently wanted" is really "ever requested": once HIGH
  has been asked for it keeps being refreshed even after the Higher orbits filter is turned off, which is why both
  groups stay on one generation and turning HIGH back on is instant.
- **Retry:** re-requests one failed group from the shown generation (LEO failed on first load: re-run the whole
  first load).
- **Consumers of the data version:** the page's `meta`, timeseries and breakdown requests re-run when it changes
  (exposed through the explorer store), so the overview numbers and charts follow the globe (about four swaps a
  day).
- **No blink on swap:** the propagation worker restarts on new records; `Objects` keeps drawing the previous
  positions until the new worker's first frame arrives, so objects never disappear during a swap. The selected
  object stays selected (selection is by NORAD ID).

### Status pill (`live-badge` element in `GlobeSection`)

Status derives from a pure function `deriveStatus(globe, wanted, now)` over the currently wanted groups:

| Situation | Dot | Word | Suffix |
|---|---|---|---|
| No group ready, first load running | grey `○` | `LOADING ORBITS…` | — |
| Pointer and fallback both 404 (nothing published) | grey `○` | `NO DATA YET` | — |
| Every wanted group failed | red `●` | `NO ORBIT DATA` | Retry |
| Some wanted group failed | amber `●` | `LIVE` / `DELAYED` | `· higher orbits failed` (or `· low orbits failed`) + Retry |
| A wanted group still loading, another ready | green `●` (amber if stale) | `LIVE` / `DELAYED` | `· loading higher orbits…` |
| All wanted groups ready, age ≤ 12 h | green `●` | `LIVE` | `· updated 2h ago` |
| All wanted groups ready, age > 12 h | amber `●` | `DELAYED` | `· updated 14h ago` |

- Age format: `just now` under 1 minute, `N min ago` under 1 hour, `Nh ago` under 48 hours, then `Nd ago`;
  re-rendered every minute. Phones (the top-bar layout) drop the word "updated": `● LIVE · 2h ago`.
- The pill's `title` gives the exact publish time: `Elements published 2026-09-26 12:41 UTC`.
- Accessibility: a polite live region announces the word and any failure message; the age text is outside it so
  minute updates are not announced. Retry is a real `<button>` that exists only while something can be retried;
  the pill itself stays non-interactive.
- When WebGL is unavailable (or the render failed / context was lost) the pill is hidden — the existing
  "can't show the 3D globe" message covers it. The centre-screen "Loading orbits…" / "Orbit data not available
  yet." / "Data unavailable…" messages stay for the empty-globe cases.

### Search (`SearchBox`)

| State | Shown under the input |
|---|---|
| Empty | nothing |
| One character (non-numeric) | `Type 2+ letters, or a NORAD number.` |
| Searching (debounce + request in flight) | `Searching…` — previous results are hidden |
| Results (fewer than 20) | `N match(es)` + the list |
| Results (exactly 20, the API's default limit) | `Showing the first 20 — type more to narrow it down` + the list |
| No matches | `No matches for “<query>”.` + `Try a name (ISS), a NORAD number (25544) or a COSPAR ID (1998-067A).` |
| Error | `Search is unavailable right now.` + Retry (re-runs the same query) |

- Results are stored with the query that produced them and shown only while it matches the current input; the
  existing out-of-order guard stays.
- The status line is a polite live region. Picking a result still selects it and clears the box.

### API

No changes: the pointer (`/api/globe/current`) and the snapshot header's `generated_at` already exist (piece 1).

## Units

- `web/src/lib/globeData.ts` (new): `useGlobeData`, `deriveStatus`, `formatAge`.
- `web/src/components/globe/GlobeSection.tsx`: consume `useGlobeData`; render the pill from `deriveStatus`.
- `web/src/components/globe/Objects.tsx` / `usePropagation.ts`: keep previous positions until the first frame of
  new records.
- `web/src/lib/store.ts`: expose the data version; `web/src/app/page.tsx`: re-run meta and chart requests on it.
- `web/src/components/panels/SearchBox.tsx`: the states above.
- `web/src/lib/snapshot.ts` / `web/src/lib/api.ts`: return the snapshot header's `generated_at` with the records.

## Testing

- Unit (vitest, fake timers, stubbed fetch): first load; group failure and Retry; pointer change → background
  download → atomic swap and version bump; failed or partial refresh keeps the shown data; check on becoming
  visible and none while hidden; one check at a time; 12 h threshold; `deriveStatus` table covering every row
  above; `formatAge` boundaries; `SearchBox` in every state, Retry, and out-of-order responses.
- Browser (Playwright, existing mocked fixtures): HIGH returning 503 → amber pill with Retry → success after
  Retry; a new generation published mid-session appears without a reload and the selection is kept; a 14-hour-old
  generation shows `DELAYED`; search no-matches and error states.

## Out of scope

Search matching of spaces vs hyphens, empty-chart explanations and other filter/selection work (piece 4);
keyboard-accessible chart data and mobile sheet tabs (piece 5); API changes.
