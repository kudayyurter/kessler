"use client";

import { useId } from "react";
import { shellLabel } from "@/lib/crowding/shell";
import { filterScope, isDefaultFilters, orbitsText, ownerText, typesText } from "@/lib/filterSummary";
import { focusFiltersEntry } from "@/lib/focusFilters";
import { useExplorer } from "@/lib/store";

/** "Showing Higher orbits · 🇺🇸 United States · 3 of 4 types" + Reset — only when the filters
 * differ from the default, so a hidden filter never makes the globe or charts look broken. */
export function FilterSummary() {
  const types = useExplorer((s) => s.types);
  const owners = useExplorer((s) => s.owners);
  const orbits = useExplorer((s) => s.orbits);
  const shell = useExplorer((s) => s.shell);
  const directory = useExplorer((s) => s.ownerDirectory);
  const resetFilters = useExplorer((s) => s.resetFilters);
  const openPanel = useExplorer((s) => s.openPanel);
  const announce = useExplorer((s) => s.announce);
  const descId = useId();
  const f = { types, owners, orbits, shell };
  if (isDefaultFilters(f)) return null;
  const owner = ownerText(f.owners, directory);
  const label = `Showing ${filterScope(f, directory)}`;
  // The accessible name must contain the visible text in both layouts — the full label matches
  // "Showing …" case-insensitively; the compact ("short:") layout shows only the word "Filtered"
  // (WCAG 2.5.3 Label in Name). `title` keeps the full "Showing …" text for a mouse hover tooltip.
  const accessibleName = `Filtered: showing ${filterScope(f, directory)}`;
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
          changing its accessible name (which comes from aria-label instead, so it stays the full
          filter summary, unabridged, even on short screens where the visible text collapses to
          "Filtered" — the OWNER segment below is only visually truncated). */}
      <button
        type="button"
        onClick={() => openPanel("filters")}
        aria-label={accessibleName}
        aria-describedby={descId}
        title={label}
        className="line-clamp-2 min-w-0 flex-1 text-center hover:underline"
      >
        <span className="short:hidden">
          <span className="text-ink-3">Showing </span>
          {orbitsText(f.orbits)}
          <span className="text-ink-3"> · </span>
          <span className="inline-block max-w-[16ch] truncate align-bottom" title={owner}>{owner}</span>
          <span className="text-ink-3"> · </span>
          {typesText(f.types)}
          {f.shell && (
            <>
              <span className="text-ink-3"> · </span>
              {shellLabel(f.shell)}
            </>
          )}
        </span>
        <span className="hidden short:inline">Filtered</span>
      </button>
      <span id={descId} className="sr-only">Opens the Filters panel</span>
      <button
        type="button"
        aria-label="Reset filters"
        onClick={() => {
          resetFilters();
          announce("Filters reset");
          // The pill unmounts with the reset; move focus once the page has re-rendered.
          requestAnimationFrame(() => focusFiltersEntry());
        }}
        className="min-h-6 whitespace-nowrap rounded-full border-2 border-line bg-[#1a1a1a] px-2 text-[11px] text-ink hover:bg-[#222]"
      >
        Reset
      </button>
    </div>
  );
}
