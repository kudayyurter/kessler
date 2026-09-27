# Filters and Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every filter state is visible and reversible (Unknown type, any of 130 owners, a summary pill with Reset), charts say their scope (Owners ranks all owners and highlights the selected one), a search result always flies to its object or says why not, search matches spaces/hyphens/underscores alike, and every owner has a proper name.

**Architecture:** API: normalised name search, an optional `rank_of` on the owner breakdown, and an expanded owner seed file. Web: pure helpers (`filterSummary.ts`, `ownerPicker.ts`, `selection.ts`, chartData additions, `locate()` in flyTo.ts) with unit tests; store actions (`selectFromSearch`, `resetFilters`, `openPanel`, selection globe status, owner directory); UI components wired on top (OwnerPicker combobox, FilterSummary pill, chart scope lines and highlight, pending fly-to in GlobeScene, object card reason).

**Tech Stack:** FastAPI + psycopg 3 + pytest (API), Next.js 16 / React 19 / zustand 5 / React Three Fiber (web), vitest 5 (node env, `web/tests/unit/**/*.test.ts`), Playwright 1.63 (`web/e2e/`, mocked API).

**Spec:** `docs/superpowers/specs/2026-09-27-filters-and-selection-design.md`

## Global Constraints

- API checks from `api/`: `uv run pytest -q`, `uv run ruff check .` (never `ruff format`; added Python lines ≤ 100 chars). Tests need Docker (testcontainers Postgres).
- Web checks from `web/`: `npx vitest run`, `npx tsc --noEmit`, `npx eslint src tests e2e`, and for UI tasks `npx playwright test` (next dev on port 3100, reused if already running; every /api call mocked).
- Read `web/AGENTS.md` before writing web code (this Next.js has breaking changes). React Strict Mode is on.
- Type chip / legend order: Payload, Debris, Rocket body, Unknown (`["PAY", "DEB", "R/B", "UNK"]`); Unknown colour `CHART_COLORS.UNK`.
- Copy, exactly: orbits `Low Earth orbit` / `Higher orbits` / `All orbits`; owners `All owners` or `<flag> <name>`; types `all types` or `N of 4 types`; summary pill `Showing <orbits> · <owner> · <types>` + button `Reset` (accessible name `Reset filters`); History scope `<orbits> · <owner> · <types>`; Owners scope `All owners, ranked · <orbits> · <types>`; extra Owners row label `<owner> #<rank>` (`#—` when the owner has none under the filters).
- Object card reasons, exactly: `Re-entered on <fmtDate(decay_date)> — no current position.` · `Not shown on the globe: beyond Earth orbit or unknown orbit.` · `No current orbit data for this object.`
- Owner picker: "All owners", then a `Largest` group (8 owners by objects in orbit), then `All owners A–Z`; typing filters by name or code (case-insensitive substring), matches sorted by objects in orbit; owners with 0 in orbit dimmed but selectable; ARIA combobox.
- Default filters: Low Earth orbit only, all owners, all four types. The summary pill shows only when filters differ from the default.
- Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (an implementer may name its actual model instead). Never push or deploy.

## Review Focus

1. A search query made only of separators ("--", "_ _") must not match every object — pinned by `test_search_ignores_separator_only_queries` (Task 1).
2. A selected owner with no objects under the current filters (`rank_of` null) must still show its extra row with "—" and 0, not crash or vanish — pinned by `ownerHighlight` "an owner with none under the filters" (Task 3).
3. Pressing Enter in the owner picker when nothing matches must select nothing — pinned by `pickerOptions` "no match gives no options" (Task 3) and the component's `choose(undefined)` guard (Task 5).
4. A re-entered or beyond-Earth-orbit search result must not change the filters — pinned by `filtersToShow` "never changes filters for objects that aren't on the globe" (Task 4).
5. An object whose group failed to load (a hole in the locators) must stay "pending", never be reported "absent" — pinned by `locate` "a group that hasn't loaded keeps it pending" (Task 4).

For the reviewer's eye (not unit-testable in the node env): a new selection while a flight is in progress cancels that flight (GlobeScene); the summary pill wraps on narrow phones like the status pill.

---

### Task 1: API — normalised search and `rank_of`

**Files:**
- Modify: `api/app/services/objects.py` (`search_objects`), `api/app/services/stats.py` (`breakdown`), `api/app/api/routes.py` (`/stats/breakdown`)
- Test: `api/tests/test_services_objects.py`, `api/tests/test_services_stats.py`, `api/tests/test_api.py`

**Interfaces:**
- Produces: `GET /api/stats/breakdown?...&rank_of=<code>` → response gains `"rank_of": {"key", "rank", "counts", "total"} | null` (only when the parameter is given; rank is 1-based among all owners under the filters, computed before the top-N fold). `GET /api/objects/search?q=` treats runs of `-`, `_` and whitespace in names as one space.

- [ ] **Step 1: Write the failing tests**

In `api/tests/test_services_objects.py` (it already imports `insert_object` and `search_objects`), add:

```python
def test_search_treats_spaces_hyphens_and_underscores_alike(conn):
    insert_object(conn, 44713, name="STARLINK-1007")
    insert_object(conn, 44714, name="STARLINK-1008")
    for q in ("starlink 1007", "starlink-1007", "STARLINK_1007", "starlink  -  1007"):
        assert [o["norad_id"] for o in search_objects(conn, q)] == [44713], q


def test_search_ignores_separator_only_queries(world):
    assert search_objects(world, "--") == []
    assert search_objects(world, "_ _") == []
```

In `api/tests/test_services_stats.py` (it already imports `breakdown` and `ALL`), add:

```python
def test_breakdown_rank_of(world):
    r = breakdown(world, at_year=2008, by="owner", filters=ALL, top=1, rank_of="PRC")
    assert [row["key"] for row in r["rows"]] == ["US", "_other"]
    assert r["rank_of"] == {"key": "PRC", "rank": 2, "counts": {"DEB": 1}, "total": 1}
    none = breakdown(world, at_year=2008, by="owner", filters=ALL, rank_of="GER")
    assert none["rank_of"] is None
    assert "rank_of" not in breakdown(world, at_year=2008, by="owner", filters=ALL)
```

