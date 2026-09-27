import type { FilterState, Orbits } from "@/lib/filterSummary";
import { fmtDate } from "@/lib/format";
import type { GroupStatus } from "@/lib/globeData";
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
 * still get one). `highStatus` is the HIGH group's load status (see globeData.ts) — without it, a
 * MEO/GEO/HEO selection whose group failed or came back missing stays "pending" forever (locate()
 * only reaches "absent" once every *loaded* expected group has been checked, and a failed group
 * never loads), leaving the card silent instead of explaining why. */
export function noPositionReason(
  o: { decay_date: string | null; regime: Regime },
  presence: GlobePresence | null,
  highStatus?: GroupStatus,
): string | null {
  if (o.decay_date) return `Re-entered on ${fmtDate(o.decay_date)} — no current position.`;
  if (o.regime === "OTHER") return "Not shown on the globe: beyond Earth orbit or unknown orbit.";
  if (presence === "absent") return "No current orbit data for this object.";
  if (presence === "pending" && o.regime !== "LEO" && (highStatus === "error" || highStatus === "missing")) {
    return "Higher-orbit positions aren't available right now.";
  }
  return null;
}
