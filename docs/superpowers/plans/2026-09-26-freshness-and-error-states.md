# Freshness and Error States Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open tabs pick up newly published orbit data by themselves, the globe's status pill tells the truth about data age and failures (with Retry), and search always says what it is doing.

**Architecture:** A framework-free controller (`createGlobeData`, a zustand vanilla store) owns globe data: first load from the published-generation pointer, per-group states, background checks every 10 minutes and on tab return, atomic swaps, retry. A thin React hook wires it into `GlobeSection`; a pure `deriveStatus` turns its state into the pill. `usePropagation` keeps the previous worker's positions on screen until a new generation's first frame. Search derives its state from a pure `searchView`.

**Tech Stack:** Next.js 16 (App Router, client components), React 19, zustand 5, React Three Fiber, vitest 5 (node environment, `tests/unit/**/*.test.ts`), Playwright 1.63 (`e2e/`, mocked API).

**Spec:** `docs/superpowers/specs/2026-09-26-freshness-and-error-states-design.md`

## Global Constraints

- All work is in `web/`. No API changes.
- Read `web/AGENTS.md` before writing code: this Next.js has breaking changes; check `node_modules/next/dist/docs/` for anything Next-specific you touch.
- Checks, from `web/`: `npx vitest run`, `npx tsc --noEmit`, `npx eslint src tests e2e`, `npx playwright test` (starts `next dev` on port 3100; the port must be free — if a dev server is already running there it is reused). Tasks 1–2 end with vitest, tsc and eslint green; Tasks 3–5 also with Playwright.
- Stale threshold: `STALE_AFTER_MS = 12 * 60 * 60 * 1000`. Check cadence: `CHECK_EVERY_MS = 10 * 60 * 1000`.
- Pill colours: green `#7fd06b`, amber `#e8b04a`, red `#e0604f`, grey `#a8a7a1`. Dots: `●` (green/amber/red), `○` (grey).
- Pill words, exactly: `LOADING ORBITS…`, `NO DATA YET`, `NO ORBIT DATA`, `LIVE`, `DELAYED`. Group labels: LEO → `low orbits`, HIGH → `higher orbits`.
- Search copy, exactly: `Type 2+ letters, or a NORAD number.` · `Searching…` · `N match` / `N matches` · `Showing the first 20 — type more to narrow it down` · `No matches for “<query>”.` + `Try a name (ISS), a NORAD number (25544) or a COSPAR ID (1998-067A).` · `Search is unavailable right now.` + `Retry`. (Curly quotes “ ” around the query; `…` is one character.)
- Search result cap: `SEARCH_LIMIT = 20` (the API default in `api/app/api/routes.py`).
- React Strict Mode is on (`web/next.config.*`: `reactStrictMode: true`): effects mount, unmount and mount again in development and in the e2e run.
- Commit messages end with a blank line and exactly:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01VPsSApUQwExwuTy7VzPMbH`
- Never push or deploy.

## Review Focus

1. React Strict Mode double-mounting `useGlobeData` (start → dispose → start) must end with data loaded once, and HIGH requested before the remount must still load — pinned by `createGlobeData` tests "dispose discards late results" and "a restart reloads every requested group" (Task 2).
2. A background check firing while the first load (or a retry) is still running must not fetch or swap — pinned by "no check while a group is loading" (Task 2).
3. Retry pressed twice quickly must request once — pinned by "retry twice requests once" (Task 2).
4. A publish time slightly in the future (visitor's clock behind) must read "just now", never a negative age — pinned by "a publish time in the future reads just now" (Task 1).
5. Clearing the search box (or typing on) while a request is in flight must never show the old query's results — pinned by `searchView` "an answer for another query is hidden" and "cleared box is idle even with an answer" (Task 5).

Not unit-testable in the node test environment and therefore for the reviewer's eye: `usePropagation`'s worker hand-over (Task 3) — superseded workers are terminated, the previous worker is terminated only when the new one takes over, and a terminated worker's late messages are ignored.

---

### Task 1: Pill status and age (pure)

**Files:**
- Create: `web/src/lib/freshness.ts`
- Test: `web/tests/unit/freshness.test.ts`

**Interfaces:**
- Consumes: nothing. (The two group type aliases are defined locally here; Task 2 replaces them with re-exports of its own identical types.)
- Produces:
  - `export const STALE_AFTER_MS: number`
  - `export const TONE_COLOR: Record<Tone, string>`
  - `export type Tone = "green" | "amber" | "red" | "grey"`
  - `export type PillGroup = "LEO" | "HIGH"`, `export type PillGroupStatus = "idle" | "loading" | "ready" | "missing" | "error"`
  - `export interface PillInput { groups: Record<PillGroup, { status: PillGroupStatus }>; wanted: PillGroup[]; generatedAt: number | null }`
  - `export interface PillStatus { tone: Tone; word: "LOADING ORBITS…" | "NO DATA YET" | "NO ORBIT DATA" | "LIVE" | "DELAYED"; note: string | null; age: string | null; retry: PillGroup[]; title: string | null }`
  - `export function formatAge(ms: number): string`
  - `export function deriveStatus(input: PillInput, now: number): PillStatus`

- [ ] **Step 1: Write the failing test**

```ts
// web/tests/unit/freshness.test.ts
import { describe, expect, it } from "vitest";
import { deriveStatus, formatAge, STALE_AFTER_MS, type PillGroup, type PillGroupStatus, type PillInput } from "@/lib/freshness";

const MIN = 60_000;
const H = 60 * MIN;
const T0 = Date.parse("2026-09-26T12:41:00Z");
const input = (
  leo: PillGroupStatus,
  high: PillGroupStatus,
  wanted: PillGroup[] = ["LEO"],
  generatedAt: number | null = T0,
): PillInput => ({ groups: { LEO: { status: leo }, HIGH: { status: high } }, wanted, generatedAt });

describe("formatAge", () => {
  it.each([
    [0, "just now"],
    [59_999, "just now"],
    [MIN, "1 min ago"],
    [59 * MIN, "59 min ago"],
    [H, "1h ago"],
    [47 * H + 59 * MIN, "47h ago"],
    [48 * H, "2d ago"],
    [80 * H, "3d ago"],
  ])("%d ms → %s", (ms, text) => {
    expect(formatAge(ms)).toBe(text);
  });
});

