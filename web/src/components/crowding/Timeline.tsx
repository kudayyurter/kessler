"use client";

import type { CrowdingIndexDay } from "@/lib/api";
import { shortStamp } from "@/lib/crowding/text";

const button = "min-h-8 rounded-full border-2 border-line bg-[#121212] px-3 text-[11px] text-ink-2 hover:text-ink disabled:opacity-40";

/** Day sliders (one in Now mode, From and To in Change mode), Play, and the shown timestamps. */
export function Timeline({ entries, mode, from, to, onFrom, onTo, playing, canPlay, onPlay, loading }: {
  entries: readonly CrowdingIndexDay[];
  mode: "now" | "change";
  from: string | null;
  to: string;
  onFrom: (day: string) => void;
  onTo: (day: string) => void;
  playing: boolean;
  canPlay: boolean;
  onPlay: () => void;
  loading: string | null;
}) {
  const days = entries.map((e) => e.day);
  const stamp = (day: string | null) => {
    const e = entries.find((x) => x.day === day);
    return e ? shortStamp(e.generated_at) : "—";
  };
  const slider = (label: string, day: string, onChange: (d: string) => void) => (
    <input
      type="range"
      aria-label={label}
      aria-valuetext={day}
      min={0}
      max={Math.max(0, days.length - 1)}
      step={1}
      value={Math.max(0, days.indexOf(day))}
      onChange={(e) => onChange(days[Number(e.target.value)])}
      className="w-full accent-[#c9c8c2]"
    />
  );
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-ink-3">
      <button type="button" onClick={onPlay} disabled={!canPlay} className={button}>{playing ? "❚❚ Pause" : "▶ Play"}</button>
      <div className="flex min-w-[160px] flex-1 flex-col gap-1">
        {mode === "change" && from !== null && slider("From", from, onFrom)}
        {slider(mode === "change" ? "To" : "Day", to, onTo)}
      </div>
      <span>{mode === "change" ? `${stamp(from)} → ${stamp(to)}` : stamp(to)}</span>
      {loading && <span role="status">Loading {loading}…</span>}
    </div>
  );
}
