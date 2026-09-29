import { buildChange, moversInCell, type CrowdingChange, type Mover } from "@/lib/crowding/change";
import { decodeCrowdingDay, type CrowdingDay, type CrowdingDayHeader } from "@/lib/crowding/format";
import { buildMap, type CrowdingFilter, type CrowdingMap } from "@/lib/crowding/grid";

export type CrowdingIn =
  | { kind: "load"; id: number; day: string; bytes: Uint8Array }
  | { kind: "drop"; id: number; day: string }
  | { kind: "map"; id: number; day: string; filter: CrowdingFilter }
  | { kind: "change"; id: number; from: string; to: string; filter: CrowdingFilter; reentries: Record<string, string> }
  | { kind: "movers"; id: number; from: string; to: string; filter: CrowdingFilter; reentries: Record<string, string>; cell: number; limit: number };
export type CrowdingOut =
  | { kind: "loaded"; id: number; header: CrowdingDayHeader }
  | { kind: "map"; id: number; map: CrowdingMap }
  | { kind: "change"; id: number; change: CrowdingChange }
  | { kind: "movers"; id: number; movers: Mover[] }
  | { kind: "error"; id: number; message: string };

const mapBuffers = (m: CrowdingMap): Transferable[] => [m.total.buffer, m.passing.buffer, ...Object.values(m.byType).map((a) => a.buffer)];
const changeBuffers = (c: CrowdingChange): Transferable[] => [c.net.buffer, ...Object.values(c.cause).map((a) => a.buffer)];

/** Holds the decoded days the client asked for (it decides which — see lib/crowding/client.ts)
 * and answers map, change and movers requests. */
export function createHandler(post: (msg: CrowdingOut, transfer?: Transferable[]) => void) {
  const days = new Map<string, CrowdingDay>();
  const day = (d: string): CrowdingDay => {
    const found = days.get(d);
    if (!found) throw new Error(`crowding day ${d} is not loaded`);
    return found;
  };
  return (msg: CrowdingIn) => {
    try {
      switch (msg.kind) {
        case "drop":
          days.delete(msg.day);
          return;
        case "load": {
          const decoded = decodeCrowdingDay(msg.bytes);
          days.set(msg.day, decoded);
          post({ kind: "loaded", id: msg.id, header: decoded.header });
          return;
        }
        case "map": {
          const map = buildMap(day(msg.day), msg.filter);
          post({ kind: "map", id: msg.id, map }, mapBuffers(map));
          return;
        }
        case "change": {
          const change = buildChange(day(msg.from), day(msg.to), msg.reentries, msg.filter);
          post({ kind: "change", id: msg.id, change }, changeBuffers(change));
          return;
        }
        case "movers":
          post({ kind: "movers", id: msg.id, movers: moversInCell(day(msg.from), day(msg.to), msg.reentries, msg.filter, msg.cell, msg.limit) });
          return;
      }
    } catch (err) {
      post({ kind: "error", id: msg.id, message: err instanceof Error ? err.message : String(err) });
    }
  };
}

// Only wire up the message loop when running inside a worker (not when imported by tests).
type WorkerScope = {
  postMessage(msg: CrowdingOut, transfer: Transferable[]): void;
  onmessage: ((e: MessageEvent<CrowdingIn>) => void) | null;
};
declare const WorkerGlobalScope: (new () => unknown) | undefined;
if (typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope) {
  const scope = self as unknown as WorkerScope;
  const handle = createHandler((msg, transfer) => scope.postMessage(msg, transfer ?? []));
  scope.onmessage = (e) => handle(e.data);
}
