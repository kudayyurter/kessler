"use client";

import { useEffect, useRef } from "react";
import type { CrowdingChange } from "@/lib/crowding/change";
import { rowSum } from "@/lib/crowding/draw";
import { FIRST_LEO_ROW, LAST_LEO_ROW, shellDensity, shellVolumeKm3, type CrowdingMap } from "@/lib/crowding/grid";
import { CHART_COLORS, OBJECT_TYPES } from "@/lib/types";

/** Spatial density per LEO shell beside the map, on the same rows: stacked by type (Now), or the
 * change in density, left for lower and right for higher (Change). Decorative: the numbers are in
 * the tooltip, the card and the data table. */
export function DensityStrip({ rows, cellH, width, padBottom, map, change }: {
  rows: readonly number[];
  cellH: number;
  width: number;
  padBottom: number;
  map?: CrowdingMap | null;
  change?: CrowdingChange | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const height = rows.length * cellH + padBottom;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const leo = rows.filter((r) => r >= FIRST_LEO_ROW && r <= LAST_LEO_ROW);
    const yOf = (row: number) => (rows.length - 1 - rows.indexOf(row)) * cellH;
    if (map) {
      const max = Math.max(0, ...leo.map((r) => shellDensity(map, r)));
      for (const r of leo) {
        let x = 0;
        for (const t of OBJECT_TYPES) {
          const w = max > 0 ? (shellDensity(map, r, t) / max) * (width - 4) : 0;
          ctx.fillStyle = CHART_COLORS[t];
          ctx.fillRect(x, yOf(r), w, Math.max(1, cellH - 0.5));
          x += w;
        }
      }
    } else if (change) {
      const values = leo.map((r) => (rowSum(change.net, r) / shellVolumeKm3(r)) * 1e9);
      const max = Math.max(0, ...values.map(Math.abs));
      const mid = width / 2;
      ctx.fillStyle = "#262626";
      ctx.fillRect(mid, 0, 1, rows.length * cellH);
      leo.forEach((r, k) => {
        const w = max > 0 ? (values[k] / max) * (mid - 4) : 0;
        ctx.fillStyle = w > 0 ? "#ff6a3d" : "#7fb0ff";
        ctx.fillRect(w > 0 ? mid : mid + w, yOf(r), Math.abs(w), Math.max(1, cellH - 0.5));
      });
    }
    ctx.fillStyle = "#a8a7a1";
    ctx.font = `9px ${getComputedStyle(canvas).fontFamily}`;
    ctx.textBaseline = "middle";
    ctx.fillText(change && !map ? "density ±" : "density", 0, rows.length * cellH + padBottom / 2 + 1);
  }, [rows, cellH, width, padBottom, map, change]);
  return <canvas ref={ref} aria-hidden="true" style={{ width, height: rows.length * cellH + padBottom }} className="block shrink-0" />;
}
