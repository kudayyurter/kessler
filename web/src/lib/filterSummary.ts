import { OBJECT_TYPES, type ObjectType, type OwnerSummary } from "@/lib/types";
import { ownerDisplay } from "@/lib/ownerPicker";

export type Orbits = { leo: boolean; high: boolean };
export interface FilterState {
  types: readonly ObjectType[];
  owners: readonly string[];
  orbits: Orbits;
}

/** Low Earth orbit only, all owners, all four types. */
export function isDefaultFilters(f: FilterState): boolean {
  return f.orbits.leo && !f.orbits.high && f.owners.length === 0 && f.types.length === OBJECT_TYPES.length;
}

export function orbitsText(o: Orbits): string {
  if (o.leo && o.high) return "All orbits";
  return o.leo ? "Low Earth orbit" : "Higher orbits";
}

export function typesText(types: readonly ObjectType[]): string {
  return types.length === OBJECT_TYPES.length ? "all types" : `${types.length} of ${OBJECT_TYPES.length} types`;
}

export function ownerText(owners: readonly string[], list: readonly OwnerSummary[]): string {
  if (owners.length === 0) return "All owners";
  const o = list.find((x) => x.code === owners[0]);
  return o ? ownerDisplay(o) : owners[0];
}

/** "Higher orbits · 🇺🇸 United States · 3 of 4 types" — the summary pill and the History scope line. */
export function filterScope(f: FilterState, list: readonly OwnerSummary[]): string {
  return [orbitsText(f.orbits), ownerText(f.owners, list), typesText(f.types)].join(" · ");
}

/** The Owners chart ranks all owners, so its scope names no owner. */
export function ownersChartScope(f: FilterState): string {
  return ["All owners, ranked", orbitsText(f.orbits), typesText(f.types)].join(" · ");
}
