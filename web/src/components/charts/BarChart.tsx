"use client";

import { animate, stagger } from "animejs";
import { scaleBand, scaleLinear } from "d3-scale";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ownerHighlight, ownerLabel, TYPE_ORDER } from "@/lib/chartData";
import { fmtInt } from "@/lib/format";
import { prefersReducedMotion } from "@/lib/motion";
import { CHART_COLORS, TYPE_LABELS, type BreakdownResponse, type ObjectType, type OwnerSummary } from "@/lib/types";
import { labelColumn, tooltipPosition } from "@/components/charts/scales";

const KEYS: ObjectType[] = TYPE_ORDER;
const M = { t: 8, r: 60, b: 8 };

export function BarChart({ data, owners, selected = null }: { data: BreakdownResponse; owners: OwnerSummary[]; selected?: string | null }) {
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(360);
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const [tipSize, setTipSize] = useState({ w: 200, h: 90 });

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (tip && tipRef.current) {
      const r = tipRef.current.getBoundingClientRect();
      if (r.width && r.height) setTipSize({ w: r.width, h: r.height });
    }
  }, [tip]);

  const { highlight, extra } = ownerHighlight(data, selected);
  const ranked = data.rows.slice(0, 6);
  const rows = extra ? [...ranked, extra] : ranked;
  const tooltipLabels = rows.map((r) => ownerLabel(r.key, owners));
  const labels = rows.map((r, i) => (extra && r === extra ? `${tooltipLabels[i]} #${extra.rank ?? "—"}` : tooltipLabels[i]));
  const { marginLeft, display } = labelColumn(labels, width);
  const H = Math.max(160, rows.length * 48 + M.t + M.b);
  const x = scaleLinear().domain([0, Math.max(1, ...rows.map((r) => r.total))]).range([marginLeft, width - M.r]);
  const y = scaleBand().domain(rows.map((r) => r.key)).range([M.t, H - M.b]).padding(0.38);

  // Keyed on the ranked rows only (not `data` as a whole, and not `extra`): picking or changing
  // the selected owner changes the breakdown request's `rank_of` param, which changes the
  // response object even when the ranked rows themselves are byte-for-byte identical — that must
  // not replay this entrance animation (only the highlight/dim/extra row should change). A newly
  // appearing or changing extra row's own segments simply render at their laid-out size with no
  // entrance animation, since they're not covered by this effect's reset+animate pass.
  const rowsKey = useMemo(() => JSON.stringify(data.rows.slice(0, 6)), [data.rows]);

  useEffect(() => {
    const el = svg.current;
    if (!el || prefersReducedMotion()) return;
    const segs = el.querySelectorAll<SVGRectElement>("rect[data-seg]");
    segs.forEach((s) => (s.style.transform = "scaleX(0)"));
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        animate(Array.from(segs), { scaleX: [0, 1], delay: stagger(60), duration: 800, ease: "outBack(1.4)" });
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rowsKey]);

  const tipPos = tip ? tooltipPosition(tip.x, tip.y, window.innerWidth, window.innerHeight, tipSize.w, tipSize.h) : null;

  return (
    <div ref={wrap} className="relative">
      <div className="mb-2 flex flex-wrap gap-4 text-[13px] text-ink-2">
        {KEYS.map((k) => (
          <span key={k} className="inline-flex items-center gap-2">
            <i className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: CHART_COLORS[k] }} />
            {TYPE_LABELS[k]}
          </span>
        ))}
      </div>
      <svg ref={svg} width={width} height={H} role="img" aria-label="Objects in orbit by owner and type" className="block max-w-full">
        {rows.map((row, i) => {
          let acc = 0;
          return (
            <g
              key={row.key}
              data-row={row.key}
              data-highlight={row.key === highlight ? "true" : undefined}
              opacity={highlight && row.key !== highlight ? 0.35 : 1}
            >
              <text x={marginLeft - 10} y={(y(row.key) ?? 0) + y.bandwidth() / 2 + 4} textAnchor="end" className="fill-ink font-mono text-[12px]">
                {display[i]}
              </text>
              {KEYS.map((k) => {
                const v = row.counts[k] ?? 0;
                if (!v) return null;
                const x0 = x(acc) + (acc ? 1 : 0);
                acc += v;
                const w = Math.max(0, x(acc) - x0 - 1);
                return (
                  <rect
                    key={k}
                    data-seg
                    x={x0}
                    y={y(row.key)}
                    width={w}
                    height={y.bandwidth()}
                    rx={4}
                    fill={CHART_COLORS[k]}
                    style={{ transformOrigin: `${marginLeft}px 0px` }}
                    onPointerMove={(e) => setTip({ text: `${tooltipLabels[i]} · ${TYPE_LABELS[k]}: ${fmtInt(v)}`, x: e.clientX, y: e.clientY })}
                    onPointerLeave={() => setTip(null)}
                  />
                );
              })}
              {row.key === highlight && row.total > 0 && (
                <rect
                  x={marginLeft - 3}
                  y={(y(row.key) ?? 0) - 3}
                  width={x(row.total) - marginLeft + 6}
                  height={y.bandwidth() + 6}
                  rx={6}
                  fill="none"
                  stroke="#f4f4f2"
                  strokeWidth={2}
                  pointerEvents="none"
                />
              )}
              <text x={x(row.total) + 8} y={(y(row.key) ?? 0) + y.bandwidth() / 2 + 4} className="fill-ink-2 font-mono text-[12px]">
                {fmtInt(row.total)}
              </text>
            </g>
          );
        })}
        {extra && (
          <line
            x1={0}
            x2={width}
            y1={(y(extra.key) ?? 0) - (y.step() - y.bandwidth()) / 2}
            y2={(y(extra.key) ?? 0) - (y.step() - y.bandwidth()) / 2}
            stroke="#2a2a2a"
            strokeWidth={2}
            strokeDasharray="4 4"
          />
        )}
      </svg>
      {tip && tipPos && (
        <div
          ref={tipRef}
          className="pointer-events-none fixed z-10 rounded-[10px] border-2 border-[#333] bg-[#161616] px-3 py-2.5 text-[13px] text-ink shadow-[3px_3px_0_#0a0a0a]"
          style={{ left: tipPos.left, top: tipPos.top }}
        >
          {tip.text}
        </div>
      )}
    </div>
  );
}
