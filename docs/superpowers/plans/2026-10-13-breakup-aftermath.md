# Breakup Aftermath Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Breakups panel and an expanded view that show, for the 10 seeded breakup events, the share of each event's catalogued pieces still in orbit since the event (survival curves), and a Gabbard diagram of each event's pieces today, with the selected event's surviving pieces highlighted on the globe.

**Architecture:** `publish_generation` writes one more file into every globe generation, `breakups.json.gz`, read in the same database snapshot as the globe: each event with its pieces as `[norad_id, decay_date]`. A new route serves it like the other globe files. In the browser, pure modules turn it into survival steps, and turn the globe's own loaded elements into Gabbard marks. A provider loads the file for the globe's generation and publishes the selected event's in-orbit NORAD IDs into the store, where the globe's highlight mask picks them up.

**Tech Stack:** API: Python 3.12, FastAPI, psycopg 3, pytest with testcontainers Postgres (`api/`). Web: Next.js 16, React 19, zustand 5, React Three Fiber, vitest (node environment, `web/tests/unit/**/*.test.ts`), Playwright (`web/e2e/`, mocked API), tsx for scripts.

**Spec:** `docs/superpowers/specs/2026-10-13-breakup-aftermath-design.md`

**Adjustments to the spec, made while planning (tell the owner):**
- The Gabbard diagram lives outside the globe's component tree, so `GlobeSection` publishes its loaded records and generation into the store (`globeRecords`). The selected event's in-orbit NORAD IDs also go through the store (`breakupPieces`), because the globe's `Objects` component sits inside the R3F `<Canvas>`, where React context from the page does not reach.
- Clicking a Gabbard mark selects the piece **and closes the view**: on desktop the view covers the right column, where Search and the ObjectCard live. The event stays selected and highlighted. Selection goes through `selectFromSearch`, so filters that would hide the piece are relaxed, as for a search result.
- Pieces in a group the page has not loaded (the HIGH group loads only once "Higher orbits" has been on) count as "not plotted". All 10 seeded events' pieces are in LEO today.
- The spec's Gabbard fixture rule ("element epoch within one day of SATCAT's") cannot work: SATCAT carries no epoch. The fixture script fetches SATCAT and GP for each designator in the same run and drops pieces with a perigee under 300 km. Measured on 2026-10-13 over 2,582 pieces of Fengyun-1C, Cosmos 2251 and Iridium 33: worst difference 3.9 km and 0.05 min, inside the 10 km / 0.5 min tolerance.
- "Today" for the survival curves is the breakups file's `generated_at` day, not the browser's clock, so a generation always draws the same curves.
- The success criterion "the globe highlights exactly the in-orbit pieces in the snapshot" is checked by unit tests (`inOrbitPieces`, `highlightMask`), not by Playwright: the highlight is GPU state that e2e cannot read.
- Opening the breakups view closes the crowding view and the other way round: both are dialogs in the same place.
- `breakup_events.description` and `source_url` may be null in the database, so the file and the web types allow null.
- The spec said the dialog traps focus. It follows the crowding view instead: a non-modal dialog (`aria-modal="false"`) that takes focus on open, closes on Escape and returns focus to whatever opened it, so the left column stays usable.

## Global Constraints

- Constants: μ = 398600.4418 km³/s²; R_E = 6378.137 km; a year is 365.25 days; Gabbard period axis cap 2,000 min; Gabbard tolerance against SATCAT 10 km and 0.5 min.
- Store key: `globe/gen/<generation>/breakups.json.gz`, gzipped JSON with `mtime=0` and `separators=(",", ":")`.
- File shape: `{"generated_at": ISO string, "events": [{"id", "name", "event_date" (YYYY-MM-DD), "kind" (ASAT|COLLISION|EXPLOSION|UNKNOWN), "parent_cospar", "description" (string|null), "source_url" (string|null), "pieces": [[norad_id, "YYYY-MM-DD"|null], …]}]}`. Events ordered by `event_date`, then `id`; every `breakup_events` row listed, with or without pieces; pieces ordered by `norad_id`.
- API: `GET /api/globe/breakups[?gen=<generation>]`. With `gen`: `Cache-Control: public, max-age=31536000, immutable`; without: `public, max-age=60, s-maxage=300`; ETag/304; body decompressed, `application/json`; 404 `not_found` when no pointer or no file; `gen` uses the existing `Generation` query type.
- Copy, exactly:
  - Panel title `Breakups`; Expand button text `⤢ Expand`, accessible name `Expand breakups view`.
  - Dialog title `Breakup aftermath`; close button accessible name `Close breakups view`; phone tabs `Survival` and `Gabbard`.
  - Event list accessible name `Breakup events`; row line `{in orbit} of {catalogued} still up`, or `no catalogued pieces`.
  - Header counts `{n} catalogued`, `{n} in orbit`, `{n} re-entered`, `{p}% re-entered in the first year`.
  - Survival chart accessible name `Survival chart`; hover line `{short name}, year {k}: {p}% still up ({n})`; curve buttons `Select {short name}`.
  - Gabbard notes `{n} in orbit not plotted`, `{n} off scale`, `No pieces in orbit to plot.`, `Waiting for the globe`; mark tooltip `{name} · {perigee} × {apogee} km · {period} min` (period to 0.1 min).
  - Empty state `Breakup data appears after the next catalog update.`; error `Data unavailable: breakups.` plus a `Retry` button; loading `Loading…`; no selection `Pick an event to see its pieces.`
  - Filter summary chip `{short name} pieces`, clear button accessible name `Clear breakup highlight`, announcement `Breakup highlight cleared`.
- Short names by event id: `transit-4a-ablestar-1961` Transit 4A Ablestar; `pegasus-haps-1996` Pegasus HAPS; `fengyun-1c-2007` Fengyun-1C; `usa-193-2008` USA-193; `cosmos-2251-2009` Cosmos 2251; `iridium-33-2009` Iridium 33; `microsat-r-2019` Microsat-R; `kosmos-1408-2021` Kosmos 1408; `long-march-6a-2022` Long March 6A (2022); `long-march-6a-2024` Long March 6A (2024). Kind labels: ASAT test, Collision, Explosion, Unknown cause.
- Colours: selected curve, selected row accent and apogee marks #ff6a3d; perigee marks #7fb0ff; other curves #4a4a4a; axes and grid #2a2a2a.
- Checks:
  - API, from `api/`: `uv run pytest` and `uv run ruff check .`.
  - Web, from `web/`: `npx vitest run`, `npx tsc --noEmit` and `npx eslint src tests e2e scripts`; UI tasks also run `npx playwright test` (next dev on port 3100, reused if running; if the port is held by something else, report NEEDS_CONTEXT).
- Read `web/AGENTS.md` before writing web code. React Strict Mode is on (effects mount twice in development).
- Work on branch `feat/breakups`. Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (an implementer may name its actual model). Never push, deploy, or merge to `main`.

## Review Focus

1. **Events with no pieces in orbit, or none catalogued at all** (USA-193 and Microsat-R have 0 in orbit; an event row may have 0 pieces). Shares must be 0, never NaN; the row says `no catalogued pieces`; the Gabbard says `No pieces in orbit to plot.`. Pinned by the survival test "an event with no pieces has zero shares and a flat curve" (Task 4) and the Gabbard test "an event with nothing in orbit gives no marks and no scale" (Task 5).
2. **A new generation arrives while an event is selected.** The provider refetches for the new generation and keeps the selection by id; an id missing from the new file must give no highlight rather than a stale one. Pinned by the `inOrbitPieces` test "an id missing from the file gives null" (Task 3).
3. **Bad data from SATCAT:** a re-entry date before the event date, or a piece whose elements give e ≥ 1 or a non-positive mean motion. Survival clamps the date to year 0; the Gabbard counts the piece as not plotted. Pinned by the survival test "a re-entry before the event counts at year 0" (Task 4) and the Gabbard test "unusable elements count as not plotted" (Task 5).
4. **Reset while an event is highlighted.** Reset must clear the highlight and the chip with the filters. Pinned by the store test "resetFilters clears the breakup highlight" (Task 7).
5. **A piece in the HIGH group while HIGH is not loaded.** It must count as not plotted, without errors. Pinned by the Gabbard test "pieces in a group that is not loaded count as not plotted" (Task 5).

