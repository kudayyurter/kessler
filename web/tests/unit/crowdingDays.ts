import type { CrowdingDay } from "@/lib/crowding/format";
import { R_EARTH_KM, type CrowdingFilter } from "@/lib/crowding/grid";
import { OBJECT_TYPES, type ObjectType } from "@/lib/types";

export interface Obj { id: number; owner?: string; type?: ObjectType; alt: number; inc: number; ecc?: number; sma?: number }

/** A decoded day built straight from objects, as decodeCrowdingDay would return it. */
export function dayOf(day: string, objs: Obj[], skipped = 0): CrowdingDay {
  const sorted = [...objs].sort((a, b) => a.id - b.id);
  const owners = [...new Set(sorted.map((o) => o.owner ?? "US"))].sort();
  return {
    header: {
      version: 1, day, generated_at: `${day}T18:41:32+00:00`, generation: null, source: "live",
      count: sorted.length, skipped, owners, types: [...OBJECT_TYPES], columns: [],
    },
    norad: Uint32Array.from(sorted.map((o) => o.id)),
    owner: Uint16Array.from(sorted.map((o) => owners.indexOf(o.owner ?? "US"))),
    type: Uint8Array.from(sorted.map((o) => OBJECT_TYPES.indexOf(o.type ?? "PAY"))),
    smaKm: Float64Array.from(sorted.map((o) => o.sma ?? R_EARTH_KM + o.alt)),
    ecc: Float64Array.from(sorted.map((o) => o.ecc ?? 0)),
    incDeg: Float64Array.from(sorted.map((o) => o.inc)),
  };
}

export const ALL: CrowdingFilter = { types: [...OBJECT_TYPES], owners: [], orbits: { leo: true, high: true } };
export const LEO: CrowdingFilter = { ...ALL, orbits: { leo: true, high: false } };
