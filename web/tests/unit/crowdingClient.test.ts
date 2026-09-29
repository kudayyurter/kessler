import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { createCrowdingClient, type WorkerLike } from "@/lib/crowding/client";
import { cellIndex } from "@/lib/crowding/grid";
import { createHandler, type CrowdingIn, type CrowdingOut } from "@/workers/crowding.worker";
import { LEO } from "./crowdingDays";

const fixture = (day: string) =>
  new Uint8Array(gunzipSync(readFileSync(new URL(`../fixtures/crowding/day-${day}.bin.gz`, import.meta.url))));
const DAY1 = "2026-09-22";
const DAY2 = "2026-09-23";
const REENTRIES = { "501": "2026-09-23" };

/** Runs the real handler in-process; replies arrive asynchronously, like a worker's. */
function fakeWorker(): WorkerLike & { posted: CrowdingIn[] } {
  const w: WorkerLike & { posted: CrowdingIn[] } = {
    posted: [],
    onmessage: null,
    terminate: () => {},
    postMessage(msg) {
      w.posted.push(msg);
      handle(msg);
    },
  };
  const handle = createHandler((out) => queueMicrotask(() => w.onmessage?.({ data: out } as MessageEvent<CrowdingOut>)));
  return w;
}

describe("crowding client", () => {
  it("fetches a day once and bins it in the worker", async () => {
    const fetchDay = vi.fn(async (day: string) => fixture(day));
    const c = createCrowdingClient(fakeWorker(), fetchDay);
    const map = await c.map(DAY2, LEO);
    expect(map?.total[cellIndex(11, 27)]).toBeCloseTo(9, 9);
    await c.map(DAY2, LEO);
    expect(fetchDay).toHaveBeenCalledTimes(1);
  });

  it("computes the change between two days by cause", async () => {
    const c = createCrowdingClient(fakeWorker(), async (day) => fixture(day));
    const change = await c.change(DAY1, DAY2, LEO, REENTRIES);
    expect(change?.counts).toEqual({ new: 1, reentered: 1, untracked: 1, moved: 1 });
    const movers = await c.movers(DAY1, DAY2, LEO, REENTRIES, cellIndex(14, 35));
    expect(movers?.map((m) => [m.noradId, m.cause])).toEqual([[301, "movedOut"]]);
  });

  it("answers null for a day without a file", async () => {
    const c = createCrowdingClient(fakeWorker(), async () => null);
    expect(await c.map(DAY2, LEO)).toBeNull();
    expect(await c.change(DAY1, DAY2, LEO, {})).toBeNull();
  });

  it("retries a day whose fetch failed", async () => {
    const fetchDay = vi.fn().mockRejectedValueOnce(new Error("offline")).mockImplementation(async (day: string) => fixture(day));
    const c = createCrowdingClient(fakeWorker(), fetchDay);
    await expect(c.map(DAY2, LEO)).rejects.toThrow("offline");
    expect(await c.map(DAY2, LEO)).not.toBeNull();
    expect(fetchDay).toHaveBeenCalledTimes(2);
  });

  it("forget() makes the next ensure() fetch the day again", async () => {
    const fetchDay = vi.fn(async (day: string) => fixture(day));
    const w = fakeWorker();
    const c = createCrowdingClient(w, fetchDay);
    await c.ensure(DAY2);
    c.forget(DAY2);
    expect(w.posted.at(-1)).toEqual({ kind: "drop", id: 0, day: DAY2 });
    await c.ensure(DAY2);
    expect(fetchDay).toHaveBeenCalledTimes(2);
  });

  it("keeps at most maxDays days and drops the least recently used", async () => {
    const fetchDay = vi.fn(async () => fixture(DAY2));
    const w = fakeWorker();
    const c = createCrowdingClient(w, fetchDay, 2);
    await c.ensure("a");
    await c.ensure("b");
    await c.ensure("a"); // a is now more recent than b
    await c.ensure("c");
    expect(w.posted.filter((m) => m.kind === "drop")).toEqual([{ kind: "drop", id: 0, day: "b" }]);
    await c.ensure("a");
    expect(fetchDay).toHaveBeenCalledTimes(3);
  });

  it("reports worker errors and rejects pending requests on dispose", async () => {
    const w = fakeWorker();
    const c = createCrowdingClient(w, async () => new TextEncoder().encode("not a day file"));
    await expect(c.map(DAY2, LEO)).rejects.toThrow("not a CRW1 day file");
    const never: WorkerLike = { postMessage: () => {}, onmessage: null, terminate: vi.fn() };
    const d = createCrowdingClient(never, async () => fixture(DAY2));
    const pending = d.map(DAY2, LEO);
    await Promise.resolve();
    d.dispose();
    await expect(pending).rejects.toThrow("disposed");
    expect(never.terminate).toHaveBeenCalled();
  });
});