In `api/tests/test_api.py`, add (match the file's `client` fixture usage):

```python
def test_breakdown_rank_of_param(client):
    r = client.get("/api/stats/breakdown?by=owner&at=2008&rank_of=PRC")
    assert r.status_code == 200
    assert r.json()["rank_of"]["rank"] == 2
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd api && uv run pytest -q tests/test_services_objects.py tests/test_services_stats.py tests/test_api.py -k "alike or separator or rank_of"`
Expected: FAIL — the normalised queries return `[]`; `breakdown()` has no `rank_of` argument (TypeError); the API ignores `rank_of`.

- [ ] **Step 3: Implement the search normalisation**

In `api/app/services/objects.py`, add near the top (after the imports; `import re` if not imported):

```python
SEPARATORS = re.compile(r"[-_\s]+")


def normalise_name(text: str) -> str:
    """Runs of hyphens, underscores and whitespace become one space, so "starlink 1007",
    "starlink-1007" and "STARLINK_1007" all match STARLINK-1007."""
    return SEPARATORS.sub(" ", text).strip()
```

and replace the final `return conn.execute(...)` of `search_objects` with:

```python
    name_q = normalise_name(q)
    # A query of only separators normalises to nothing; don't let it match every name.
    name_clause = (
        "regexp_replace(name, '[-_[:space:]]+', ' ', 'g') ILIKE %(p)s ESCAPE '\\' OR "
        if len(name_q) >= 2
        else ""
    )
    return conn.execute(
        base
        + "WHERE "
        + name_clause
        + "cospar_id ILIKE %(c)s ESCAPE '\\' "
        "ORDER BY (decay_date IS NULL) DESC, norad_id LIMIT %(limit)s",
        {"p": f"%{escape_like(name_q)}%", "c": f"{escape_like(q.upper())}%", "limit": limit},
    ).fetchall()
```

- [ ] **Step 4: Implement `rank_of`**

In `api/app/services/stats.py`, change `breakdown`'s signature and body:

```python
def breakdown(
    conn: psycopg.Connection,
    *,
    at_year: int,
    by: str,
    filters: Filters,
    top: int = 8,
    rank_of: str | None = None,
) -> dict:
```

After `rows = sorted(...)` and before the `if by == "owner" and len(rows) > top:` fold, add:

```python
    # The requested key's rank among ALL keys (before the top-N fold), so the Owners chart can
    # show a selected owner outside the top rows with its rank.
    ranked = None
    if rank_of is not None:
        ranked = next(
            (
                {"key": row["key"], "rank": i + 1, "counts": row["counts"], "total": row["total"]}
                for i, row in enumerate(rows)
                if row["key"] == rank_of
            ),
            None,
        )
```

and replace the final `return {"at": at_year, "by": by, "rows": rows}` with:

```python
    out: dict = {"at": at_year, "by": by, "rows": rows}
    if rank_of is not None:
        out["rank_of"] = ranked
    return out
```

In `api/app/api/routes.py`, in `breakdown(...)` add the parameter after `top`:

```python
    rank_of: str | None = Query(None, max_length=16),
```

and pass it: `return stats.breakdown(conn, at_year=year, by=by, filters=filters, top=top, rank_of=rank_of)`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd api && uv run pytest -q && uv run ruff check .`
Expected: all pass (including the existing `test_search_treats_wildcards_literally`: "50%_" normalises to "50%" and still matches only "BETA R/B 50%_OFF").

- [ ] **Step 6: Commit**

```bash
git add api/app/services/objects.py api/app/services/stats.py api/app/api/routes.py api/tests/test_services_objects.py api/tests/test_services_stats.py api/tests/test_api.py
git commit -m "feat(api): search treats spaces, hyphens and underscores alike; breakdown rank_of

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: API — a proper name for every owner

**Files:**
- Modify: `api/app/seeds/owners.csv` (append 84 rows)
- Test: `api/tests/test_seeds.py` (create)

**Interfaces:**
- Produces: `owners.csv` with 131 rows (130 catalogue codes + the existing `UNK`), every name different from its code. `load_seeds` (run by the daily SATCAT ingest) upserts them — no code change.

- [ ] **Step 1: Write the failing test**

```python
# api/tests/test_seeds.py
import csv
import re

from app.seeds import SEED_DIR


def _owners() -> list[dict[str, str]]:
    with open(SEED_DIR / "owners.csv", newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def test_every_owner_has_a_proper_name():
    rows = _owners()
    codes = [r["code"] for r in rows]
    assert len(codes) == len(set(codes)) == 131
    assert all(r["name"].strip() and r["name"] != r["code"] for r in rows)
    assert {"ABS", "AC", "FGER", "SVK", "KWT", "JOR", "UGA", "VAT"} <= set(codes)


def test_owner_flags_use_two_letter_country_codes():
    for r in _owners():
        if r["country_iso"]:
            assert re.fullmatch(r"[A-Z]{2}", r["country_iso"]), r
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd api && uv run pytest -q tests/test_seeds.py`
Expected: FAIL — 47 rows, not 131; and the existing `SES,SES,` row has a name equal to its code.

- [ ] **Step 3: Name SES and append the rows**

Change the existing row `SES,SES,` to `SES,SES S.A.,` (the operator's legal name; "SES" alone reads as a code). Then append exactly these lines to `api/app/seeds/owners.csv` (names from CelesTrak's SATCAT source list, https://celestrak.org/satcat/sources.php, shortened to common names for countries; SVK, KWT, JOR, UGA added by hand; `country_iso` only for single countries):

```csv
EGYP,Egypt,EG
THAI,Thailand,TH
MALA,Malaysia,MY
SWED,Sweden,SE
PAKI,Pakistan,PK
POR,Portugal,PT
BEL,Belgium,BE
MEX,Mexico,MX
DEN,Denmark,DK
ABS,Asia Broadcast Satellite,
AC,AsiaSat (Asia Satellite Telecommunications),
ALG,Algeria,DZ
NATO,North Atlantic Treaty Organization,
CZCH,Czech Republic (former Czechoslovakia),CZ
RWA,Rwanda,RW
BUL,Bulgaria,BG
UKR,Ukraine,UA
KAZ,Kazakhstan,KZ
NIG,Nigeria,NG
HUN,Hungary,HU
CHLE,Chile,CL
VTNM,Vietnam,VN
ASRA,Austria,AT
BELA,Belarus,BY
AZER,Azerbaijan,AZ
MA,Morocco,MA
SAFR,South Africa,ZA
RP,Philippines,PH
VENZ,Venezuela,VE
LTU,Lithuania,LT
PERU,Peru,PE
SVK,Slovakia,SK
KWT,Kuwait,KW
SVN,Slovenia,SI
ANG,Angola,AO
ECU,Ecuador,EC
FGER,France/Germany,
FRIT,France/Italy,
RASC,RascomStar-QAF,
STCT,Singapore/Taiwan,
COL,Colombia,CO
BGD,Bangladesh,BD
DJI,Djibouti,DJ
EST,Estonia,EE
ROM,Romania,RO
BHR,Bahrain,BH
BOL,Bolivia,BO
BWA,Botswana,BW
ETH,Ethiopia,ET
GRSA,Greece/Saudi Arabia,
HRV,Croatia,HR
IRAQ,Iraq,IQ
JOR,Jordan,JO
LAOS,Laos,LA
MNE,Montenegro,ME
NICO,New ICO,
SLB,Solomon Islands,SB
TMMC,Turkmenistan/Monaco,
URY,Uruguay,UY
USBZ,United States/Brazil,
ESRO,European Space Research Organization,
KEN,Kenya,KE
SGJP,Singapore/Japan,
ZWE,Zimbabwe,ZW
ARM,Armenia,AM
BHUT,Bhutan,BT
CRI,Costa Rica,CR
GHA,Ghana,GH
GUAT,Guatemala,GT
IRL,Ireland,IE
LKA,Sri Lanka,LK
MCO,Monaco,MC
MDA,Moldova,MD
MMR,Myanmar,MM
MNG,Mongolia,MN
MUS,Mauritius,MU
NPL,Nepal,NP
PRY,Paraguay,PY
QAT,Qatar,QA
SDN,Sudan,SD
SEN,Senegal,SN
TUN,Tunisia,TN
UGA,Uganda,UG
VAT,Vatican City,VA
```

(Make sure the file ends with a newline and that the previous last line was newline-terminated.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd api && uv run pytest -q && uv run ruff check .`
Expected: all pass (other tests that call `load_seeds` still pass with the larger file).

- [ ] **Step 5: Commit**

```bash
git add api/app/seeds/owners.csv api/tests/test_seeds.py
git commit -m "feat(api): a proper name (and flag where it's a country) for every owner code

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Web — filter summary, owner picker and chart helpers (pure)

**Files:**
- Create: `web/src/lib/filterSummary.ts`, `web/src/lib/ownerPicker.ts`
- Modify: `web/src/lib/chartData.ts` (Unknown series, `ownerHighlight`), `web/src/lib/types.ts` (`RankedRow`, `BreakdownResponse.rank_of`)
- Test: `web/tests/unit/filterSummary.test.ts`, `web/tests/unit/ownerPicker.test.ts` (create), `web/tests/unit/chartData.test.ts` (extend)

**Interfaces:**
- Produces:
  - `filterSummary.ts`: `type Orbits = { leo: boolean; high: boolean }`; `interface FilterState { types: readonly ObjectType[]; owners: readonly string[]; orbits: Orbits }`; `isDefaultFilters(f)`, `orbitsText(o)`, `typesText(types)`, `ownerText(owners, list)`, `filterScope(f, list)`, `ownersChartScope(f)`.
  - `ownerPicker.ts`: `LARGEST = 8`; `ownerDisplay(o)`; `interface PickerOption { id: string; code: string | null; label: string; count: number | null; dim: boolean; heading?: string }`; `pickerOptions(list, query): PickerOption[]`.
  - `chartData.ts`: `visibleTypeSeries` now includes `UNK`; `TYPE_ORDER: ObjectType[]`; `interface ExtraRow { key: string; rank: number | null; counts: Partial<Record<ObjectType, number>>; total: number }`; `ownerHighlight(data: BreakdownResponse, selected: string | null): { highlight: string | null; extra: ExtraRow | null }`.
  - `types.ts`: `interface RankedRow extends BreakdownRow { rank: number }`; `BreakdownResponse` gains `rank_of?: RankedRow | null`.

- [ ] **Step 1: Write the failing tests**

```ts
// web/tests/unit/filterSummary.test.ts
import { describe, expect, it } from "vitest";
import { filterScope, isDefaultFilters, orbitsText, ownersChartScope, ownerText, typesText } from "@/lib/filterSummary";
import type { ObjectType, OwnerSummary } from "@/lib/types";

const ALL: ObjectType[] = ["PAY", "R/B", "DEB", "UNK"];
const US: OwnerSummary = { code: "US", name: "United States", flag_emoji: "🇺🇸", in_orbit: 10, total: 12 };
const ESA: OwnerSummary = { code: "ESA", name: "European Space Agency", flag_emoji: null, in_orbit: 3, total: 5 };
const LEO = { leo: true, high: false };

describe("filterSummary", () => {
  it("knows the default filters", () => {
    expect(isDefaultFilters({ types: ALL, owners: [], orbits: LEO })).toBe(true);
    expect(isDefaultFilters({ types: ALL, owners: [], orbits: { leo: true, high: true } })).toBe(false);
    expect(isDefaultFilters({ types: ALL, owners: ["US"], orbits: LEO })).toBe(false);
    expect(isDefaultFilters({ types: ["PAY"], owners: [], orbits: LEO })).toBe(false);
  });

  it("words the orbits", () => {
    expect(orbitsText(LEO)).toBe("Low Earth orbit");
    expect(orbitsText({ leo: false, high: true })).toBe("Higher orbits");
    expect(orbitsText({ leo: true, high: true })).toBe("All orbits");
  });

  it("counts the types out of four", () => {
    expect(typesText(ALL)).toBe("all types");
    expect(typesText(["PAY", "DEB", "R/B"])).toBe("3 of 4 types");
    expect(typesText(["UNK"])).toBe("1 of 4 types");
  });

  it("names the owner with its flag, or falls back to the code", () => {
    expect(ownerText([], [US])).toBe("All owners");
    expect(ownerText(["US"], [US])).toBe("🇺🇸 United States");
    expect(ownerText(["ESA"], [ESA])).toBe("European Space Agency");
    expect(ownerText(["XYZ"], [US])).toBe("XYZ");
  });

  it("builds the summary / History scope and the Owners scope", () => {
    const f = { types: ["PAY", "R/B", "UNK"] as ObjectType[], owners: ["US"], orbits: { leo: false, high: true } };
    expect(filterScope(f, [US])).toBe("Higher orbits · 🇺🇸 United States · 3 of 4 types");
    expect(filterScope({ types: ALL, owners: [], orbits: LEO }, [])).toBe("Low Earth orbit · All owners · all types");
    expect(ownersChartScope(f)).toBe("All owners, ranked · Higher orbits · 3 of 4 types");
  });
});
```

```ts
// web/tests/unit/ownerPicker.test.ts
import { describe, expect, it } from "vitest";
import { LARGEST, ownerDisplay, pickerOptions } from "@/lib/ownerPicker";
import type { OwnerSummary } from "@/lib/types";

const o = (code: string, name: string, in_orbit: number, flag: string | null = null): OwnerSummary =>
  ({ code, name, flag_emoji: flag, in_orbit, total: in_orbit + 1 });
const LIST: OwnerSummary[] = [
  o("GER", "Germany", 102, "🇩🇪"), o("FGER", "France/Germany", 2), o("US", "United States", 18485, "🇺🇸"),
  o("PRC", "China", 6178, "🇨🇳"), o("CIS", "Russia / former USSR", 6674, "🇷🇺"), o("UK", "United Kingdom", 725, "🇬🇧"),
  o("FR", "France", 647, "🇫🇷"), o("JPN", "Japan", 338, "🇯🇵"), o("IND", "India", 200, "🇮🇳"),
  o("TBD", "To be determined", 151), o("ABS", "Asia Broadcast Satellite", 8), o("ESRO", "European Space Research Organization", 0),
];

describe("ownerDisplay", () => {
  it("prefixes the flag when there is one", () => {
    expect(ownerDisplay(LIST[0])).toBe("🇩🇪 Germany");
    expect(ownerDisplay(LIST[1])).toBe("France/Germany");
  });
});

describe("pickerOptions", () => {
  it("lists All owners, then the 8 largest, then everyone A–Z", () => {
    const opts = pickerOptions(LIST, "");
    expect(opts[0]).toMatchObject({ code: null, label: "All owners", count: null });
    const largest = opts.slice(1, 1 + LARGEST);
    expect(largest.map((x) => x.code)).toEqual(["US", "CIS", "PRC", "UK", "FR", "JPN", "IND", "TBD"]);
    expect(largest[0].heading).toBe("Largest");
    const az = opts.slice(1 + LARGEST);
    expect(az).toHaveLength(LIST.length);
    expect(az[0]).toMatchObject({ heading: "All owners A–Z", label: "Asia Broadcast Satellite" });
    const byName = [...LIST].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
    expect(az.map((x) => x.code)).toEqual(byName.map((x) => x.code));
  });

  it("gives every option a unique id", () => {
    const ids = pickerOptions(LIST, "").map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("dims owners with nothing in orbit and shows counts", () => {
    const esro = pickerOptions(LIST, "esro")[0];
    expect(esro).toMatchObject({ code: "ESRO", count: 0, dim: true });
    expect(pickerOptions(LIST, "germany")[0]).toMatchObject({ code: "GER", count: 102, dim: false });
  });

  it("matches name or code, case-insensitively, largest first", () => {
    expect(pickerOptions(LIST, "ger").map((x) => x.code)).toEqual(["GER", "FGER"]);
    expect(pickerOptions(LIST, "PrC").map((x) => x.code)).toEqual(["PRC"]);
    expect(pickerOptions(LIST, "  china ").map((x) => x.code)).toEqual(["PRC"]);
  });

  it("no match gives no options", () => {
    expect(pickerOptions(LIST, "zzzz")).toEqual([]);
  });
});
```

Append to `web/tests/unit/chartData.test.ts` (keep its existing imports; add `ownerHighlight` and the types it needs):

```ts
import { ownerHighlight } from "@/lib/chartData";
import type { BreakdownResponse } from "@/lib/types";

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
    expect(ownerHighlight(bars(), null)).toEqual({ highlight: null, extra: null });
  });

  it("highlights a ranked row in place", () => {
    expect(ownerHighlight(bars(), "PRC")).toEqual({ highlight: "PRC", extra: null });
  });

  it("adds an extra row with the rank for an owner outside the ranked rows", () => {
    const r = ownerHighlight(bars({ rank_of: { key: "GER", rank: 9, counts: { PAY: 86 }, total: 86 } }), "GER");
    expect(r).toEqual({ highlight: "GER", extra: { key: "GER", rank: 9, counts: { PAY: 86 }, total: 86 } });
  });

  it("an owner with none under the filters gets an empty extra row", () => {
    expect(ownerHighlight(bars({ rank_of: null }), "GER")).toEqual({
      highlight: "GER", extra: { key: "GER", rank: null, counts: {}, total: 0 },
    });
  });
});
```

(If `chartData.test.ts` already has a test asserting that `visibleTypeSeries` returns only PAY/DEB/R/B, update it to the new order including UNK and say so in the report.)

- [ ] **Step 2: Run them to verify they fail**

Run: `cd web && npx vitest run tests/unit/filterSummary.test.ts tests/unit/ownerPicker.test.ts tests/unit/chartData.test.ts`
Expected: FAIL — the two new modules don't exist; `ownerHighlight` isn't exported; `visibleTypeSeries` drops UNK.

- [ ] **Step 3: Implement**

```ts
// web/src/lib/filterSummary.ts
import { OBJECT_TYPES, type ObjectType, type OwnerSummary } from "@/lib/types";

export type Orbits = { leo: boolean; high: boolean };
export interface FilterState {
  types: readonly ObjectType[];
  owners: readonly string[];
  orbits: Orbits;
}

/** Low Earth orbit only, all owners, all four types. */
export function isDefaultFilters(f: FilterState): boolean {
  return f.orbits.leo && !f.orbits.high && f.owners.length === 0 && f.types.length === OBJECT_TYPES.length;
}

export function orbitsText(o: Orbits): string {
  if (o.leo && o.high) return "All orbits";
  return o.leo ? "Low Earth orbit" : "Higher orbits";
}

export function typesText(types: readonly ObjectType[]): string {
  return types.length === OBJECT_TYPES.length ? "all types" : `${types.length} of ${OBJECT_TYPES.length} types`;
}

export function ownerText(owners: readonly string[], list: readonly OwnerSummary[]): string {
  if (owners.length === 0) return "All owners";
  const o = list.find((x) => x.code === owners[0]);
  return o ? `${o.flag_emoji ?? ""} ${o.name}`.trim() : owners[0];
}

/** "Higher orbits · 🇺🇸 United States · 3 of 4 types" — the summary pill and the History scope line. */
export function filterScope(f: FilterState, list: readonly OwnerSummary[]): string {
  return [orbitsText(f.orbits), ownerText(f.owners, list), typesText(f.types)].join(" · ");
}

/** The Owners chart ranks all owners, so its scope names no owner. */
export function ownersChartScope(f: FilterState): string {
  return ["All owners, ranked", orbitsText(f.orbits), typesText(f.types)].join(" · ");
}
```

```ts
// web/src/lib/ownerPicker.ts
import type { OwnerSummary } from "@/lib/types";

export const LARGEST = 8;

export interface PickerOption {
  id: string;
  code: string | null;
  label: string;
  count: number | null;
  dim: boolean;
  /** Group heading shown above this option (first option of a group only). */
  heading?: string;
}

export function ownerDisplay(o: OwnerSummary): string {
  return `${o.flag_emoji ?? ""} ${o.name}`.trim();
}

const byInOrbit = (a: OwnerSummary, b: OwnerSummary) => b.in_orbit - a.in_orbit || a.name.localeCompare(b.name);
const byName = (a: OwnerSummary, b: OwnerSummary) => a.name.localeCompare(b.name, "en", { sensitivity: "base" });

function option(o: OwnerSummary, group: string, heading?: string): PickerOption {
  return { id: `${group}-${o.code}`, code: o.code, label: ownerDisplay(o), count: o.in_orbit, dim: o.in_orbit === 0, heading };
}

/** The owner picker's options: with no query, "All owners", the largest owners, then everyone A–Z;
 * with a query, the owners whose name or code contains it (case-insensitive), largest first. */
export function pickerOptions(list: readonly OwnerSummary[], query: string): PickerOption[] {
  const q = query.trim().toLowerCase();
  if (q) {
    return list
      .filter((o) => o.name.toLowerCase().includes(q) || o.code.toLowerCase().includes(q))
      .sort(byInOrbit)
      .map((o) => option(o, "match"));
  }
  const largest = [...list].sort(byInOrbit).slice(0, LARGEST);
  const az = [...list].sort(byName);
  return [
    { id: "all", code: null, label: "All owners", count: null, dim: false },
    ...largest.map((o, i) => option(o, "largest", i === 0 ? "Largest" : undefined)),
    ...az.map((o, i) => option(o, "az", i === 0 ? "All owners A–Z" : undefined)),
  ];
}
```

In `web/src/lib/types.ts`, after `BreakdownRow`:

```ts
export interface RankedRow extends BreakdownRow { rank: number }
export interface BreakdownResponse { at: number; by: "owner" | "type" | "regime"; rows: BreakdownRow[]; rank_of?: RankedRow | null }
```

(replacing the existing `BreakdownResponse` line).

In `web/src/lib/chartData.ts`: replace `const SHOWN: ObjectType[] = ["PAY", "DEB", "R/B"];` with

```ts
/** Display order for type chips, legends, lines and stacks. */
export const TYPE_ORDER: ObjectType[] = ["PAY", "DEB", "R/B", "UNK"];
```

and use `TYPE_ORDER` in `visibleTypeSeries`. Add `BreakdownResponse` to the type import and append:

```ts
export interface ExtraRow {
  key: string;
  rank: number | null;
  counts: Partial<Record<ObjectType, number>>;
  total: number;
}

/** Which Owners row to highlight, and — when the selected owner isn't among the ranked rows — the
 * extra row to show under them (from the response's `rank_of`; empty when it has none). */
export function ownerHighlight(data: BreakdownResponse, selected: string | null): { highlight: string | null; extra: ExtraRow | null } {
  if (selected === null) return { highlight: null, extra: null };
  if (data.rows.some((r) => r.key === selected)) return { highlight: selected, extra: null };
  const r = data.rank_of;
  return {
    highlight: selected,
    extra: r ? { key: r.key, rank: r.rank, counts: r.counts, total: r.total } : { key: selected, rank: null, counts: {}, total: 0 },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run && npx tsc --noEmit && npx eslint src tests e2e`
Expected: all pass. (The LineChart now draws an Unknown line through `visibleTypeSeries`; tsc/eslint must still pass.)

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/filterSummary.ts web/src/lib/ownerPicker.ts web/src/lib/chartData.ts web/src/lib/types.ts web/tests/unit/filterSummary.test.ts web/tests/unit/ownerPicker.test.ts web/tests/unit/chartData.test.ts
git commit -m "feat(web): filter summary, owner picker and owner-highlight helpers; Unknown series

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Web — selection helpers, `locate()` and store actions

**Files:**
- Create: `web/src/lib/selection.ts`
- Modify: `web/src/components/globe/flyTo.ts` (`Found`, `Locator`, `locate` replacing `findPosition`), `web/src/lib/store.ts`
- Test: `web/tests/unit/selection.test.ts` (create), `web/tests/unit/flyTo.test.ts`, `web/tests/unit/store.test.ts`

**Interfaces:**
- Consumes: `FilterState`, `Orbits` from `@/lib/filterSummary` (Task 3).
- Produces:
  - `selection.ts`: `interface Findable { norad_id: number; object_type: ObjectType; owner: string; regime: Regime; decayed: boolean }` (a `SearchResult` satisfies it); `type GlobePresence = "pending" | "shown" | "absent"`; `filtersToShow(o: Findable, f: FilterState): { types?: ObjectType[]; owners?: string[]; orbits?: Orbits } | null`; `noPositionReason(o: { decay_date: string | null; regime: Regime }, presence: GlobePresence | null): string | null`.
  - `flyTo.ts`: `type Found = THREE.Vector3 | "pending" | "absent"`; `type Locator = (id: number) => Found`; `locate(locators: readonly (Locator | undefined)[], expected: readonly number[], id: number): Found`. `findPosition` is removed.
  - store: `selectionOnGlobe: GlobePresence | null` (`select(id)` sets `"pending"`, or `null` when clearing); `setSelectionOnGlobe(p: GlobePresence)`; `selectFromSearch(o: Findable)`; `resetFilters()`; `ownerDirectory: OwnerSummary[]` + `setOwnerDirectory(list)`; `panelRequest: { id: PanelId; n: number } | null` + `openPanel(id: PanelId)`.

- [ ] **Step 1: Write the failing tests**

```ts
// web/tests/unit/selection.test.ts
import { describe, expect, it } from "vitest";
import { fmtDate } from "@/lib/format";
import { filtersToShow, noPositionReason, type Findable } from "@/lib/selection";
import type { ObjectType } from "@/lib/types";

const ALL: ObjectType[] = ["PAY", "R/B", "DEB", "UNK"];
const DEFAULT = { types: ALL, owners: [] as string[], orbits: { leo: true, high: false } };
const obj = (over: Partial<Findable> = {}): Findable =>
  ({ norad_id: 1, object_type: "PAY", owner: "US", regime: "LEO", decayed: false, ...over });

describe("filtersToShow", () => {
  it("changes nothing when the object is already visible", () => {
    expect(filtersToShow(obj(), DEFAULT)).toBeNull();
  });

  it("turns on Higher orbits for MEO, GEO and HEO objects", () => {
    for (const regime of ["MEO", "GEO", "HEO"] as const) {
      expect(filtersToShow(obj({ regime }), DEFAULT)).toEqual({ orbits: { leo: true, high: true } });
    }
  });

  it("turns Low Earth orbit back on for a LEO object", () => {
    expect(filtersToShow(obj(), { ...DEFAULT, orbits: { leo: false, high: true } })).toEqual({ orbits: { leo: true, high: true } });
  });

  it("turns its type back on, keeping the canonical order", () => {
    expect(filtersToShow(obj({ object_type: "DEB" }), { ...DEFAULT, types: ["PAY", "UNK"] })).toEqual({ types: ["PAY", "DEB", "UNK"] });
  });

  it("clears an owner filter that would hide it, keeps one that matches", () => {
    expect(filtersToShow(obj({ owner: "PRC" }), { ...DEFAULT, owners: ["US"] })).toEqual({ owners: [] });
    expect(filtersToShow(obj({ owner: "US" }), { ...DEFAULT, owners: ["US"] })).toBeNull();
  });

  it("never changes filters for objects that aren't on the globe", () => {
    const hidden = { types: ["PAY"] as ObjectType[], owners: ["US"], orbits: { leo: false, high: true } };
    expect(filtersToShow(obj({ decayed: true, object_type: "DEB", owner: "PRC" }), hidden)).toBeNull();
    expect(filtersToShow(obj({ regime: "OTHER", object_type: "DEB" }), hidden)).toBeNull();
  });
});

describe("noPositionReason", () => {
  it("says the object re-entered", () => {
    expect(noPositionReason({ decay_date: "2024-03-08", regime: "LEO" }, "pending"))
      .toBe(`Re-entered on ${fmtDate("2024-03-08")} — no current position.`);
  });

  it("says objects beyond Earth orbit are not on the globe", () => {
    expect(noPositionReason({ decay_date: null, regime: "OTHER" }, "pending"))
      .toBe("Not shown on the globe: beyond Earth orbit or unknown orbit.");
  });

  it("says when its loaded group doesn't have it", () => {
    expect(noPositionReason({ decay_date: null, regime: "LEO" }, "absent")).toBe("No current orbit data for this object.");
  });

  it("says nothing while pending or once shown", () => {
    expect(noPositionReason({ decay_date: null, regime: "LEO" }, "pending")).toBeNull();
    expect(noPositionReason({ decay_date: null, regime: "GEO" }, "shown")).toBeNull();
  });
});
```

Replace the `findPosition` describe block in `web/tests/unit/flyTo.test.ts` (and its import) with:

```ts
import { locate, shortestAngle, type Locator } from "@/components/globe/flyTo";

describe("locate", () => {
  const at = new THREE.Vector3(1, 2, 3);
  const has = (id: number): Locator => (x) => (x === id ? at : "absent");
  const notYet = (id: number): Locator => (x) => (x === id ? "pending" : "absent");

  it("returns the position from whichever expected group has it", () => {
    expect(locate([has(5), has(9)], [0, 1], 9)).toBe(at);
  });

  it("waits while the object's group hasn't computed positions yet", () => {
    expect(locate([notYet(5)], [0], 5)).toBe("pending");
  });

  it("a group that hasn't loaded keeps it pending", () => {
    expect(locate([has(5), undefined], [0, 1], 9)).toBe("pending");
  });

  it("is absent only when every expected group is loaded and none has it", () => {
    expect(locate([has(5), has(6)], [0, 1], 9)).toBe("absent");
  });

  it("ignores groups that aren't expected", () => {
    expect(locate([has(5), has(9)], [0], 9)).toBe("absent");
  });
});
```

(Keep the `shortestAngle` tests and the `THREE` import.)

Append to `web/tests/unit/store.test.ts` (match its style; `useExplorer` is imported there):

```ts
describe("selection and filter actions", () => {
  it("marks a new selection pending and clears it with the selection", () => {
    useExplorer.getState().reset();
    useExplorer.getState().select(7);
    expect(useExplorer.getState().selectionOnGlobe).toBe("pending");
    useExplorer.getState().setSelectionOnGlobe("shown");
    expect(useExplorer.getState().selectionOnGlobe).toBe("shown");
    useExplorer.getState().select(null);
    expect(useExplorer.getState().selectionOnGlobe).toBeNull();
    useExplorer.getState().setSelectionOnGlobe("absent");
    expect(useExplorer.getState().selectionOnGlobe).toBeNull();
  });

  it("selectFromSearch shows the object first, then selects it", () => {
    useExplorer.getState().reset();
    useExplorer.getState().setOwners(["US"]);
    useExplorer.getState().selectFromSearch({ norad_id: 42, object_type: "PAY", owner: "PRC", regime: "GEO", decayed: false });
    const s = useExplorer.getState();
    expect(s.orbits).toEqual({ leo: true, high: true });
    expect(s.owners).toEqual([]);
    expect(s.selectedId).toBe(42);
    expect(s.selectionOnGlobe).toBe("pending");
  });

  it("resetFilters restores the default filters and keeps the selection", () => {
    useExplorer.getState().reset();
    useExplorer.getState().select(3);
    useExplorer.getState().toggleOrbit("high");
    useExplorer.getState().toggleType("DEB");
    useExplorer.getState().setOwners(["US"]);
    useExplorer.getState().resetFilters();
    const s = useExplorer.getState();
    expect(s.orbits).toEqual({ leo: true, high: false });
    expect(s.types).toEqual(["PAY", "R/B", "DEB", "UNK"]);
    expect(s.owners).toEqual([]);
    expect(s.selectedId).toBe(3);
  });

  it("openPanel shows the panel and bumps a request the sheet can follow", () => {
    useExplorer.getState().reset();
    useExplorer.getState().openPanel("filters");
    expect(useExplorer.getState().panels.filters).toBe(true);
    expect(useExplorer.getState().panelRequest).toEqual({ id: "filters", n: 1 });
    useExplorer.getState().openPanel("filters");
    expect(useExplorer.getState().panelRequest).toEqual({ id: "filters", n: 2 });
  });

  it("keeps the owner directory", () => {
    useExplorer.getState().reset();
    const list = [{ code: "US", name: "United States", flag_emoji: "🇺🇸", in_orbit: 1, total: 1 }];
    useExplorer.getState().setOwnerDirectory(list);
    expect(useExplorer.getState().ownerDirectory).toBe(list);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd web && npx vitest run tests/unit/selection.test.ts tests/unit/flyTo.test.ts tests/unit/store.test.ts`
Expected: FAIL — `@/lib/selection` missing, `locate` not exported, the store actions don't exist.

- [ ] **Step 3: Implement**

```ts
// web/src/lib/selection.ts
import type { FilterState, Orbits } from "@/lib/filterSummary";
import { fmtDate } from "@/lib/format";
import { OBJECT_TYPES, type ObjectType, type Regime } from "@/lib/types";

/** What selecting needs to know about an object — a search result has all of it. */
export interface Findable {
  norad_id: number;
  object_type: ObjectType;
  owner: string;
  regime: Regime;
  decayed: boolean;
}

/** Where the selected object stands on the globe: waiting for a position, flown to, or not in the
 * loaded data. */
export type GlobePresence = "pending" | "shown" | "absent";

/** The filter changes that make `o` visible on the globe, or null when none are needed — or none
 * would help (re-entered and beyond-Earth-orbit objects are never on the globe). */
export function filtersToShow(
  o: Findable,
  f: FilterState,
): { types?: ObjectType[]; owners?: string[]; orbits?: Orbits } | null {
  if (o.decayed || o.regime === "OTHER") return null;
  const changes: { types?: ObjectType[]; owners?: string[]; orbits?: Orbits } = {};
  const high = o.regime !== "LEO";
  if (high ? !f.orbits.high : !f.orbits.leo) changes.orbits = { ...f.orbits, [high ? "high" : "leo"]: true };
  if (!f.types.includes(o.object_type)) changes.types = OBJECT_TYPES.filter((t) => t === o.object_type || f.types.includes(t));
  if (f.owners.length > 0 && !f.owners.includes(o.owner)) changes.owners = [];
  return Object.keys(changes).length ? changes : null;
}

/** Why the object card's object has no position on the globe, or null when it has one (or may
 * still get one). */
export function noPositionReason(o: { decay_date: string | null; regime: Regime }, presence: GlobePresence | null): string | null {
  if (o.decay_date) return `Re-entered on ${fmtDate(o.decay_date)} — no current position.`;
  if (o.regime === "OTHER") return "Not shown on the globe: beyond Earth orbit or unknown orbit.";
  if (presence === "absent") return "No current orbit data for this object.";
  return null;
}
```

In `web/src/components/globe/flyTo.ts`, replace the `Locator` type and `findPosition` with:

```ts
/** A group's answer for one object: its position, "pending" (in this group's data but no
 * position computed yet), or "absent" (not in this group's data). */
export type Found = THREE.Vector3 | "pending" | "absent";
export type Locator = (id: number) => Found;

/**
 * Looks for an object across the groups expected to be loaded (by index, e.g. [0] for LEO or
 * [0, 1] for LEO and HIGH) in a sparse locator list, where a group that hasn't loaded (or failed)
 * leaves a hole. Returns the first position found; "absent" only when every expected group is
 * loaded and none has the object; otherwise "pending".
 */
export function locate(locators: readonly (Locator | undefined)[], expected: readonly number[], id: number): Found {
  let pending = false;
  for (const i of expected) {
    const find = locators[i];
    if (!find) {
      pending = true;
      continue;
    }
    const r = find(id);
    if (r instanceof THREE.Vector3) return r;
    if (r === "pending") pending = true;
  }
  return pending ? "pending" : "absent";
}
```

In `web/src/lib/store.ts`:

- Import: `import type { GlobePresence, Findable } from "@/lib/selection"; import { filtersToShow } from "@/lib/selection";` and `type OwnerSummary` from `@/lib/types`.
- Export the filter types: `export type Orbits = …` and `export type Filters = …` (change `type` to `export type`).
- Add to `ExplorerState` (with one-line comments in the file's style):

```ts
  // Where the selected object stands on the globe (see GlobeScene's pending fly-to); null when
  // nothing is selected.
  selectionOnGlobe: GlobePresence | null;
  // The owners list from /meta, for components outside the page's panel context (the summary
  // pill, chart scope lines) to name the selected owner.
  ownerDirectory: OwnerSummary[];
  // Bumped by openPanel so the phone sheet (MobileSheet) can switch to that tab.
  panelRequest: { id: PanelId; n: number } | null;
  setSelectionOnGlobe: (p: GlobePresence) => void;
  selectFromSearch: (o: Findable) => void;
  resetFilters: () => void;
  setOwnerDirectory: (list: OwnerSummary[]) => void;
  openPanel: (id: PanelId) => void;
```

- Add to `initial()`'s picked keys `"selectionOnGlobe" | "ownerDirectory" | "panelRequest"` and values `selectionOnGlobe: null, ownerDirectory: [], panelRequest: null,`.
- Change `create<ExplorerState>((set) => ({` to `create<ExplorerState>((set, get) => ({`.
- Replace `select` and add the new actions:

```ts
  select: (id) =>
    set((s) =>
      id === null
        ? { selectedId: null, selectionOnGlobe: null }
        : { selectedId: id, selectionOnGlobe: "pending", panels: { ...s.panels, search: true } },
    ),
  setSelectionOnGlobe: (p) => set((s) => (s.selectedId === null ? s : { selectionOnGlobe: p })),
  selectFromSearch: (o) => {
    const changes = filtersToShow(o, get());
    if (changes) set(changes);
    get().select(o.norad_id);
  },
  resetFilters: () => {
    const { types, owners, orbits } = initial();
    set({ types, owners, orbits });
  },
  setOwnerDirectory: (ownerDirectory) => set({ ownerDirectory }),
  openPanel: (id) =>
    set((s) => {
      const panels = { ...s.panels, [id]: true };
      saveVisibility(browserStorage(), panels);
      return { panels, panelRequest: { id, n: (s.panelRequest?.n ?? 0) + 1 } };
    }),
```

GlobeScene still imports `findPosition` until Task 7; to keep this task compiling, change GlobeScene's fly-to effect minimally now:

```ts
import { flyTo, locate, type Locator } from "@/components/globe/flyTo";
…
    const p = locate(locators.current, [0, 1], selectedId);
    if (!(p instanceof THREE.Vector3)) return;
```

and Objects' locator (in `Objects.tsx`, the `onReady` layout effect) to return the new `Found` values:

```ts
    onReady?.((noradId) => {
      const i = indexById.get(noradId);
      if (i === undefined) return "absent";
      const v = new THREE.Vector3();
      return interpolate(frames.current, simClock.now(), i, v) ? v : "pending";
    });
```

with `onReady?: (positionOf: Locator) => void;` in its props (import `type Locator` from `@/components/globe/flyTo`). Task 7 replaces the GlobeScene effect with the pending fly-to.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run && npx tsc --noEmit && npx eslint src tests e2e && npx playwright test`
Expected: all pass (the existing fly-to/labels e2e still passes).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/selection.ts web/src/components/globe/flyTo.ts web/src/lib/store.ts web/src/components/globe/GlobeScene.tsx web/src/components/globe/Objects.tsx web/tests/unit/selection.test.ts web/tests/unit/flyTo.test.ts web/tests/unit/store.test.ts
git commit -m "feat(web): selection helpers, locate() with pending/absent, store actions for search, reset and panels

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Web — Unknown chip, owner picker, summary pill

**Files:**
- Create: `web/src/components/panels/OwnerPicker.tsx`, `web/src/components/globe/FilterSummary.tsx`
- Modify: `web/src/components/panels/Filters.tsx`, `web/src/components/globe/GlobeSection.tsx`, `web/src/components/layout/MobileSheet.tsx`, `web/src/app/page.tsx` (owner directory)
- Test: `web/e2e/explorer.spec.ts`

**Interfaces:**
- Consumes: `pickerOptions`, `ownerDisplay`, `PickerOption` (Task 3); `filterScope`, `isDefaultFilters` (Task 3); store `ownerDirectory`, `setOwnerDirectory`, `resetFilters`, `openPanel`, `panelRequest` (Task 4).
- Produces: `<OwnerPicker id owners value onChange />`; `<FilterSummary />` (`data-testid="filter-summary"`).

- [ ] **Step 1: Write the failing e2e tests**

In `web/e2e/explorer.spec.ts`, add a helper after `fx`:

```ts
// The fixture /meta lists only US and PRC; tests of the owner picker add a few more owners.
function metaWithOwners(): string {
  const meta = JSON.parse(fx("api/meta.json").toString());
  meta.owners.push(
    { code: "GER", name: "Germany", flag_emoji: "🇩🇪", in_orbit: 102, total: 110 },
    { code: "FGER", name: "France/Germany", flag_emoji: null, in_orbit: 2, total: 2 },
  );
  return JSON.stringify(meta);
}
```

and append:

```ts
test("the Unknown chip filters the chart requests", async ({ page }) => {
  await mockApi(page);
  const typesParams: (string | null)[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname === "/api/stats/timeseries") typesParams.push(u.searchParams.get("types"));
  });
  await page.goto("/");
  await page.getByTestId("panel-dock").getByRole("button", { name: "Filters" }).click();
  await page.getByRole("button", { name: "Unknown", exact: true }).click();
  await expect.poll(() => typesParams.at(-1)).toBe("PAY,R/B,DEB");
  await expect(page.getByTestId("filter-summary")).toContainText("3 of 4 types");
});

test("the owner picker finds any owner by typing and filters History", async ({ page }) => {
  await mockApi(page, { "/meta": { status: 200, body: metaWithOwners() } });
  const ownersParams: (string | null)[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname === "/api/stats/timeseries") ownersParams.push(u.searchParams.get("owners"));
  });
  await page.goto("/");
  await page.getByTestId("panel-dock").getByRole("button", { name: "Filters" }).click();
  await page.getByLabel("Owner").fill("ger");
  await expect(page.getByRole("option")).toHaveCount(2);
  await page.getByRole("option", { name: /Germany/ }).first().click();
  await expect.poll(() => ownersParams.at(-1)).toBe("GER");
  await expect(page.getByLabel("Owner")).toHaveValue("🇩🇪 Germany");
  await expect(page.getByTestId("filter-summary")).toContainText("🇩🇪 Germany");
});

