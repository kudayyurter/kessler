"use client";

import { useEffect, useId, useRef, useState } from "react";
import { PANELS, panelLabel, type PanelId } from "@/lib/panels";
import { PANEL_CONTENT, type PanelCtx } from "@/components/panels/panelContent";
import { nextTabIndex } from "@/lib/tabs";
import { useExplorer } from "@/lib/store";
import { SoonTag } from "@/components/ui/SoonTag";

/** `showBody` is false during the server render / hydration pass (the layout isn't known yet and
 * the desktop columns hold the panel bodies then — see page.tsx), so only the tab bar paints. */
export function MobileSheet({ ctx, showBody = true }: { ctx: PanelCtx; showBody?: boolean }) {
  const [active, setActive] = useState<PanelId>("search");
  const baseId = useId();
  const tabId = (id: PanelId) => `${baseId}-tab-${id}`;
  const panelId = `${baseId}-panel`;
  const tabRefs = useRef<Partial<Record<PanelId, HTMLButtonElement | null>>>({});
  const stripRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ left: false, right: false });
  const selectedId = useExplorer((s) => s.selectedId);
  // Lives in the store (not local state) so GlobeScene, inside the <Canvas> tree elsewhere in the
  // page, can read it too and keep the globe framed above the sheet while it's open.
  const open = useExplorer((s) => s.mobileSheetOpen);
  const setOpen = useExplorer((s) => s.setMobileSheetOpen);
  const setSheetTop = useExplorer((s) => s.setMobileSheetTop);
  const panelRequest = useExplorer((s) => s.panelRequest);
  // The request already pending at mount (e.g. the sheet remounting on a tablet rotation, while a
  // stale request from before it unmounted is still sitting in the store) must not replay — only
  // react to a *later* one, i.e. a bigger `n` than whatever was already there when this instance
  // of the sheet appeared.
  const seenRequestN = useRef(panelRequest?.n ?? 0);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedId !== null) {
      // Reacting to an external selection event (tapping/searching an object elsewhere on the
      // page), not deriving state from a prop on every render — same justification as
      // ObjectCard's identical disable.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActive("search");
      setOpen(true);
    }
  }, [selectedId, setOpen]);

  useEffect(() => {
    if (!panelRequest || panelRequest.n <= seenRequestN.current) return;
    seenRequestN.current = panelRequest.n;
    // Reacting to an external request (the filter summary's "open Filters"), same justification as
    // the selection effect above (the early return above means eslint no longer treats this as an
    // unconditional set-state-in-effect, so it needs no disable comment).
    setActive(panelRequest.id);
    setOpen(true);
  }, [panelRequest, setOpen]);

  // Publishes the sheet's real rendered top edge: with the top bar's bottom edge (measured in
  // GlobeSection) it bounds the part of the globe left visible, which GlobeScene centres the Earth
  // in (camera.ts sheetViewOffset) and LabelDriver restricts labels to. A ResizeObserver catches
  // every case the top can change (open/collapse, active tab, content load) since this element is
  // bottom-anchored — its own height change is exactly what moves its top. Only once the layout is
  // known (`showBody`): before that this shell may be display:none (desktop first paint).
  useEffect(() => {
    const el = sheetRef.current;
    if (!el || !showBody) return;
    const update = () => setSheetTop(el.getBoundingClientRect().top);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
      setSheetTop(null);
    };
  }, [setSheetTop, showBody]);

  // The active tab is always scrolled into view within the strip.
  useEffect(() => {
    tabRefs.current[active]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  // Fades on the strip's edges say "more tabs this way".
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const update = () => setFade({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);

  const select = (id: PanelId) => {
    setActive(id);
    setOpen(true);
  };
  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    const next = nextTabIndex(e.key, i, PANELS.length);
    if (next === null) return;
    e.preventDefault();
    select(PANELS[next].id);
    tabRefs.current[PANELS[next].id]?.focus();
  };

  return (
    <div ref={sheetRef} data-testid="mobile-sheet" className="panel fixed inset-x-2 bottom-2 z-20 mx-auto max-h-[60dvh] max-w-[640px] !p-0 short:max-h-[50dvh] wide:hidden">
      <div className="flex items-stretch border-b-2 border-line">
        <div className="relative min-w-0 flex-1">
          <div ref={stripRef} role="tablist" aria-label="Panels" className="flex gap-1 overflow-x-auto px-2 py-1.5 [scrollbar-width:none]">
            {PANELS.map((p, i) => (
              <button
                key={p.id}
                ref={(el) => {
                  tabRefs.current[p.id] = el;
                }}
                id={tabId(p.id)}
                role="tab"
                type="button"
                data-opens={p.id}
                aria-label={panelLabel(p)}
                aria-selected={active === p.id}
                aria-controls={panelId}
                tabIndex={active === p.id ? 0 : -1}
                onClick={() => select(p.id)}
                onKeyDown={(e) => onTabKey(e, i)}
                className={`flex min-h-10 shrink-0 items-center rounded-full px-3 text-[13px] ${active === p.id ? "bg-[#1c1c1c] text-ink" : "text-ink-2"}`}
              >
                {p.title}
                {p.soon && <SoonTag />}
              </button>
            ))}
          </div>
          {fade.left && <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-card to-transparent" />}
          {fade.right && <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-card to-transparent" />}
        </div>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={open ? "Collapse panel" : "Expand panel"}
          className="flex h-11 w-11 shrink-0 items-center justify-center border-l-2 border-line text-ink-2"
        >
          {open ? "▾" : "▴"}
        </button>
      </div>
      {open && showBody && (
        <div id={panelId} role="tabpanel" aria-labelledby={tabId(active)} tabIndex={0} className="max-h-[calc(60dvh-56px)] overflow-y-auto p-3 short:max-h-[calc(50dvh-56px)]">
          {PANEL_CONTENT[active](ctx)}
        </div>
      )}
    </div>
  );
}
