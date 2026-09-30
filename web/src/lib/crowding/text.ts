import { busiestShell, cellIndex, cellLabel, FIRST_LEO_ROW, LAST_LEO_ROW, rowLabel, shellDensity, type Cell, type CrowdingMap } from "@/lib/crowding/grid";
import type { CrowdingChange, Mover } from "@/lib/crowding/change";
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

/** "09-22 18:41" from an ISO time (UTC). */
export function shortStamp(iso: string): string {
  return `${iso.slice(5, 10)} ${iso.slice(11, 16)}`;
}

const signed = (n: number, fmt: (v: number) => string) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmt(Math.abs(n))}`;

export function summaryLine(counts: CrowdingChange["counts"], fromStamp: string): string {
  const net = counts.new - counts.reentered - counts.untracked;
  const parts = [`+${fmtInt(counts.new)} newly catalogued`, `−${fmtInt(counts.reentered)} re-entered`];
  if (counts.untracked > 0) parts.push(`−${fmtInt(counts.untracked)} no longer tracked`);
  parts.push(`${fmtInt(counts.moved)} moved between cells`, `net ${signed(net, fmtInt)}`);
  return `Since ${fromStamp} UTC: ${parts.join(" · ")}`;
}

export function changeCardRows(change: CrowdingChange, cell: Cell): { label: string; value: string }[] {
  const k = cellIndex(cell.row, cell.col);
  const rows = [
    { label: "net change", value: signed(change.net[k], fmtAvg) },
    { label: "moved out", value: fmtAvg(change.cause.movedOut[k]) },
    { label: "moved in", value: fmtAvg(change.cause.movedIn[k]) },
    { label: "newly catalogued", value: fmtAvg(change.cause.new[k]) },
    { label: "re-entered", value: fmtAvg(change.cause.reentered[k]) },
  ];
  if (change.cause.untracked[k] > 0) rows.push({ label: "no longer tracked", value: fmtAvg(change.cause.untracked[k]) });
  return rows;
}

export function changeAnnouncement(change: CrowdingChange, cell: Cell): string {
  return `${cellLabel(cell)}. ${changeCardRows(change, cell).map((r) => `${r.label} ${r.value}`).join(", ")}`;
}

const km = (altKm: number) => fmtInt(Math.round(altKm));

export function moverLine(m: Mover, name: string): string {
  if (m.cause === "new") return `${name}: newly catalogued at ${km(m.after!.altKm)} km`;
  if (m.cause === "reentered") return `${name}: re-entered`;
  if (m.cause === "untracked") return `${name}: no longer tracked`;
  const { before, after } = m as { before: NonNullable<Mover["before"]>; after: NonNullable<Mover["after"]> };
  const inc = Math.abs(after.incDeg - before.incDeg) >= 0.1 ? `, ${ONE_DECIMAL.format(before.incDeg)}° → ${ONE_DECIMAL.format(after.incDeg)}°` : "";
  return `${name}: ${km(before.altKm)} → ${km(after.altKm)} km${inc}`;
}