For the reviewer's eye: the provider must not fetch until the globe's first load has settled (otherwise it fetches the current file and then the generation's file); the dialog's Escape handler must clear `hoverPiece`; the selected curve must be drawn last so it sits on top.

---

### Task 1: The breakups file in every globe generation (API)

**Files:**
- Modify: `api/app/ingest/snapshot.py` (new SQL, `breakups_file`, `pack_breakups`; `publish_generation` writes the file)
- Modify: `api/tests/test_snapshot_publish.py:22` (`FILES`) and `:72` (file count)
- Create: `api/tests/test_breakups_publish.py`

**Interfaces:**
- Consumes: `breakup_events` and `objects.event_id` (migration 0001); the `world` fixture (seeds the 10 events); `tests.factories.insert_object`, `add_gp`.
- Produces (`app.ingest.snapshot`): `BREAKUP_EVENTS_SQL: str`, `BREAKUP_PIECES_SQL: str`, `breakups_file() -> str` (returns `"breakups.json.gz"`), `pack_breakups(events: list[dict], pieces: list[dict], generated_at: datetime) -> bytes`.

- [ ] **Step 1: Write the failing tests**

```python
# api/tests/test_breakups_publish.py
import gzip
import json
from datetime import UTC, date, datetime

from app.ingest.snapshot import breakups_file, generation_key, pack_breakups, publish_generation
from tests.factories import add_gp, insert_object

T0 = datetime(2026, 9, 25, 6, 41, 12, tzinfo=UTC)
GEN = "20260925T064112Z-r42"
EVENT_IDS = [
    "transit-4a-ablestar-1961", "pegasus-haps-1996", "fengyun-1c-2007", "usa-193-2008",
    "cosmos-2251-2009", "iridium-33-2009", "microsat-r-2019", "kosmos-1408-2021",
    "long-march-6a-2022", "long-march-6a-2024",
]


def read_breakups(store, gen=GEN):
    return json.loads(gzip.decompress(store.get(generation_key(gen, breakups_file()))))


def test_the_file_name():
    assert breakups_file() == "breakups.json.gz"


def test_every_event_is_listed_in_date_order_with_its_pieces(world, store):
    insert_object(world, 31001, object_type="DEB", owner="PRC", event_id="fengyun-1c-2007")
    insert_object(world, 30999, object_type="DEB", owner="PRC", event_id="fengyun-1c-2007",
                  decay_date=date(2015, 3, 2))
    insert_object(world, 24000, object_type="DEB", owner="CIS", event_id="cosmos-2251-2009")
    add_gp(world, 1, 4)
    publish_generation(world, store, T0, 42)
    body = read_breakups(store)
    assert body["generated_at"] == T0.isoformat()
    assert [e["id"] for e in body["events"]] == EVENT_IDS
    fengyun = body["events"][2]
    assert {k: fengyun[k] for k in ("name", "event_date", "kind", "parent_cospar")} == {
        "name": "Fengyun-1C anti-satellite test", "event_date": "2007-01-11", "kind": "ASAT",
        "parent_cospar": "1999-025",
    }
    assert fengyun["description"].startswith("China destroyed")
    assert fengyun["source_url"].startswith("https://")
    assert fengyun["pieces"] == [[30999, "2015-03-02"], [31001, None]]
    assert body["events"][4]["pieces"] == [[24000, None]]


def test_an_event_without_linked_pieces_is_listed_with_none(world, store):
    add_gp(world, 1, 4)
    publish_generation(world, store, T0, 42)
    assert all(e["pieces"] == [] for e in read_breakups(store)["events"])


def test_objects_without_an_event_are_left_out(world, store):
    insert_object(world, 31002, object_type="DEB", cospar_id="1999-025ZZ")  # parent matches, no link
    add_gp(world, 1, 4)
    publish_generation(world, store, T0, 42)
    assert all(31002 not in [p[0] for p in e["pieces"]] for e in read_breakups(store)["events"])


def test_pack_breakups_is_deterministic_and_compact():
    events = [{"id": "x", "name": "X", "event_date": date(2000, 1, 1), "kind": "UNKNOWN",
               "parent_cospar": "2000-001", "description": None, "source_url": None}]
    pieces = [{"event_id": "x", "norad_id": 7, "decay_date": None},
              {"event_id": "gone", "norad_id": 8, "decay_date": None}]
    a = pack_breakups(events, pieces, T0)
    assert a == pack_breakups(events, pieces, T0)
    raw = gzip.decompress(a)
    assert b", " not in raw and b": " not in raw
    assert json.loads(raw)["events"] == [{
        "id": "x", "name": "X", "event_date": "2000-01-01", "kind": "UNKNOWN",
        "parent_cospar": "2000-001", "description": None, "source_url": None, "pieces": [[7, None]],
    }]
```

In `api/tests/test_snapshot_publish.py`, the generation now holds five files. Change line 22:

```python
FILES = ("LEO.bin.gz", "HIGH.bin.gz", "names-LEO.json.gz", "names-HIGH.json.gz", "breakups.json.gz")
```

and in `test_a_failed_file_leaves_the_previous_generation_live` change the last assertion:

```python
    assert len(good.keys("globe/gen/20260925T064112Z-r1/")) == len(FILES)  # previous generation intact
```

- [ ] **Step 2: Run the tests to see them fail**

Run (from `api/`): `uv run pytest tests/test_breakups_publish.py tests/test_snapshot_publish.py -q`
Expected: FAIL — `ImportError: cannot import name 'breakups_file'`.

- [ ] **Step 3: Implement**

In `api/app/ingest/snapshot.py`, after `GROUP_ROWS_SQL`:

```python
BREAKUP_EVENTS_SQL = """
    SELECT id, name, event_date, kind, parent_cospar, description, source_url
    FROM breakup_events
    ORDER BY event_date, id
"""

BREAKUP_PIECES_SQL = """
    SELECT event_id, norad_id, decay_date
    FROM objects
    WHERE event_id IS NOT NULL
    ORDER BY event_id, norad_id
"""


def breakups_file() -> str:
    return "breakups.json.gz"


def pack_breakups(events: list[dict], pieces: list[dict], generated_at: datetime) -> bytes:
    """Every breakup event with its linked pieces as [norad_id, decay_date or null], for the
    breakup view (see docs/superpowers/specs/2026-10-13-breakup-aftermath-design.md). Pieces
    must come ordered by norad_id; a piece of an event not in `events` is ignored."""
    by_event: dict[str, list] = {e["id"]: [] for e in events}
    for p in pieces:
        if p["event_id"] in by_event:
            decay = p["decay_date"]
            by_event[p["event_id"]].append([p["norad_id"], decay.isoformat() if decay else None])
    body = {
        "generated_at": generated_at.isoformat(),
        "events": [
            {"id": e["id"], "name": e["name"], "event_date": e["event_date"].isoformat(),
             "kind": e["kind"], "parent_cospar": e["parent_cospar"],
             "description": e["description"], "source_url": e["source_url"],
             "pieces": by_event[e["id"]]}
            for e in events
        ],
    }
    return gzip.compress(json.dumps(body, separators=(",", ":")).encode(), mtime=0)
```

In `publish_generation`, read the breakup rows inside the existing transaction, right after `groups = {...}`:

```python
        breakup_events = conn.execute(BREAKUP_EVENTS_SQL).fetchall()
        breakup_pieces = conn.execute(BREAKUP_PIECES_SQL).fetchall()
```

and write the file after the per-group loop, before `counts = …` (so a failure still leaves the previous generation live):

```python
    store.put(generation_key(generation, breakups_file()),
              pack_breakups(breakup_events, breakup_pieces, generated_at))
```

Also add one sentence to `publish_generation`'s docstring: "It also writes the breakups file (see pack_breakups) from the same database snapshot."

- [ ] **Step 4: Run the tests to see them pass**

Run (from `api/`): `uv run pytest -q && uv run ruff check .`
Expected: all pass, including the parametrized `test_a_failed_file_leaves_the_previous_generation_live[breakups.json.gz]` and the cleanup tests (a whole generation folder, breakups file included, is removed).

- [ ] **Step 5: Commit**

```bash
git add api/app/ingest/snapshot.py api/tests/test_breakups_publish.py api/tests/test_snapshot_publish.py
git commit -m "feat(api): publish a breakups file with every globe generation"
```

---

### Task 2: `GET /api/globe/breakups`

**Files:**
- Modify: `api/app/api/routes.py:159-180` (`_globe_file` label) and add the route after `globe_names_route`
- Create: `api/tests/test_api_breakups.py`

**Interfaces:**
- Consumes: `breakups_file()` (Task 1); `_globe_file`, `Generation`, `IMMUTABLE`, `CURRENT_FILE` in `routes.py`.
- Produces: `GET /api/globe/breakups` with the caching in Global Constraints.

- [ ] **Step 1: Write the failing tests**

```python
# api/tests/test_api_breakups.py
import gzip
import json
from datetime import UTC, datetime

import pytest

from app.ingest.snapshot import breakups_file, generation_key, publish_generation
from tests.factories import add_gp

T0 = datetime(2026, 9, 25, 6, 41, 12, tzinfo=UTC)
GEN = "20260925T064112Z-r42"
IMMUTABLE = "public, max-age=31536000, immutable"
CURRENT = "public, max-age=60, s-maxage=300"


@pytest.fixture
def published(world, store):
    add_gp(world, 1, 4)
    publish_generation(world, store, T0, 42)
    return store


def stored(store):
    return json.loads(gzip.decompress(store.get(generation_key(GEN, breakups_file()))))


def test_breakups_are_404_before_any_generation(client):
    r = client.get("/api/globe/breakups")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


def test_current_breakups_come_from_the_pointer_generation(client, published):
    r = client.get("/api/globe/breakups")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/json"
    assert r.headers["cache-control"] == CURRENT
    assert r.json() == stored(published)


def test_versioned_breakups_are_immutable_and_revalidate(client, published):
    r = client.get(f"/api/globe/breakups?gen={GEN}")
    assert r.status_code == 200
    assert r.headers["cache-control"] == IMMUTABLE
    assert len(r.json()["events"]) == 10
    again = client.get(f"/api/globe/breakups?gen={GEN}", headers={"If-None-Match": r.headers["etag"]})
    assert again.status_code == 304


def test_a_generation_without_a_breakups_file_is_404(client, published):
    published.delete(generation_key(GEN, breakups_file()))
    r = client.get(f"/api/globe/breakups?gen={GEN}")
    assert r.status_code == 404
    assert "breakups" in r.json()["error"]["message"]


def test_a_malformed_gen_is_rejected_like_the_other_globe_routes(client, published):
    a = client.get("/api/globe/breakups?gen=../x")
    b = client.get("/api/globe/names?gen=../x")
    assert a.status_code == b.status_code >= 400
```

- [ ] **Step 2: Run the tests to see them fail**

Run (from `api/`): `uv run pytest tests/test_api_breakups.py -q`
Expected: FAIL — 404 from the router for `/api/globe/breakups` on the success tests (`assert 404 == 200`).

- [ ] **Step 3: Implement**

In `routes.py`, `_globe_file`'s `group` argument only names the data in the 404 message. Rename it to `label` and change the message:

```python
def _globe_file(request: Request, label: str, gen: str | None, filename: str,
                legacy_key: str | None) -> tuple[bytes | None, dict[str, str]]:
```

```python
        raise ApiError(404, "not_found", f"no globe data for {label}{where}")
```

Update its two callers to pass `f"group {group}"` (the messages stay exactly as before):

```python
    data, headers = _globe_file(request, f"group {group}", gen, snapshot_file(group), snapshot_key(group))
```

```python
    data, headers = _globe_file(request, f"group {group}", gen, names_file(group), None)
```

Import `breakups_file` from `app.ingest.snapshot` with the other snapshot imports, and add the route after `globe_names_route`:

```python
@router.get("/globe/breakups")
def globe_breakups_route(request: Request, gen: Generation = None) -> Response:
    data, headers = _globe_file(request, "breakups", gen, breakups_file(), None)
    if data is None:
        return Response(status_code=304, headers=headers)
    return Response(content=gzip.decompress(data), media_type="application/json", headers=headers)
```

- [ ] **Step 4: Run the tests to see them pass**

Run (from `api/`): `uv run pytest -q && uv run ruff check .`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add api/app/api/routes.py api/tests/test_api_breakups.py
git commit -m "feat(api): serve each generation's breakups file"
```

---

### Task 3: The breakups file in the browser: types, parsing, API call, piece set

**Files:**
- Create: `web/src/lib/breakups/format.ts`
- Modify: `web/src/lib/api.ts` (add `api.breakups`)
- Create: `web/tests/unit/breakupsFormat.test.ts`
- Modify: `web/tests/unit/api.test.ts` (one test)

**Interfaces:**
- Consumes: the file shape (Global Constraints).
- Produces (`@/lib/breakups/format`): `type BreakupKind = "ASAT" | "COLLISION" | "EXPLOSION" | "UNKNOWN"`, `BREAKUP_KINDS: readonly BreakupKind[]`, `type Piece = readonly [number, string | null]`, `interface BreakupEventData { id: string; name: string; event_date: string; kind: BreakupKind; parent_cospar: string; description: string | null; source_url: string | null; pieces: Piece[] }`, `interface BreakupFile { generated_at: string; events: BreakupEventData[] }`, `parseBreakups(v: unknown): BreakupFile` (throws `Error` on a malformed file), `inOrbitPieces(file: BreakupFile, id: string): ReadonlySet<number> | null`.
- Produces (`@/lib/api`): `api.breakups(generation?: string): Promise<BreakupFile | null>` (null on 404).

- [ ] **Step 1: Write the failing tests**

```ts
// web/tests/unit/breakupsFormat.test.ts
import { describe, expect, it } from "vitest";
import { inOrbitPieces, parseBreakups } from "@/lib/breakups/format";

const good = {
  generated_at: "2026-10-13T06:41:00+00:00",
  events: [
    {
      id: "fengyun-1c-2007", name: "Fengyun-1C anti-satellite test", event_date: "2007-01-11", kind: "ASAT",
      parent_cospar: "1999-025", description: "China destroyed…", source_url: "https://example.org",
      pieces: [[29733, null], [29734, null], [29735, "2010-05-01"]],
    },
    { id: "usa-193-2008", name: "USA-193", event_date: "2008-02-21", kind: "ASAT", parent_cospar: "2006-057", description: null, source_url: null, pieces: [] },
  ],
};

describe("breakups file", () => {
  it("parses a good file", () => {
    const f = parseBreakups(good);
    expect(f.generated_at).toBe("2026-10-13T06:41:00+00:00");
    expect(f.events.map((e) => e.id)).toEqual(["fengyun-1c-2007", "usa-193-2008"]);
    expect(f.events[0].pieces).toEqual([[29733, null], [29734, null], [29735, "2010-05-01"]]);
    expect(f.events[1].description).toBeNull();
  });

  it.each([
    ["no events", { generated_at: "x" }],
    ["an unknown kind", { ...good, events: [{ ...good.events[0], kind: "OOPS" }] }],
    ["a bad event date", { ...good, events: [{ ...good.events[0], event_date: "2007" }] }],
    ["a piece that is not a pair", { ...good, events: [{ ...good.events[0], pieces: [[1]] }] }],
    ["a bad NORAD ID", { ...good, events: [{ ...good.events[0], pieces: [[-1, null]] }] }],
    ["a bad re-entry date", { ...good, events: [{ ...good.events[0], pieces: [[1, "soon"]] }] }],
    ["a missing name", { ...good, events: [{ ...good.events[0], name: 3 }] }],
  ])("rejects %s", (_, v) => {
    expect(() => parseBreakups(v)).toThrow(/breakups file/);
  });

  it("gives the in-orbit pieces of an event", () => {
    const f = parseBreakups(good);
    expect([...(inOrbitPieces(f, "fengyun-1c-2007") ?? [])]).toEqual([29733, 29734]);
    expect(inOrbitPieces(f, "usa-193-2008")?.size).toBe(0);
  });

  it("an id missing from the file gives null", () => {
    expect(inOrbitPieces(parseBreakups(good), "gone-1999")).toBeNull();
  });
});
```

Add to `web/tests/unit/api.test.ts`, inside `describe("api", …)`:

```ts
  it("fetches a generation's breakups file and returns null on 404", async () => {
    const body = { generated_at: "2026-10-13T06:41:00+00:00", events: [] };
    const fn = stubFetch(Response.json(body));
    expect(await api.breakups("20261013T064100Z-r1")).toEqual(body);
    expect((fn.mock.calls[0] as unknown[])[0]).toBe("/api/globe/breakups?gen=20261013T064100Z-r1");
    stubFetch(Response.json({ error: { code: "not_found", message: "none" } }, { status: 404 }));
    expect(await api.breakups()).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run (from `web/`): `npx vitest run tests/unit/breakupsFormat.test.ts tests/unit/api.test.ts`
Expected: FAIL — cannot resolve `@/lib/breakups/format`.

- [ ] **Step 3: Implement**

```ts
// web/src/lib/breakups/format.ts
/** The breakups file published with each globe generation (see api/app/ingest/snapshot.py's
 * pack_breakups and docs/superpowers/specs/2026-10-13-breakup-aftermath-design.md). */

export type BreakupKind = "ASAT" | "COLLISION" | "EXPLOSION" | "UNKNOWN";
export const BREAKUP_KINDS: readonly BreakupKind[] = ["ASAT", "COLLISION", "EXPLOSION", "UNKNOWN"];

/** [NORAD ID, re-entry date, or null while the piece is in orbit]. */
export type Piece = readonly [number, string | null];

export interface BreakupEventData {
  id: string;
  name: string;
  event_date: string;
  kind: BreakupKind;
  parent_cospar: string;
  description: string | null;
  source_url: string | null;
  pieces: Piece[];
}

export interface BreakupFile {
  generated_at: string;
  events: BreakupEventData[];
}

const DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function str(o: Record<string, unknown>, key: string): string {
  const v = o[key];
  if (typeof v !== "string") throw new Error(`breakups file: ${key} is not a string`);
  return v;
}

function optStr(o: Record<string, unknown>, key: string): string | null {
  return o[key] === null ? null : str(o, key);
}

function piece(v: unknown): Piece {
  if (!Array.isArray(v) || v.length !== 2) throw new Error("breakups file: a piece is not a pair");
  const [id, decay] = v as [unknown, unknown];
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) throw new Error("breakups file: bad NORAD ID");
  if (decay !== null && !(typeof decay === "string" && DAY.test(decay))) throw new Error("breakups file: bad re-entry date");
  return [id, decay];
}

function event(v: unknown): BreakupEventData {
  if (!isObject(v) || !Array.isArray(v.pieces)) throw new Error("breakups file: bad event");
  const kind = str(v, "kind");
  if (!BREAKUP_KINDS.includes(kind as BreakupKind)) throw new Error(`breakups file: unknown kind ${kind}`);
  const eventDate = str(v, "event_date");
  if (!DAY.test(eventDate)) throw new Error("breakups file: bad event date");
  return {
    id: str(v, "id"),
    name: str(v, "name"),
    event_date: eventDate,
    kind: kind as BreakupKind,
    parent_cospar: str(v, "parent_cospar"),
    description: optStr(v, "description"),
    source_url: optStr(v, "source_url"),
    pieces: v.pieces.map(piece),
  };
}

/** Checks and types a parsed breakups file; throws on anything malformed. */
export function parseBreakups(v: unknown): BreakupFile {
  if (!isObject(v) || !Array.isArray(v.events)) throw new Error("breakups file: no events");
  return { generated_at: str(v, "generated_at"), events: v.events.map(event) };
}

/** The NORAD IDs of an event's pieces still in orbit, or null when the file has no such event. */
export function inOrbitPieces(file: BreakupFile, id: string): ReadonlySet<number> | null {
  const e = file.events.find((x) => x.id === id);
  return e ? new Set(e.pieces.filter(([, decay]) => decay === null).map(([n]) => n)) : null;
}
```

In `web/src/lib/api.ts`, import `{ parseBreakups, type BreakupFile }` from `@/lib/breakups/format` and add to `api`, after `snapshot`:

```ts
  /** A globe generation's breakups file (or the current generation's when `generation` is
   * undefined), or null when it has none — before the first publication after this feature's
   * deploy, or for an older generation. */
  async breakups(generation?: string): Promise<BreakupFile | null> {
    const res = await fetch(`/api/globe/breakups${buildQuery({ gen: generation })}`, { signal: AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS) });
    if (res.status === 404) return null;
    if (!res.ok) throw await toError(res);
    return parseBreakups(await res.json());
  },
```

- [ ] **Step 4: Run the tests to see them pass**

Run (from `web/`): `npx vitest run && npx tsc --noEmit && npx eslint src tests e2e`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/breakups/format.ts web/src/lib/api.ts web/tests/unit/breakupsFormat.test.ts web/tests/unit/api.test.ts
git commit -m "feat(web): parse the breakups file and fetch it per generation"
```

---

### Task 4: Survival curves

**Files:**
- Create: `web/src/lib/breakups/survival.ts`
- Create: `web/tests/unit/breakupsSurvival.test.ts`

**Interfaces:**
- Consumes: `BreakupEventData` (Task 3).
- Produces (`@/lib/breakups/survival`): `YEAR_DAYS = 365.25`, `yearsBetween(from: string, to: string): number` (dates or ISO timestamps; only the date part counts), `interface SurvivalStep { t: number; inOrbit: number }`, `interface Survival { total: number; inOrbit: number; reentered: number; firstYearReentered: number; age: number; steps: SurvivalStep[] }`, `survival(e: BreakupEventData, today: string): Survival`, `share(s: Survival, inOrbit?: number): number`, `inOrbitAt(s: Survival, t: number): number`, `interface YearRow { from: number; to: number; inOrbit: number; reentered: number }`, `byYear(s: Survival): YearRow[]`.

`steps` starts at `{ t: 0, inOrbit: total }`, adds one step per distinct re-entry time (in years since the event, clamped to `[0, age]`), and ends with `{ t: age, inOrbit }` when the last step is earlier. A step means "from this t onward, this many in orbit".

- [ ] **Step 1: Write the failing tests**

```ts
// web/tests/unit/breakupsSurvival.test.ts
import { describe, expect, it } from "vitest";
import type { BreakupEventData } from "@/lib/breakups/format";
import { byYear, inOrbitAt, share, survival, yearsBetween } from "@/lib/breakups/survival";

const ev = (pieces: BreakupEventData["pieces"], event_date = "2000-01-01"): BreakupEventData => ({
  id: "x", name: "X", event_date, kind: "COLLISION", parent_cospar: "2000-001", description: null, source_url: null, pieces,
});

// 2000-01-01 → 2000-06-01 is 152 days, → 2001-07-01 is 547 days, → 2002-07-01 is 912 days.
const e = ev([[1, null], [2, "2000-06-01"], [3, "2001-07-01"], [4, null]]);
const s = survival(e, "2002-07-01T06:41:00+00:00");

describe("survival", () => {
  it("measures years with 365.25-day years from the date part", () => {
    expect(yearsBetween("2000-01-01", "2000-06-01")).toBeCloseTo(152 / 365.25, 9);
    expect(yearsBetween("2000-01-01", "2002-07-01T23:59:00Z")).toBeCloseTo(912 / 365.25, 9);
  });

  it("counts pieces and steps down at each re-entry", () => {
    expect([s.total, s.inOrbit, s.reentered, s.firstYearReentered]).toEqual([4, 2, 2, 1]);
    expect(s.age).toBeCloseTo(912 / 365.25, 9);
    expect(s.steps.map((x) => x.inOrbit)).toEqual([4, 3, 2, 2]);
    expect(s.steps.map((x) => x.t)).toEqual([0, 152 / 365.25, 547 / 365.25, 912 / 365.25]);
  });

  it("reads the count and share at any time", () => {
    expect(inOrbitAt(s, 0)).toBe(4);
    expect(inOrbitAt(s, 0.5)).toBe(3);
    expect(inOrbitAt(s, 2)).toBe(2);
    expect(share(s)).toBe(0.5);
    expect(share(s, 3)).toBe(0.75);
  });

  it("groups re-entries on the same day into one step", () => {
    const t = survival(ev([[1, "2001-01-01"], [2, "2001-01-01"], [3, null]]), "2003-01-01");
    expect(t.steps.map((x) => x.inOrbit)).toEqual([3, 1, 1]);
  });

  it("a re-entry before the event counts at year 0", () => {
    const t = survival(ev([[1, "1999-12-01"], [2, null]]), "2001-01-01");
    expect(t.steps).toEqual([{ t: 0, inOrbit: 2 }, { t: 0, inOrbit: 1 }, { t: 366 / 365.25, inOrbit: 1 }]);
    expect(inOrbitAt(t, 0)).toBe(1);
    expect(t.firstYearReentered).toBe(1);
  });

  it("an event with no pieces has zero shares and a flat curve", () => {
    const t = survival(ev([]), "2001-01-01");
    expect([t.total, t.inOrbit, t.reentered, share(t)]).toEqual([0, 0, 0, 0]);
    expect(t.steps.map((x) => x.inOrbit)).toEqual([0, 0]);
    expect(Number.isNaN(share(t))).toBe(false);
  });

  it("tabulates each year since the event, the last one partial", () => {
    expect(byYear(s)).toEqual([
      { from: 0, to: 1, inOrbit: 3, reentered: 1 },
      { from: 1, to: 2, inOrbit: 2, reentered: 1 },
      { from: 2, to: 912 / 365.25, inOrbit: 2, reentered: 0 },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run (from `web/`): `npx vitest run tests/unit/breakupsSurvival.test.ts`
Expected: FAIL — cannot resolve `@/lib/breakups/survival`.

- [ ] **Step 3: Implement**

```ts
// web/src/lib/breakups/survival.ts
import type { BreakupEventData } from "@/lib/breakups/format";

export const YEAR_DAYS = 365.25;
const DAY_MS = 86_400_000;

/** Years from one date to another (ISO dates or timestamps; only the date part counts). */
export function yearsBetween(from: string, to: string): number {
  return (Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / DAY_MS / YEAR_DAYS;
}

/** From `t` years after the event onward, `inOrbit` pieces are still up. */
export interface SurvivalStep {
  t: number;
  inOrbit: number;
}

export interface Survival {
  total: number;
  inOrbit: number;
  reentered: number;
  firstYearReentered: number;
  /** Years from the event to `today`. */
  age: number;
  steps: SurvivalStep[];
}

/** An event's pieces over time, from its catalogued pieces' re-entry dates. A re-entry dated
 * before the event (bad data) counts at year 0; one after `today` counts at `today`. */
export function survival(e: BreakupEventData, today: string): Survival {
  const age = Math.max(0, yearsBetween(e.event_date, today));
  const times = e.pieces
    .flatMap(([, decay]) => (decay === null ? [] : [Math.min(age, Math.max(0, yearsBetween(e.event_date, decay)))]))
    .sort((a, b) => a - b);
  const total = e.pieces.length;
  const steps: SurvivalStep[] = [{ t: 0, inOrbit: total }];
  let inOrbit = total;
  for (let i = 0; i < times.length; ) {
    let j = i;
    while (j < times.length && times[j] === times[i]) j++;
    inOrbit -= j - i;
    steps.push({ t: times[i], inOrbit });
    i = j;
  }
  if (steps[steps.length - 1].t < age) steps.push({ t: age, inOrbit });
  return { total, inOrbit, reentered: total - inOrbit, firstYearReentered: times.filter((t) => t < 1).length, age, steps };
}

/** The share of the catalogued pieces that `inOrbit` stands for; 0 for an event with none. */
export function share(s: Survival, inOrbit = s.inOrbit): number {
  return s.total === 0 ? 0 : inOrbit / s.total;
}

/** Pieces in orbit at `t` years, counting re-entries at exactly `t`. */
export function inOrbitAt(s: Survival, t: number): number {
  let n = s.total;
  for (const step of s.steps) {
    if (step.t > t) break;
    n = step.inOrbit;
  }
  return n;
}

/** Pieces in orbit just before `t` years. */
function inOrbitBefore(s: Survival, t: number): number {
  let n = s.total;
  for (const step of s.steps) {
    if (step.t >= t) break;
    n = step.inOrbit;
  }
  return n;
}

export interface YearRow {
  from: number;
  to: number;
  inOrbit: number;
  reentered: number;
}

/** One row per year since the event: pieces in orbit at its end and re-entered during it. The
 * last row ends at `age`. */
export function byYear(s: Survival): YearRow[] {
  const rows: YearRow[] = [];
  for (let k = 0; k < s.age; k++) {
    const last = k + 1 >= s.age;
    const start = inOrbitBefore(s, k);
    const end = last ? s.inOrbit : inOrbitBefore(s, k + 1);
    rows.push({ from: k, to: last ? s.age : k + 1, inOrbit: end, reentered: start - end });
  }
  return rows;
}
```

Note: `inOrbitBefore(s, 0)` returns `total`, so a re-entry clamped to year 0 counts as re-entered during the first year.

- [ ] **Step 4: Run the tests to see them pass**

Run (from `web/`): `npx vitest run && npx tsc --noEmit && npx eslint src tests e2e`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/breakups/survival.ts web/tests/unit/breakupsSurvival.test.ts
git commit -m "feat(web): survival curves for breakup events"
```

---

### Task 5: Gabbard marks, scale and the SATCAT check

**Files:**
- Create: `web/src/lib/breakups/gabbard.ts`
- Create: `web/scripts/breakups/make-gabbard-fixture.ts`
- Create: `web/tests/fixtures/breakups/gabbard.json` (generated by the script)
- Create: `web/tests/unit/breakupsGabbard.test.ts`

**Interfaces:**
- Consumes: `BreakupEventData` (Task 3); `OrbitRecord` (`@/lib/snapshot`); `ObjectType` (`@/lib/types`).
- Produces (`@/lib/breakups/gabbard`): `MU_KM3_S2`, `R_E_KM`, `PERIOD_CAP_MIN = 2000`, `interface Orbit { periodMin: number; apogeeKm: number; perigeeKm: number }`, `orbitOf(meanMotion: number, eccentricity: number): Orbit | null`, `interface GabbardMark extends Orbit { noradId: number; owner: string; type: ObjectType; group: "LEO" | "HIGH" }`, `type GroupRecords = { LEO: readonly OrbitRecord[] | null; HIGH: readonly OrbitRecord[] | null }`, `gabbardMarks(e: BreakupEventData, records: GroupRecords): { marks: GabbardMark[]; notPlotted: number }`, `interface GabbardScale { periodMin: number; periodMax: number; altMax: number; offScale: number }`, `gabbardScale(marks: readonly GabbardMark[]): GabbardScale | null`, `GABBARD_PAD = { left: 48, right: 10, top: 10, bottom: 28 }`, `markPoint(scale: GabbardScale, width: number, height: number, periodMin: number, altKm: number): { x: number; y: number }`, `nearestMark(marks: readonly GabbardMark[], scale: GabbardScale, width: number, height: number, x: number, y: number, radius?: number): GabbardMark | null`, `ticks(min: number, max: number, count: number): number[]`.

- [ ] **Step 1: Write the fixture script and generate the fixture**

```ts
// web/scripts/breakups/make-gabbard-fixture.ts
// Builds tests/fixtures/breakups/gabbard.json: real debris pieces with their GP elements and
// SATCAT's own apogee, perigee and period, fetched from CelesTrak in one run. SATCAT computes
// those values independently, so they check gabbard.ts's maths. SATCAT has no element epoch, so
// fast-decaying pieces (perigee under 300 km), whose orbit moves between the two fetches, are left
// out. Run from web/: npx tsx scripts/breakups/make-gabbard-fixture.ts
import { writeFileSync } from "node:fs";

const DESIGNATORS = ["1999-025", "1993-036", "1997-051"]; // Fengyun-1C, Cosmos 2251, Iridium 33
const PER_DESIGNATOR = 17;

type Satcat = { NORAD_CAT_ID: number; OBJECT_TYPE: string; DECAY_DATE: string; APOGEE: number; PERIGEE: number; PERIOD: number };
type Gp = { NORAD_CAT_ID: number; OBJECT_ID: string; MEAN_MOTION: number; ECCENTRICITY: number };

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return (await res.json()) as T;
}

const pieces = [];
for (const d of DESIGNATORS) {
  const satcat = await json<Satcat[]>(`https://celestrak.org/satcat/records.php?INTDES=${d}&FORMAT=JSON`);
  const gp = await json<Gp[]>(`https://celestrak.org/NORAD/elements/gp.php?INTDES=${d}&FORMAT=JSON`);
  const byId = new Map(satcat.map((s) => [s.NORAD_CAT_ID, s]));
  const usable = gp
    .filter((g) => {
      const s = byId.get(g.NORAD_CAT_ID);
      return s && s.OBJECT_TYPE === "DEB" && !s.DECAY_DATE && s.PERIGEE >= 300;
    })
    .sort((a, b) => a.NORAD_CAT_ID - b.NORAD_CAT_ID)
    .slice(0, PER_DESIGNATOR);
  for (const g of usable) {
    const s = byId.get(g.NORAD_CAT_ID)!;
    pieces.push({
      norad_id: g.NORAD_CAT_ID, object_id: g.OBJECT_ID, mean_motion: g.MEAN_MOTION, eccentricity: g.ECCENTRICITY,
      satcat: { apogee: s.APOGEE, perigee: s.PERIGEE, period: s.PERIOD },
    });
  }
}
writeFileSync("tests/fixtures/breakups/gabbard.json", `${JSON.stringify({ fetched_at: new Date().toISOString(), pieces }, null, 1)}\n`);
console.log(`wrote ${pieces.length} pieces`);
```

Run (from `web/`): `mkdir -p tests/fixtures/breakups && npx tsx scripts/breakups/make-gabbard-fixture.ts`
Expected: `wrote 51 pieces`. If CelesTrak is unreachable, report NEEDS_CONTEXT; do not hand-write the fixture.

- [ ] **Step 2: Write the failing tests**

```ts
// web/tests/unit/breakupsGabbard.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BreakupEventData } from "@/lib/breakups/format";
import { gabbardMarks, gabbardScale, markPoint, nearestMark, orbitOf, PERIOD_CAP_MIN, ticks } from "@/lib/breakups/gabbard";
import type { OrbitRecord } from "@/lib/snapshot";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/breakups/gabbard.json", import.meta.url)).toString()) as {
  pieces: { norad_id: number; mean_motion: number; eccentricity: number; satcat: { apogee: number; perigee: number; period: number } }[];
};

const rec = (noradId: number, meanMotion: number, eccentricity: number): OrbitRecord => ({
  noradId, owner: "PRC", type: "DEB", epochMs: 0, meanMotion, eccentricity, inclination: 98.8,
  raan: 0, argPericenter: 0, meanAnomaly: 0, bstar: 0, meanMotionDot: 0, meanMotionDdot: 0,
});
const ev = (pieces: BreakupEventData["pieces"]): BreakupEventData => ({
  id: "fengyun-1c-2007", name: "F", event_date: "2007-01-11", kind: "ASAT", parent_cospar: "1999-025", description: null, source_url: null, pieces,
});

describe("gabbard", () => {
  it("gives the ISS's apogee, perigee and period", () => {
    const o = orbitOf(15.49224498, 0.00047657)!;
    expect(o.apogeeKm).toBeCloseTo(422.233, 2);
    expect(o.perigeeKm).toBeCloseTo(415.754, 2);
    expect(o.periodMin).toBeCloseTo(92.95, 2);
  });

  it("agrees with SATCAT within 10 km and 0.5 min on real debris", () => {
    expect(fixture.pieces.length).toBeGreaterThanOrEqual(40);
    for (const p of fixture.pieces) {
      const o = orbitOf(p.mean_motion, p.eccentricity)!;
      expect(Math.abs(o.apogeeKm - p.satcat.apogee), `apogee of ${p.norad_id}`).toBeLessThanOrEqual(10);
      expect(Math.abs(o.perigeeKm - p.satcat.perigee), `perigee of ${p.norad_id}`).toBeLessThanOrEqual(10);
      expect(Math.abs(o.periodMin - p.satcat.period), `period of ${p.norad_id}`).toBeLessThanOrEqual(0.5);
    }
  });

  it("unusable elements count as not plotted", () => {
    expect([orbitOf(0, 0.1), orbitOf(-1, 0.1), orbitOf(15, 1), orbitOf(15, -0.1), orbitOf(Number.NaN, 0)]).toEqual([null, null, null, null, null]);
    const { marks, notPlotted } = gabbardMarks(ev([[1, null], [2, null]]), { LEO: [rec(1, 14.3, 0.01), rec(2, 15, 1.2)], HIGH: null });
    expect(marks.map((m) => m.noradId)).toEqual([1]);
    expect(notPlotted).toBe(1);
  });

  it("plots only in-orbit pieces, from both groups, in NORAD order", () => {
    const { marks, notPlotted } = gabbardMarks(
      ev([[5, null], [3, null], [4, "2010-01-01"], [9, null]]),
      { LEO: [rec(5, 14.3, 0.01), rec(4, 14.3, 0.01)], HIGH: [rec(3, 2.0, 0.6)] },
    );
    expect(marks.map((m) => [m.noradId, m.group])).toEqual([[3, "HIGH"], [5, "LEO"]]);
    expect(notPlotted).toBe(1); // 9 is in orbit but on neither group
  });

  it("pieces in a group that is not loaded count as not plotted", () => {
    const { marks, notPlotted } = gabbardMarks(ev([[3, null], [5, null]]), { LEO: [rec(5, 14.3, 0.01)], HIGH: null });
    expect(marks.map((m) => m.noradId)).toEqual([5]);
    expect(notPlotted).toBe(1);
  });

  it("an event with nothing in orbit gives no marks and no scale", () => {
    const { marks, notPlotted } = gabbardMarks(ev([[1, "2010-01-01"]]), { LEO: [], HIGH: [] });
    expect([marks, notPlotted]).toEqual([[], 0]);
    expect(gabbardScale(marks)).toBeNull();
  });

  it("scales to the marks and leaves long periods off the axis", () => {
    const { marks } = gabbardMarks(ev([[1, null], [2, null], [3, null]]), {
      LEO: [rec(1, 12.9692, 0.058), rec(2, 14.3, 0.001)],
      HIGH: [rec(3, 0.5, 0.1)], // 2,880 min
    });
    const s = gabbardScale(marks)!;
    expect(s).toEqual({ periodMin: Math.floor(1440 / 14.3 - 1), periodMax: Math.ceil(1440 / 12.9692 + 1), altMax: 1800, offScale: 1 });
    expect(marks.find((m) => m.noradId === 3)!.periodMin).toBeGreaterThan(PERIOD_CAP_MIN);
  });

  it("maps marks to pixels and finds the nearest one", () => {
    const { marks } = gabbardMarks(ev([[1, null]]), { LEO: [rec(1, 12.9692, 0.058)], HIGH: null });
    const s = gabbardScale(marks)!;
    const p = markPoint(s, 560, 300, marks[0].periodMin, marks[0].apogeeKm);
    expect(p.x).toBeGreaterThan(48);
    expect(p.x).toBeLessThan(550);
    expect(nearestMark(marks, s, 560, 300, p.x + 3, p.y - 2)?.noradId).toBe(1);
    const q = markPoint(s, 560, 300, marks[0].periodMin, marks[0].perigeeKm);
    expect(nearestMark(marks, s, 560, 300, q.x, q.y)?.noradId).toBe(1);
    expect(nearestMark(marks, s, 560, 300, p.x + 40, p.y)).toBeNull();
  });

  it("picks round tick values", () => {
    expect(ticks(0, 1800, 4)).toEqual([0, 500, 1000, 1500]);
    expect(ticks(99, 113, 4)).toEqual([100, 105, 110]);
  });
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run (from `web/`): `npx vitest run tests/unit/breakupsGabbard.test.ts`
Expected: FAIL — cannot resolve `@/lib/breakups/gabbard`.

- [ ] **Step 4: Implement**

```ts
// web/src/lib/breakups/gabbard.ts
import type { BreakupEventData } from "@/lib/breakups/format";
import type { OrbitRecord } from "@/lib/snapshot";
import type { ObjectType } from "@/lib/types";

export const MU_KM3_S2 = 398600.4418;
export const R_E_KM = 6378.137;
/** Periods above this many minutes are left off the Gabbard axis and counted as off scale. */
export const PERIOD_CAP_MIN = 2000;

export interface Orbit {
  periodMin: number;
  apogeeKm: number;
  perigeeKm: number;
}

/** Period, apogee and perigee altitude from a mean motion (rev/day) and eccentricity, or null when
 * they describe no closed orbit. */
export function orbitOf(meanMotion: number, eccentricity: number): Orbit | null {
  if (!Number.isFinite(meanMotion) || !(meanMotion > 0) || !(eccentricity >= 0 && eccentricity < 1)) return null;
  const n = (meanMotion * 2 * Math.PI) / 86_400;
  const a = Math.cbrt(MU_KM3_S2 / (n * n));
  return { periodMin: 1440 / meanMotion, apogeeKm: a * (1 + eccentricity) - R_E_KM, perigeeKm: a * (1 - eccentricity) - R_E_KM };
}

export interface GabbardMark extends Orbit {
  noradId: number;
  owner: string;
  type: ObjectType;
  group: "LEO" | "HIGH";
}

export type GroupRecords = { LEO: readonly OrbitRecord[] | null; HIGH: readonly OrbitRecord[] | null };

/** One mark per in-orbit piece found in the globe's loaded records, ordered by NORAD ID, and the
 * count of in-orbit pieces that could not be plotted (not loaded, or no usable orbit). */
export function gabbardMarks(e: BreakupEventData, records: GroupRecords): { marks: GabbardMark[]; notPlotted: number } {
  const wanted = new Set(e.pieces.filter(([, decay]) => decay === null).map(([id]) => id));
  const total = wanted.size;
  const marks: GabbardMark[] = [];
  for (const group of ["LEO", "HIGH"] as const) {
    for (const r of records[group] ?? []) {
      if (!wanted.has(r.noradId)) continue;
      wanted.delete(r.noradId);
      const o = orbitOf(r.meanMotion, r.eccentricity);
      if (o) marks.push({ noradId: r.noradId, owner: r.owner, type: r.type, group, ...o });
    }
  }
  marks.sort((a, b) => a.noradId - b.noradId);
  return { marks, notPlotted: total - marks.length };
}

export interface GabbardScale {
  periodMin: number;
  periodMax: number;
  altMax: number;
  /** Marks left off the axis because their period exceeds PERIOD_CAP_MIN. */
  offScale: number;
}

/** Axis ranges for the marks within PERIOD_CAP_MIN, or null when none are. */
export function gabbardScale(marks: readonly GabbardMark[]): GabbardScale | null {
  const shown = marks.filter((m) => m.periodMin <= PERIOD_CAP_MIN);
  if (shown.length === 0) return null;
  let lo = Infinity;
  let hi = -Infinity;
  let top = 0;
  for (const m of shown) {
    lo = Math.min(lo, m.periodMin);
    hi = Math.max(hi, m.periodMin);
    top = Math.max(top, m.apogeeKm);
  }
  return { periodMin: Math.floor(lo - 1), periodMax: Math.ceil(hi + 1), altMax: Math.ceil((top + 50) / 100) * 100, offScale: marks.length - shown.length };
}

export const GABBARD_PAD = { left: 48, right: 10, top: 10, bottom: 28 } as const;

/** A point's position in CSS pixels on a `width` × `height` Gabbard canvas. */
export function markPoint(scale: GabbardScale, width: number, height: number, periodMin: number, altKm: number): { x: number; y: number } {
  const w = width - GABBARD_PAD.left - GABBARD_PAD.right;
  const h = height - GABBARD_PAD.top - GABBARD_PAD.bottom;
  return {
    x: GABBARD_PAD.left + ((periodMin - scale.periodMin) / (scale.periodMax - scale.periodMin)) * w,
    y: GABBARD_PAD.top + (1 - altKm / scale.altMax) * h,
  };
}

/** The mark whose apogee or perigee point is nearest to (x, y), within `radius` pixels. */
export function nearestMark(
  marks: readonly GabbardMark[], scale: GabbardScale, width: number, height: number, x: number, y: number, radius = 6,
): GabbardMark | null {
  let best: GabbardMark | null = null;
  let bestD = radius * radius;
  for (const m of marks) {
    if (m.periodMin > PERIOD_CAP_MIN) continue;
    for (const alt of [m.apogeeKm, m.perigeeKm]) {
      const p = markPoint(scale, width, height, m.periodMin, alt);
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d <= bestD) {
        bestD = d;
        best = m;
      }
    }
  }
  return best;
}

/** Round tick values from `min` to `max` (inclusive), about `count` of them. */
export function ticks(min: number, max: number, count: number): number[] {
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((f) => f * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}
```

Check the `ticks` expectations by hand before running: `ticks(0, 1800, 4)`: raw 450, mag 100, step 500 → 0, 500, 1000, 1500. `ticks(99, 113, 4)`: raw 3.5, mag 1, step 5 → 100, 105, 110.

- [ ] **Step 5: Run the tests to see them pass**

Run (from `web/`): `npx vitest run && npx tsc --noEmit && npx eslint src tests e2e scripts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/breakups/gabbard.ts web/scripts/breakups/make-gabbard-fixture.ts web/tests/fixtures/breakups/gabbard.json web/tests/unit/breakupsGabbard.test.ts
git commit -m "feat(web): Gabbard marks from the globe's elements, checked against SATCAT"
```

---

### Task 6: Breakup text and table rows

**Files:**
- Create: `web/src/lib/breakups/text.ts`, `web/src/lib/breakups/tables.ts`
- Create: `web/tests/unit/breakupsText.test.ts`

**Interfaces:**
- Consumes: `BreakupEventData`, `BreakupKind` (Task 3); `Survival`, `share`, `inOrbitAt`, `byYear` (Task 4); `GabbardMark` (Task 5); `fmtInt`, `fmtDate` (`@/lib/format`).
- Produces (`@/lib/breakups/text`): `SHORT_NAMES: Record<string, string>`, `shortName(e: { id: string; name?: string }): string`, `KIND_LABELS: Record<BreakupKind, string>`, `fmtShare(f: number): string`, `stillUpLine(s: Survival): string`, `countLines(s: Survival): string[]`, `survivalTip(e: { id: string; name: string }, s: Survival, t: number): string`, `afterLine(e: { id: string; name: string }, s: Survival): string`, `survivalSummary(curves: { e: BreakupEventData; s: Survival }[], selected: string | null): string`, `markTip(m: GabbardMark, name: string | undefined): string`, `plotNotes(notPlotted: number, offScale: number): string[]`.
- Produces (`@/lib/breakups/tables`): `interface SurvivalRow { span: string; inOrbit: string; share: string; reentered: string }`, `survivalRows(s: Survival): SurvivalRow[]`, `interface PieceRow { noradId: number; name: string; orbit: string; period: string; reentered: string }`, `pieceRows(e: BreakupEventData, marks: readonly GabbardMark[], names: ReadonlyMap<number, string>): PieceRow[]`.

- [ ] **Step 1: Write the failing tests**

```ts
// web/tests/unit/breakupsText.test.ts
import { describe, expect, it } from "vitest";
import type { BreakupEventData } from "@/lib/breakups/format";
import { gabbardMarks } from "@/lib/breakups/gabbard";
import { survival } from "@/lib/breakups/survival";
import { pieceRows, survivalRows } from "@/lib/breakups/tables";
import { afterLine, countLines, fmtShare, markTip, plotNotes, shortName, stillUpLine, survivalSummary, survivalTip } from "@/lib/breakups/text";
import type { OrbitRecord } from "@/lib/snapshot";

const fengyun: BreakupEventData = {
  id: "fengyun-1c-2007", name: "Fengyun-1C anti-satellite test", event_date: "2007-01-11", kind: "ASAT", parent_cospar: "1999-025",
  description: null, source_url: null, pieces: [[29733, null], [29734, null], [29735, "2007-06-01"]],
};
const empty: BreakupEventData = { ...fengyun, id: "usa-193-2008", name: "USA-193 intercept", pieces: [] };
const today = "2026-10-13T06:41:00+00:00";
const s = survival(fengyun, today);
const rec: OrbitRecord = {
  noradId: 29733, owner: "PRC", type: "DEB", epochMs: 0, meanMotion: 12.9692, eccentricity: 0.058, inclination: 98.8,
  raan: 0, argPericenter: 0, meanAnomaly: 0, bstar: 0, meanMotionDot: 0, meanMotionDdot: 0,
};

describe("breakup text", () => {
  it("names events briefly, falling back to the full name", () => {
    expect(shortName(fengyun)).toBe("Fengyun-1C");
    expect(shortName({ id: "long-march-6a-2024" })).toBe("Long March 6A (2024)");
    expect(shortName({ id: "new-1999", name: "Something new" })).toBe("Something new");
    expect(shortName({ id: "new-1999" })).toBe("new-1999");
  });

  it("words the counts", () => {
    expect(fmtShare(2 / 3)).toBe("67%");
    expect(stillUpLine(s)).toBe("2 of 3 still up");
    expect(stillUpLine(survival(empty, today))).toBe("no catalogued pieces");
    expect(countLines(s)).toEqual(["3 catalogued", "2 in orbit", "1 re-entered", "33% re-entered in the first year"]);
    expect(countLines(survival(empty, today))).toEqual(["0 catalogued"]);
  });

  it("words a point on a curve and the chart", () => {
    expect(survivalTip(fengyun, s, 9.4)).toBe("Fengyun-1C, year 9: 67% still up (2)");
    expect(survivalTip(fengyun, s, 0.1)).toBe("Fengyun-1C, year 0: 100% still up (3)");
    const curves = [{ e: fengyun, s }];
    expect(afterLine(fengyun, s)).toBe("Fengyun-1C: 67% still up after 19.8 years.");
    expect(survivalSummary(curves, null)).toBe("Share of each breakup's catalogued pieces still in orbit, by years since the event.");
    expect(survivalSummary(curves, "fengyun-1c-2007")).toBe(
      "Share of each breakup's catalogued pieces still in orbit, by years since the event. Fengyun-1C: 67% still up after 19.8 years.",
    );
  });

  it("words a Gabbard mark and the plot notes", () => {
    const { marks } = gabbardMarks(fengyun, { LEO: [rec], HIGH: null });
    expect(markTip(marks[0], "OBJECT 29733")).toBe("OBJECT 29733 · 830 × 1,718 km · 111.0 min");
    expect(markTip(marks[0], undefined)).toBe("NORAD 29733 · 830 × 1,718 km · 111.0 min");
    expect(plotNotes(1, 0)).toEqual(["1 in orbit not plotted"]);
    expect(plotNotes(0, 2)).toEqual(["2 off scale"]);
    expect(plotNotes(0, 0)).toEqual([]);
  });

  it("tabulates survival by year", () => {
    const rows = survivalRows(s);
    expect(rows[0]).toEqual({ span: "0–1", inOrbit: "2", share: "67%", reentered: "1" });
    expect(rows).toHaveLength(20);
    expect(rows.at(-1)!.span).toBe("19–19.8");
  });

  it("tabulates every piece, in orbit or not", () => {
    const { marks } = gabbardMarks(fengyun, { LEO: [rec], HIGH: null });
    expect(pieceRows(fengyun, marks, new Map([[29733, "OBJECT 29733"]]))).toEqual([
      { noradId: 29733, name: "OBJECT 29733", orbit: "830 × 1,718 km", period: "111.0 min", reentered: "—" },
      { noradId: 29734, name: "NORAD 29734", orbit: "not on the globe", period: "—", reentered: "—" },
      { noradId: 29735, name: "NORAD 29735", orbit: "—", period: "—", reentered: "1 Jun 2007" },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run (from `web/`): `npx vitest run tests/unit/breakupsText.test.ts`
Expected: FAIL — cannot resolve `@/lib/breakups/text`.

- [ ] **Step 3: Implement**

```ts
// web/src/lib/breakups/text.ts
import type { BreakupEventData, BreakupKind } from "@/lib/breakups/format";
import type { GabbardMark } from "@/lib/breakups/gabbard";
import { inOrbitAt, share, type Survival } from "@/lib/breakups/survival";
import { fmtInt } from "@/lib/format";

export const SHORT_NAMES: Record<string, string> = {
  "transit-4a-ablestar-1961": "Transit 4A Ablestar",
  "pegasus-haps-1996": "Pegasus HAPS",
  "fengyun-1c-2007": "Fengyun-1C",
  "usa-193-2008": "USA-193",
  "cosmos-2251-2009": "Cosmos 2251",
  "iridium-33-2009": "Iridium 33",
  "microsat-r-2019": "Microsat-R",
  "kosmos-1408-2021": "Kosmos 1408",
  "long-march-6a-2022": "Long March 6A (2022)",
  "long-march-6a-2024": "Long March 6A (2024)",
};

export function shortName(e: { id: string; name?: string }): string {
  return SHORT_NAMES[e.id] ?? e.name ?? e.id;
}

export const KIND_LABELS: Record<BreakupKind, string> = {
  ASAT: "ASAT test", COLLISION: "Collision", EXPLOSION: "Explosion", UNKNOWN: "Unknown cause",
};

export const fmtShare = (f: number): string => `${Math.round(f * 100)}%`;

export function stillUpLine(s: Survival): string {
  return s.total === 0 ? "no catalogued pieces" : `${fmtInt(s.inOrbit)} of ${fmtInt(s.total)} still up`;
}

export function countLines(s: Survival): string[] {
  if (s.total === 0) return ["0 catalogued"];
  return [
    `${fmtInt(s.total)} catalogued`, `${fmtInt(s.inOrbit)} in orbit`, `${fmtInt(s.reentered)} re-entered`,
    `${fmtShare(s.firstYearReentered / s.total)} re-entered in the first year`,
  ];
}

export function survivalTip(e: { id: string; name: string }, s: Survival, t: number): string {
  const n = inOrbitAt(s, t);
  return `${shortName(e)}, year ${Math.floor(t)}: ${fmtShare(share(s, n))} still up (${fmtInt(n)})`;
}

const CHART = "Share of each breakup's catalogued pieces still in orbit, by years since the event.";

export function afterLine(e: { id: string; name: string }, s: Survival): string {
  return `${shortName(e)}: ${fmtShare(share(s))} still up after ${s.age.toFixed(1)} years.`;
}

export function survivalSummary(curves: { e: BreakupEventData; s: Survival }[], selected: string | null): string {
  const c = curves.find((x) => x.e.id === selected);
  return c ? `${CHART} ${afterLine(c.e, c.s)}` : CHART;
}

export function markTip(m: GabbardMark, name: string | undefined): string {
  return `${name ?? `NORAD ${m.noradId}`} · ${fmtInt(m.perigeeKm)} × ${fmtInt(m.apogeeKm)} km · ${m.periodMin.toFixed(1)} min`;
}

export function plotNotes(notPlotted: number, offScale: number): string[] {
  return [
    ...(notPlotted > 0 ? [`${fmtInt(notPlotted)} in orbit not plotted`] : []),
    ...(offScale > 0 ? [`${fmtInt(offScale)} off scale`] : []),
  ];
}
```

```ts
// web/src/lib/breakups/tables.ts
import type { BreakupEventData } from "@/lib/breakups/format";
import type { GabbardMark } from "@/lib/breakups/gabbard";
import { byYear, share, type Survival } from "@/lib/breakups/survival";
import { fmtShare } from "@/lib/breakups/text";
import { fmtDate, fmtInt } from "@/lib/format";

export interface SurvivalRow {
  span: string;
  inOrbit: string;
  share: string;
  reentered: string;
}

export function survivalRows(s: Survival): SurvivalRow[] {
  return byYear(s).map((r) => ({
    span: `${r.from}–${Number.isInteger(r.to) ? r.to : r.to.toFixed(1)}`,
    inOrbit: fmtInt(r.inOrbit),
    share: fmtShare(share(s, r.inOrbit)),
    reentered: fmtInt(r.reentered),
  }));
}

export interface PieceRow {
  noradId: number;
  name: string;
  orbit: string;
  period: string;
  reentered: string;
}

export function pieceRows(e: BreakupEventData, marks: readonly GabbardMark[], names: ReadonlyMap<number, string>): PieceRow[] {
  const byId = new Map(marks.map((m) => [m.noradId, m]));
  return [...e.pieces]
    .sort((a, b) => a[0] - b[0])
    .map(([id, decay]) => {
      const m = byId.get(id);
      const name = names.get(id) ?? `NORAD ${id}`;
      if (decay !== null) return { noradId: id, name, orbit: "—", period: "—", reentered: fmtDate(decay) };
      if (!m) return { noradId: id, name, orbit: "not on the globe", period: "—", reentered: "—" };
      return { noradId: id, name, orbit: `${fmtInt(m.perigeeKm)} × ${fmtInt(m.apogeeKm)} km`, period: `${m.periodMin.toFixed(1)} min`, reentered: "—" };
    });
}
```

Check before running: Fengyun-1C to 2026-10-13 is 7,215 days, age 19.75 years, so `toFixed(1)` gives `19.8` and `byYear` has 20 rows. 29735 re-entered 141 days after the event, so the first row has 1 re-entered and 2 in orbit.

- [ ] **Step 4: Run the tests to see them pass**

Run (from `web/`): `npx vitest run && npx tsc --noEmit && npx eslint src tests e2e scripts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/breakups/text.ts web/src/lib/breakups/tables.ts web/tests/unit/breakupsText.test.ts
git commit -m "feat(web): breakup copy and data-table rows"
```

---

### Task 7: Store, panel registry and the globe highlight

**Files:**
- Modify: `web/src/lib/store.ts` (new fields and actions; `resetFilters`; `setCrowdingView`; `dataTablesOpen`)
- Modify: `web/src/lib/panels.ts` (`PanelId`, `PANELS`, `DEFAULT_VISIBILITY`)
- Modify: `web/src/components/charts/ChartData.tsx:11` (`which` type)
- Create: `web/src/lib/breakups/highlight.ts`
- Modify: `web/src/components/globe/Objects.tsx:62-66` (highlight)
- Modify: `web/src/components/globe/GlobeSection.tsx` (publish `globeRecords`)
- Modify: `web/src/components/panels/panelContent.tsx` (temporary `breakups` entry, replaced in Task 8)
- Modify: `web/tests/unit/store.test.ts`, `web/tests/unit/panels.test.ts`
- Create: `web/tests/unit/breakupsHighlight.test.ts`

**Interfaces:**
- Consumes: `OrbitRecord` (`@/lib/snapshot`); `Shell`, `inShell` (`@/lib/crowding/shell`).
- Produces (`@/lib/store`): `type DataTable = "history" | "owners" | "crowding" | "breakups"`; `type GlobeRecords = { generation: string | undefined; settled: boolean; LEO: OrbitRecord[] | null; HIGH: OrbitRecord[] | null }`; state `breakupEvent: string | null`, `breakupPieces: ReadonlySet<number> | null`, `hoverPiece: number | null`, `breakupsView: boolean`, `globeRecords: GlobeRecords`, `dataTablesOpen.breakups: boolean`; actions `selectBreakup(id: string | null)`, `openBreakup(id: string)`, `setBreakupPieces(p: ReadonlySet<number> | null)`, `setHoverPiece(id: number | null)`, `setBreakupsView(open: boolean)`, `setGlobeRecords(r: GlobeRecords)`, `toggleDataTable(which: DataTable)`.
- Produces (`@/lib/panels`): `PanelId` gains `"breakups"`, between `"crowding"` and `"chat"` in `PANELS`, visible by default.
- Produces (`@/lib/breakups/highlight`): `highlightMask(records: readonly OrbitRecord[], h: { hoverShell: Shell | null; hoverPiece: number | null; pieces: ReadonlySet<number> | null }): boolean[] | null`.

- [ ] **Step 1: Write the failing tests**

```ts
// web/tests/unit/breakupsHighlight.test.ts
import { describe, expect, it } from "vitest";
import { highlightMask } from "@/lib/breakups/highlight";
import { inShell } from "@/lib/crowding/shell";
import type { OrbitRecord } from "@/lib/snapshot";

const rec = (noradId: number, meanMotion: number): OrbitRecord => ({
  noradId, owner: "US", type: "DEB", epochMs: 0, meanMotion, eccentricity: 0.001, inclination: 53,
  raan: 0, argPericenter: 0, meanAnomaly: 0, bstar: 0, meanMotionDot: 0, meanMotionDdot: 0,
});
const records = [rec(1, 15.5), rec(2, 14.2), rec(3, 13.1)];
const shell = { row: 9, col: 27 };

describe("highlightMask", () => {
  it("is null with nothing to highlight", () => {
    expect(highlightMask(records, { hoverShell: null, hoverPiece: null, pieces: null })).toBeNull();
  });

  it("lights the selected event's pieces", () => {
    expect(highlightMask(records, { hoverShell: null, hoverPiece: null, pieces: new Set([1, 3]) })).toEqual([true, false, true]);
  });

  it("an empty piece set lights nothing (an event with no pieces in orbit)", () => {
    expect(highlightMask(records, { hoverShell: null, hoverPiece: null, pieces: new Set() })).toEqual([false, false, false]);
  });

  it("a hovered piece wins over the event", () => {
    expect(highlightMask(records, { hoverShell: null, hoverPiece: 2, pieces: new Set([1, 3]) })).toEqual([false, true, false]);
  });

  it("a hovered crowding cell wins over both", () => {
    expect(highlightMask(records, { hoverShell: shell, hoverPiece: 2, pieces: new Set([1, 3]) })).toEqual(records.map((r) => inShell(r, shell)));
  });
});
```

In `web/tests/unit/panels.test.ts`, change the two expectations at lines 11–12:

```ts
    expect(PANELS.map((p) => p.id)).toEqual(["search", "filters", "overview", "history", "owners", "crowding", "breakups", "chat"]);
    expect(DEFAULT_VISIBILITY).toEqual({ overview: true, search: true, history: true, owners: true, crowding: true, breakups: true, filters: false, chat: false });
```

Add to `web/tests/unit/store.test.ts`, inside `describe("explorer store", …)`:

```ts
  it("selects a breakup and drops the old piece set when the event changes", () => {
    const s = useExplorer.getState();
    s.selectBreakup("fengyun-1c-2007");
    s.setBreakupPieces(new Set([29733]));
    s.selectBreakup("fengyun-1c-2007");
    expect(useExplorer.getState().breakupPieces).toEqual(new Set([29733]));
    s.selectBreakup("cosmos-2251-2009");
    expect(useExplorer.getState()).toMatchObject({ breakupEvent: "cosmos-2251-2009", breakupPieces: null });
    s.selectBreakup(null);
    expect(useExplorer.getState().breakupEvent).toBeNull();
  });

  it("resetFilters clears the breakup highlight", () => {
    const s = useExplorer.getState();
    s.selectBreakup("fengyun-1c-2007");
    s.setBreakupPieces(new Set([29733]));
    s.resetFilters();
    expect(useExplorer.getState()).toMatchObject({ breakupEvent: null, breakupPieces: null });
  });

  it("opens one expanded view at a time", () => {
    const s = useExplorer.getState();
    s.setCrowdingView(true);
    s.openBreakup("fengyun-1c-2007");
    expect(useExplorer.getState()).toMatchObject({ breakupsView: true, crowdingView: false, breakupEvent: "fengyun-1c-2007" });
    s.setCrowdingView(true);
    expect(useExplorer.getState()).toMatchObject({ breakupsView: false, crowdingView: true });
    s.setBreakupsView(true);
    expect(useExplorer.getState()).toMatchObject({ breakupsView: true, crowdingView: false });
  });

  it("holds the globe's records and the hovered piece", () => {
    const s = useExplorer.getState();
    expect(s.globeRecords).toEqual({ generation: undefined, settled: false, LEO: null, HIGH: null });
    s.setGlobeRecords({ generation: "g1", settled: true, LEO: [], HIGH: null });
    s.setHoverPiece(29733);
    expect(useExplorer.getState()).toMatchObject({ globeRecords: { generation: "g1", settled: true }, hoverPiece: 29733 });
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run (from `web/`): `npx vitest run tests/unit/breakupsHighlight.test.ts tests/unit/panels.test.ts tests/unit/store.test.ts`
Expected: FAIL — cannot resolve `@/lib/breakups/highlight`; `selectBreakup is not a function`; the panel list lacks `breakups`.

- [ ] **Step 3: Implement the highlight mask**

```ts
// web/src/lib/breakups/highlight.ts
import { inShell, type Shell } from "@/lib/crowding/shell";
import type { OrbitRecord } from "@/lib/snapshot";

/** Which records the globe draws bright (the rest dim), or null to draw all of them normally. A
 * hovered crowding cell wins, then a hovered Gabbard piece, then the selected breakup's pieces.
 * Visibility (the filters) is separate: a hidden record stays hidden. */
export function highlightMask(
  records: readonly OrbitRecord[],
  h: { hoverShell: Shell | null; hoverPiece: number | null; pieces: ReadonlySet<number> | null },
): boolean[] | null {
  const { hoverShell, hoverPiece, pieces } = h;
  if (hoverShell) return records.map((r) => inShell(r, hoverShell));
  if (hoverPiece !== null) return records.map((r) => r.noradId === hoverPiece);
  if (pieces) return records.map((r) => pieces.has(r.noradId));
  return null;
}
```

- [ ] **Step 4: Implement the panel registry**

In `web/src/lib/panels.ts`:

```ts
export type PanelId = "overview" | "search" | "history" | "owners" | "crowding" | "breakups" | "filters" | "chat";
```

Add `{ id: "breakups", title: "Breakups" },` to `PANELS` between `crowding` and `chat`, and `breakups: true,` to `DEFAULT_VISIBILITY` after `crowding: true,`.

Until Task 8 replaces it, add a placeholder to `PANEL_CONTENT` in `web/src/components/panels/panelContent.tsx` so the record type still covers every panel:

```tsx
  breakups: () => null,
```

- [ ] **Step 5: Implement the store changes**

In `web/src/lib/store.ts`, import `type OrbitRecord` from `@/lib/snapshot` and add, above `type Filters`:

```ts
export type DataTable = "history" | "owners" | "crowding" | "breakups";

/** The globe's loaded records and their generation, published by GlobeSection for components
 * outside the globe (the Gabbard diagram). `settled` turns true once the LEO group's first load
 * has finished, whether it succeeded or not. */
export type GlobeRecords = { generation: string | undefined; settled: boolean; LEO: OrbitRecord[] | null; HIGH: OrbitRecord[] | null };
```

In `ExplorerState`, change `dataTablesOpen` and `toggleDataTable` to use `DataTable`:

```ts
  dataTablesOpen: Record<DataTable, boolean>;
```

```ts
  toggleDataTable: (which: DataTable) => void;
```

and add, after `crowdingView: boolean;`:

```ts
  // The breakup event whose surviving pieces the globe highlights (see BreakupsPanel). Not a
  // filter: it hides nothing. The filter summary shows it and Reset clears it.
  breakupEvent: string | null;
  // The selected event's in-orbit NORAD IDs, from the breakups file (set by BreakupsProvider).
  // Lives here because the globe's Objects sit inside the R3F <Canvas>, out of the provider's reach.
  breakupPieces: ReadonlySet<number> | null;
  // The piece under the Gabbard pointer: the globe highlights only it while it is set.
  hoverPiece: number | null;
  // Whether the expanded breakups view is open (see BreakupsView).
  breakupsView: boolean;
  globeRecords: GlobeRecords;
  selectBreakup: (id: string | null) => void;
  openBreakup: (id: string) => void;
  setBreakupPieces: (p: ReadonlySet<number> | null) => void;
  setHoverPiece: (id: number | null) => void;
  setBreakupsView: (open: boolean) => void;
  setGlobeRecords: (r: GlobeRecords) => void;
```

Add the five new state keys to the `Pick<…>` list of `initial`:

```ts
    | "breakupEvent"
    | "breakupPieces"
    | "hoverPiece"
    | "breakupsView"
    | "globeRecords"
```

and to its body, with `dataTablesOpen` gaining `breakups`:

```ts
  dataTablesOpen: { history: false, owners: false, crowding: false, breakups: false },
```

```ts
  breakupEvent: null,
  breakupPieces: null,
  hoverPiece: null,
  breakupsView: false,
  globeRecords: { generation: undefined, settled: false, LEO: null, HIGH: null },
```

Replace `resetFilters` and `setCrowdingView`, and add the new actions next to `setCrowdingView`:

```ts
  resetFilters: () => {
    const { types, owners, orbits, shell } = initial();
    set({ types, owners, orbits, shell, breakupEvent: null, breakupPieces: null });
  },
```

```ts
  setCrowdingView: (open) => set(open ? { crowdingView: true, breakupsView: false } : { crowdingView: false }),
  selectBreakup: (id) => set((s) => (id === s.breakupEvent ? s : { breakupEvent: id, breakupPieces: null })),
  openBreakup: (id) =>
    set((s) => ({ breakupsView: true, crowdingView: false, ...(id === s.breakupEvent ? {} : { breakupEvent: id, breakupPieces: null }) })),
  setBreakupPieces: (breakupPieces) => set({ breakupPieces }),
  setHoverPiece: (hoverPiece) => set({ hoverPiece }),
  setBreakupsView: (open) => set(open ? { breakupsView: true, crowdingView: false } : { breakupsView: false, hoverPiece: null }),
  setGlobeRecords: (globeRecords) => set({ globeRecords }),
```

In `web/src/components/charts/ChartData.tsx`, import `type DataTable` from `@/lib/store` and change `DataDisclosure`'s prop type to `which: DataTable`.

- [ ] **Step 6: Wire the globe**

In `web/src/components/globe/Objects.tsx`, import `highlightMask` from `@/lib/breakups/highlight` and replace the `hoverShell`/`highlight` lines (62–66):

```ts
  const hoverShell = useExplorer((s) => s.hoverShell);
  const hoverPiece = useExplorer((s) => s.hoverPiece);
  const pieces = useExplorer((s) => s.breakupPieces);
  const highlight = useMemo(
    () => highlightMask(view, { hoverShell, hoverPiece, pieces }),
    [view, hoverShell, hoverPiece, pieces],
  );
```

Remove the `inShell` import from `Objects.tsx` if nothing else in the file uses it (eslint will say).

In `web/src/components/globe/GlobeSection.tsx`, after the `setHighStatus` effect:

```ts
  // Published for the Gabbard diagram (see BreakupsView), which sits outside the globe and needs
  // the same records and generation the globe shows.
  const setGlobeRecords = useExplorer((s) => s.setGlobeRecords);
  const leoRecords = globe.groups.LEO.records;
  const highRecords = globe.groups.HIGH.records;
  const leoSettled = leoStatus !== "idle" && leoStatus !== "loading";
  useEffect(() => {
    setGlobeRecords({ generation: globe.generation, settled: leoSettled, LEO: leoRecords, HIGH: highRecords });
  }, [globe.generation, leoSettled, leoRecords, highRecords, setGlobeRecords]);
```

- [ ] **Step 7: Run all checks**

Run (from `web/`): `npx vitest run && npx tsc --noEmit && npx eslint src tests e2e scripts && npx playwright test`
Expected: all pass. The dock and the phone sheet now list `Breakups` (empty until Task 8). If an existing e2e test counts dock buttons or sheet tabs, update its count by one and say so in the commit message.

- [ ] **Step 8: Commit**

```bash
git add web/src/lib/store.ts web/src/lib/panels.ts web/src/lib/breakups/highlight.ts web/src/components/charts/ChartData.tsx web/src/components/globe/Objects.tsx web/src/components/globe/GlobeSection.tsx web/src/components/panels/panelContent.tsx web/tests/unit/store.test.ts web/tests/unit/panels.test.ts web/tests/unit/breakupsHighlight.test.ts
git commit -m "feat(web): breakup selection in the store and the globe highlight"
```

---

### Task 8: The Breakups panel, survival chart, filter-summary chip and ObjectCard link

**Files:**
- Create: `web/src/components/breakups/BreakupsProvider.tsx`, `web/src/components/breakups/BreakupsPanel.tsx`, `web/src/components/breakups/EventList.tsx`, `web/src/components/breakups/SurvivalChart.tsx`
- Modify: `web/src/components/panels/panelContent.tsx` (real `breakups` entry)
- Modify: `web/src/app/page.tsx:124-144` (provider, panel placement)
- Modify: `web/src/components/globe/FilterSummary.tsx` (chip)
- Modify: `web/src/components/panels/ObjectCard.tsx:61` (Created by button)
- Create: `web/tests/fixtures/breakups/breakups.json`
- Modify: `web/e2e/explorer.spec.ts` (`mockApi` route; new `describe("breakups")`)

**Interfaces:**
- Consumes: `api.breakups`, `BreakupFile`, `inOrbitPieces` (Task 3); `survival`, `share` (Task 4); text helpers (Task 6); store fields and actions (Task 7); `Unavailable`; `retryButton` (`@/components/crowding/CrowdingPanel`).
- Produces: `BreakupsProvider`, `useBreakups(): { status: "loading" | "ready" | "empty" | "error"; file: BreakupFile | null; retry: () => void }` (`@/components/breakups/BreakupsProvider`); `useCurves(file: BreakupFile | null): Curve[]` and `type Curve = { e: BreakupEventData; s: Survival }` (same file); `EventList({ curves, selected, onSelect })`; `SurvivalChart({ curves, selected, onSelect, width, height, label })`.

- [ ] **Step 1: Add the e2e fixture and the failing e2e tests**

```json
{
 "generated_at": "2026-10-13T06:41:00+00:00",
 "events": [
  {"id": "fengyun-1c-2007", "name": "Fengyun-1C anti-satellite test", "event_date": "2007-01-11", "kind": "ASAT", "parent_cospar": "1999-025",
   "description": "China destroyed its Fengyun-1C weather satellite with a ground-launched missile at about 865 km.", "source_url": "https://en.wikipedia.org/wiki/2007_Chinese_anti-satellite_missile_test",
   "pieces": [[29733, null], [29734, null], [29735, "2010-05-01"]]},
  {"id": "usa-193-2008", "name": "USA-193 intercept", "event_date": "2008-02-21", "kind": "ASAT", "parent_cospar": "2006-057",
   "description": "The US Navy destroyed the failed USA-193 satellite at about 247 km.", "source_url": null, "pieces": []}
 ]
}
```

Save that as `web/tests/fixtures/breakups/breakups.json`. The LEO snapshot fixture already holds record 29733 (a PRC debris piece, mean motion 12.9692, e 0.058); 29734 is in no snapshot, so it is "in orbit, not plotted".

In `mockApi`'s `map`, add `"/globe/breakups": "breakups/breakups.json",`.

Add at the end of `web/e2e/explorer.spec.ts`:

```ts
test.describe("breakups", () => {
  const eventList = (page: Page) => page.getByRole("region", { name: "Breakups" }).getByRole("list", { name: "Breakup events" });

  test("the panel lists events; selecting one shows the chip, which clears it", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    const fengyun = eventList(page).getByRole("button", { name: /Fengyun-1C/ });
    await expect(fengyun).toContainText("2 of 3 still up");
    await expect(eventList(page).getByRole("button", { name: /USA-193/ })).toContainText("no catalogued pieces");
    await fengyun.click();
    await expect(fengyun).toHaveAttribute("aria-pressed", "true");
    const summary = page.getByTestId("filter-summary");
    await expect(summary).toContainText("Fengyun-1C pieces");
    await summary.getByRole("button", { name: "Clear breakup highlight" }).click();
    await expect(summary).toHaveCount(0);
    await expect(fengyun).toHaveAttribute("aria-pressed", "false");
  });

  test("the survival chart selects an event from its curve", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    const chart = page.getByRole("region", { name: "Breakups" }).getByRole("group", { name: "Survival chart" });
    await chart.getByRole("button", { name: "Select Fengyun-1C" }).focus();
    await page.keyboard.press("Enter");
    await expect(eventList(page).getByRole("button", { name: /Fengyun-1C/ })).toHaveAttribute("aria-pressed", "true");
  });

  test("Reset clears the breakup highlight with the filters", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    await eventList(page).getByRole("button", { name: /Fengyun-1C/ }).click();
    await page.getByRole("button", { name: "Reset filters" }).click();
    await expect(page.getByTestId("filter-summary")).toHaveCount(0);
  });

  test("with no breakups file the panel says when data arrives", async ({ page }) => {
    await mockApi(page, { "/globe/breakups": { status: 404 } });
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Breakups" }).getByText("Breakup data appears after the next catalog update.")).toBeVisible();
  });

  test("a failed fetch offers Retry", async ({ page }) => {
    await mockApi(page, { "/globe/breakups": { status: 500 } });
    await page.goto("/");
    const panel = page.getByRole("region", { name: "Breakups" });
    await expect(panel.getByText("Data unavailable: breakups.")).toBeVisible();
    await page.unroute("**/api/**");
    await mockApi(page);
    await panel.getByRole("button", { name: "Retry" }).click();
    await expect(eventList(page).getByRole("button", { name: /Fengyun-1C/ })).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the new e2e tests to see them fail**

Run (from `web/`): `npx playwright test -g "breakups"`
Expected: FAIL — no `Breakup events` list in the panel.

- [ ] **Step 3: Implement the provider**

```tsx
// web/src/components/breakups/BreakupsProvider.tsx
"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { inOrbitPieces, type BreakupEventData, type BreakupFile } from "@/lib/breakups/format";
import { survival, type Survival } from "@/lib/breakups/survival";
import { useExplorer } from "@/lib/store";

export type BreakupsStatus = "loading" | "ready" | "empty" | "error";
export type Curve = { e: BreakupEventData; s: Survival };

interface BreakupsContext {
  status: BreakupsStatus;
  file: BreakupFile | null;
  retry: () => void;
}

const Ctx = createContext<BreakupsContext>({ status: "loading", file: null, retry: () => {} });

export const useBreakups = (): BreakupsContext => useContext(Ctx);

/** Each event with its survival, "today" being the file's own publication day. */
export function useCurves(file: BreakupFile | null): Curve[] {
  return useMemo(() => (file ? file.events.map((e) => ({ e, s: survival(e, file.generated_at) })) : []), [file]);
}

type Loaded = { key: string; file: BreakupFile | null; error: boolean };

/** Loads the breakups file of the generation the globe shows, once something needs it (the panel,
 * the view, or a selected event), and again after each globe swap. Publishes the selected event's
 * in-orbit pieces to the store for the globe's highlight. */
export function BreakupsProvider({ children }: { children: React.ReactNode }) {
  const wanted = useExplorer((s) => s.panels.breakups || s.breakupsView || s.breakupEvent !== null);
  const settled = useExplorer((s) => s.globeRecords.settled);
  const generation = useExplorer((s) => s.globeRecords.generation);
  const breakupEvent = useExplorer((s) => s.breakupEvent);
  const setBreakupPieces = useExplorer((s) => s.setBreakupPieces);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const key = `${generation ?? "current"}#${attempt}`;
  const done = loaded?.key === key;

  useEffect(() => {
    // Wait for the globe's first load: before it settles the generation is not known yet, and a
    // fetch of "current" would be followed by a second one for the same generation.
    if (!wanted || !settled || done) return;
    let cancelled = false;
    api.breakups(generation).then(
      (file) => {
        if (!cancelled) setLoaded({ key, file, error: false });
      },
      () => {
        if (!cancelled) setLoaded((l) => ({ key, file: l?.file ?? null, error: true }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [wanted, settled, done, generation, key]);

  const file = loaded?.file ?? null;
  useEffect(() => {
    setBreakupPieces(file && breakupEvent ? inOrbitPieces(file, breakupEvent) : null);
  }, [file, breakupEvent, setBreakupPieces]);

  // A failed refetch keeps showing the previous generation's file.
  const status: BreakupsStatus = file ? "ready" : !done ? "loading" : loaded.error ? "error" : "empty";
  const value = useMemo<BreakupsContext>(() => ({ status, file, retry: () => setAttempt((a) => a + 1) }), [status, file]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
```

Note on `status`: after a 404 the stored `file` is null and `done` is true, so it reads `empty`; on a later swap the key changes and it reads `loading` until the new answer arrives. TypeScript narrows `loaded` to non-null in the last branch because `done` is only true when `loaded` is set; if `tsc` disagrees, write `loaded?.error`.

- [ ] **Step 4: Implement the event list and the survival chart**

```tsx
// web/src/components/breakups/EventList.tsx
"use client";

import type { Curve } from "@/components/breakups/BreakupsProvider";
import { KIND_LABELS, shortName, stillUpLine } from "@/lib/breakups/text";

/** One button per event: short name, year and kind, and how many of its pieces are still up. */
export function EventList({ curves, selected, onSelect }: { curves: Curve[]; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <ul aria-label="Breakup events" className="flex flex-col">
      {curves.map(({ e, s }) => {
        const on = selected === e.id;
        return (
          <li key={e.id}>
            <button
              type="button"
              aria-pressed={on}
              onClick={() => onSelect(e.id)}
              className={`flex w-full items-baseline justify-between gap-2 rounded-[8px] border-l-2 px-2 py-1 text-left text-[12px] ${
                on ? "border-[#ff6a3d] bg-[#1d1d1d] text-ink" : s.total === 0 ? "border-transparent text-ink-3" : "border-transparent text-ink-2 hover:text-ink"
              }`}
            >
              <span className="min-w-0 truncate">
                <span className={s.total === 0 ? "" : "text-ink"}>{shortName(e)}</span>{" "}
                <span className="text-ink-3">{e.event_date.slice(0, 4)} · {KIND_LABELS[e.kind]}</span>
              </span>
              <span className="whitespace-nowrap font-mono">{stillUpLine(s)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
```

```tsx
// web/src/components/breakups/SurvivalChart.tsx
"use client";

import { useId, useState } from "react";
import type { Curve } from "@/components/breakups/BreakupsProvider";
import { share } from "@/lib/breakups/survival";
import { afterLine, shortName, survivalSummary, survivalTip } from "@/lib/breakups/text";

const PAD = { left: 34, right: 8, top: 8, bottom: 20 };

/** Share of each event's catalogued pieces still in orbit against years since the event, as step
 * curves; the selected event is drawn bold and last. Each curve is a button that selects it. */
export function SurvivalChart({
  curves, selected, onSelect, width, height, label = "Survival chart",
}: { curves: Curve[]; selected: string | null; onSelect: (id: string) => void; width: number; height: number; label?: string }) {
  const descId = useId();
  const [hoverT, setHoverT] = useState<number | null>(null);
  const shown = curves.filter((c) => c.s.total > 0);
  const span = Math.max(1, ...shown.map((c) => c.s.age));
  const pw = width - PAD.left - PAD.right;
  const ph = height - PAD.top - PAD.bottom;
  const x = (t: number) => PAD.left + (t / span) * pw;
  const y = (f: number) => PAD.top + (1 - f) * ph;
  const d = ({ s }: Curve) =>
    s.steps.map((st, i) => (i === 0 ? `M${x(st.t).toFixed(1)} ${y(share(s, st.inOrbit)).toFixed(1)}` : `H${x(st.t).toFixed(1)} V${y(share(s, st.inOrbit)).toFixed(1)}`)).join(" ");
  const ordered = [...shown.filter((c) => c.e.id !== selected), ...shown.filter((c) => c.e.id === selected)];
  const current = shown.find((c) => c.e.id === selected) ?? null;
  const tip = current && hoverT !== null && hoverT <= current.s.age ? survivalTip(current.e, current.s, hoverT) : null;
  const xTicks = [0, Math.round(span / 2), Math.floor(span)];

  return (
    <div role="group" aria-label={label} aria-describedby={descId} className="mt-2">
      <svg
        width={width}
        height={height}
        onPointerMove={(ev) => {
          const r = ev.currentTarget.getBoundingClientRect();
          const t = ((ev.clientX - r.left - PAD.left) / pw) * span;
          setHoverT(t >= 0 && t <= span ? t : null);
        }}
        onPointerLeave={() => setHoverT(null)}
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(f)} y2={y(f)} stroke="#2a2a2a" />
            <text x={PAD.left - 4} y={y(f) + 3} textAnchor="end" fontSize={9} fill="currentColor" className="text-ink-3">{`${f * 100}%`}</text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} x={x(t)} y={height - 6} textAnchor="middle" fontSize={9} fill="currentColor" className="text-ink-3">{t}</text>
        ))}
        <text x={width - PAD.right} y={height - 6} textAnchor="end" fontSize={9} fill="currentColor" className="text-ink-3">years</text>
        {ordered.map((c) => {
          const on = c.e.id === selected;
          return (
            <g
              key={c.e.id}
              role="button"
              tabIndex={0}
              aria-label={`Select ${shortName(c.e)}`}
              aria-pressed={on}
              onClick={() => onSelect(c.e.id)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" || ev.key === " ") {
                  ev.preventDefault();
                  onSelect(c.e.id);
                }
              }}
              className="cursor-pointer outline-none focus-visible:[&>path:last-child]:stroke-[#7fd06b]"
            >
              <path d={d(c)} fill="none" stroke="transparent" strokeWidth={8} />
              <path d={d(c)} fill="none" stroke={on ? "#ff6a3d" : "#4a4a4a"} strokeWidth={on ? 2 : 1} />
            </g>
          );
        })}
        {tip && hoverT !== null && <line x1={x(hoverT)} x2={x(hoverT)} y1={PAD.top} y2={PAD.top + ph} stroke="#2a2a2a" />}
      </svg>
      <p className="min-h-[18px] text-[12px] text-ink-2">{tip ?? (current ? afterLine(current.e, current.s) : "")}</p>
      <p id={descId} className="sr-only">{survivalSummary(curves, selected)}</p>
    </div>
  );
}
```

The line under the chart shows the hover line, or the selected event's "Fengyun-1C: 67% still up after 19.8 years." when the pointer is elsewhere.

- [ ] **Step 5: Implement the panel and mount it**

```tsx
// web/src/components/breakups/BreakupsPanel.tsx
"use client";

import { useBreakups, useCurves } from "@/components/breakups/BreakupsProvider";
import { EventList } from "@/components/breakups/EventList";
import { SurvivalChart } from "@/components/breakups/SurvivalChart";
import { retryButton } from "@/components/crowding/CrowdingPanel";
import { Unavailable } from "@/components/ui/Unavailable";
import { useExplorer } from "@/lib/store";

/** The small Breakups panel: the event list and a small survival chart. Selecting an event lights
 * its surviving pieces up on the globe; selecting it again clears that. */
export function BreakupsPanel() {
  const { status, file, retry } = useBreakups();
  const curves = useCurves(file);
  const selected = useExplorer((s) => s.breakupEvent);
  const selectBreakup = useExplorer((s) => s.selectBreakup);
  const setBreakupsView = useExplorer((s) => s.setBreakupsView);

  if (status === "empty") return <p className="text-[13px] text-ink-2">Breakup data appears after the next catalog update.</p>;
  if (status === "error") {
    return (
      <div className="flex items-center gap-3">
        <Unavailable what="breakups" />
        <button type="button" onClick={retry} className={retryButton}>Retry</button>
      </div>
    );
  }
  if (!file) return <p role="status" className="text-[13px] text-ink-3">Loading…</p>;
  const toggle = (id: string) => selectBreakup(id === selected ? null : id);
  return (
    <div>
      <div className="mb-1 flex justify-end">
        <button
          type="button"
          data-breakups-expand
          aria-label="Expand breakups view"
          onClick={() => setBreakupsView(true)}
          className="min-h-7 rounded-full border-2 border-line bg-[#121212] px-2.5 text-[11px] text-ink-2 hover:text-ink"
        >
          ⤢ Expand
        </button>
      </div>
      <EventList curves={curves} selected={selected} onSelect={toggle} />
      <SurvivalChart curves={curves} selected={selected} onSelect={toggle} width={280} height={120} />
    </div>
  );
}
```

In `panelContent.tsx`, import `BreakupsPanel` and replace the placeholder with `breakups: () => <BreakupsPanel />,`.

In `web/src/app/page.tsx`, import `BreakupsProvider`, wrap the children of `<CrowdingProvider>` in `<BreakupsProvider>…</BreakupsProvider>`, and place the panel in the right column's lower group:

```tsx
              <div className="flex flex-col gap-3">{panel("crowding")}{panel("breakups")}{panel("owners")}</div>
```

- [ ] **Step 6: The filter-summary chip**

In `web/src/components/globe/FilterSummary.tsx`, import `shortName` from `@/lib/breakups/text`, read `breakupEvent` and `selectBreakup` from the store, and change the early return and the body:

```tsx
  const breakupEvent = useExplorer((s) => s.breakupEvent);
  const selectBreakup = useExplorer((s) => s.selectBreakup);
  const f = { types, owners, orbits, shell };
  const defaults = isDefaultFilters(f);
  if (defaults && !breakupEvent) return null;
```

Wrap the existing "Showing …" `<button>` and its `<span id={descId}>` in `{!defaults && (<>…</>)}`, and insert before the Reset button:

```tsx
      {breakupEvent && (
        <span className="flex items-center gap-1 whitespace-nowrap">
          <span>{shortName({ id: breakupEvent })} pieces</span>
          <button
            type="button"
            aria-label="Clear breakup highlight"
            onClick={() => {
              selectBreakup(null);
              announce("Breakup highlight cleared");
            }}
            className="min-h-6 rounded-full border-2 border-line bg-[#1a1a1a] px-1.5 text-[11px] text-ink hover:bg-[#222]"
          >
            ✕
          </button>
        </span>
      )}
```

Update the component's doc comment: it also shows the highlighted breakup, which Reset clears too.

- [ ] **Step 7: The ObjectCard link**

In `ObjectCard.tsx`, read `openBreakup` from the store and replace the "Created by" `Row` (line 61):

```tsx
          {obj.event && (
            <div className="flex justify-between gap-4 border-t border-[#1c1c1c] py-1.5 text-[13px]">
              <dt className="text-ink-2">Created by</dt>
              <dd className="text-right font-mono text-ink">
                <button
                  type="button"
                  title="Show this breakup"
                  onClick={() => openBreakup(obj.event!.id)}
                  className="text-right underline decoration-[#555] underline-offset-2 hover:text-[#ff6a3d]"
                >
                  {`${obj.event.name} (${obj.event.event_date.slice(0, 4)})`}
                </button>
              </dd>
            </div>
          )}
```

The view it opens arrives in Task 9; until then the button only selects and highlights the event.

- [ ] **Step 8: Run all checks**

Run (from `web/`): `npx vitest run && npx tsc --noEmit && npx eslint src tests e2e scripts && npx playwright test`
Expected: all pass, including the five new `breakups` tests and every existing test (the extra panel must not push an existing assertion off the right column; if one now needs `scrollIntoViewIfNeeded`, add it and say so in the commit message).

- [ ] **Step 9: Commit**

```bash
git add web/src/components/breakups web/src/components/panels/panelContent.tsx web/src/app/page.tsx web/src/components/globe/FilterSummary.tsx web/src/components/panels/ObjectCard.tsx web/tests/fixtures/breakups/breakups.json web/e2e/explorer.spec.ts
git commit -m "feat(web): Breakups panel with survival curves and the globe highlight"
```

---

### Task 9: The expanded view: header, Gabbard diagram, method note, data tables, phone layout

**Files:**
- Create: `web/src/components/breakups/BreakupsView.tsx`, `web/src/components/breakups/GabbardCanvas.tsx`, `web/src/components/breakups/BreakupsMethodNote.tsx`, `web/src/components/breakups/BreakupsTables.tsx`
- Modify: `web/src/app/page.tsx` (mount `<BreakupsView />` after `<CrowdingView />`)
- Modify: `web/e2e/explorer.spec.ts` (`describe("breakups")` gains view tests)

**Interfaces:**
- Consumes: everything from Tasks 3–8; `nameCache` (`@/lib/names`, `get(group): Promise<Map<number, string> | null>`); `useIsMobile` (`@/lib/useIsMobile`); `DataDisclosure`.
- Produces: `BreakupsView` (renders nothing while `breakupsView` is false).

- [ ] **Step 1: Write the failing e2e tests**

Add inside `test.describe("breakups", …)`:

```ts
  // An ObjectDetail for the fixture snapshot's debris piece 29733, linked to Fengyun-1C.
  function fengyunPiece(): string {
    const o = JSON.parse(fx("api/object.json").toString());
    return JSON.stringify({
      ...o, norad_id: 29733, cospar_id: "1999-025ABC", name: "FENGYUN 1C DEB", object_type: "DEB", owner: "PRC", owner_name: "China",
      parent_cospar: "1999-025", event_id: "fengyun-1c-2007",
      event: { id: "fengyun-1c-2007", name: "Fengyun-1C anti-satellite test", event_date: "2007-01-11" },
    });
  }

  /** A point on the Gabbard canvas, from the layout numbers the canvas exposes. */
  async function gabbardPoint(canvas: import("@playwright/test").Locator, periodMin: number, altKm: number) {
    await canvas.scrollIntoViewIfNeeded();
    const box = (await canvas.boundingBox())!;
    const n = async (a: string) => Number(await canvas.getAttribute(a));
    const [left, top, w, h, pMin, pMax, altMax] = [
      await n("data-pad-left"), await n("data-pad-top"), await n("data-plot-w"), await n("data-plot-h"),
      await n("data-period-min"), await n("data-period-max"), await n("data-alt-max"),
    ];
    return { x: box.x + left + ((periodMin - pMin) / (pMax - pMin)) * w, y: box.y + top + (1 - altKm / altMax) * h };
  }

  test("the view plots the pieces; a mark opens its card, whose row reopens the view", async ({ page }) => {
    await mockApi(page);
    await page.route("**/api/objects/29733", (route) => route.fulfill({ status: 200, contentType: "application/json", body: fengyunPiece() }));
    await page.goto("/");
    await eventList(page).getByRole("button", { name: /Fengyun-1C/ }).click();
    await page.getByRole("button", { name: "Expand breakups view" }).click();
    const view = page.getByRole("dialog", { name: "Breakup aftermath" });
    await expect(view.getByRole("heading", { name: "Fengyun-1C anti-satellite test" })).toBeVisible();
    await expect(view.getByText("3 catalogued")).toBeVisible();
    await expect(view.getByText("1 in orbit not plotted")).toBeVisible();
    // 29733: mean motion 12.9692 rev/day, e 0.058 → period 111.03 min, apogee 1,718 km.
    const p = await gabbardPoint(view.locator("canvas[data-gabbard]"), 1440 / 12.9692, 1718.016);
    await page.mouse.move(p.x, p.y);
    await expect(view.getByText("OBJECT 29733 · 830 × 1,718 km · 111.0 min")).toBeVisible();
    await page.mouse.click(p.x, p.y);
    await expect(view).toHaveCount(0);
    const card = page.getByTestId("object-card");
    await expect(card).toContainText("FENGYUN 1C DEB");
    await card.getByRole("button", { name: "Fengyun-1C anti-satellite test (2007)" }).click();
    await expect(page.getByRole("dialog", { name: "Breakup aftermath" })).toBeVisible();
  });

  test("Escape closes the view and returns focus to Expand", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    const expand = page.getByRole("button", { name: "Expand breakups view" });
    await expand.click();
    const view = page.getByRole("dialog", { name: "Breakup aftermath" });
    await expect(view.getByText("Pick an event to see its pieces.")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(view).toHaveCount(0);
    await expect(expand).toBeFocused();
  });

  test("the data tables carry the survival and piece numbers", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    await eventList(page).getByRole("button", { name: /Fengyun-1C/ }).click();
    await page.getByRole("button", { name: "Expand breakups view" }).click();
    const view = page.getByRole("dialog", { name: "Breakup aftermath" });
    await view.getByRole("button", { name: "View data" }).click();
    const data = view.getByRole("region", { name: "Breakup data" });
    await expect(data.getByRole("row", { name: /^0–1 / })).toBeVisible();
    await expect(data.getByRole("row", { name: /29734 NORAD 29734 not on the globe/ })).toBeVisible();
  });

  test("on a phone the view has Survival and Gabbard tabs", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockApi(page);
    await page.goto("/");
    await page.getByRole("tab", { name: "Breakups" }).click();
    await page.getByRole("list", { name: "Breakup events" }).getByRole("button", { name: /Fengyun-1C/ }).click();
    await page.getByRole("button", { name: "Expand breakups view" }).click();
    const view = page.getByRole("dialog", { name: "Breakup aftermath" });
    await expect(view.getByRole("group", { name: "Survival chart" })).toBeVisible();
    await view.getByRole("tab", { name: "Gabbard" }).click();
    await expect(view.locator("canvas[data-gabbard]")).toBeVisible();
    await expect(view.getByRole("group", { name: "Survival chart" })).toHaveCount(0);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run (from `web/`): `npx playwright test -g "breakups"`
Expected: the four new tests FAIL (no dialog); the Task 8 tests still pass.

- [ ] **Step 3: Implement the Gabbard canvas**

```tsx
// web/src/components/breakups/GabbardCanvas.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { GABBARD_PAD, gabbardScale, markPoint, nearestMark, PERIOD_CAP_MIN, ticks, type GabbardMark } from "@/lib/breakups/gabbard";
import { markTip } from "@/lib/breakups/text";

const APOGEE = "#ff6a3d";
const PERIGEE = "#7fb0ff";
const AXIS = "#2a2a2a";
const LABEL = "#8a8a8a";

/** Apogee (▲) and perigee (▼) altitude against period for each plotted piece. Hover names a piece
 * and highlights it on the globe; a click picks it. The canvas is hidden from assistive tech; the
 * piece table carries the same numbers. Layout numbers are exposed as data attributes for tests. */
export function GabbardCanvas({
  marks, width, height, names, onHover, onPick,
}: {
  marks: GabbardMark[];
  width: number;
  height: number;
  names: ReadonlyMap<number, string>;
  onHover: (id: number | null) => void;
  onPick: (m: GabbardMark) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const scale = useMemo(() => gabbardScale(marks), [marks]);
  const [tip, setTip] = useState<string | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !scale) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const bottom = height - GABBARD_PAD.bottom;
    ctx.font = "9px ui-monospace, monospace";
    ctx.fillStyle = LABEL;
    ctx.strokeStyle = AXIS;
    ctx.textAlign = "right";
    for (const alt of ticks(0, scale.altMax, 4)) {
      const { y } = markPoint(scale, width, height, scale.periodMin, alt);
      ctx.beginPath();
      ctx.moveTo(GABBARD_PAD.left, y);
      ctx.lineTo(width - GABBARD_PAD.right, y);
      ctx.stroke();
      ctx.fillText(`${alt}`, GABBARD_PAD.left - 4, y + 3);
    }
    ctx.textAlign = "center";
    for (const p of ticks(scale.periodMin, scale.periodMax, 5)) {
      ctx.fillText(`${p}`, markPoint(scale, width, height, p, 0).x, bottom + 12);
    }
    ctx.fillText("period (min)", width / 2, height - 2);
    ctx.save();
    ctx.translate(10, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("altitude (km)", 0, 0);
    ctx.restore();
    const tri = (x: number, y: number, up: boolean) => {
      if (y < GABBARD_PAD.top || y > bottom) return;
      ctx.beginPath();
      ctx.moveTo(x, up ? y - 2.5 : y + 2.5);
      ctx.lineTo(x - 2.5, up ? y + 2 : y - 2);
      ctx.lineTo(x + 2.5, up ? y + 2 : y - 2);
      ctx.fill();
    };
    for (const m of marks) {
      if (m.periodMin > PERIOD_CAP_MIN) continue;
      const a = markPoint(scale, width, height, m.periodMin, m.apogeeKm);
      const p = markPoint(scale, width, height, m.periodMin, m.perigeeKm);
      ctx.fillStyle = PERIGEE;
      tri(p.x, p.y, false);
      ctx.fillStyle = APOGEE;
      tri(a.x, a.y, true);
    }
  }, [marks, scale, width, height]);

  if (!scale) return <p className="text-[12px] text-ink-3">No pieces in orbit to plot.</p>;
  // React.PointerEvent extends React.MouseEvent, so one helper serves hover and click.
  const at = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    return nearestMark(marks, scale, width, height, ev.clientX - r.left, ev.clientY - r.top);
  };
  return (
    <div>
      <canvas
        ref={ref}
        data-gabbard
        aria-hidden="true"
        data-pad-left={GABBARD_PAD.left}
        data-pad-top={GABBARD_PAD.top}
        data-plot-w={width - GABBARD_PAD.left - GABBARD_PAD.right}
        data-plot-h={height - GABBARD_PAD.top - GABBARD_PAD.bottom}
        data-period-min={scale.periodMin}
        data-period-max={scale.periodMax}
        data-alt-max={scale.altMax}
        style={{ width, height }}
        className="cursor-crosshair"
        onPointerMove={(ev) => {
          const m = at(ev);
          setTip(m ? markTip(m, names.get(m.noradId)) : null);
          onHover(m?.noradId ?? null);
        }}
        onPointerLeave={() => {
          setTip(null);
          onHover(null);
        }}
        onClick={(ev) => {
          const m = at(ev);
          if (m) onPick(m);
        }}
      />
      <p className="min-h-[18px] text-[12px] text-ink-2">{tip ?? ""}</p>
    </div>
  );
}
```

- [ ] **Step 4: Implement the method note and the tables**

```tsx
// web/src/components/breakups/BreakupsMethodNote.tsx
/** How the breakup numbers are made (see docs/superpowers/specs/2026-10-13-breakup-aftermath-design.md). */
export function BreakupsMethodNote() {
  return (
    <details className="mt-3 text-[12px] leading-relaxed text-ink-2">
      <summary className="cursor-pointer text-ink">Method</summary>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        <li>
          A piece belongs to an event when it is catalogued as debris and its international designator matches the parent object&apos;s
          launch (1999-025 for Fengyun-1C). Rocket bodies and payloads are not counted.
        </li>
        <li>Only tracked pieces count: roughly 10 cm and larger in low Earth orbit. Far more smaller fragments exist.</li>
        <li>
          The share still in orbit is out of every piece catalogued so far. Pieces of recent events are still being catalogued, so their
          curves look better than they will.
        </li>
        <li>
          Re-entry dates come from CelesTrak&apos;s satellite catalogue. The Gabbard diagram uses the same orbit data as the globe: apogee
          and perigee above a 6,378 km Earth radius, from each piece&apos;s mean motion and eccentricity.
        </li>
      </ul>
    </details>
  );
}
```

```tsx
// web/src/components/breakups/BreakupsTables.tsx
"use client";

import type { Curve } from "@/components/breakups/BreakupsProvider";
import type { GabbardMark } from "@/lib/breakups/gabbard";
import { pieceRows, survivalRows } from "@/lib/breakups/tables";

const th = "px-2 py-1 text-right font-normal text-ink-2";
const td = "px-2 py-1 text-right font-mono text-ink";

/** The selected event's numbers as tables: survival by year, then every piece. */
export function BreakupsTables({ curve, marks, names }: { curve: Curve; marks: GabbardMark[]; names: ReadonlyMap<number, string> }) {
  return (
    <div className="text-[12px]">
      <table className="w-full">
        <caption className="px-2 py-1 text-left text-ink">Survival by year</caption>
        <thead>
          <tr><th className={th}>Years since</th><th className={th}>In orbit</th><th className={th}>Share</th><th className={th}>Re-entered</th></tr>
        </thead>
        <tbody>
          {survivalRows(curve.s).map((r) => (
            <tr key={r.span}><td className={td}>{r.span}</td><td className={td}>{r.inOrbit}</td><td className={td}>{r.share}</td><td className={td}>{r.reentered}</td></tr>
          ))}
        </tbody>
      </table>
      <table className="mt-3 w-full">
        <caption className="px-2 py-1 text-left text-ink">Pieces</caption>
        <thead>
          <tr><th className={th}>NORAD</th><th className={th}>Name</th><th className={th}>Orbit</th><th className={th}>Period</th><th className={th}>Re-entered</th></tr>
        </thead>
        <tbody>
          {pieceRows(curve.e, marks, names).map((r) => (
            <tr key={r.noradId}><td className={td}>{r.noradId}</td><td className={td}>{r.name}</td><td className={td}>{r.orbit}</td><td className={td}>{r.period}</td><td className={td}>{r.reentered}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 5: Implement the view and mount it**

```tsx
// web/src/components/breakups/BreakupsView.tsx
"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { BreakupsMethodNote } from "@/components/breakups/BreakupsMethodNote";
import { useBreakups, useCurves } from "@/components/breakups/BreakupsProvider";
import { BreakupsTables } from "@/components/breakups/BreakupsTables";
import { EventList } from "@/components/breakups/EventList";
import { GabbardCanvas } from "@/components/breakups/GabbardCanvas";
import { SurvivalChart } from "@/components/breakups/SurvivalChart";
import { DataDisclosure } from "@/components/charts/ChartData";
import { retryButton } from "@/components/crowding/CrowdingPanel";
import { Unavailable } from "@/components/ui/Unavailable";
import { gabbardMarks, gabbardScale, type GabbardMark } from "@/lib/breakups/gabbard";
import { countLines, KIND_LABELS, plotNotes } from "@/lib/breakups/text";
import { fmtDate } from "@/lib/format";
import { nameCache } from "@/lib/names";
import { useExplorer } from "@/lib/store";
import { useIsMobile } from "@/lib/useIsMobile";

export function BreakupsView() {
  const open = useExplorer((s) => s.breakupsView);
  return open ? <BreakupsDialog /> : null;
}

/** The expanded breakups view: a non-modal dialog over the globe (desktop: to the right of the left
 * column; phone: the whole screen, with Survival and Gabbard tabs). */
function BreakupsDialog() {
  const setOpen = useExplorer((s) => s.setBreakupsView);
  const selected = useExplorer((s) => s.breakupEvent);
  const selectBreakup = useExplorer((s) => s.selectBreakup);
  const setHoverPiece = useExplorer((s) => s.setHoverPiece);
  const selectFromSearch = useExplorer((s) => s.selectFromSearch);
  const records = useExplorer((s) => s.globeRecords);
  const { status, file, retry } = useBreakups();
  const curves = useCurves(file);
  const sheet = useIsMobile();
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<Element | null>(null);
  const [tab, setTab] = useState<"survival" | "gabbard">("survival");
  const [names, setNames] = useState<ReadonlyMap<number, string>>(new Map());

  const current = curves.find((c) => c.e.id === selected) ?? null;
  const gabbard = useMemo(() => (current ? gabbardMarks(current.e, records) : null), [current, records]);
  const groups = useMemo(() => [...new Set(gabbard?.marks.map((m) => m.group) ?? [])], [gabbard]);

  useEffect(() => {
    opener.current = document.activeElement;
    heading.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all(groups.map((g) => nameCache.get(g))).then((maps) => {
      if (cancelled) return;
      const merged = new Map<number, string>();
      for (const m of maps) for (const [k, v] of m ?? []) merged.set(k, v);
      setNames(merged);
    }, () => {});
    return () => {
      cancelled = true;
    };
  }, [groups]);

  const close = () => {
    setOpen(false);
    const back = opener.current;
    requestAnimationFrame(() => {
      if (back instanceof HTMLElement && back.isConnected) back.focus();
      else document.querySelector<HTMLElement>("[data-breakups-expand]")?.focus();
    });
  };
  const pick = (m: GabbardMark) => {
    selectFromSearch({ norad_id: m.noradId, object_type: m.type, owner: m.owner, regime: m.group === "LEO" ? "LEO" : "MEO", decayed: false });
    setHoverPiece(null);
    close();
  };

  const showSurvival = !sheet || tab === "survival";
  const showGabbard = !sheet || tab === "gabbard";
  const scale = gabbard ? gabbardScale(gabbard.marks) : null;
  const notes = gabbard ? plotNotes(gabbard.notPlotted, scale?.offScale ?? gabbard.marks.length) : [];

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          close();
        }
      }}
      className={sheet
        ? "fixed inset-0 z-40 overflow-y-auto bg-[#080808] p-3"
        : "pointer-events-auto fixed bottom-4 left-[calc(var(--col-l)+2rem)] right-4 top-14 z-30 overflow-y-auto rounded-[16px] border-2 border-line bg-[#080808] p-4"}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 ref={heading} id={titleId} tabIndex={-1} className="font-mono text-[15px] text-ink outline-none">Breakup aftermath</h2>
        <button type="button" aria-label="Close breakups view" onClick={close} className="h-8 w-8 rounded-full border-2 border-line text-ink-2 hover:text-ink">✕</button>
      </div>

      {status === "empty" && <p className="mt-3 text-[13px] text-ink-2">Breakup data appears after the next catalog update.</p>}
      {status === "error" && (
        <div className="mt-3 flex items-center gap-3">
          <Unavailable what="breakups" />
          <button type="button" onClick={retry} className={retryButton}>Retry</button>
        </div>
      )}
      {status === "loading" && <p role="status" className="mt-3 text-[13px] text-ink-3">Loading…</p>}

      {file && (
        <div className={`mt-3 flex gap-4 ${sheet ? "flex-col" : "flex-row"}`}>
          <div className={sheet ? "" : "w-[300px] shrink-0"}>
            <EventList curves={curves} selected={selected} onSelect={selectBreakup} />
          </div>
          <div className="min-w-0 flex-1">
            {!current && <p className="text-[13px] text-ink-2">Pick an event to see its pieces.</p>}
            {current && (
              <>
                <h3 className="font-mono text-[14px] text-ink">{current.e.name}</h3>
                <p className="mt-1 text-[12px] text-ink-3">{fmtDate(current.e.event_date)} · {KIND_LABELS[current.e.kind]}</p>
                {current.e.description && <p className="mt-1 text-[13px] leading-snug text-ink-2">{current.e.description}</p>}
                {current.e.source_url && (
                  <a href={current.e.source_url} target="_blank" rel="noreferrer" className="text-[12px] text-ink-2 underline underline-offset-2 hover:text-ink">Source</a>
                )}
                <p className="mt-2 text-[12px] text-ink">{countLines(current.s).join(" · ")}</p>
              </>
            )}
            {sheet && (
              <div role="tablist" className="mt-3 inline-flex overflow-hidden rounded-full border-2 border-line text-[11px]">
                {(["survival", "gabbard"] as const).map((t) => (
                  <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                    className={`px-3 py-1 ${tab === t ? "bg-[#1d1d1d] text-ink" : "text-ink-3"}`}>
                    {t === "survival" ? "Survival" : "Gabbard"}
                  </button>
                ))}
              </div>
            )}
            {showSurvival && (
              <SurvivalChart curves={curves} selected={selected} onSelect={selectBreakup} width={sheet ? 340 : 560} height={sheet ? 200 : 240} />
            )}
            {showGabbard && current && (
              <div className="mt-3">
                <h3 className="text-[12px] text-ink">Gabbard diagram, today</h3>
                {!records.settled ? (
                  <p className="text-[12px] text-ink-3">Waiting for the globe</p>
                ) : (
                  gabbard && (
                    <GabbardCanvas marks={gabbard.marks} width={sheet ? 340 : 560} height={sheet ? 260 : 300} names={names}
                      onHover={setHoverPiece} onPick={pick} />
                  )
                )}
                {notes.map((n) => <p key={n} className="text-[12px] text-ink-3">{n}</p>)}
              </div>
            )}
            <BreakupsMethodNote />
            {current && gabbard && (
              <DataDisclosure which="breakups" label="Breakup data">
                <BreakupsTables curve={current} marks={gabbard.marks} names={names} />
              </DataDisclosure>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

In `web/src/app/page.tsx`, import `BreakupsView` and add `<BreakupsView />` right after `<CrowdingView />` (inside `<BreakupsProvider>`).

- [ ] **Step 6: Run all checks**

Run (from `web/`): `npx vitest run && npx tsc --noEmit && npx eslint src tests e2e scripts && npx playwright test`
Expected: all pass, including the four new view tests.

- [ ] **Step 7: Watch the view once**

Run (from `web/`): `npx playwright test -g "breakups" --headed` (the mocked API needs Playwright, so this is the way to see the view). Confirm: the selected curve is orange and drawn on top; apogee marks are orange triangles, perigee marks blue; hovering a mark dims the globe except one point; the dialog does not cover the left column on desktop.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/breakups web/src/app/page.tsx web/e2e/explorer.spec.ts
git commit -m "feat(web): breakup view with the Gabbard diagram, method note and data tables"
```

---

## Rollout (after all tasks, by the owner)

- One branch and PR from `feat/breakups`; the owner merges. API and jobs ship through the GitHub Actions deploy, the web through Vercel. The web shows "Breakup data appears after the next catalog update." while the API is behind.
- After deploy, run `publish-globe` once on the jobs Lambda, or wait for the next GP ingest (within 6 hours).
- Check that `https://kessler.kudayyurter.dev/api/globe/breakups` lists all 10 events and that each event's catalogued and in-orbit counts match `/api/events` (spec, Success criteria).