test("the filter summary appears when filters change and Reset restores the defaults", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.getByTestId("filter-summary")).toHaveCount(0);
  await page.getByTestId("panel-dock").getByRole("button", { name: "Filters" }).click();
  await page.getByRole("button", { name: "Higher orbits" }).click();
  const summary = page.getByTestId("filter-summary");
  await expect(summary).toContainText("Showing All orbits · All owners · all types");
  await summary.getByRole("button", { name: "Reset filters" }).click();
  await expect(summary).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Higher orbits" })).toHaveAttribute("aria-pressed", "false");
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd web && npx playwright test -g "Unknown chip|owner picker|filter summary"`
Expected: FAIL — no Unknown chip, no picker options, no summary pill.

- [ ] **Step 3: Owner picker**

```tsx
// web/src/components/panels/OwnerPicker.tsx
"use client";

import { Fragment, useId, useMemo, useState } from "react";
import { fmtInt } from "@/lib/format";
import { ownerDisplay, pickerOptions, type PickerOption } from "@/lib/ownerPicker";
import type { OwnerSummary } from "@/lib/types";

/** Type-to-filter owner picker (ARIA combobox): "All owners", the largest owners, then everyone
 * A–Z; typing narrows by name or code. Single selection; `value` is an owner code or null. */
export function OwnerPicker({
  id,
  owners,
  value,
  onChange,
}: {
  id: string;
  owners: readonly OwnerSummary[];
  value: string | null;
  onChange: (code: string | null) => void;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const options = useMemo(() => pickerOptions(owners, query), [owners, query]);
  const selected = value === null ? null : owners.find((o) => o.code === value) ?? null;
  const shown = open ? query : selected ? ownerDisplay(selected) : "";
  const optionId = (o: PickerOption) => `${listId}-${o.id}`;

  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const choose = (o: PickerOption | undefined) => {
    if (!o) return; // Enter with nothing matching selects nothing.
    onChange(o.code);
    close();
  };
  const move = (step: number) => {
    setOpen(true);
    setActive((a) => Math.min(Math.max(a + step, 0), Math.max(options.length - 1, 0)));
  };

  return (
    <div className="relative mt-2">
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? optionId(options[active]) : undefined}
        autoComplete="off"
        value={shown}
        placeholder="All owners"
        onFocus={() => {
          setOpen(true);
          setActive(0);
        }}
        onClick={() => setOpen(true)}
        onBlur={close}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            move(1);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            move(-1);
          } else if (e.key === "Enter" && open) {
            e.preventDefault();
            choose(options[active]);
          } else if (e.key === "Escape") {
            close();
          }
        }}
        className="w-full rounded-[10px] border-2 border-line bg-[#121212] px-3 py-2 text-sm text-ink placeholder:text-ink-3"
      />
      {open && (
        <ul id={listId} role="listbox" aria-label="Owners" className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-auto rounded-[10px] border-2 border-line bg-[#121212] py-1">
          {options.length === 0 && <li className="px-3 py-1.5 text-[13px] text-ink-3">No owners match</li>}
          {options.map((o, i) => (
            <Fragment key={o.id}>
              {o.heading && (
                <li role="presentation" className="px-3 pb-0.5 pt-2 text-[11px] tracking-wide text-ink-3">
                  {o.heading}
                </li>
              )}
              <li
                id={optionId(o)}
                role="option"
                aria-selected={o.code === value}
                // Keep focus in the input so its blur doesn't close the list before the click lands.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(o)}
                onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer justify-between gap-3 px-3 py-1.5 text-[13px] ${i === active ? "bg-[#1d1d1d]" : ""} ${o.dim ? "text-ink-3" : "text-ink"}`}
              >
                <span>{o.label}</span>
                {o.count !== null && <span className="font-mono text-[12px] text-ink-3">{fmtInt(o.count)}</span>}
              </li>
            </Fragment>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Filters panel**

Replace `web/src/components/panels/Filters.tsx`'s body so that: `TYPES` is `TYPE_ORDER` from `@/lib/chartData` (Payload, Debris, Rocket body, Unknown); the `<select>` and `topOwners` are replaced by the picker:

```tsx
      <label className="label mt-4 block" htmlFor="owner">Owner</label>
      <OwnerPicker id="owner" owners={meta?.owners ?? []} value={owners[0] ?? null} onChange={(code) => setOwners(code ? [code] : [])} />
```

(import `OwnerPicker` from `@/components/panels/OwnerPicker`; remove the unused imports).

- [ ] **Step 5: Summary pill, sheet tab, owner directory**

```tsx
// web/src/components/globe/FilterSummary.tsx
"use client";

import { filterScope, isDefaultFilters } from "@/lib/filterSummary";
import { useExplorer } from "@/lib/store";

/** "Showing Higher orbits · 🇺🇸 United States · 3 of 4 types" + Reset — only when the filters
 * differ from the default, so a hidden filter never makes the globe or charts look broken. */
export function FilterSummary() {
  const types = useExplorer((s) => s.types);
  const owners = useExplorer((s) => s.owners);
  const orbits = useExplorer((s) => s.orbits);
  const directory = useExplorer((s) => s.ownerDirectory);
  const resetFilters = useExplorer((s) => s.resetFilters);
  const openPanel = useExplorer((s) => s.openPanel);
  const f = { types, owners, orbits };
  if (isDefaultFilters(f)) return null;
  return (
    <div
      role="group"
      aria-label="Active filters"
      data-testid="filter-summary"
      className="label pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-full border-2 border-line bg-[#121212] px-3 py-2 !text-ink"
    >
      <button type="button" onClick={() => openPanel("filters")} className="text-center hover:underline">
        <span className="text-ink-3">Showing </span>
        {filterScope(f, directory)}
      </button>
      <button
        type="button"
        aria-label="Reset filters"
        onClick={resetFilters}
        className="min-h-6 whitespace-nowrap rounded-full border-2 border-line bg-[#1a1a1a] px-2 text-[11px] text-ink hover:bg-[#222]"
      >
        Reset
      </button>
    </div>
  );
}
```

In `GlobeSection.tsx`, wrap the pill(s) in the top bar so both sit together:

```tsx
        <div className="flex max-w-full flex-wrap items-center justify-center gap-2">
          {webgl === true && !broken && (
            <StatusPill input={{ groups: globe.groups, wanted, generatedAt: globe.generatedAt }} onRetry={globe.retry} />
          )}
          <FilterSummary />
        </div>
```

(keeping the existing "Hidden without WebGL" comment above the StatusPill; import `FilterSummary`).

In `MobileSheet.tsx`, follow `panelRequest` (after the existing selection effect):

```tsx
  const panelRequest = useExplorer((s) => s.panelRequest);
  useEffect(() => {
    if (!panelRequest) return;
    // Reacting to an external request (the filter summary's "open Filters"), same justification as
    // the selection effect above.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActive(panelRequest.id);
    setOpen(true);
  }, [panelRequest, setOpen]);
```

In `web/src/app/page.tsx`, publish the owners list once meta arrives:

```tsx
  const setOwnerDirectory = useExplorer((s) => s.setOwnerDirectory);
  useEffect(() => {
    if (meta.data) setOwnerDirectory(meta.data.owners);
  }, [meta.data, setOwnerDirectory]);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd web && npx vitest run && npx tsc --noEmit && npx eslint src tests e2e && npx playwright test`
Expected: all pass, including the viewport tests (no summary pill in the default state).

- [ ] **Step 7: Commit**

```bash
git add web/src/components/panels/OwnerPicker.tsx web/src/components/globe/FilterSummary.tsx web/src/components/panels/Filters.tsx web/src/components/globe/GlobeSection.tsx web/src/components/layout/MobileSheet.tsx web/src/app/page.tsx web/e2e/explorer.spec.ts
git commit -m "feat(web): Unknown type chip, type-to-filter owner picker, filter summary pill with Reset

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Web — chart scope lines, Unknown bars, owner highlight

**Files:**
- Modify: `web/src/components/charts/BarChart.tsx`, `web/src/components/panels/panelContent.tsx`, `web/src/app/page.tsx` (breakdown `rank_of`), `web/src/lib/api.ts` (`BreakdownQuery.rank_of`)
- Test: `web/e2e/explorer.spec.ts`, `web/tests/unit/api.test.ts`

**Interfaces:**
- Consumes: `ownerHighlight`, `ExtraRow`, `TYPE_ORDER` (Task 3); `filterScope`, `ownersChartScope` (Task 3); store `ownerDirectory` (Task 4).
- Produces: `<BarChart data owners selected />`; Owners rows carry `data-row="<key>"` and `data-highlight="true"` on the highlighted row; scope lines `data-testid="history-scope"` and `data-testid="owners-scope"`.

- [ ] **Step 1: Write the failing tests**

In `web/tests/unit/api.test.ts`, add (match its fetch-stub style):

```ts
it("adds rank_of to the breakdown request when given", async () => {
  const urls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (u: string) => {
    urls.push(u);
    return new Response(JSON.stringify({ at: 2026, by: "owner", rows: [] }), { status: 200 });
  }));
  await api.breakdown({ by: "owner", top: 5, rank_of: "GER" });
  await api.breakdown({ by: "owner", top: 5 });
  expect(new URL(urls[0], "http://x").searchParams.get("rank_of")).toBe("GER");
  expect(new URL(urls[1], "http://x").searchParams.has("rank_of")).toBe(false);
  vi.unstubAllGlobals();
});
```

(adapt imports/`vi` usage to the file's existing pattern).

Append to `web/e2e/explorer.spec.ts` (uses `metaWithOwners` from Task 5):

```ts
test("the Owners chart ranks all owners and highlights the selected one, with its rank when outside the top 5", async ({ page }) => {
  await mockApi(page, { "/meta": { status: 200, body: metaWithOwners() } });
  const breakdownOwners: (string | null)[] = [];
  await page.route("**/api/stats/breakdown**", async (route) => {
    const u = new URL(route.request().url());
    breakdownOwners.push(u.searchParams.get("owners"));
    const body = JSON.parse(fx("api/breakdown.json").toString());
    if (u.searchParams.get("rank_of") === "GER") body.rank_of = { key: "GER", rank: 9, counts: { PAY: 86 }, total: 86 };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/");
  await expect(page.getByTestId("owners-scope")).toHaveText("All owners, ranked · Low Earth orbit · all types");
  await expect(page.getByTestId("history-scope")).toHaveText("Low Earth orbit · All owners · all types");
  await page.getByTestId("panel-dock").getByRole("button", { name: "Filters" }).click();
  await page.getByLabel("Owner").fill("germany");
  await page.getByRole("option", { name: /^🇩🇪 Germany/ }).click();
  const row = page.locator('[data-row="GER"]');
  await expect(row).toContainText("#9");
  await expect(row).toHaveAttribute("data-highlight", "true");
  await expect(page.getByTestId("history-scope")).toHaveText("Low Earth orbit · 🇩🇪 Germany · all types");
  expect(breakdownOwners.every((o) => o === null)).toBe(true);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd web && npx vitest run tests/unit/api.test.ts && npx playwright test -g "Owners chart ranks"`
Expected: FAIL — `rank_of` is not a `BreakdownQuery` field (tsc) / not sent; no scope lines; no extra row.

- [ ] **Step 3: API client and page**

In `web/src/lib/api.ts`, add `rank_of?: string;` to `BreakdownQuery`. In `web/src/app/page.tsx`, the breakdown call becomes:

```ts
    api.breakdown({ by: "owner", types, regimes, top: 5, gen, rank_of: owners[0] })
```

(the breakdown never passes `owners` — the chart ranks all owners; `rank_of` only adds the selected owner's rank).

- [ ] **Step 4: Scope lines and the Owners panel**

In `web/src/components/panels/panelContent.tsx`, add two small components (they read the store, so they can't be plain render functions) and use them:

```tsx
function HistoryScope() {
  const types = useExplorer((s) => s.types);
  const owners = useExplorer((s) => s.owners);
  const orbits = useExplorer((s) => s.orbits);
  const directory = useExplorer((s) => s.ownerDirectory);
  return <p data-testid="history-scope" className="mt-1 text-[12px] text-ink-3">{filterScope({ types, owners, orbits }, directory)}</p>;
}

function OwnersChart({ c }: { c: PanelCtx }) {
  const types = useExplorer((s) => s.types);
  const orbits = useExplorer((s) => s.orbits);
  const selected = useExplorer((s) => s.owners[0] ?? null);
  return (
    <div>
      <h3 className="font-mono text-[16px] text-ink">Who owns what&apos;s up there</h3>
      <p data-testid="owners-scope" className="mt-1 text-[12px] text-ink-3">{ownersChartScope({ types, owners: [], orbits })}</p>
      <div className="mt-2">
        {c.bars.error ? <Unavailable what="owners" /> : c.bars.data && <BarChart data={c.bars.data} owners={c.meta.data?.owners ?? []} selected={selected} />}
      </div>
    </div>
  );
}
```

- `history`: after the subtitle `<p>`, add `<HistoryScope />`.
- `owners: (c) => <OwnersChart c={c} />`.
- Imports: `filterScope, ownersChartScope` from `@/lib/filterSummary`, `useExplorer` from `@/lib/store`.

- [ ] **Step 5: BarChart — Unknown, legend, highlight, extra row**

In `web/src/components/charts/BarChart.tsx`:

- `const KEYS: ObjectType[] = TYPE_ORDER;` (import `TYPE_ORDER, ownerHighlight` from `@/lib/chartData`).
- Props: `{ data, owners, selected = null }: { data: BreakdownResponse; owners: OwnerSummary[]; selected?: string | null }`.
- Rows and labels:

```ts
  const { highlight, extra } = ownerHighlight(data, selected);
  const ranked = data.rows.slice(0, 6);
  const rows = extra ? [...ranked, extra] : ranked;
  const labels = rows.map((r) =>
    extra && r === extra ? `${ownerLabel(r.key, owners)} #${extra.rank ?? "—"}` : ownerLabel(r.key, owners),
  );
```

- The band scale's domain stays `rows.map((r) => r.key)` (the extra row's key is never among the ranked keys — `ownerHighlight` only returns an extra row when it isn't).
- Above the `<svg>`, a legend (same markup as LineChart's):

```tsx
      <div className="mb-2 flex flex-wrap gap-4 text-[13px] text-ink-2">
        {KEYS.map((k) => (
          <span key={k} className="inline-flex items-center gap-2">
            <i className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: CHART_COLORS[k] }} />
            {TYPE_LABELS[k]}
          </span>
        ))}
      </div>
```

- Each row's `<g>` becomes `<g key={row.key} data-row={row.key} data-highlight={row.key === highlight ? "true" : undefined} opacity={highlight && row.key !== highlight ? 0.35 : 1}>`.
- Inside the highlighted row's `<g>`, before the value text, an outline around its bar:

```tsx
              {row.key === highlight && row.total > 0 && (
                <rect
                  x={marginLeft - 3}
                  y={(y(row.key) ?? 0) - 3}
                  width={x(row.total) - marginLeft + 6}
                  height={y.bandwidth() + 6}
                  rx={6}
                  fill="none"
                  stroke="#f4f4f2"
                  strokeWidth={2}
                  pointerEvents="none"
                />
              )}
```

- A dashed divider above the extra row, inside the `<svg>` after the rows map:

```tsx
        {extra && (
          <line
            x1={0}
            x2={width}
            y1={(y(extra.key) ?? 0) - (y.step() - y.bandwidth()) / 2}
            y2={(y(extra.key) ?? 0) - (y.step() - y.bandwidth()) / 2}
            stroke="#2a2a2a"
            strokeWidth={2}
            strokeDasharray="4 4"
          />
        )}
```

- The x-scale domain already uses `rows` (now including the extra row).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd web && npx vitest run && npx tsc --noEmit && npx eslint src tests e2e && npx playwright test`
Expected: all pass (existing "explorer renders…" still sees `path[data-series]` lines — now 4 if the fixture has UNK, otherwise 3; if the fixture's timeseries has no UNK series, the count stays 3).

- [ ] **Step 7: Commit**

```bash
git add web/src/components/charts/BarChart.tsx web/src/components/panels/panelContent.tsx web/src/app/page.tsx web/src/lib/api.ts web/tests/unit/api.test.ts web/e2e/explorer.spec.ts
git commit -m "feat(web): charts say their scope; Owners ranks all owners, shows Unknown and highlights the selected owner

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Web — search selection, pending fly-to, object card reason

**Files:**
- Modify: `web/src/components/globe/GlobeScene.tsx`, `web/src/components/panels/SearchBox.tsx`, `web/src/components/panels/ObjectCard.tsx`
- Test: `web/e2e/explorer.spec.ts`

**Interfaces:**
- Consumes: `locate`, `flyTo` (Task 4); store `selectFromSearch`, `selectionOnGlobe`, `setSelectionOnGlobe` (Task 4); `noPositionReason` (Task 4).
- Produces: the object card's reason line `data-testid="no-position"`.

- [ ] **Step 1: Write the failing e2e tests**

Add imports at the top of `web/e2e/explorer.spec.ts`: `import { gunzipSync, gzipSync } from "node:zlib";` (merge with an existing node:zlib import if Task 4 of piece 3 added one), and a helper after `fx`:

```ts
// The LEO fixture snapshot with its records' NORAD IDs rewritten (records start after the JSON
// header; each is 88 bytes with the NORAD ID as a little-endian uint32 at offset 0).
function snapshotWithIds(ids: number[]): Buffer {
  const raw = gunzipSync(fx("snapshot-leo.bin.gz"));
  const start = 8 + raw.readUInt32LE(4);
  ids.forEach((id, i) => raw.writeUInt32LE(id, start + i * 88));
  return gzipSync(raw);
}
```

Append:

```ts
test("selecting a higher-orbit search result turns on Higher orbits and flies to it", async ({ page }) => {
  await mockApi(page);
  const HIGH_ID = 99001;
  await page.route("**/api/globe/snapshot**", (route) =>
    new URL(route.request().url()).searchParams.get("group") === "HIGH"
      ? route.fulfill({ status: 200, body: snapshotWithIds([HIGH_ID, 99002]), contentType: "application/octet-stream" })
      : route.fallback(),
  );
  await page.route("**/api/globe/names**", (route) =>
    new URL(route.request().url()).searchParams.get("group") === "HIGH"
      ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ generated_at: "2026-09-23T12:00:00Z", names: { [HIGH_ID]: "TEST GEO", 99002: "OTHER GEO" } }) })
      : route.fallback(),
  );
  await page.route("**/api/objects/search**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ norad_id: HIGH_ID, name: "TEST GEO", cospar_id: "2020-001A", object_type: "PAY", owner: "US", regime: "GEO", decayed: false }]),
    }),
  );
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible();
  await page.getByLabel("Find an object").fill("test geo");
  await page.getByRole("button", { name: /TEST GEO/ }).click();
  await expect(page.getByTestId("filter-summary")).toContainText("All orbits");
  await expect(page.getByTestId("globe-labels").locator("button", { hasText: "TEST GEO" })).toBeVisible({ timeout: 15_000 });
});

test("a re-entered object's card says why it has no position", async ({ page }) => {
  await mockApi(page);
  const obj = JSON.parse(fx("api/object.json").toString());
  await page.route("**/api/objects/25544", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...obj, decay_date: "2024-03-08" }) }),
  );
  await page.route("**/api/objects/search**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ norad_id: 25544, name: "ISS (ZARYA)", cospar_id: "1998-067A", object_type: "PAY", owner: "ISS", regime: "LEO", decayed: true }]),
    }),
  );
  await page.goto("/");
  await page.getByLabel("Find an object").fill("iss");
  await page.getByRole("button", { name: /ISS \(ZARYA\)/ }).click();
  await expect(page.getByTestId("no-position")).toContainText("Re-entered on");
});

