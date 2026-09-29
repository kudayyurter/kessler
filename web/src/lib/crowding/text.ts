import { busiestShell, cellIndex, cellLabel, FIRST_LEO_ROW, LAST_LEO_ROW, rowLabel, shellDensity, type Cell, type CrowdingMap } from "@/lib/crowding/grid";
import { fmtInt } from "@/lib/format";
import { OBJECT_TYPES, type ObjectType } from "@/lib/types";

const ONE_DECIMAL = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const TWO_DECIMALS = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

/** Average objects: one decimal below 100 ("2.6"), whole numbers above ("4,370"). */
export function fmtAvg(v: number): string {
  return Math.abs(v) >= 100 ? fmtInt(Math.round(v)) : ONE_DECIMAL.format(v);
}

/** Objects per 10⁹ km³: whole numbers from 10, one decimal from 1, two below. */
export function fmtDensity(d: number): string {
  if (d >= 10) return fmtInt(Math.round(d));
  if (d >= 1) return ONE_DECIMAL.format(d);
  return TWO_DECIMALS.format(d);
}

export const TYPE_WORDS: Record<ObjectType, string> = { PAY: "payloads", "R/B": "rocket bodies", DEB: "debris", UNK: "unknown" };

export function busiestLine(map: CrowdingMap): string {
  const b = busiestShell(map);
  return b ? `Busiest shell ${rowLabel(b.row)} · ${fmtDensity(b.density)} per 10⁹ km³` : "No objects in low Earth orbit under these filters.";
}

export function cellSummary(map: CrowdingMap, cell: Cell): { title: string; lines: string[] } {
  const k = cellIndex(cell.row, cell.col);
  const types = OBJECT_TYPES.filter((t) => map.byType[t][k] >= 0.05).map((t) => `${fmtAvg(map.byType[t][k])} ${TYPE_WORDS[t]}`);
  const inLeo = cell.row >= FIRST_LEO_ROW && cell.row <= LAST_LEO_ROW;
  const pass = `${fmtInt(map.passing[k])} pass through${inLeo && map.passing[k] > 0 ? ` · shell ${fmtDensity(shellDensity(map, cell.row))} per 10⁹ km³` : ""}`;
  return {
    title: cellLabel(cell),
    lines: [`≈ ${fmtAvg(map.total[k])} objects at any moment`, ...(types.length ? [types.join(" · ")] : []), pass],
  };
}

export function cellAnnouncement(map: CrowdingMap, cell: Cell): string {
  const s = cellSummary(map, cell);
  return [s.title, ...s.lines].join(". ");
}
