import * as THREE from "three";
import type { Found } from "@/components/globe/flyTo";

type Frames = { prev: Float32Array | null; next: Float32Array | null; prevTime: number; nextTime: number };

export function interpolate(frames: Frames, timeMs: number, i: number, out: THREE.Vector3): boolean {
  const { prev, next, prevTime, nextTime } = frames;
  if (!prev || !next) return false;
  const a = nextTime > prevTime ? Math.min(Math.max((timeMs - prevTime) / (nextTime - prevTime), 0), 1.5) : 1;
  const k = i * 3;
  const x = prev[k] + (next[k] - prev[k]) * a;
  const y = prev[k + 1] + (next[k + 1] - prev[k + 1]) * a;
  const z = prev[k + 2] + (next[k + 2] - prev[k + 2]) * a;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
  out.set(x, y, z);
  return true;
}

/**
 * One group's answer for a single object's position, decided from its raw frames rather than
 * just `interpolate`'s boolean: "absent" when the object has no index in this group's records;
 * "pending" while this group hasn't produced its first frame yet; the interpolated position when
 * one can be computed; or "absent" when interpolation fails with frames present — propagateAll
 * writes NaN for a null satrec or failed SGP4, and that never recovers, so it must not be reported
 * as merely "pending" forever.
 */
export function locateIn(frames: Frames, index: number | undefined, timeMs: number, out: THREE.Vector3): Found {
  if (index === undefined) return "absent";
  if (!frames.prev || !frames.next) return "pending";
  return interpolate(frames, timeMs, index, out) ? out : "absent";
}
