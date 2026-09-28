"use client";

import { useId } from "react";
import { historyTable, ownersTable } from "@/lib/chartTables";
import { fmtInt } from "@/lib/format";
import { useExplorer } from "@/lib/store";
import { TYPE_LABELS, type BreakdownResponse, type ObjectType, type OwnerSummary, type TimeseriesResponse } from "@/lib/types";

/** "View data" / "Hide data" under a chart: the same numbers as a real table for keyboard and
 * screen-reader users. The scroll area is focusable so a keyboard can scroll it. */
export function DataDisclosure({ which, label, children }: { which: "history" | "owners"; label: string; children: React.ReactNode }) {
  const open = useExplorer((s) => s.dataTablesOpen[which]);
  const toggle = useExplorer((s) => s.toggleDataTable);
  const regionId = useId();
  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => toggle(which)}
        className="min-h-8 rounded-full border-2 border-line bg-[#121212] px-3 text-[12px] text-ink-2 hover:text-ink"
      >
        {open ? "Hide data" : "View data"}
      </button>
      <div
        id={regionId}
        role="region"
        aria-label={label}
        hidden={!open}
        tabIndex={open ? 0 : -1}
        className="mt-2 max-h-60 overflow-auto rounded-[10px] border-2 border-line"
      >
        {open && children}
      </div>
    </div>
  );
}

const th = "px-2 py-1 text-right font-normal text-ink-2";
const td = "px-2 py-1 text-right text-ink";

export function HistoryDataTable({ data }: { data: TimeseriesResponse }) {
  const t = historyTable(data);
  return (
    <table className="w-full border-collapse font-mono text-[12px]">
      <caption className="px-2 py-1 text-left text-[11px] text-ink-3">Objects in orbit at the end of each year</caption>
      <thead className="sticky top-0 bg-[#121212]">
        <tr>
          <th scope="col" className={`${th} text-left`}>Year</th>
          {t.columns.map((c) => <th key={c} scope="col" className={th}>{TYPE_LABELS[c]}</th>)}
          <th scope="col" className={th}>Total</th>
        </tr>
      </thead>
      <tbody>
        {t.rows.map((r) => (
          <tr key={r.year} className="even:bg-[#111]">
            <th scope="row" className={`${td} text-left font-normal`}>{r.year}</th>
            {r.values.map((v, i) => <td key={t.columns[i]} className={td}>{fmtInt(v)}</td>)}
            <td className={td}>{fmtInt(r.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function OwnersDataTable({
  data,
  owners,
  selected,
  rankFor,
  types,
}: {
  data: BreakdownResponse;
  owners: OwnerSummary[];
  selected: string | null;
  rankFor: string | null;
  types: readonly ObjectType[];
}) {
  const t = ownersTable(data, owners, selected, rankFor, types);
  return (
    <table className="w-full border-collapse font-mono text-[12px]">
      <caption className="px-2 py-1 text-left text-[11px] text-ink-3">Objects in orbit by owner and type</caption>
      <thead className="sticky top-0 bg-[#121212]">
        <tr>
          <th scope="col" className={th}>#</th>
          <th scope="col" className={`${th} text-left`}>Owner</th>
          {t.columns.map((c) => <th key={c} scope="col" className={th}>{TYPE_LABELS[c]}</th>)}
          <th scope="col" className={th}>Total</th>
        </tr>
      </thead>
      <tbody>
        {t.rows.map((r) => (
          <tr key={r.key} className={r.selected ? "bg-[#1d1d1d]" : "even:bg-[#111]"}>
            <td className={td}>{r.rank ?? (r.key === "_other" ? "" : "—")}</td>
            <th scope="row" className={`${td} text-left font-normal`}>{r.label}</th>
            {r.values.map((v, i) => <td key={t.columns[i]} className={td}>{fmtInt(v)}</td>)}
            <td className={td}>{fmtInt(r.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
