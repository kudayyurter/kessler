import type { OwnerSummary } from "@/lib/types";

export const LARGEST = 8;

export interface PickerOption {
  id: string;
  code: string | null;
  label: string;
  count: number | null;
  dim: boolean;
  /** Group heading shown above this option (first option of a group only). */
  heading?: string;
}

export function ownerDisplay(o: OwnerSummary): string {
  return `${o.flag_emoji ?? ""} ${o.name}`.trim();
}

const byInOrbit = (a: OwnerSummary, b: OwnerSummary) => b.in_orbit - a.in_orbit || a.name.localeCompare(b.name);
const byName = (a: OwnerSummary, b: OwnerSummary) => a.name.localeCompare(b.name, "en", { sensitivity: "base" });

function option(o: OwnerSummary, group: string, heading?: string): PickerOption {
  return { id: `${group}-${o.code}`, code: o.code, label: ownerDisplay(o), count: o.in_orbit, dim: o.in_orbit === 0, heading };
}

/** The owner picker's options: with no query, "All owners", the largest owners, then everyone A–Z;
 * with a query, the owners whose name or code contains it (case-insensitive), largest first. */
export function pickerOptions(list: readonly OwnerSummary[], query: string): PickerOption[] {
  const q = query.trim().toLowerCase();
  if (q) {
    return list
      .filter((o) => o.name.toLowerCase().includes(q) || o.code.toLowerCase().includes(q))
      .sort(byInOrbit)
      .map((o) => option(o, "match"));
  }
  const largest = [...list].sort(byInOrbit).slice(0, LARGEST);
  const az = [...list].sort(byName);
  return [
    { id: "all", code: null, label: "All owners", count: null, dim: false },
    ...largest.map((o, i) => option(o, "largest", i === 0 ? "Largest" : undefined)),
    ...az.map((o, i) => option(o, "az", i === 0 ? "All owners A–Z" : undefined)),
  ];
}
