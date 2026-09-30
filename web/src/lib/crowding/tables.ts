import type { CrowdingChange } from "@/lib/crowding/change";
import { cellIndex, cellLabel, COLS, FIRST_LEO_ROW, LAST_LEO_ROW, rowLabel, shellDensity, type Cell, type CrowdingMap } from "@/lib/crowding/grid";
import { OBJECT_TYPES, type ObjectType } from "@/lib/types";

export interface CellRow { cell: Cell; label: string; total: number; byType: Record<ObjectType, number> }
export interface ShellRow { row: number; label: string; density: number; byType: Record<ObjectType, number> }
export interface ChangeRow { cell: Cell; label: string; net: number; new: number; movedIn: number; movedOut: number; reentered: number; untracked: number }

const byTypeAt = (map: CrowdingMap, k: number) =>
  Object.fromEntries(OBJECT_TYPES.map((t) => [t, map.byType[t][k]])) as Record<ObjectType, number>;

export function topCells(map: CrowdingMap, rows: readonly number[], n = 20): CellRow[] {
  const out: CellRow[] = [];
  for (const row of rows) {
    for (let col = 0; col < COLS; col++) {
      const k = cellIndex(row, col);
      if (map.total[k] > 0.005) out.push({ cell: { row, col }, label: cellLabel({ row, col }), total: map.total[k], byType: byTypeAt(map, k) });
    }
  }
  return out.sort((a, b) => b.total - a.total || a.cell.row - b.cell.row || a.cell.col - b.cell.col).slice(0, n);
}

export function shellRows(map: CrowdingMap): ShellRow[] {
  const out: ShellRow[] = [];
  for (let row = FIRST_LEO_ROW; row <= LAST_LEO_ROW; row++) {
    const density = shellDensity(map, row);
    if (density <= 0) continue;
    const byType = Object.fromEntries(OBJECT_TYPES.map((t) => [t, shellDensity(map, row, t)])) as Record<ObjectType, number>;
    out.push({ row, label: rowLabel(row), density, byType });
  }
  return out;
}

export function changeRows(change: CrowdingChange, rows: readonly number[], n = 20): { gains: ChangeRow[]; losses: ChangeRow[] } {
  const all: ChangeRow[] = [];
  for (const row of rows) {
    for (let col = 0; col < COLS; col++) {
      const k = cellIndex(row, col);
      if (Math.abs(change.net[k]) < 0.05) continue;
      all.push({
        cell: { row, col }, label: cellLabel({ row, col }), net: change.net[k], new: change.cause.new[k],
        movedIn: change.cause.movedIn[k], movedOut: change.cause.movedOut[k],
        reentered: change.cause.reentered[k], untracked: change.cause.untracked[k],
      });
    }
  }
  const order = (a: ChangeRow, b: ChangeRow) => Math.abs(b.net) - Math.abs(a.net) || a.cell.row - b.cell.row || a.cell.col - b.cell.col;
  return {
    gains: all.filter((r) => r.net > 0).sort(order).slice(0, n),
    losses: all.filter((r) => r.net < 0).sort(order).slice(0, n),
  };
}
