"use client";

import { useExplorer } from "@/lib/store";

/** "⤢ Fit globe" — only while the camera has moved away from the whole-Earth framing. */
export function FitButton() {
  const offFit = useExplorer((s) => s.offFit);
  const requestFit = useExplorer((s) => s.requestFit);
  if (!offFit) return null;
  return (
    <button
      type="button"
      onClick={requestFit}
      aria-label="Fit globe"
      className="label pointer-events-auto inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-full border-2 border-line bg-[#121212] px-3 py-1.5 !text-ink-2 hover:!text-ink"
    >
      <span aria-hidden="true">⤢</span> Fit<span className="sheet:hidden"> globe</span>
    </button>
  );
}
