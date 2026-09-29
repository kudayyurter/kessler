import type { CrowdingChange, Mover } from "@/lib/crowding/change";
import type { CrowdingDayHeader } from "@/lib/crowding/format";
import type { CrowdingFilter, CrowdingMap } from "@/lib/crowding/grid";
import type { CrowdingIn, CrowdingOut } from "@/workers/crowding.worker";

/** Decoded days the worker keeps at most (~0.6 MB each). */
export const MAX_DAYS = 60;

export interface WorkerLike {
  postMessage(msg: CrowdingIn, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<CrowdingOut>) => void) | null;
  terminate(): void;
}

type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;
export type CrowdingClient = ReturnType<typeof createCrowdingClient>;

/** Talks to the crowding worker: fetches each day once (`fetchDay` returns uncompressed CRW1 bytes,
 * or null when the day has no file), keeps the most recently used `maxDays` in the worker, and turns
 * replies into promises. */
export function createCrowdingClient(worker: WorkerLike, fetchDay: (day: string) => Promise<Uint8Array | null>, maxDays = MAX_DAYS) {
  let nextId = 1;
  let disposed = false;
  const pending = new Map<number, { resolve: (m: CrowdingOut) => void; reject: (e: Error) => void }>();
  worker.onmessage = (e) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.kind === "error") p.reject(new Error(e.data.message));
    else p.resolve(e.data);
  };

  function call(msg: WithoutId<CrowdingIn>, transfer: Transferable[] = []): Promise<CrowdingOut> {
    if (disposed) return Promise.reject(new Error("crowding client disposed"));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ ...msg, id } as CrowdingIn, transfer);
    });
  }

  // Days loaded (or loading) in the worker, least recently used first.
  const loaded = new Map<string, Promise<CrowdingDayHeader | null>>();

  function ensure(day: string): Promise<CrowdingDayHeader | null> {
    const known = loaded.get(day);
    if (known) {
      loaded.delete(day);
      loaded.set(day, known);
      return known;
    }
    const p = fetchDay(day).then(async (bytes) => {
      if (bytes === null) return null;
      const out = await call({ kind: "load", day, bytes }, [bytes.buffer]);
      return out.kind === "loaded" ? out.header : null;
    });
    loaded.set(day, p);
    p.catch(() => {
      if (loaded.get(day) === p) loaded.delete(day);
    });
    while (loaded.size > maxDays) {
      const oldest = loaded.keys().next().value as string;
      loaded.delete(oldest);
      worker.postMessage({ kind: "drop", id: 0, day: oldest });
    }
    return p;
  }

  return {
    ensure,
    /** Forgets a day, so the next request fetches it again (the latest day after a new generation). */
    forget(day: string): void {
      if (loaded.delete(day)) worker.postMessage({ kind: "drop", id: 0, day });
    },
    async map(day: string, filter: CrowdingFilter): Promise<CrowdingMap | null> {
      if (!(await ensure(day))) return null;
      const out = await call({ kind: "map", day, filter });
      return out.kind === "map" ? out.map : null;
    },
    async change(from: string, to: string, filter: CrowdingFilter, reentries: Record<string, string>): Promise<CrowdingChange | null> {
      const [a, b] = await Promise.all([ensure(from), ensure(to)]);
      if (!a || !b) return null;
      const out = await call({ kind: "change", from, to, filter, reentries });
      return out.kind === "change" ? out.change : null;
    },
    async movers(from: string, to: string, filter: CrowdingFilter, reentries: Record<string, string>, cell: number, limit = 5): Promise<Mover[] | null> {
      const [a, b] = await Promise.all([ensure(from), ensure(to)]);
      if (!a || !b) return null;
      const out = await call({ kind: "movers", from, to, filter, reentries, cell, limit });
      return out.kind === "movers" ? out.movers : null;
    },
    dispose(): void {
      disposed = true;
      worker.onmessage = null;
      worker.terminate();
      for (const p of pending.values()) p.reject(new Error("crowding client disposed"));
      pending.clear();
    },
  };
}
