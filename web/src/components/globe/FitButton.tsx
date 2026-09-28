"use client";

import { useExplorer } from "@/lib/store";

/** "⤢ Fit globe" — only while the camera has moved away from the whole-Earth framing. */
export function FitButton({ onActivateWhileFocused }: { onActivateWhileFocused?: () => void }) {
  const offFit = useExplorer((s) => s.offFit);
  const requestFit = useExplorer((s) => s.requestFit);
  if (!offFit) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        // Only when this click leaves the button focused (mouse click, or Enter/Space while
        // already focused) — GlobeSection uses this to move focus to the globe once the pill
        // unmounts (offFit flips false), instead of letting it fall through to <body>.
        if (document.activeElement === e.currentTarget) onActivateWhileFocused?.();
        requestFit();
      }}
      aria-label="Fit globe"
      className="label pointer-events-auto inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-full border-2 border-line bg-[#121212] px-3 py-1.5 !text-ink-2 hover:!text-ink"
    >
      <span aria-hidden="true">⤢</span> Fit<span className="sheet:hidden"> globe</span>
    </button>
  );
}
