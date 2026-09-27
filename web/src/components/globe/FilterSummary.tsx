"use client";

import { useId } from "react";
import { isDefaultFilters, orbitsText, ownerText, typesText } from "@/lib/filterSummary";
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
  const descId = useId();
  const f = { types, owners, orbits };
  if (isDefaultFilters(f)) return null;
  const owner = ownerText(f.owners, directory);
  return (
    <div
      role="group"
      aria-label="Active filters"
      data-testid="filter-summary"
      className="label pointer-events-auto flex max-w-full items-center justify-center gap-x-2 rounded-full border-2 border-line bg-[#121212] px-3 py-2 !text-ink"
    >
      {/* flex-nowrap (not flex-wrap) keeps Reset on the same row as this button always — even
          when its own text needs two lines — instead of the two of them stacking into a third
          line; flex-1 + min-w-0 let it (not Reset) claim the shrinkable space and wrap there. The
          visible text alone doesn't say what the button does; aria-describedby adds that without
          changing its accessible name (which stays the full filter summary, unabridged — the
          OWNER segment below is only visually truncated). */}
      <button type="button" onClick={() => openPanel("filters")} aria-describedby={descId} className="line-clamp-2 min-w-0 flex-1 text-center hover:underline">
        <span className="text-ink-3">Showing </span>
        {orbitsText(f.orbits)}
        <span className="text-ink-3"> · </span>
        <span className="inline-block max-w-[16ch] truncate align-bottom" title={owner}>{owner}</span>
        <span className="text-ink-3"> · </span>
        {typesText(f.types)}
      </button>
      <span id={descId} className="sr-only">Opens the Filters panel</span>
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
