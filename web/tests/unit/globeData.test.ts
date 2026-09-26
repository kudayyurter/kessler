import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
      if (keyGates.has(key)) await keyGates.get(key);
      if (fail.has(group) || fail.has(key)) throw new Error("HTTP 503");
      if (missing.has(group) || missing.has(key)) return null;
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
  const keyGates = new Map<string, Promise<void>>();
  return {
    deps, calls, names, fail, missing, serveAs,
    setPointer: (p: string | null | Error) => { pointer = p; },
    hold: () => {
      let release!: () => void;
      gate = new Promise((r) => { release = r; });
      return () => { gate = null; release(); };
    },
    // Gates one specific "group@generation" request only, independent of the others — for races
    // between two in-flight requests that must resolve in either order.
    holdKey: (key: string) => {
      let release!: () => void;
      keyGates.set(key, new Promise((r) => { release = r; }));
      return () => { keyGates.delete(key); release(); };
    },
  };
}

const settle = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};
const ids = (records: OrbitRecord[] | null) => records?.map((r) => r.noradId) ?? null;

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  vi.useRealTimers();
});

describe("createGlobeData", () => {
  it("warns (with context) on a failed group load and a failed check, instead of swallowing the error", async () => {
    const api = fakeApi();
    api.fail.add("LEO");
    const ctl = createGlobeData(api.deps);
    await ctl.start();
    expect(ctl.store.getState().groups.LEO.status).toBe("error");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("globe data"), expect.anything());
    warnSpy.mockClear();

    api.setPointer(new Error("HTTP 500"));
    await ctl.check();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("globe data"), expect.anything());
  });
});

describe("createGlobeData (existing behaviour)", () => {
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

  it("wanting a group while start's pointer request is in flight requests it once", async () => {
    const api = fakeApi();
    const ctl = createGlobeData(api.deps);
    await Promise.all([ctl.start(), ctl.want("HIGH")]);
    expect(api.calls.filter((c) => c.startsWith("HIGH"))).toEqual(["HIGH@g1"]);
    expect(ctl.store.getState().groups.HIGH.status).toBe("ready");
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

  it("check: a group asked for during a background download is not left behind", async () => {
    for (const order of ["leo-first", "high-first"] as const) {
      const api = fakeApi();
      const ctl = createGlobeData(api.deps);
      await ctl.start(); // requested = {LEO}, LEO ready on g1
      api.setPointer("g2");
      const releaseLeo = api.holdKey("LEO@g2");
      const releaseHigh = api.holdKey("HIGH@g1");
      const checkPromise = ctl.check(); // reads pointer g2, starts downloading LEO@g2 only
      await settle();
      const wantPromise = ctl.want("HIGH"); // turned on mid-download: loads HIGH from the shown gen, g1
      await settle();
      if (order === "leo-first") {
        releaseLeo();
        await settle();
        releaseHigh();
      } else {
        releaseHigh();
        await settle();
        releaseLeo();
      }
      await Promise.all([checkPromise, wantPromise]);
      let s = ctl.store.getState();
      expect(s.generation).toBe("g1");
      expect(s.version).toBe(0);
      expect(s.groups.HIGH.status).toBe("ready");
      expect(ids(s.groups.HIGH.records)).toEqual([2, 10]);
      // The next check sees both groups requested and swaps them in together.
      await ctl.check();
      s = ctl.store.getState();
      expect(s.generation).toBe("g2");
      expect(s.version).toBe(1);
      expect(ids(s.groups.LEO.records)).toEqual([1, 20]);
      expect(ids(s.groups.HIGH.records)).toEqual([2, 20]);
    }
  });

  it("check: a failed pointer request changes nothing", async () => {
    const api = fakeApi();
    const ctl = createGlobeData(api.deps);
    await ctl.start();
    api.setPointer(new Error("HTTP 500"));
    await ctl.check();
    expect(ctl.store.getState().generation).toBe("g1");
  });

  it("check: a null pointer (no generation published yet) changes nothing", async () => {
    const api = fakeApi();
    const ctl = createGlobeData(api.deps);
    await ctl.start();
    api.setPointer(null);
    await ctl.check();
    const s = ctl.store.getState();
    expect(s.generation).toBe("g1");
    expect(s.version).toBe(0);
  });

  it("check: a partial 404 during a background download keeps what is shown", async () => {
    const api = fakeApi();
    const ctl = createGlobeData(api.deps);
    await ctl.start();
    await ctl.want("HIGH");
    api.setPointer("g2");
    api.missing.add("HIGH@g2");
    await ctl.check();
    const s = ctl.store.getState();
    expect(s.generation).toBe("g1");
    expect(s.version).toBe(0);
    expect(ids(s.groups.LEO.records)).toEqual([1, 10]);
    expect(s.groups.HIGH.status).toBe("ready");
    expect(ids(s.groups.HIGH.records)).toEqual([2, 10]);
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
    const before = api.calls.length;
    await ctl.start();
    await ctl.want("HIGH"); // the remounted effect asks again: already requested
    await settle();
    const since = api.calls.slice(before);
    expect(since.filter((c) => c === "LEO@g1")).toHaveLength(1);
    expect(since.filter((c) => c === "HIGH@g1")).toHaveLength(1);
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