describe("deriveStatus", () => {
  it("shows loading before anything is ready", () => {
    expect(deriveStatus(input("loading", "idle"), T0)).toEqual({
      tone: "grey", word: "LOADING ORBITS…", note: null, age: null, retry: [], title: "Elements published 2026-09-26 12:41 UTC",
    });
  });

  it("counts an idle wanted group as loading", () => {
    expect(deriveStatus(input("idle", "idle", ["LEO"], null), T0)).toMatchObject({ tone: "grey", word: "LOADING ORBITS…", title: null });
  });

  it("says no data yet when nothing is published", () => {
    expect(deriveStatus(input("missing", "idle", ["LEO"], null), T0)).toMatchObject({ tone: "grey", word: "NO DATA YET", retry: [] });
  });

  it("says no orbit data, with Retry, when every wanted group failed", () => {
    expect(deriveStatus(input("error", "idle", ["LEO"], null), T0)).toMatchObject({ tone: "red", word: "NO ORBIT DATA", note: null, retry: ["LEO"] });
    expect(deriveStatus(input("error", "error", ["LEO", "HIGH"], null), T0).retry).toEqual(["LEO", "HIGH"]);
  });

  it("is LIVE with the age when fresh", () => {
    expect(deriveStatus(input("ready", "idle"), T0 + 2 * H)).toEqual({
      tone: "green", word: "LIVE", note: null, age: "2h ago", retry: [], title: "Elements published 2026-09-26 12:41 UTC",
    });
  });

  it("is still LIVE at exactly 12 hours and DELAYED after", () => {
    expect(deriveStatus(input("ready", "idle"), T0 + STALE_AFTER_MS)).toMatchObject({ tone: "green", word: "LIVE" });
    expect(deriveStatus(input("ready", "idle"), T0 + STALE_AFTER_MS + 1)).toMatchObject({ tone: "amber", word: "DELAYED", age: "12h ago" });
  });

  it("names a failed wanted group and offers Retry for it", () => {
    expect(deriveStatus(input("ready", "error", ["LEO", "HIGH"]), T0 + H)).toMatchObject({
      tone: "amber", word: "LIVE", note: "higher orbits failed", age: null, retry: ["HIGH"],
    });
  });

  it("ignores a failed group that is not wanted", () => {
    expect(deriveStatus(input("ready", "error", ["LEO"]), T0 + H)).toMatchObject({ tone: "green", word: "LIVE", age: "1h ago", retry: [] });
  });

  it("keeps DELAYED when stale and partial", () => {
    expect(deriveStatus(input("ready", "error", ["LEO", "HIGH"]), T0 + 14 * H)).toMatchObject({
      tone: "amber", word: "DELAYED", note: "higher orbits failed",
    });
  });

  it("says a wanted group is still loading", () => {
    expect(deriveStatus(input("ready", "loading", ["LEO", "HIGH"]), T0 + H)).toMatchObject({
      tone: "green", word: "LIVE", note: "loading higher orbits…", age: null,
    });
  });

  it("says a wanted group is not available when it was never published", () => {
    expect(deriveStatus(input("ready", "missing", ["LEO", "HIGH"]), T0 + H)).toMatchObject({
      tone: "amber", word: "LIVE", note: "higher orbits not available", retry: [],
    });
  });

  it("is NO ORBIT DATA when only higher orbits are wanted and they failed", () => {
    expect(deriveStatus(input("ready", "error", ["HIGH"]), T0 + H)).toMatchObject({ tone: "red", word: "NO ORBIT DATA", retry: ["HIGH"] });
  });

  it("names whichever wanted group failed", () => {
    expect(deriveStatus(input("ready", "error", ["LEO", "HIGH"]), T0).note).toBe("higher orbits failed");
    expect(deriveStatus(input("error", "ready", ["LEO", "HIGH"]), T0)).toMatchObject({ note: "low orbits failed", retry: ["LEO"] });
  });

  it("has no age or title before the publish time is known", () => {
    expect(deriveStatus(input("ready", "idle", ["LEO"], null), T0)).toMatchObject({ age: null, title: null, word: "LIVE", tone: "green" });
  });

  it("a publish time in the future reads just now", () => {
    expect(deriveStatus(input("ready", "idle"), T0 - 5 * MIN).age).toBe("just now");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run tests/unit/freshness.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/freshness"`.

- [ ] **Step 3: Write the implementation**

```ts
// web/src/lib/freshness.ts
/** The globe status pill's state, derived from the globe data (see createGlobeData) — pure, so
 * every row of the spec's table is unit-tested. */

export type Tone = "green" | "amber" | "red" | "grey";
export type PillGroup = "LEO" | "HIGH";
export type PillGroupStatus = "idle" | "loading" | "ready" | "missing" | "error";

export interface PillInput {
  groups: Record<PillGroup, { status: PillGroupStatus }>;
  /** The groups the orbit filter currently shows. */
  wanted: PillGroup[];
  /** When the shown data was published (ms since epoch), or null before any is shown. */
  generatedAt: number | null;
}

export interface PillStatus {
  tone: Tone;
  word: "LOADING ORBITS…" | "NO DATA YET" | "NO ORBIT DATA" | "LIVE" | "DELAYED";
  /** Replaces the age: a failure ("higher orbits failed") or progress ("loading higher orbits…"). */
  note: string | null;
  /** "2h ago" — the pill prefixes "updated " where there is room. */
  age: string | null;
  /** Groups the Retry button reloads; empty = no Retry. */
  retry: PillGroup[];
  /** Tooltip with the exact publish time. */
  title: string | null;
}

export const STALE_AFTER_MS = 12 * 60 * 60 * 1000;

export const TONE_COLOR: Record<Tone, string> = { green: "#7fd06b", amber: "#e8b04a", red: "#e0604f", grey: "#a8a7a1" };

const LABEL: Record<PillGroup, string> = { LEO: "low orbits", HIGH: "higher orbits" };
const names = (groups: PillGroup[]) => groups.map((g) => LABEL[g]).join(" and ");

export function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function deriveStatus(input: PillInput, now: number): PillStatus {
  const having = (match: (s: PillGroupStatus) => boolean) => input.wanted.filter((g) => match(input.groups[g].status));
  const ready = having((s) => s === "ready");
  const failed = having((s) => s === "error");
  const loading = having((s) => s === "loading" || s === "idle");
  const missing = having((s) => s === "missing");
  const title =
    input.generatedAt === null
      ? null
      : `Elements published ${new Date(input.generatedAt).toISOString().slice(0, 16).replace("T", " ")} UTC`;
  const base = { note: null, age: null, retry: [] as PillGroup[], title };

  if (ready.length === 0) {
    if (loading.length > 0) return { ...base, tone: "grey", word: "LOADING ORBITS…" };
    if (failed.length > 0) return { ...base, tone: "red", word: "NO ORBIT DATA", retry: failed };
    return { ...base, tone: "grey", word: "NO DATA YET" };
  }

  const stale = input.generatedAt !== null && now - input.generatedAt > STALE_AFTER_MS;
  const word = stale ? "DELAYED" : "LIVE";
  if (failed.length > 0) return { ...base, tone: "amber", word, note: `${names(failed)} failed`, retry: failed };
  if (missing.length > 0) return { ...base, tone: "amber", word, note: `${names(missing)} not available` };
  const tone: Tone = stale ? "amber" : "green";
  if (loading.length > 0) return { ...base, tone, word, note: `loading ${names(loading)}…` };
  return { ...base, tone, word, age: input.generatedAt === null ? null : formatAge(now - input.generatedAt) };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run tests/unit/freshness.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Full checks and commit**

Run: `cd web && npx vitest run && npx tsc --noEmit && npx eslint src tests e2e`
Expected: all pass (Playwright is unaffected by this task; run it at the end of Task 3 onwards).

```bash
git add web/src/lib/freshness.ts web/tests/unit/freshness.test.ts
git commit -m "feat(web): derive the globe status pill from data age and group states

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VPsSApUQwExwuTy7VzPMbH"
```

---

### Task 2: Globe data controller

**Files:**
- Create: `web/src/lib/globeData.ts`
- Test: `web/tests/unit/globeData.test.ts`

**Interfaces:**
- Consumes: `GlobeCurrent` (`web/src/lib/api.ts`), `OrbitRecord`, `SnapshotHeader` (`web/src/lib/snapshot.ts`).
- Produces:
  - `export type GroupName = "LEO" | "HIGH"`; `export type GroupStatus = "idle" | "loading" | "ready" | "missing" | "error"`
  - `export interface GroupState { status: GroupStatus; records: OrbitRecord[] | null }`
  - `export interface GlobeData { generation: string | undefined; generatedAt: number | null; version: number; groups: Record<GroupName, GroupState> }`
  - `export interface GlobeDataDeps { current(): Promise<GlobeCurrent | null>; snapshot(group, generation?): Promise<Uint8Array | null>; decode(gz): Promise<{ header: SnapshotHeader; records: OrbitRecord[] }>; setNamesGeneration(generation: string | undefined): void }`
  - `export interface PollEnv { isVisible(): boolean; onVisible(cb: () => void): () => void; everyMs?: number }`
  - `export const CHECK_EVERY_MS: number`
  - `export function createGlobeData(deps: GlobeDataDeps): { store: StoreApi<GlobeData>; start(): Promise<void>; want(g: GroupName): Promise<void>; retry(g: GroupName): Promise<void>; check(): Promise<void>; poll(env: PollEnv): () => void; dispose(): void }`

- [ ] **Step 1: Write the failing tests**

```ts
// web/tests/unit/globeData.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHECK_EVERY_MS, createGlobeData, type GlobeDataDeps } from "@/lib/globeData";
import type { OrbitRecord, SnapshotHeader } from "@/lib/snapshot";

const PUBLISHED: Record<string, string> = { g1: "2026-09-26T00:41:00+00:00", g2: "2026-09-26T06:41:00+00:00" };

/** Fake API. A snapshot's bytes are just "<generation>|<group>", which the fake decoder reads back:
 * LEO records are [1, gen-tag], HIGH records [2, gen-tag] (gen-tag 10 for g1, 20 for g2). */
function fakeApi() {
  let pointer: string | null | Error = "g1";
  const fail = new Set<string>(); // "HIGH" or "HIGH@g2": that snapshot request throws
  const missing = new Set<string>(); // "LEO": that snapshot 404s
  const serveAs = new Map<string, string>(); // "HIGH@g1" → "g2": the fallback served another generation
  let gate: Promise<void> | null = null; // while set, snapshot requests wait for it
  const calls: string[] = [];
  const names: (string | undefined)[] = [];
  const latest = () => (typeof pointer === "string" ? pointer : "g1");
  const deps: GlobeDataDeps = {
    current: async () => {
      calls.push("current");
      if (pointer instanceof Error) throw pointer;
      return pointer === null
        ? null
        : { generation: pointer, generated_at: PUBLISHED[pointer], groups: { LEO: { count: 2 }, HIGH: { count: 2 } } };
    },
    snapshot: async (group, generation) => {
      const key = `${group}@${generation ?? "-"}`;
      calls.push(key);
      if (gate) await gate;
      if (fail.has(group) || fail.has(key)) throw new Error("HTTP 503");
      if (missing.has(group)) return null;
      const gen = serveAs.get(key) ?? generation ?? latest();
      return new TextEncoder().encode(`${gen}|${group}`);
    },
    decode: async (gz) => {
      const [gen, group] = new TextDecoder().decode(gz).split("|");
      const records = [{ noradId: group === "LEO" ? 1 : 2 }, { noradId: gen === "g1" ? 10 : 20 }] as OrbitRecord[];
      return { header: { generated_at: PUBLISHED[gen] } as SnapshotHeader, records };
    },
    setNamesGeneration: (g) => names.push(g),
  };
  return {
    deps, calls, names, fail, missing, serveAs,
    setPointer: (p: string | null | Error) => { pointer = p; },
    hold: () => {
      let release!: () => void;
      gate = new Promise((r) => { release = r; });
      return () => { gate = null; release(); };
    },
  };
}

const settle = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};
const ids = (records: OrbitRecord[] | null) => records?.map((r) => r.noradId) ?? null;

afterEach(() => {
  vi.useRealTimers();
});

describe("createGlobeData", () => {
  it("first load: pointer, then LEO from that generation", async () => {
    const api = fakeApi();
    const ctl = createGlobeData(api.deps);
    await ctl.start();
    const s = ctl.store.getState();
    expect(s.generation).toBe("g1");
    expect(s.generatedAt).toBe(Date.parse(PUBLISHED.g1));
    expect(s.version).toBe(0);
    expect(s.groups.LEO).toEqual({ status: "ready", records: [{ noradId: 1 }, { noradId: 10 }] });
    expect(s.groups.HIGH.status).toBe("idle");
    expect(api.calls).toEqual(["current", "LEO@g1"]);
    expect(api.names).toEqual(["g1"]);
  });

  it("falls back to the un-versioned snapshot without a pointer", async () => {
    for (const p of [null, new Error("HTTP 500")]) {
      const api = fakeApi();
      api.setPointer(p);
      const ctl = createGlobeData(api.deps);
      await ctl.start();
      expect(ctl.store.getState().generation).toBeUndefined();
      expect(ctl.store.getState().groups.LEO.status).toBe("ready");
      expect(api.calls).toEqual(["current", "LEO@-"]);
    }
  });

  it("marks a group missing on 404 and failed on error", async () => {
    const a = fakeApi();
    a.missing.add("LEO");
    const ca = createGlobeData(a.deps);
    await ca.start();
    expect(ca.store.getState().groups.LEO).toEqual({ status: "missing", records: null });

    const b = fakeApi();
    b.fail.add("LEO");
    const cb = createGlobeData(b.deps);
    await cb.start();
    expect(cb.store.getState().groups.LEO.status).toBe("error");
  });

  it("loads HIGH from the shown generation, once", async () => {
    const api = fakeApi();
    const ctl = createGlobeData(api.deps);
    await ctl.start();
    await Promise.all([ctl.want("HIGH"), ctl.want("HIGH")]);
    expect(ctl.store.getState().groups.HIGH).toEqual({ status: "ready", records: [{ noradId: 2 }, { noradId: 10 }] });
    expect(api.calls.filter((c) => c.startsWith("HIGH"))).toEqual(["HIGH@g1"]);
  });

  it("retries a failed group", async () => {
    const api = fakeApi();
    api.fail.add("HIGH");
    const ctl = createGlobeData(api.deps);
    await ctl.start();
    await ctl.want("HIGH");
    expect(ctl.store.getState().groups.HIGH.status).toBe("error");
    api.fail.clear();
    await ctl.retry("HIGH");
    expect(ctl.store.getState().groups.HIGH.status).toBe("ready");
  });

  it("does nothing on retry unless the group failed", async () => {
    const api = fakeApi();
    const ctl = createGlobeData(api.deps);
    await ctl.start();
    await ctl.retry("LEO");
    expect(api.calls).toEqual(["current", "LEO@g1"]);
  });

  it("retry twice requests once", async () => {
    const api = fakeApi();
    api.fail.add("HIGH");
    const ctl = createGlobeData(api.deps);
    await ctl.start();
    await ctl.want("HIGH");
    api.fail.clear();
    await Promise.all([ctl.retry("HIGH"), ctl.retry("HIGH")]);
    expect(api.calls.filter((c) => c.startsWith("HIGH"))).toEqual(["HIGH@g1", "HIGH@g1"]);
  });

  it("re-runs the whole first load when nothing is shown yet", async () => {
    const api = fakeApi();
    api.setPointer(new Error("HTTP 500"));
    api.fail.add("LEO");
    const ctl = createGlobeData(api.deps);
    await ctl.start();
    expect(ctl.store.getState().groups.LEO.status).toBe("error");
    api.setPointer("g1");
    api.fail.clear();
    await ctl.retry("LEO");
    expect(ctl.store.getState().generation).toBe("g1");
    expect(ctl.store.getState().groups.LEO.status).toBe("ready");
    expect(api.calls).toEqual(["current", "LEO@-", "current", "LEO@g1"]);
  });

  it("check: same generation → nothing downloaded", async () => {
    const api = fakeApi();
    const ctl = createGlobeData(api.deps);
    await ctl.start();
    await ctl.check();
    expect(api.calls).toEqual(["current", "LEO@g1", "current"]);
    expect(ctl.store.getState().version).toBe(0);
  });

  it("check: a newer generation is downloaded and swapped in all at once", async () => {
    const api = fakeApi();
    const ctl = createGlobeData(api.deps);
    await ctl.start();
    await ctl.want("HIGH");
    api.setPointer("g2");
    await ctl.check();
    const s = ctl.store.getState();
    expect(s.generation).toBe("g2");
    expect(s.generatedAt).toBe(Date.parse(PUBLISHED.g2));
    expect(s.version).toBe(1);
    expect(ids(s.groups.LEO.records)).toEqual([1, 20]);
    expect(ids(s.groups.HIGH.records)).toEqual([2, 20]);
    expect(api.names).toEqual(["g1", "g2"]);
  });

  it("check: a failed background download keeps what is shown; the next check retries", async () => {
    const api = fakeApi();
    const ctl = createGlobeData(api.deps);
    await ctl.start();
    await ctl.want("HIGH");
    api.setPointer("g2");
    api.fail.add("HIGH@g2");
    await ctl.check();
    let s = ctl.store.getState();
    expect(s.generation).toBe("g1");
    expect(s.version).toBe(0);
    expect(ids(s.groups.LEO.records)).toEqual([1, 10]);
    expect(s.groups.HIGH.status).toBe("ready");
    api.fail.clear();
    await ctl.check();
    s = ctl.store.getState();
    expect(s.generation).toBe("g2");
    expect(s.version).toBe(1);
  });

  it("check: a failed pointer request changes nothing", async () => {
    const api = fakeApi();
    const ctl = createGlobeData(api.deps);
    await ctl.start();
    api.setPointer(new Error("HTTP 500"));
    await ctl.check();
    expect(ctl.store.getState().generation).toBe("g1");
  });

  it("runs one check at a time", async () => {
    const api = fakeApi();
    const ctl = createGlobeData(api.deps);
    await ctl.start();
    await Promise.all([ctl.check(), ctl.check()]);
    expect(api.calls.filter((c) => c === "current")).toHaveLength(2); // the first load's + one check
  });

  it("no check while a group is loading", async () => {
    const api = fakeApi();
    const ctl = createGlobeData(api.deps);
    const release = api.hold();
    const first = ctl.start();
    await settle(); // pointer read, LEO request waiting
    api.setPointer("g2");
    await ctl.check();
    expect(api.calls).toEqual(["current", "LEO@g1"]);
    release();
    await first;
    expect(ctl.store.getState().generation).toBe("g1");
    expect(ids(ctl.store.getState().groups.LEO.records)).toEqual([1, 10]);
  });

  it("re-aligns on the current generation when the fallback served a newer file", async () => {
    const api = fakeApi();
    const ctl = createGlobeData(api.deps);
    await ctl.start();
    api.setPointer("g2");
    api.serveAs.set("HIGH@g1", "g2"); // g1's HIGH file had passed retention
    await ctl.want("HIGH");
    await settle();
    const s = ctl.store.getState();
    expect(s.generation).toBe("g2");
    expect(s.version).toBe(1);
    expect(ids(s.groups.LEO.records)).toEqual([1, 20]);
  });

  it("dispose discards late results", async () => {
    const api = fakeApi();
    const ctl = createGlobeData(api.deps);
    const release = api.hold();
    void ctl.start();
    await settle();
    ctl.dispose();
    release();
    await settle();
    expect(ctl.store.getState().groups.LEO.status).toBe("loading");
  });

  it("a restart reloads every requested group (Strict Mode remount)", async () => {
    const api = fakeApi();
    const ctl = createGlobeData(api.deps);
    const release = api.hold();
    void ctl.start();
    void ctl.want("HIGH");
    await settle();
    ctl.dispose();
    release();
    await ctl.start();
    await ctl.want("HIGH"); // the remounted effect asks again: already requested
    await settle();
    const s = ctl.store.getState();
    expect(s.groups.LEO.status).toBe("ready");
    expect(s.groups.HIGH.status).toBe("ready");
  });

  it("polls every 10 minutes while visible, and when the tab becomes visible", async () => {
    vi.useFakeTimers();
    const api = fakeApi();
    const ctl = createGlobeData(api.deps);
    await ctl.start();
    let visible = true;
    // A holder object, not a `let`: TypeScript doesn't track assignments made inside callbacks.
    const hooks: { onVisible: (() => void) | null } = { onVisible: null };
    const stop = ctl.poll({
      isVisible: () => visible,
      onVisible: (cb) => {
        hooks.onVisible = cb;
        return () => { hooks.onVisible = null; };
      },
    });
    const checks = () => api.calls.filter((c) => c === "current").length - 1;
    vi.advanceTimersByTime(CHECK_EVERY_MS - 1);
    expect(checks()).toBe(0);
    vi.advanceTimersByTime(1);
    await settle();
    expect(checks()).toBe(1);
    visible = false;
    vi.advanceTimersByTime(CHECK_EVERY_MS);
    await settle();
    expect(checks()).toBe(1);
    visible = true;
    hooks.onVisible?.();
    await settle();
    expect(checks()).toBe(2);
    stop();
    expect(hooks.onVisible).toBeNull();
    vi.advanceTimersByTime(3 * CHECK_EVERY_MS);
    await settle();
    expect(checks()).toBe(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run tests/unit/globeData.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/globeData"`.

- [ ] **Step 3: Write the implementation**

```ts
// web/src/lib/globeData.ts
import { createStore, type StoreApi } from "zustand/vanilla";
import type { GlobeCurrent } from "@/lib/api";
import type { OrbitRecord, SnapshotHeader } from "@/lib/snapshot";

export type GroupName = "LEO" | "HIGH";
export type GroupStatus = "idle" | "loading" | "ready" | "missing" | "error";

export interface GroupState {
  status: GroupStatus;
  records: OrbitRecord[] | null;
}

export interface GlobeData {
  /** The shown generation; undefined when served from the un-versioned fallback. */
  generation: string | undefined;
  /** When the shown data was published (ms since epoch), from the snapshot header. */
  generatedAt: number | null;
  /** Increments whenever a newer generation is swapped in. */
  version: number;
  groups: Record<GroupName, GroupState>;
}

export interface GlobeDataDeps {
  current: () => Promise<GlobeCurrent | null>;
  snapshot: (group: GroupName, generation?: string) => Promise<Uint8Array | null>;
  decode: (gz: Uint8Array) => Promise<{ header: SnapshotHeader; records: OrbitRecord[] }>;
  setNamesGeneration: (generation: string | undefined) => void;
}

export interface PollEnv {
  isVisible: () => boolean;
  /** Subscribes to "the tab became visible"; returns an unsubscribe function. */
  onVisible: (cb: () => void) => () => void;
  everyMs?: number;
}

export const CHECK_EVERY_MS = 10 * 60 * 1000;

const GROUPS: GroupName[] = ["LEO", "HIGH"];

const initial = (): GlobeData => ({
  generation: undefined,
  generatedAt: null,
  version: 0,
  groups: { LEO: { status: "idle", records: null }, HIGH: { status: "idle", records: null } },
});

type Loaded = { records: OrbitRecord[]; generatedAt: number };

/** Globe data for one page: the first load from the published-generation pointer, per-group
 * states, background checks for a newer generation (swapped in only once every requested group
 * has downloaded), and retry. Framework-free so it is unit-tested; useGlobeData wires it to React. */
export function createGlobeData(deps: GlobeDataDeps) {
  const store: StoreApi<GlobeData> = createStore<GlobeData>(initial);
  // Groups the page has asked for: LEO always, HIGH once the Higher orbits filter was on.
  const requested = new Set<GroupName>(["LEO"]);
  // Bumped by start() and dispose(): async work from an older epoch never writes state.
  let epoch = 0;
  let pointerReady: Promise<void> = Promise.resolve();
  let checking: Promise<void> | null = null;

  const setGroup = (g: GroupName, patch: Partial<GroupState>) =>
    store.setState((s) => ({ groups: { ...s.groups, [g]: { ...s.groups[g], ...patch } } }));

  async function fetchGroup(g: GroupName, generation: string | undefined): Promise<Loaded | null> {
    const gz = await deps.snapshot(g, generation);
    if (!gz) return null;
    const { header, records } = await deps.decode(gz);
    return { records, generatedAt: Date.parse(header.generated_at) };
  }

  /** Loads one group from the shown generation. */
  async function loadGroup(g: GroupName, e: number): Promise<void> {
    const { generation, version } = store.getState();
    setGroup(g, { status: "loading" });
    let loaded: Loaded | null;
    try {
      loaded = await fetchGroup(g, generation);
    } catch {
      if (e === epoch && store.getState().version === version) setGroup(g, { status: "error" });
      return;
    }
    // Disposed/restarted, or a newer generation was swapped in meanwhile: this result is out of date.
    if (e !== epoch || store.getState().version !== version) return;
    if (!loaded) {
      setGroup(g, { status: "missing", records: null });
      return;
    }
    const got = loaded;
    const shownAt = store.getState().generatedAt;
    store.setState((s) => ({
      generatedAt: s.generatedAt ?? got.generatedAt,
      groups: { ...s.groups, [g]: { status: "ready", records: got.records } },
    }));
    // The shown generation's file had passed its retention and the un-versioned fallback served a
    // newer one: re-align every group on the current generation.
    if (shownAt !== null && got.generatedAt !== shownAt) void check();
  }

  /** The first load (and a restart): pointer, then every requested group from its generation. */
  async function start(): Promise<void> {
    const e = ++epoch;
    store.setState(initial());
    for (const g of requested) setGroup(g, { status: "loading" });
    pointerReady = (async () => {
      const pointer = await deps.current().catch(() => null);
      if (e !== epoch) return;
      deps.setNamesGeneration(pointer?.generation);
      store.setState({ generation: pointer?.generation });
    })();
    await pointerReady;
    if (e !== epoch) return;
    await Promise.all([...requested].map((g) => loadGroup(g, e)));
  }

  /** Asks for a group (HIGH when the Higher orbits filter is first turned on). */
  async function want(g: GroupName): Promise<void> {
    if (requested.has(g)) return;
    requested.add(g);
    const e = epoch;
    setGroup(g, { status: "loading" });
    await pointerReady;
    if (e !== epoch) return;
    await loadGroup(g, e);
  }

  async function retry(g: GroupName): Promise<void> {
    const s = store.getState();
    if (s.groups[g].status !== "error") return;
    // Nothing on screen yet: redo the whole first load, pointer included.
    if (s.generatedAt === null) return start();
    await loadGroup(g, epoch);
  }

  /** Looks for a newer generation; downloads every requested group of it in the background and
   * swaps them in together. Any failure keeps what is shown — the next check tries again. */
  function check(): Promise<void> {
    if (checking) return checking;
    const s0 = store.getState();
    // A first load or retry is still running; the next check looks again.
    if (GROUPS.some((g) => s0.groups[g].status === "loading")) return Promise.resolve();
    const e = epoch;
    const run = (async () => {
      try {
        const pointer = await deps.current();
        if (e !== epoch || !pointer || pointer.generation === store.getState().generation) return;
        const groups = [...requested];
        const loaded = await Promise.all(groups.map((g) => fetchGroup(g, pointer.generation)));
        if (e !== epoch || loaded.some((l) => l === null)) return;
        const got = loaded as Loaded[];
        deps.setNamesGeneration(pointer.generation);
        store.setState((cur) => {
          const next = { ...cur.groups };
          groups.forEach((g, i) => {
            next[g] = { status: "ready", records: got[i].records };
          });
          return { generation: pointer.generation, generatedAt: got[0].generatedAt, version: cur.version + 1, groups: next };
        });
      } catch {
        // Keep what is shown.
      }
    })();
    checking = run.finally(() => {
      checking = null;
    });
    return checking;
  }

  /** Checks every `everyMs` while visible, and whenever the tab becomes visible. Returns stop(). */
  function poll(env: PollEnv): () => void {
    const timer = setInterval(() => {
      if (env.isVisible()) void check();
    }, env.everyMs ?? CHECK_EVERY_MS);
    const off = env.onVisible(() => void check());
    return () => {
      clearInterval(timer);
      off();
    };
  }

  function dispose(): void {
    epoch++;
  }

  return { store, start, want, retry, check, poll, dispose };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run tests/unit/globeData.test.ts`
Expected: PASS (all tests). If "retry twice requests once" shows three HIGH calls, the second `retry` did not see the `loading` status set synchronously by `loadGroup` — `setGroup(g, { status: "loading" })` must run before `loadGroup`'s first `await`.

- [ ] **Step 5: Make `freshness.ts` use the shared group types**

In `web/src/lib/freshness.ts`, replace the two local aliases with re-exports of Task 2's types, so there is one definition:

```ts
import type { GroupName, GroupStatus } from "@/lib/globeData";

export type PillGroup = GroupName;
export type PillGroupStatus = GroupStatus;
```

(delete the lines `export type PillGroup = "LEO" | "HIGH";` and `export type PillGroupStatus = "idle" | "loading" | "ready" | "missing" | "error";`).

- [ ] **Step 6: Full checks and commit**

Run: `cd web && npx vitest run && npx tsc --noEmit && npx eslint src tests e2e`
Expected: all pass.

```bash
git add web/src/lib/globeData.ts web/src/lib/freshness.ts web/tests/unit/globeData.test.ts
git commit -m "feat(web): globe data controller — first load, per-group states, background checks, retry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VPsSApUQwExwuTy7VzPMbH"
```

---

### Task 3: No blink when new orbits arrive

**Files:**
- Modify: `web/src/components/globe/usePropagation.ts` (whole file, below)
- Modify: `web/src/components/globe/Objects.tsx` (use the records the on-screen frames belong to)

**Interfaces:**
- Consumes: nothing new.
- Produces: `usePropagation(records, active)` now returns `{ frames, requestPath, shown }`, where `shown: OrbitRecord[] | null` is the records array the current `frames` belong to (the previous records until the new worker's first frame).

There is no unit test for this task: the hook needs React and a Web Worker, and the unit tests run in node. It is verified by the existing Playwright suite (globe renders, fly-to labels) now and by Task 4's "newly published generation" e2e test. The reviewer checks the worker hand-over by reading (see Review Focus).

- [ ] **Step 1: Replace `usePropagation.ts`**

```ts
// web/src/components/globe/usePropagation.ts
"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { simClock } from "@/lib/clock";
import type { OrbitRecord } from "@/lib/snapshot";
import type { WorkerIn, WorkerOut } from "@/workers/propagate.worker";

export type PropagationFrames = {
  current: { prev: Float32Array | null; next: Float32Array | null; prevTime: number; nextTime: number };
};
type Frames = PropagationFrames["current"];
const emptyFrames = (): Frames => ({ prev: null, next: null, prevTime: 0, nextTime: 0 });

const TICK_MS = 100;

/** Asks the worker for an object's orbit path (see WorkerIn "path"); resolves null if the worker went away. */
export type RequestPath = (index: number, centerMs: number, steps: number) => Promise<Float32Array | null>;

/** A worker whose first frame has arrived, waiting (for React to render its records) to take over the screen. */
type Staged = { records: OrbitRecord[]; frames: Frames; request: () => void; path: RequestPath; retire: () => void };

/** Keeps the latest two position frames from the worker. Renderers interpolate between them
 * at simClock.now(). `active` (default true) pauses the tick interval — without tearing down
 * the worker or losing the last two frames — while the globe is offscreen or the tab is
 * backgrounded, so an invisible globe doesn't keep propagating orbits nobody is rendering.
 *
 * New `records` (a newly published generation) get their own worker. The previous worker keeps the
 * screen — `shown` stays its records and `frames` its positions — until the new worker's first
 * frame, so objects never vanish during a swap. Renderers must build from `shown`, not `records`:
 * frame indices belong to `shown`. */
export function usePropagation(
  records: OrbitRecord[] | null,
  active = true,
): { frames: PropagationFrames; requestPath: RequestPath; shown: OrbitRecord[] | null } {
  const frames = useRef<Frames>(emptyFrames());
  const requestRef = useRef<() => void>(() => {});
  const pathRef = useRef<RequestPath>(async () => null);
  const retireLive = useRef<(() => void) | null>(null);
  const staged = useRef<Staged | null>(null);
  // A fresh object per hand-over so React re-renders even if the same array comes back.
  const [shown, setShown] = useState<{ records: OrbitRecord[] } | null>(null);

  useEffect(() => {
    if (!records || records.length === 0) return;
    const worker = new Worker(new URL("../../workers/propagate.worker.ts", import.meta.url), { type: "module" });
    let id = 0;
    let waiting = false;
    let promoted = false;
    let retired = false;
    const pendingPaths = new Map<number, (p: Float32Array | null) => void>();
    let pathId = 0;
    const request = () => {
      if (waiting || retired) return;
      waiting = true;
      const msg: WorkerIn = { kind: "tick", timeMs: simClock.now() + TICK_MS, id: ++id };
      worker.postMessage(msg);
    };
    const path: RequestPath = (index, centerMs, steps) =>
      new Promise((resolve) => {
        if (retired) return resolve(null);
        const pid = ++pathId;
        pendingPaths.set(pid, resolve);
        const msg: WorkerIn = { kind: "path", id: pid, index, centerMs, steps };
        worker.postMessage(msg);
      });
    const retire = () => {
      retired = true;
      pendingPaths.forEach((resolve) => resolve(null));
      pendingPaths.clear();
      worker.terminate();
    };
    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      if (retired) return;
      const msg = e.data;
      if (msg.kind === "loaded") {
        request();
        return;
      }
      if (msg.kind === "path") {
        pendingPaths.get(msg.id)?.(msg.positions);
        pendingPaths.delete(msg.id);
        return;
      }
      waiting = false;
      if (!promoted) {
        // First frame for these records: stage them to take over (see the layout effect below).
        promoted = true;
        staged.current?.retire();
        staged.current = {
          records,
          frames: { prev: msg.positions, next: msg.positions, prevTime: msg.timeMs, nextTime: msg.timeMs },
          request,
          path,
          retire,
        };
        setShown({ records });
        return;
      }
      const f = frames.current;
      f.prev = f.next;
      f.prevTime = f.nextTime;
      f.next = msg.positions;
      f.nextTime = msg.timeMs;
    };
    const load: WorkerIn = { kind: "load", records };
    worker.postMessage(load);
    // Superseded before its first frame: nothing of it is on screen, so stop it now. Once promoted it
    // is stopped when a newer worker takes over, or on unmount (below).
    return () => {
      if (!promoted) retire();
    };
  }, [records]);

  // The staged worker takes over in the same commit that renders its records (geometry is built from
  // `shown`), before the next animation frame — frames and geometry never disagree.
  useLayoutEffect(() => {
    const s = staged.current;
    if (!s || !shown || s.records !== shown.records) return;
    staged.current = null;
    retireLive.current?.();
    retireLive.current = s.retire;
    frames.current = s.frames;
    requestRef.current = s.request;
    pathRef.current = s.path;
  }, [shown]);

  // Unmount: stop the worker on screen and any waiting to take over.
  useEffect(
    () => () => {
      retireLive.current?.();
      retireLive.current = null;
      staged.current?.retire();
      staged.current = null;
      requestRef.current = () => {};
      pathRef.current = async () => null;
      frames.current = emptyFrames();
    },
    [],
  );

  // Kept separate from the worker effect so toggling `active` pauses/resumes the tick cadence
  // without restarting the worker (which would re-send every record and drop in-flight frames).
  useEffect(() => {
    if (!active || !records || records.length === 0) return;
    const timer = window.setInterval(() => requestRef.current(), TICK_MS);
    return () => window.clearInterval(timer);
  }, [active, records]);

  const requestPath = useCallback<RequestPath>((index, centerMs, steps) => pathRef.current(index, centerMs, steps), []);
  return { frames, requestPath, shown: shown?.records ?? null };
}
```

- [ ] **Step 2: Make `Objects.tsx` build from `shown`**

In `web/src/components/globe/Objects.tsx`:

Replace

```ts
  const { frames, requestPath } = usePropagation(records, active);
```

with

```ts
  const { frames, requestPath, shown } = usePropagation(records, active);
  // The records the on-screen positions belong to. During a data swap these stay the previous
  // generation's until the new worker's first frame (see usePropagation); before the first frame
  // they are `records` (nothing is drawn until frames arrive).
  const view = shown ?? records;
```

Then replace `records` with `view` in exactly these places (and nowhere else — the `records` prop itself still goes to `usePropagation`):

```ts
  const visible = useMemo(
    () => view.map((r) => isVisible(r, group, { types, owners, orbits })),
    [view, group, types, owners, orbits],
  );
```

```ts
  const geometry = useMemo(() => buildObjectGeometry(view), [view]);
```

```ts
  const indexById = useMemo(() => new Map(view.map((r, i) => [r.noradId, i])), [view]);
```

```ts
  useEffect(() => {
    onLabelSource?.({ group, records: view, visible, frames });
    return () => onLabelSource?.(null);
  }, [group, view, visible, frames, onLabelSource]);
```

```tsx
        <Selection record={view[selectedIndex]} index={selectedIndex} frames={frames} requestPath={requestPath} atlas={atlas} />
```

- [ ] **Step 3: Run the checks**

Run: `cd web && npx vitest run && npx tsc --noEmit && npx eslint src tests e2e && npx playwright test`
Expected: all pass, including the existing globe e2e tests ("explorer renders tiles, charts, globe and attribution", "zooming in on a searched object shows name labels near the centre; clicking one opens its card").

- [ ] **Step 4: Commit**

```bash
git add web/src/components/globe/usePropagation.ts web/src/components/globe/Objects.tsx
git commit -m "feat(web): keep the previous orbits on screen until new ones have their first frame

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VPsSApUQwExwuTy7VzPMbH"
```

---

### Task 4: Wire it in — status pill, background refresh, panels follow

**Files:**
- Create: `web/src/components/globe/useGlobeData.ts`
- Create: `web/src/components/globe/StatusPill.tsx`
- Modify: `web/src/components/globe/GlobeSection.tsx`
- Modify: `web/src/lib/store.ts` (`dataVersion`)
- Modify: `web/src/app/page.tsx` (refetch on `dataVersion`)
- Test: `web/tests/unit/store.test.ts` (dataVersion), `web/e2e/explorer.spec.ts`

**Interfaces:**
- Consumes: `createGlobeData`, `GlobeData`, `GroupName` (Task 2); `deriveStatus`, `TONE_COLOR`, `PillInput` (Task 1); `api`, `nameCache`, `loadSnapshot`.
- Produces: `useGlobeData(wantHigh: boolean): GlobeData & { retry: (g: GroupName) => void }`; `<StatusPill input onRetry />` with `data-testid="live-badge"`; explorer store `dataVersion: number`, `setDataVersion(v: number)`.

- [ ] **Step 1: Write the failing store test**

Append to `web/tests/unit/store.test.ts` (inside its top-level `describe`, or at the end of the file as a new `describe` — match the file's style):

```ts
describe("dataVersion", () => {
  it("starts at 0, is set by setDataVersion and cleared by reset", () => {
    useExplorer.getState().reset();
    expect(useExplorer.getState().dataVersion).toBe(0);
    useExplorer.getState().setDataVersion(3);
    expect(useExplorer.getState().dataVersion).toBe(3);
    useExplorer.getState().reset();
    expect(useExplorer.getState().dataVersion).toBe(0);
  });
});
```

(`useExplorer` is already imported in that file; add `describe`/`it`/`expect` imports only if missing.)

- [ ] **Step 2: Write the failing e2e tests**

In `web/e2e/explorer.spec.ts`, add after the `trackErrors` function:

```ts
// The snapshot fixture's header says it was published 2026-09-23T12:00:00Z. Tests that read the
// status pill fix the page clock relative to that, so the age is deterministic.
const FIXTURE_PUBLISHED = Date.parse("2026-09-23T12:00:00Z");
const hoursAfterFixture = (h: number) => new Date(FIXTURE_PUBLISHED + h * 3_600_000);
```

Append these tests at the end of the file:

```ts
test("the status pill says LIVE with the data age, and the exact time on hover", async ({ page }) => {
  await page.clock.setFixedTime(hoursAfterFixture(2));
  await mockApi(page);
  await page.goto("/");
  const pill = page.getByTestId("live-badge");
  await expect(pill).toContainText("LIVE", { timeout: 10_000 });
  await expect(pill).toContainText("2h ago");
  await expect(pill).toHaveAttribute("title", "Elements published 2026-09-23 12:00 UTC");
});

test("the status pill says DELAYED when the data is over 12 hours old", async ({ page }) => {
  await page.clock.setFixedTime(hoursAfterFixture(14));
  await mockApi(page);
  await page.goto("/");
  const pill = page.getByTestId("live-badge");
  await expect(pill).toContainText("DELAYED", { timeout: 10_000 });
  await expect(pill).toContainText("14h ago");
});

test("a failed higher-orbits load is named in the pill and Retry recovers it", async ({ page }) => {
  await page.clock.setFixedTime(hoursAfterFixture(2));
  await mockApi(page);
  let highFails = true;
  await page.route("**/api/globe/snapshot**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("group") !== "HIGH") return route.fallback();
    return highFails
      ? route.fulfill({ status: 503, body: JSON.stringify({ error: { code: "unavailable", message: "x" } }), contentType: "application/json" })
      : route.fulfill({ status: 200, body: fx("snapshot-leo.bin.gz"), contentType: "application/octet-stream" });
  });
  await page.goto("/");
  const pill = page.getByTestId("live-badge");
  await expect(pill).toContainText("LIVE", { timeout: 10_000 });
  await page.getByTestId("panel-dock").getByRole("button", { name: "Filters" }).click();
  await page.getByRole("button", { name: "Higher orbits" }).click();
  await expect(pill).toContainText("higher orbits failed");
  highFails = false;
  await pill.getByRole("button", { name: "Retry" }).click();
  await expect(pill).toContainText("2h ago");
  await expect(pill.getByRole("button", { name: "Retry" })).toHaveCount(0);
});

test("a newly published generation replaces the orbits without a reload and keeps the selection", async ({ page }) => {
  await page.clock.setFixedTime(hoursAfterFixture(2));
  await mockApi(page);
  let generation = "20260924T004100Z-r42";
  await page.route("**/api/globe/current", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ generation, generated_at: "2026-09-23T12:00:00+00:00", groups: { LEO: { count: 2 }, HIGH: { count: 0 } } }),
    }),
  );
  const snapshotGenerations: (string | null)[] = [];
  let metaRequests = 0;
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname === "/api/globe/snapshot") snapshotGenerations.push(u.searchParams.get("gen"));
    if (u.pathname === "/api/meta") metaRequests++;
  });
  await page.goto("/");
  await page.getByLabel("Find an object").fill("ISS");
  await page.getByRole("button", { name: /ISS \(ZARYA\)/ }).click();
  await expect(page.getByTestId("object-card")).toBeVisible();
  const metaBefore = metaRequests;
  generation = "20260926T064100Z-r43";
  // A check runs whenever the tab becomes visible; the page is visible, so this triggers one.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(() => snapshotGenerations).toContain("20260926T064100Z-r43");
  await expect.poll(() => metaRequests).toBeGreaterThan(metaBefore);
  await expect(page.getByTestId("object-card")).toBeVisible();
  await expect(page.getByTestId("live-badge")).toContainText("LIVE");
});
```

Update the viewport test (`for (const [w, h] of [[640, 900], …`): add `await page.clock.setFixedTime(hoursAfterFixture(2));` as its first line (before `setViewportSize`), and replace its last three lines

```ts
    const badge = page.getByTestId("live-badge");
    const bb = (await badge.boundingBox())!;
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.textContent ?? null, [bb.x + bb.width / 2, bb.y + bb.height / 2]);
    expect(hit, "element at the LIVE badge's centre").toBe("● LIVE");
```

with

```ts
    const badge = page.getByTestId("live-badge");
    await expect(badge).toContainText("LIVE");
    const bb = (await badge.boundingBox())!;
    const inside = await page.evaluate(
      ([x, y]) => !!document.elementFromPoint(x, y)?.closest("[data-testid=live-badge]"),
      [bb.x + bb.width / 2, bb.y + bb.height / 2],
    );
    expect(inside, "the element at the status pill's centre belongs to the pill").toBe(true);
```

Also add `await page.clock.setFixedTime(hoursAfterFixture(2));` as the first line of the test "phone: bottom sheet with tabs, no horizontal overflow" (its badge must be the fresh, short one).

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd web && npx vitest run tests/unit/store.test.ts`
Expected: FAIL — `dataVersion` is `undefined` / `setDataVersion is not a function`.

Run: `cd web && npx playwright test -g "status pill|higher-orbits|newly published|no overlap"`
Expected: FAIL — the pill still reads `● LIVE` with no age, no Retry, no `title`.

- [ ] **Step 4: Add `dataVersion` to the store**

In `web/src/lib/store.ts`:

In `interface ExplorerState`, after `topBarBottom: number | null;` add:

```ts
  // Bumped by GlobeSection whenever a newly published generation is swapped in (see
  // createGlobeData's `version`); the page re-fetches the overview and charts when it changes.
  dataVersion: number;
```

and after `setTopBarBottom: (bottom: number | null) => void;` add:

```ts
  setDataVersion: (v: number) => void;
```

In `initial()`, change the return type's `Pick<…>` list to include `"dataVersion"` and add `dataVersion: 0,` after `topBarBottom: null,`:

```ts
const initial = (): Filters & Pick<ExplorerState, "selectedId" | "panels" | "mobileSheetOpen" | "mobileSheetTop" | "topBarBottom" | "dataVersion"> => ({
  types: [...OBJECT_TYPES],
  owners: [],
  orbits: { leo: true, high: false },
  selectedId: null,
  panels: { ...DEFAULT_VISIBILITY },
  mobileSheetOpen: true,
  mobileSheetTop: null,
  topBarBottom: null,
  dataVersion: 0,
});
```

In the store body, after `setTopBarBottom: (topBarBottom) => set({ topBarBottom }),` add:

```ts
  setDataVersion: (dataVersion) => set({ dataVersion }),
```

- [ ] **Step 5: Create the hook**

```ts
// web/src/components/globe/useGlobeData.ts
"use client";

import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { api } from "@/lib/api";
import { createGlobeData, type GlobeData, type GroupName } from "@/lib/globeData";
import { nameCache } from "@/lib/names";
import { loadSnapshot } from "@/lib/snapshot";

/** Globe data for the page (see createGlobeData): first load, background checks every 10 minutes
 * while the tab is visible and whenever it becomes visible, retry. HIGH loads the first time
 * `wantHigh` is true. */
export function useGlobeData(wantHigh: boolean): GlobeData & { retry: (g: GroupName) => void } {
  const [ctl] = useState(() =>
    createGlobeData({
      current: () => api.current(),
      snapshot: (group, generation) => api.snapshot(group, generation),
      decode: loadSnapshot,
      setNamesGeneration: (generation) => nameCache.useGeneration(generation),
    }),
  );
  const state = useStore(ctl.store);

  useEffect(() => {
    void ctl.start();
    const stop = ctl.poll({
      isVisible: () => document.visibilityState === "visible",
      onVisible: (cb) => {
        const handler = () => {
          if (document.visibilityState === "visible") cb();
        };
        document.addEventListener("visibilitychange", handler);
        return () => document.removeEventListener("visibilitychange", handler);
      },
    });
    return () => {
      stop();
      ctl.dispose();
    };
  }, [ctl]);

  useEffect(() => {
    if (wantHigh) void ctl.want("HIGH");
  }, [ctl, wantHigh]);

  return { ...state, retry: (g) => void ctl.retry(g) };
}
```

- [ ] **Step 6: Create the pill**

```tsx
// web/src/components/globe/StatusPill.tsx
"use client";

import { useEffect, useState } from "react";
import { deriveStatus, TONE_COLOR, type PillGroup, type PillInput } from "@/lib/freshness";

/** Wall-clock time, refreshed every `everyMs` (the pill's age only changes by the minute). Same
 * effect pattern as GlobeSection's Readout, which eslint's set-state-in-effect rule accepts. */
function useNow(everyMs: number): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const id = window.setInterval(update, everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return now;
}

/** The globe's status: a dot, a word, and either the data age or the problem (with Retry). The
 * word and any problem are a polite live region; the minute-by-minute age is not, so it doesn't
 * chatter. Retry exists only while something can be retried. */
export function StatusPill({ input, onRetry }: { input: PillInput; onRetry: (g: PillGroup) => void }) {
  const now = useNow(30_000);
  const s = deriveStatus(input, now);
  return (
    <div
      data-testid="live-badge"
      title={s.title ?? undefined}
      className="label pointer-events-auto flex select-none items-center gap-2 whitespace-nowrap rounded-full border-2 border-line bg-[#121212] px-3 py-2 !text-ink"
    >
      <span>
        <span role="status">
          <span aria-hidden="true" style={{ color: TONE_COLOR[s.tone] }}>
            {s.tone === "grey" ? "○" : "●"}
          </span>{" "}
          {s.word}
          {s.note && <span className="text-ink-3"> · {s.note}</span>}
        </span>
        {s.age && (
          <span className="text-ink-3">
            {" "}· <span className="hidden sm:inline">updated </span>
            {s.age}
          </span>
        )}
      </span>
      {s.retry.length > 0 && (
        <button
          type="button"
          onClick={() => s.retry.forEach(onRetry)}
          className="rounded-full border-2 border-line bg-[#1a1a1a] px-2 text-[11px] text-ink hover:bg-[#222]"
        >
          Retry
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Rewire `GlobeSection.tsx`**

In `web/src/components/globe/GlobeSection.tsx`:

Replace the imports block (lines 1–13) with:

```tsx
"use client";

import { Canvas } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { simClock } from "@/lib/clock";
import type { GroupName } from "@/lib/globeData";
import { useExplorer } from "@/lib/store";
import { subsolarPoint } from "@/lib/sun";
import { GlobeErrorBoundary } from "@/components/globe/GlobeErrorBoundary";
import { GlobeScene } from "@/components/globe/GlobeScene";
import { StatusPill } from "@/components/globe/StatusPill";
import { useGlobeData } from "@/components/globe/useGlobeData";
import { hasWebGL } from "@/components/globe/webgl";
```

Delete `type Status = …` and the `fetchGroup` function (old lines 17–22).

In `GlobeSection()`, replace

```tsx
  const [leo, setLeo] = useState<OrbitRecord[] | null>(null);
  const [high, setHigh] = useState<OrbitRecord[] | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [source, setSource] = useState<{ generation: string | undefined } | null>(null);
```

with nothing (delete those four lines), and replace

```tsx
  const setTopBarBottom = useExplorer((s) => s.setTopBarBottom);
  const wantHigh = useExplorer((s) => s.orbits.high);
```

with

```tsx
  const setTopBarBottom = useExplorer((s) => s.setTopBarBottom);
  const setDataVersion = useExplorer((s) => s.setDataVersion);
  const orbits = useExplorer((s) => s.orbits);
  const globe = useGlobeData(orbits.high);
  const leoStatus = globe.groups.LEO.status;
  const wanted: GroupName[] = [...(orbits.leo ? (["LEO"] as const) : []), ...(orbits.high ? (["HIGH"] as const) : [])];
```

Delete the two data effects (the `useEffect` that calls `api.current()` … `fetchGroup("LEO", generation)` and the `useEffect` that fetches `"HIGH"`), and add in their place:

```tsx
  // Lets the page re-fetch the overview and charts when a newer generation is swapped in.
  useEffect(() => setDataVersion(globe.version), [globe.version, setDataVersion]);
```

In the JSX, pass the controller's records to the scene:

```tsx
            <GlobeScene
              leo={globe.groups.LEO.records}
              high={globe.groups.HIGH.records}
              active={active}
              labelsRef={labelsRef}
              sectionRef={sectionRef}
            />
```

Replace the three centre messages with:

```tsx
        {webgl && !broken && (leoStatus === "loading" || leoStatus === "idle") && <p className="label">Loading orbits…</p>}
        {webgl && !broken && leoStatus === "missing" && <p className="text-sm text-ink-2">Orbit data not available yet.</p>}
        {webgl && !broken && leoStatus === "error" && <p className="text-sm text-ink-2">Data unavailable. The Earth is shown without objects.</p>}
```

Replace the badge (the comment `{/* Non-interactive: real time is the only speed … */}` and the whole `<p data-testid="live-badge" …>…</p>`) with:

```tsx
        {/* Hidden without WebGL: the "can't show the 3D globe" message already explains the page. */}
        {webgl === true && !broken && (
          <StatusPill input={{ groups: globe.groups, wanted, generatedAt: globe.generatedAt }} onRetry={globe.retry} />
        )}
```

Update the stale comment above the labels div (`so a label can never cover the LIVE badge or the readout`) to say `the status pill` instead of `the LIVE badge`.

- [ ] **Step 8: Re-fetch the overview and charts on `dataVersion`**

In `web/src/app/page.tsx`:

After `const orbits = useExplorer((s) => s.orbits);` add:

```tsx
  const dataVersion = useExplorer((s) => s.dataVersion);
```

Replace the meta effect

```tsx
  useEffect(() => {
    api.meta().then((d) => setMeta({ data: d, error: false })).catch(() => setMeta({ data: null, error: true }));
  }, []);
```

with

```tsx
  // Re-fetched whenever the globe swaps in a newly published generation (dataVersion); a failed
  // refresh keeps the numbers already shown.
  useEffect(() => {
    api.meta()
      .then((d) => setMeta({ data: d, error: false }))
      .catch(() => setMeta((m) => (m.data ? m : { data: null, error: true })));
  }, [dataVersion]);
```

and change the charts effect's dependency list from `[owners, types, orbits]` to `[owners, types, orbits, dataVersion]`.

- [ ] **Step 9: Run the tests to verify they pass**

Run: `cd web && npx vitest run && npx tsc --noEmit && npx eslint src tests e2e && npx playwright test`
Expected: all pass — including "survives API failure" (the centre still says "Data unavailable…"; the pill says `NO ORBIT DATA` with Retry) and "shows note when snapshot is missing".

- [ ] **Step 10: Commit**

```bash
git add web/src/components/globe/useGlobeData.ts web/src/components/globe/StatusPill.tsx web/src/components/globe/GlobeSection.tsx web/src/lib/store.ts web/src/app/page.tsx web/tests/unit/store.test.ts web/e2e/explorer.spec.ts
git commit -m "feat(web): status pill with data age and Retry; open tabs pick up new generations

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VPsSApUQwExwuTy7VzPMbH"
```

---

### Task 5: Search states

**Files:**
- Create: `web/src/lib/searchState.ts`
- Modify: `web/src/components/panels/SearchBox.tsx` (whole file, below)
- Test: `web/tests/unit/searchState.test.ts`, `web/e2e/explorer.spec.ts`

**Interfaces:**
- Consumes: `SearchResult` (`web/src/lib/types.ts`), `api.search`.
- Produces: `SEARCH_LIMIT`, `isSearchable(text)`, `searchView(input, attempt, answer)`, `searchStatus(view)`, types `SearchView`, `SearchAnswer`.

- [ ] **Step 1: Write the failing unit tests**

```ts
// web/tests/unit/searchState.test.ts
import { describe, expect, it } from "vitest";
import { isSearchable, SEARCH_LIMIT, searchStatus, searchView, type SearchAnswer } from "@/lib/searchState";
import type { SearchResult } from "@/lib/types";

const results = (n: number): SearchResult[] =>
  Array.from({ length: n }, (_, i) => ({
    norad_id: i + 1, name: `OBJECT ${i + 1}`, cospar_id: null, object_type: "PAY", owner: "US", regime: "LEO", decayed: false,
  }));
const answer = (query: string, found: SearchResult[] | null, attempt = 0): SearchAnswer => ({ query, attempt, results: found });

describe("isSearchable", () => {
  it.each([
    ["", false], [" ", false], ["i", false], ["is", true], [" is ", true], ["7", true], ["25544", true],
  ])("%j → %s", (text, ok) => {
    expect(isSearchable(text)).toBe(ok);
  });
});

describe("searchView", () => {
  it("is idle for an empty box", () => {
    expect(searchView("", 0, null)).toEqual({ kind: "idle" });
    expect(searchView("   ", 0, null)).toEqual({ kind: "idle" });
  });

  it("is short for one non-numeric character", () => {
    expect(searchView("i", 0, null)).toEqual({ kind: "short" });
  });

  it("is searching until the answer for this query and attempt arrives", () => {
    expect(searchView("iss", 0, null)).toEqual({ kind: "searching" });
    expect(searchView("7", 0, null)).toEqual({ kind: "searching" });
  });

  it("an answer for another query is hidden", () => {
    expect(searchView("iss", 0, answer("is", results(3)))).toEqual({ kind: "searching" });
  });

  it("an answer from an earlier attempt is hidden (Retry)", () => {
    expect(searchView("iss", 1, answer("iss", null, 0))).toEqual({ kind: "searching" });
  });

  it("cleared box is idle even with an answer", () => {
    expect(searchView("", 0, answer("iss", results(3)))).toEqual({ kind: "idle" });
  });

  it("shows results for the trimmed query", () => {
    expect(searchView(" iss ", 0, answer("iss", results(2)))).toEqual({ kind: "results", query: "iss", results: results(2) });
  });

  it("shows an error when the request failed", () => {
    expect(searchView("iss", 0, answer("iss", null))).toEqual({ kind: "error", query: "iss" });
  });
});

describe("searchStatus", () => {
  it("has nothing to say when idle", () => {
    expect(searchStatus({ kind: "idle" })).toBeNull();
  });

  it("hints at the minimum length", () => {
    expect(searchStatus({ kind: "short" })).toEqual({ text: "Type 2+ letters, or a NORAD number." });
  });

  it("says it is searching", () => {
    expect(searchStatus({ kind: "searching" })).toEqual({ text: "Searching…" });
  });

  it("counts matches", () => {
    expect(searchStatus({ kind: "results", query: "iss", results: results(1) })).toEqual({ text: "1 match" });
    expect(searchStatus({ kind: "results", query: "iss", results: results(3) })).toEqual({ text: "3 matches" });
  });

  it("says when the list is capped", () => {
    expect(searchStatus({ kind: "results", query: "starlink", results: results(SEARCH_LIMIT) })).toEqual({
      text: "Showing the first 20 — type more to narrow it down",
    });
  });

  it("says no matches with the formats to try", () => {
    expect(searchStatus({ kind: "results", query: "starlink 1007", results: [] })).toEqual({
      text: "No matches for “starlink 1007”.",
      hint: "Try a name (ISS), a NORAD number (25544) or a COSPAR ID (1998-067A).",
    });
  });

  it("says when search is unavailable", () => {
    expect(searchStatus({ kind: "error", query: "iss" })).toEqual({ text: "Search is unavailable right now." });
  });
});
```

- [ ] **Step 2: Write the failing e2e test**

Append to `web/e2e/explorer.spec.ts`:

```ts
test("search says when nothing matches, and offers Retry when it fails", async ({ page }) => {
  await mockApi(page);
  let mode: "empty" | "fail" | "ok" = "empty";
  await page.route("**/api/objects/search**", (route) =>
    mode === "empty"
      ? route.fulfill({ status: 200, body: "[]", contentType: "application/json" })
      : mode === "fail"
        ? route.fulfill({ status: 500, body: JSON.stringify({ error: { code: "internal", message: "x" } }), contentType: "application/json" })
        : route.fallback(),
  );
  await page.goto("/");
  const box = page.getByLabel("Find an object");
  await box.fill("zzzz");
  await expect(page.getByText("No matches for “zzzz”.")).toBeVisible();
  await expect(page.getByText("Try a name (ISS), a NORAD number (25544) or a COSPAR ID (1998-067A).")).toBeVisible();
  mode = "fail";
  await box.fill("iss");
  await expect(page.getByText("Search is unavailable right now.")).toBeVisible();
  mode = "ok";
  await page.locator('[data-panel="search"]').getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("button", { name: /ISS \(ZARYA\)/ })).toBeVisible();
  await expect(page.getByText("1 match")).toBeVisible();
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd web && npx vitest run tests/unit/searchState.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/searchState"`.

Run: `cd web && npx playwright test -g "search says"`
Expected: FAIL — no "No matches for …" text.

- [ ] **Step 4: Write `searchState.ts`**

```ts
// web/src/lib/searchState.ts
import type { SearchResult } from "@/lib/types";

/** The API's default result limit (api/app/api/routes.py): a full page means there may be more. */
export const SEARCH_LIMIT = 20;

export type SearchView =
  | { kind: "idle" }
  | { kind: "short" }
  | { kind: "searching" }
  | { kind: "results"; query: string; results: SearchResult[] }
  | { kind: "error"; query: string };

/** What a finished request returned: `results` null = the request failed. */
export interface SearchAnswer {
  query: string;
  attempt: number;
  results: SearchResult[] | null;
}

export function isSearchable(text: string): boolean {
  const t = text.trim();
  return t.length >= 2 || /^\d+$/.test(t);
}

/** The panel's state for the text in the box. An answer shows only if it is for exactly this query
 * and attempt, so old results never sit under a new query. */
export function searchView(input: string, attempt: number, answer: SearchAnswer | null): SearchView {
  const text = input.trim();
  if (text === "") return { kind: "idle" };
  if (!isSearchable(text)) return { kind: "short" };
  if (!answer || answer.query !== text || answer.attempt !== attempt) return { kind: "searching" };
  if (answer.results === null) return { kind: "error", query: text };
  return { kind: "results", query: text, results: answer.results };
}

/** The status line under the input (a polite live region); null = say nothing. */
export function searchStatus(view: SearchView): { text: string; hint?: string } | null {
  switch (view.kind) {
    case "idle":
      return null;
    case "short":
      return { text: "Type 2+ letters, or a NORAD number." };
    case "searching":
      return { text: "Searching…" };
    case "error":
      return { text: "Search is unavailable right now." };
    case "results": {
      const n = view.results.length;
      if (n === 0) {
        return {
          text: `No matches for “${view.query}”.`,
          hint: "Try a name (ISS), a NORAD number (25544) or a COSPAR ID (1998-067A).",
        };
      }
      if (n >= SEARCH_LIMIT) return { text: `Showing the first ${SEARCH_LIMIT} — type more to narrow it down` };
      return { text: `${n} ${n === 1 ? "match" : "matches"}` };
    }
  }
}
```

- [ ] **Step 5: Replace `SearchBox.tsx`**

```tsx
// web/src/components/panels/SearchBox.tsx
"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { isSearchable, searchStatus, searchView, type SearchAnswer } from "@/lib/searchState";
import { useExplorer } from "@/lib/store";
import { TYPE_LABELS } from "@/lib/types";

export function SearchBox() {
  const [q, setQ] = useState("");
  // Bumped by Retry: re-runs the same query, and hides the failed answer until the new one arrives.
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<SearchAnswer | null>(null);
  const select = useExplorer((s) => s.select);
  const text = q.trim();

  useEffect(() => {
    if (!isSearchable(text)) return;
    // `cancelled` guards against responses arriving out of order (the debounce only protects
    // against a pending timer being superseded); the view also shows an answer only for the
    // query and attempt it belongs to (see searchView).
    let cancelled = false;
    const id = window.setTimeout(() => {
      api.search(text)
        .then((results) => { if (!cancelled) setAnswer({ query: text, attempt, results }); })
        .catch(() => { if (!cancelled) setAnswer({ query: text, attempt, results: null }); });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [text, attempt]);

  const view = searchView(q, attempt, answer);
  const status = searchStatus(view);
  return (
    <div>
      <label className="label" htmlFor="search">Find an object</label>
      <input
        id="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="ISS, 25544, 1999-025…"
        maxLength={100}
        className="mt-2 w-full rounded-[10px] border-2 border-line bg-[#121212] px-3 py-2 text-[13px] text-ink placeholder:text-ink-3"
      />
      <div className={`${status ? "mt-2 " : ""}flex flex-wrap items-baseline gap-x-2`}>
        <p role="status" className="text-[13px] text-ink-3">
          {status && (
            <>
              <span className={view.kind === "results" && view.results.length === 0 ? "text-ink-2" : undefined}>{status.text}</span>
              {status.hint && (
                <>
                  <br />
                  {status.hint}
                </>
              )}
            </>
          )}
        </p>
        {view.kind === "error" && (
          <button
            type="button"
            onClick={() => setAttempt((a) => a + 1)}
            className="rounded-full border-2 border-line bg-[#1a1a1a] px-2 text-[11px] text-ink hover:bg-[#222]"
          >
            Retry
          </button>
        )}
      </div>
      {view.kind === "results" && view.results.length > 0 && (
        <ul className="mt-2 max-h-56 overflow-auto rounded-[10px] border-2 border-line">
          {view.results.map((r) => (
            <li key={r.norad_id}>
              <button type="button" onClick={() => { select(r.norad_id); setQ(""); }} className="flex w-full justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-[#161616]">
                <span className="text-ink">{r.name}</span>
                <span className="font-mono text-[12px] text-ink-3">{TYPE_LABELS[r.object_type]} · {r.decayed ? "re-entered" : r.regime}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

(The `role="status"` paragraph is always rendered, even when empty: a live region must exist before its text changes for screen readers to announce the change.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd web && npx vitest run && npx tsc --noEmit && npx eslint src tests e2e && npx playwright test`
Expected: all pass, including the existing "search opens the object card".

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/searchState.ts web/src/components/panels/SearchBox.tsx web/tests/unit/searchState.test.ts web/e2e/explorer.spec.ts
git commit -m "feat(web): search says searching, how many matches, no matches, or unavailable with Retry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VPsSApUQwExwuTy7VzPMbH"
```