test("an object missing from its loaded group says there is no current orbit data", async ({ page }) => {
  await mockApi(page);
  const obj = JSON.parse(fx("api/object.json").toString());
  await page.route("**/api/objects/12345", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...obj, norad_id: 12345, decay_date: null, regime: "LEO" }) }),
  );
  await page.route("**/api/objects/search**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ norad_id: 12345, name: "LOST SAT", cospar_id: "2001-001A", object_type: "PAY", owner: "US", regime: "LEO", decayed: false }]),
    }),
  );
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible();
  await page.getByLabel("Find an object").fill("lost");
  await page.getByRole("button", { name: /LOST SAT/ }).click();
  await expect(page.getByTestId("no-position")).toHaveText("No current orbit data for this object.", { timeout: 15_000 });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd web && npx playwright test -g "higher-orbit search result|re-entered object|missing from its loaded group"`
Expected: FAIL — Higher orbits aren't turned on; no reason line.

- [ ] **Step 3: Search selects through `selectFromSearch`**

In `web/src/components/panels/SearchBox.tsx`: `const selectFromSearch = useExplorer((s) => s.selectFromSearch);` (replacing `select`), and the result button's `onClick={() => { selectFromSearch(r); setQ(""); }}`.

- [ ] **Step 4: Pending fly-to in GlobeScene**

In `web/src/components/globe/GlobeScene.tsx`, replace the `selectedId` fly-to `useEffect` (the one Task 4 adapted) with:

```tsx
  // Pending fly-to: every selection starts "pending" (see the store); each frame, look for the
  // object in the groups expected to be loaded and fly the moment it has a position — after Higher
  // orbits finish downloading, or the orbit worker's first frame. "absent" (its group loaded without
  // it) ends the wait; the object card then says why there's no position.
  const fly = useRef<{ cancel(): void } | null>(null);
  const resumeControls = useCallback(() => {
    const c = controls.current;
    if (!c) return;
    c.enabled = true;
    c.update();
  }, []);
  // A new selection (or clearing it) cancels a flight still in progress.
  useEffect(
    () => () => {
      if (!fly.current) return;
      fly.current.cancel();
      fly.current = null;
      resumeControls();
    },
    [selectedId, resumeControls],
  );
