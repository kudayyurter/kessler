"use client";

import { useEffect, useState } from "react";
import { useCrowdingMovers } from "@/components/crowding/CrowdingProvider";
import type { CrowdingChange } from "@/lib/crowding/change";
import { cellIndex, cellLabel, type Cell, type CrowdingMap } from "@/lib/crowding/grid";
import { cellSummary, changeCardRows, moverLine } from "@/lib/crowding/text";
import { nameCache } from "@/lib/names";

/** Object names from the globe's names files (both groups), for the movers list. */
function useObjectNames(): Map<number, string> {
  const [names, setNames] = useState<Map<number, string>>(() => new Map());
  useEffect(() => {
    let cancelled = false;
    void Promise.all([nameCache.get("LEO"), nameCache.get("HIGH")]).then(([leo, high]) => {
      if (!cancelled) setNames(new Map([...(leo ?? []), ...(high ?? [])]));
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return names;
}

export function CellCard({ cell, mode, map, change, from, to, onShowOnGlobe }: {
  cell: Cell;
  mode: "now" | "change";
  map: CrowdingMap | null;
  change: CrowdingChange | null;
  from: string | null;
  to: string | null;
  onShowOnGlobe: () => void;
}) {
  const movers = useCrowdingMovers(mode === "change" ? from : null, mode === "change" ? to : null, cellIndex(cell.row, cell.col));
  const names = useObjectNames();
  return (
    <div data-testid="cell-card" className="w-full self-start rounded-[10px] border-2 border-[#3a3a3a] bg-[#101010] p-2.5 text-[11px] leading-relaxed text-ink-2 shadow-[3px_3px_0_#1c1c1c] wide:w-[250px]">
      <h3 className="mb-1 font-mono text-[12px] font-normal text-ink">{cellLabel(cell)}</h3>
      {mode === "now" && map && cellSummary(map, cell).lines.map((l) => <p key={l}>{l}</p>)}
      {mode === "change" && change && (
        <>
          <dl>
            {changeCardRows(change, cell).map((r) => (
              <div key={r.label} className="flex justify-between gap-3">
                <dt>{r.label}</dt>
                <dd className="text-ink">{r.value}</dd>
              </div>
            ))}
          </dl>
          {movers.data && movers.data.length > 0 && (
            <ul className="mt-1.5 text-ink-3">
              {movers.data.map((m) => <li key={m.noradId}>{moverLine(m, names.get(m.noradId) ?? String(m.noradId))}</li>)}
            </ul>
          )}
        </>
      )}
      <button type="button" onClick={onShowOnGlobe} className="mt-2 min-h-8 rounded-full border-2 border-[#4a4a4a] px-3 text-ink hover:bg-[#1a1a1a]">
        Show on globe
      </button>
    </div>
  );
}
