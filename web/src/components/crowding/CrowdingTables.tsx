"use client";

import type { CrowdingChange } from "@/lib/crowding/change";
import { ALL_ROWS } from "@/lib/crowding/draw";
import type { CrowdingMap } from "@/lib/crowding/grid";
import { changeRows, shellRows, topCells, type ChangeRow } from "@/lib/crowding/tables";
import { fmtAvg, fmtDensity } from "@/lib/crowding/text";
import { OBJECT_TYPES, TYPE_LABELS } from "@/lib/types";

const th = "px-2 py-1 text-right font-normal text-ink-2";
const td = "px-2 py-1 text-right text-ink";
const table = "w-full border-collapse font-mono text-[12px]";
const caption = "px-2 py-1 text-left text-[11px] text-ink-3";

function ChangeTable({ title, rows }: { title: string; rows: ChangeRow[] }) {
  return (
    <table className={table}>
      <caption className={caption}>{title}</caption>
      <thead className="sticky top-0 bg-[#121212]">
        <tr>
          <th scope="col" className={`${th} text-left`}>Cell</th>
          {["Net", "New", "Moved in", "Moved out", "Re-entered", "No longer tracked"].map((h) => <th key={h} scope="col" className={th}>{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className="even:bg-[#111]">
            <th scope="row" className={`${td} text-left font-normal`}>{r.label}</th>
            {[r.net, r.new, r.movedIn, r.movedOut, r.reentered, r.untracked].map((v, i) => <td key={i} className={td}>{fmtAvg(v)}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The expanded view's numbers as tables: busiest cells and shell densities (Now), largest gains
 * and losses by cause (Change). */
export function CrowdingTables({ mode, map, change }: { mode: "now" | "change"; map: CrowdingMap | null; change: CrowdingChange | null }) {
  if (mode === "change") {
    if (!change) return null;
    const { gains, losses } = changeRows(change, ALL_ROWS);
    return (
      <>
        <ChangeTable title="Largest gains (average objects)" rows={gains} />
        <ChangeTable title="Largest losses (average objects)" rows={losses} />
      </>
    );
  }
  if (!map) return null;
  return (
    <>
      <table className={table}>
        <caption className={caption}>Busiest cells: average objects present at any moment</caption>
        <thead className="sticky top-0 bg-[#121212]">
          <tr>
            <th scope="col" className={`${th} text-left`}>Cell</th>
            <th scope="col" className={th}>Objects</th>
            {OBJECT_TYPES.map((t) => <th key={t} scope="col" className={th}>{TYPE_LABELS[t]}</th>)}
          </tr>
        </thead>
        <tbody>
          {topCells(map, ALL_ROWS).map((r) => (
            <tr key={r.label} className="even:bg-[#111]">
              <th scope="row" className={`${td} text-left font-normal`}>{r.label}</th>
              <td className={td}>{fmtAvg(r.total)}</td>
              {OBJECT_TYPES.map((t) => <td key={t} className={td}>{fmtAvg(r.byType[t])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <table className={table}>
        <caption className={caption}>Spatial density per shell (objects per 10⁹ km³)</caption>
        <thead className="sticky top-0 bg-[#121212]">
          <tr>
            <th scope="col" className={`${th} text-left`}>Shell</th>
            <th scope="col" className={th}>All</th>
            {OBJECT_TYPES.map((t) => <th key={t} scope="col" className={th}>{TYPE_LABELS[t]}</th>)}
          </tr>
        </thead>
        <tbody>
          {shellRows(map).map((r) => (
            <tr key={r.label} className="even:bg-[#111]">
              <th scope="row" className={`${td} text-left font-normal`}>{r.label}</th>
              <td className={td}>{fmtDensity(r.density)}</td>
              {OBJECT_TYPES.map((t) => <td key={t} className={td}>{fmtDensity(r.byType[t])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
