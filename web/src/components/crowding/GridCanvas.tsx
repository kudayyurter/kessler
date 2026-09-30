"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  axisLabels, cellAt, cellRect, changeColor, EMPTY_FILL, gridLayout, maxAbs, moveCell, nowColor, OUTLINE, strongestCell,
} from "@/lib/crowding/draw";
import { cellIndex, COLS, type Cell } from "@/lib/crowding/grid";

export interface GridCanvasProps {
  /** ROWS × COLS values: average objects (Now) or net change (Change). */
  values: Float64Array;
  /** Grid rows to draw, bottom to top. */
  rows: readonly number[];
  mode: "now" | "change";
  cellW: number;
  cellH: number;
  /** "ticks": altitude and inclination ticks; "names": one name per row (the high strip). */
  axes: "ticks" | "names";
  /** The cell drawn with an outline (the pinned or selected one). */
  pinned: Cell | null;
  label: string;
  describedBy?: string;
  onHover: (cell: Cell | null) => void;
  onSelect: (cell: Cell) => void;
  /** Keyboard focus moved to a cell (announce it). */
  onFocusCell: (cell: Cell) => void;
  /** Escape was pressed; return true when it was handled here (so a dialog doesn't also close). */
  onEscape: () => boolean;
}

/** Left margin for labels: narrower on the small panel's compact map (cells under 4 px tall). */
const padLeftFor = (cellH: number) => (cellH >= 4 ? 44 : 30);
const PAD_BOTTOM = 18;

/** A crowding grid drawn on a canvas. It is one focusable element: arrow keys move a focus cell
 * (Shift jumps to the next drawn cell), Enter selects, Escape clears. */
export function GridCanvas(p: GridCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  // Set between pointerdown and pointerup: focus that comes from a click must not start keyboard
  // navigation (or announce a cell the user didn't pick).
  const pointer = useRef(false);
  const [focus, setFocus] = useState<Cell | null>(null);
  const [focused, setFocused] = useState(false);
  const layout = useMemo(
    () => gridLayout(p.rows, p.cellW, p.cellH, padLeftFor(p.cellH), p.axes === "ticks" ? PAD_BOTTOM : 0),
    [p.rows, p.cellW, p.cellH, p.axes],
  );
  const scale = useMemo(() => maxAbs(p.values, p.rows), [p.values, p.rows]);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(layout.width * dpr);
    canvas.height = Math.round(layout.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, layout.width, layout.height);
    ctx.fillStyle = EMPTY_FILL;
    ctx.fillRect(layout.padLeft, 0, COLS * layout.cellW, layout.rows.length * layout.cellH);
    for (const row of layout.rows) {
      for (let col = 0; col < COLS; col++) {
        const v = p.values[cellIndex(row, col)];
        const fill = p.mode === "now" ? nowColor(v, scale) : changeColor(v, scale);
        const r = fill && cellRect(layout, { row, col });
        if (!r) continue;
        ctx.fillStyle = fill;
        ctx.fillRect(r.x, r.y, Math.ceil(r.w), Math.ceil(r.h));
      }
    }
    ctx.fillStyle = "#a8a7a1";
    const px = p.axes === "names" ? Math.min(10, layout.cellH - 1) : layout.cellH >= 4 ? 11 : 9;
    ctx.font = `${px}px ${getComputedStyle(canvas).fontFamily}`;
    ctx.textBaseline = "middle";
    for (const t of axisLabels(layout, p.axes)) ctx.fillText(t.text, t.x, t.y);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = OUTLINE;
    for (const c of [p.pinned, focused ? focus : null]) {
      const r = c && cellRect(layout, c);
      if (r) ctx.strokeRect(r.x - 1.5, r.y - 1.5, r.w + 3, r.h + 3);
    }
  }, [layout, p.values, p.mode, p.pinned, p.axes, scale, focus, focused]);

  const cellOf = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return cellAt(layout, e.clientX - box.left, e.clientY - box.top);
  };
  const startCell = (): Cell => focus ?? p.pinned ?? strongestCell(p.values, p.rows) ?? { row: p.rows[0], col: 0 };
  const moveTo = (c: Cell) => {
    setFocus(c);
    p.onFocusCell(c);
  };

  return (
    <canvas
      ref={ref}
      role="group"
      tabIndex={0}
      aria-roledescription="crowding map"
      aria-label={p.label}
      aria-describedby={p.describedBy}
      data-cell-w={p.cellW}
      data-cell-h={p.cellH}
      data-pad-left={layout.padLeft}
      data-first-row={p.rows[0]}
      data-row-count={p.rows.length}
      style={{ width: layout.width, height: layout.height }}
      className="block shrink-0 cursor-crosshair touch-manipulation rounded-[4px] outline-none focus-visible:ring-2 focus-visible:ring-[#7fd06b]"
      onPointerDown={() => {
        pointer.current = true;
      }}
      onPointerUp={() => {
        pointer.current = false;
      }}
      onPointerMove={(e) => p.onHover(cellOf(e))}
      onPointerLeave={() => p.onHover(null)}
      onClick={(e) => {
        const c = cellOf(e);
        if (c) p.onSelect(c);
      }}
      onFocus={() => {
        setFocused(true);
        if (!pointer.current) moveTo(startCell());
      }}
      onBlur={() => {
        setFocused(false);
        p.onHover(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          if (p.onEscape()) e.stopPropagation();
          return;
        }
        if (focus === null) {
          // Focused by a click: the first key starts keyboard navigation where it would have begun.
          if (e.key === "Enter" || e.key === " " || e.key.startsWith("Arrow")) {
            e.preventDefault();
            moveTo(startCell());
          }
          return;
        }
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          p.onSelect(focus);
          return;
        }
        const next = moveCell(e.key, focus, p.rows, p.values, e.shiftKey);
        if (next) {
          e.preventDefault();
          moveTo(next);
        }
      }}
    />
  );
}
