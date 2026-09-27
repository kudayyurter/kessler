"use client";

import { useEffect, useRef } from "react";
import type { PanelId } from "@/lib/panels";
import { useExplorer } from "@/lib/store";

export function Panel({ id, title, children, className = "" }: { id: PanelId; title: string; children: React.ReactNode; className?: string }) {
  const shown = useExplorer((s) => s.panels[id]);
  const setPanel = useExplorer((s) => s.setPanel);
  const panelRequest = useExplorer((s) => s.panelRequest);
  const ref = useRef<HTMLElement>(null);

  // openPanel only ever *shows* a panel; if it was already shown but scrolled out of its column
  // (desktop only — the phone sheet has no scrolling column, see MobileSheet's own panelRequest
  // effect), nothing else would visibly happen when "Showing …" is clicked again. Keyed on
  // `panelRequest.n`, not just its presence, so every request re-scrolls even if the id repeats.
  useEffect(() => {
    if (panelRequest?.id === id) ref.current?.scrollIntoView({ block: "nearest" });
  }, [panelRequest, id]);

  if (!shown) return null;
  return (
    <section ref={ref} className={`panel ${className}`} aria-label={title} data-panel={id}>
      <header className="mb-2 flex items-center justify-between gap-3">
        <h2 className="font-mono text-[15px] text-ink">{title}</h2>
        <button type="button" onClick={() => setPanel(id, false)} aria-label={`Hide ${title}`} className="px-1 text-[16px] leading-none text-ink-2 hover:text-ink">×</button>
      </header>
      {children}
    </section>
  );
}
