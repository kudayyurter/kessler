"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { fmtDate } from "@/lib/format";
import { countUp } from "@/lib/motion";
import { GLOBE_COLORS, TYPE_LABELS, type Meta, type ObjectType } from "@/lib/types";
import { ATTRIBUTION } from "@/components/panels/Footer";
import { Unavailable } from "@/components/ui/Unavailable";

const TYPES: ObjectType[] = ["PAY", "DEB", "R/B"];

function Count({ type, value, index }: { type: ObjectType; value: number | null; index: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  // The value actually on screen right now (as opposed to `value`, which may have just changed
  // to a new target) — updated on every tick via countUp's onValue, not eagerly set to the target
  // when a tween starts. A later update (e.g. a background refresh triggered by dataVersion)
  // counts up from here instead of from 0, so it doesn't visually reset the tile; and Strict
  // Mode's mount-cleanup-remount cancels the first tween near its start (not near its target), so
  // the remount still counts up instead of animating target->target. Null before the first
  // animation, so the first mount still counts up from 0.
  const shownRef = useRef<number | null>(null);
  useEffect(() => {
    if (!ref.current || value === null) return;
    const anim = countUp(ref.current, value, 300 + index * 120, shownRef.current ?? 0, (v) => {
      shownRef.current = v;
    });
    return () => {
      anim?.cancel();
    };
  }, [value, index]);
  return (
    <div data-testid={`tile-${type}`} className="flex items-baseline justify-between gap-3">
      <span className="text-[13px] text-ink-2">{TYPE_LABELS[type]}</span>
      <span ref={ref} className="font-mono text-[22px] tabular-nums" style={{ color: GLOBE_COLORS[type] }}>{value === null ? "—" : "0"}</span>
    </div>
  );
}

export function Overview({ meta, error }: { meta: Meta | null; error: boolean }) {
  const asOf = meta?.data_as_of.gp ?? meta?.data_as_of.satcat ?? null;
  return (
    <div>
      <p className="font-mono text-[22px] leading-tight text-ink">KESSLER</p>
      <p className="mt-1 text-[13px] leading-snug text-ink-2">Every tracked object in Earth orbit, 1957 to now.</p>
      <p className="label mt-3">In low Earth orbit now</p>
      {error ? <Unavailable what="object counts" /> : (
        <div className="mt-1 flex flex-col gap-1">{TYPES.map((t, i) => <Count key={t} type={t} index={i} value={meta?.in_orbit[t]?.LEO ?? null} />)}</div>
      )}
      <p className="mt-3 font-mono text-[12px] text-ink-3">{ATTRIBUTION}{asOf ? ` Updated ${fmtDate(asOf)}.` : ""}</p>
      <p className="mt-2 flex gap-4 text-[13px] text-ink-2">
        <Link href="/about" className="hover:text-ink">About</Link>
        <a href="https://kudayyurter.dev" className="hover:text-ink">kudayyurter.dev ↗</a>
      </p>
    </div>
  );
}
