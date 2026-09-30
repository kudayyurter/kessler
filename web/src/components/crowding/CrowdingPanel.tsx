"use client";

import { useId, useState } from "react";
import { useCrowding, useCrowdingMap } from "@/components/crowding/CrowdingProvider";
import { DensityStrip } from "@/components/crowding/DensityStrip";
import { GridCanvas } from "@/components/crowding/GridCanvas";
import { Unavailable } from "@/components/ui/Unavailable";
import { LEO_AND_FLOOR_ROWS } from "@/lib/crowding/draw";
import type { Cell } from "@/lib/crowding/grid";
import { busiestLine, cellAnnouncement, cellSummary } from "@/lib/crowding/text";
import { useExplorer } from "@/lib/store";

export const sameCell = (a: Cell | null, b: Cell | null): boolean => !!a && !!b && a.row === b.row && a.col === b.col;
export const retryButton = "min-h-8 rounded-full border-2 border-line bg-[#121212] px-3 text-[12px] text-ink-2 hover:text-ink";

/** The small Crowding panel: today's map of the floor and LEO rows with the density strip. Hover
 * lights the cell's objects up on the globe; a click pins the cell as a filter. */
export function CrowdingPanel() {
  const { status, index, retry } = useCrowding();
  const map = useCrowdingMap(index?.latest?.day ?? null);
  const pinned = useExplorer((s) => s.shell);
  const pinShell = useExplorer((s) => s.pinShell);
  const setHoverShell = useExplorer((s) => s.setHoverShell);
  const announce = useExplorer((s) => s.announce);
  const setCrowdingView = useExplorer((s) => s.setCrowdingView);
  const leo = useExplorer((s) => s.orbits.leo);
  const [hover, setHover] = useState<Cell | null>(null);
  const helpId = useId();

  if (status === "empty") return <p className="text-[13px] text-ink-2">No crowding data yet.</p>;
  if (status === "error" || (map.error && !map.data)) {
    return (
      <div className="flex items-center gap-3">
        <Unavailable what="crowding" />
        <button type="button" onClick={retry} className={retryButton}>Retry</button>
      </div>
    );
  }
  if (!map.data) return <p role="status" className="text-[13px] text-ink-3">Loading…</p>;
  const data = map.data;
  const shown = hover ?? pinned;
  const summary = shown ? cellSummary(data, shown) : null;
  const hoverOn = (c: Cell | null) => {
    setHover(c);
    setHoverShell(c);
  };
  return (
    <div>
      <div className="mb-1 flex justify-end">
        <button
          type="button"
          data-crowding-expand
          aria-label="Expand crowding view"
          onClick={() => setCrowdingView(true)}
          className="min-h-7 rounded-full border-2 border-line bg-[#121212] px-2.5 text-[11px] text-ink-2 hover:text-ink"
        >
          ⤢ Expand
        </button>
      </div>
      <div className="flex gap-1.5">
        <GridCanvas
          values={data.total}
          rows={LEO_AND_FLOOR_ROWS}
          mode="now"
          cellW={2.2}
          cellH={3}
          axes="ticks"
          pinned={pinned}
          label="Crowding map"
          describedBy={helpId}
          onHover={hoverOn}
          onSelect={(c) => pinShell(sameCell(c, pinned) ? null : c)}
          onFocusCell={(c) => {
            hoverOn(c);
            announce(cellAnnouncement(data, c));
          }}
          onEscape={() => {
            if (!pinned) return false;
            pinShell(null);
            return true;
          }}
        />
        <DensityStrip rows={LEO_AND_FLOOR_ROWS} cellH={3} width={44} padBottom={18} map={data} />
      </div>
      <p id={helpId} className="sr-only">
        Altitude increases upwards and inclination to the right. Arrow keys move between cells; Shift with an arrow jumps to the next
        busy cell; Enter shows only that cell&apos;s objects on the globe; Escape clears it.
      </p>
      <p className="mt-1 text-[12px] text-ink-2">{leo ? busiestLine(data) : "Low Earth orbit is filtered out."}</p>
      <div className="mt-1 min-h-[76px] text-[12px] leading-snug text-ink-2">
        {summary ? (
          <>
            <p className="text-ink">{summary.title}</p>
            {summary.lines.map((l) => <p key={l}>{l}</p>)}
            <p className="text-ink-3">{sameCell(shown, pinned) ? "Only these are shown on the globe · click again to clear" : "Click to show only these on the globe"}</p>
          </>
        ) : (
          <p className="text-ink-3">Hover a cell for its numbers.</p>
        )}
      </div>
    </div>
  );
}
