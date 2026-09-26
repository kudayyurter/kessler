"use client";

import { useEffect, useState } from "react";
import { deriveStatus, TONE_COLOR, type PillGroup, type PillInput } from "@/lib/freshness";

/** Wall-clock time, refreshed every `everyMs` (the pill's age only changes by the minute). Same
 * effect pattern as GlobeSection's Readout, which eslint's set-state-in-effect rule accepts. */
function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const id = window.setInterval(update, everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return now;
}

/** The globe's status: a dot, a word, and either the data age or the problem (with Retry). The
 * word and any problem are a polite live region; the minute-by-minute age is not, so it doesn't
 * chatter. Retry exists only while something can be retried. */
export function StatusPill({ input, onRetry }: { input: PillInput; onRetry: (g: PillGroup) => void }) {
  const now = useNow(30_000);
  const s = deriveStatus(input, now);
  return (
    <div
      data-testid="live-badge"
      title={s.title ?? undefined}
      className="label pointer-events-auto flex max-w-full select-none flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-full border-2 border-line bg-[#121212] px-3 py-2 !text-ink"
    >
      <span role="status" className="whitespace-nowrap">
        <span aria-hidden="true" style={{ color: TONE_COLOR[s.tone] }}>
          {s.tone === "grey" ? "○" : "●"}
        </span>{" "}
        {s.word}
        {s.note && <span className="text-ink-3"> · {s.note}</span>}
      </span>
      {s.age && (
        <span className="whitespace-nowrap text-ink-3">
          · <span className="sheet:hidden">updated </span>
          {s.age}
        </span>
      )}
      {s.retry.length > 0 && (
        <button
          type="button"
          onClick={() => s.retry.forEach(onRetry)}
          className="whitespace-nowrap rounded-full border-2 border-line bg-[#1a1a1a] px-2 text-[11px] text-ink hover:bg-[#222]"
        >
          Retry
        </button>
      )}
    </div>
  );
}
