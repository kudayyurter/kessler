"use client";

import { filterScope, isDefaultFilters } from "@/lib/filterSummary";
import { useExplorer } from "@/lib/store";

/** "Showing Higher orbits · 🇺🇸 United States · 3 of 4 types" + Reset — only when the filters
 * differ from the default, so a hidden filter never makes the globe or charts look broken. */
export function FilterSummary() {
  const types = useExplorer((s) => s.types);
  const owners = useExplorer((s) => s.owners);
  const orbits = useExplorer((s) => s.orbits);
  const directory = useExplorer((s) => s.ownerDirectory);
  const resetFilters = useExplorer((s) => s.resetFilters);
  const openPanel = useExplorer((s) => s.openPanel);
  const f = { types, owners, orbits };
  if (isDefaultFilters(f)) return null;
  return (
    <div
      role="group"
      aria-label="Active filters"
      data-testid="filter-summary"
      className="label pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-full border-2 border-line bg-[#121212] px-3 py-2 !text-ink"
    >
      <button type="button" onClick={() => openPanel("filters")} className="text-center hover:underline">
        <span className="text-ink-3">Showing </span>
        {filterScope(f, directory)}
      </button>
      <button
        type="button"
        aria-label="Reset filters"
        onClick={resetFilters}
        className="min-h-6 whitespace-nowrap rounded-full border-2 border-line bg-[#1a1a1a] px-2 text-[11px] text-ink hover:bg-[#222]"
      >
        Reset
      </button>
    </div>
  );
}
