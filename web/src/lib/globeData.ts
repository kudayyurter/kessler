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
    // Snapshotted before awaiting the pointer: a concurrent want() adds to `requested` and loads
    // its own group once the pointer resolves — re-reading `requested` after the await would load
    // that group a second time.
    const groups = [...requested];
    pointerReady = (async () => {
      const pointer = await deps.current().catch(() => null);
      if (e !== epoch) return;
      deps.setNamesGeneration(pointer?.generation);
      store.setState({ generation: pointer?.generation });
    })();
    await pointerReady;
    if (e !== epoch) return;
    await Promise.all(groups.map((g) => loadGroup(g, e)));
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
        // A group was requested mid-download and is not covered by this download: swapping now
        // would either strand it in `loading` (if its own load finishes after this swap) or show
        // it against a stale generation (if it finishes first). Skip; the next check covers it.
        if ([...requested].some((g) => !groups.includes(g))) return;
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
