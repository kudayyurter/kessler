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