```

and at the start of the existing `useFrame` callback (after `simClock.tick();`):

```tsx
    const st = useExplorer.getState();
    if (st.selectedId !== null && st.selectionOnGlobe === "pending") {
      const found = locate(locators.current, st.orbits.high ? [0, 1] : [0], st.selectedId);
      if (found === "absent") {
        st.setSelectionOnGlobe("absent");
      } else if (found !== "pending") {
        st.setSelectionOnGlobe("shown");
        // OrbitControls and the tween both write camera.position; hand control to the tween, then
        // resync OrbitControls from wherever the camera ended up.
        if (controls.current) controls.current.enabled = false;
        fly.current = flyTo(camera, found, Math.max(1.35, found.length() + 0.45), () => {
          fly.current = null;
          resumeControls();
        });
      }
    }
```

Update the locators comment to say `locate` (not `findPosition`) skips holes.

- [ ] **Step 5: Object card reason**

In `web/src/components/panels/ObjectCard.tsx`: `const presence = useExplorer((s) => s.selectionOnGlobe);`, `const reason = obj ? noPositionReason(obj, presence) : null;`, and right after the `<h2>` row:

```tsx
      {reason && <p data-testid="no-position" className="mt-2 text-[13px] text-ink-2">{reason}</p>}
```

(import `noPositionReason` from `@/lib/selection`).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd web && npx vitest run && npx tsc --noEmit && npx eslint src tests e2e && npx playwright test`
Expected: all pass, including the existing "zooming in on a searched object shows name labels near the centre…" (ISS is LEO: no filter change, it flies as before).

- [ ] **Step 7: Commit**

```bash
git add web/src/components/globe/GlobeScene.tsx web/src/components/panels/SearchBox.tsx web/src/components/panels/ObjectCard.tsx web/e2e/explorer.spec.ts
git commit -m "feat(web): a search result shows its object first, flies when its position exists, or says why not

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
