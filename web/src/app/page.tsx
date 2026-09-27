"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { keepPrevIfEqual } from "@/lib/dedupe";
import { PANELS, type PanelId } from "@/lib/panels";
import { regimesFor, useExplorer } from "@/lib/store";
import { useSheetLayout } from "@/lib/useIsMobile";
import type { Meta, TimeseriesResponse } from "@/lib/types";
import { MobileSheet } from "@/components/layout/MobileSheet";
import { Panel } from "@/components/layout/Panel";
import { PanelColumn } from "@/components/layout/PanelColumn";
import { PanelDock } from "@/components/layout/PanelDock";
import { PANEL_CONTENT, type BarsLoad, type Load, type PanelCtx } from "@/components/panels/panelContent";

// GlobeSection pulls in three/R3F/satellite.js — by far the largest slice of the
// page's JS — and only ever renders client-side anyway (it probes WebGL support in an effect and
// has no server-renderable content). Loading it with next/dynamic(ssr:false) keeps that whole
// graph out of the page's initial bundle so tiles/search/charts can hydrate without parsing it
// first; the loading placeholder matches GlobeSection's own outer <section> exactly (same
// classes/aria-label) so swapping it in doesn't shift layout.
const GlobeSection = dynamic(() => import("@/components/globe/GlobeSection").then((m) => m.GlobeSection), {
  ssr: false,
  loading: () => <section className="fixed inset-0" aria-label="Live globe of tracked objects" />,
});

export default function Explorer() {
  const [meta, setMeta] = useState<Load<Meta>>({ data: null, error: false });
  const [ts, setTs] = useState<Load<TimeseriesResponse>>({ data: null, error: false });
  const [bars, setBars] = useState<BarsLoad>({ data: null, error: false, rankFor: null });
  const owners = useExplorer((s) => s.owners);
  const types = useExplorer((s) => s.types);
  const orbits = useExplorer((s) => s.orbits);
  const dataVersion = useExplorer((s) => s.dataVersion);
  const dataGeneration = useExplorer((s) => s.dataGeneration);
  const hydratePanels = useExplorer((s) => s.hydratePanels);
  const setOwnerDirectory = useExplorer((s) => s.setOwnerDirectory);
  // null until hydrated: the server HTML (and the hydration pass) renders both layout shells and
  // CSS (`sheet:` / `wide:` variants) shows the right one, so first paint never flashes the wrong
  // layout. Panel bodies are rendered in only ONE shell at a time — the desktop columns before
  // hydration (the sheet shows just its tab bar until then), then whichever layout matches — so
  // there's never a second SearchBox (or any other duplicated panel) in the DOM.
  const sheet = useSheetLayout();

  useEffect(() => hydratePanels(), [hydratePanels]);

  useEffect(() => {
    if (meta.data) setOwnerDirectory(meta.data.owners);
  }, [meta.data, setOwnerDirectory]);

  // Re-fetched whenever the globe swaps in a newly published generation (dataVersion); a failed
  // refresh keeps the numbers already shown, and `keepPrevIfEqual` keeps the same object identity
  // when the payload didn't actually change, so Overview's tiles don't replay their count-up.
  // dataVersion > 0 means this run is such a refetch (the first load, version 0, keeps today's
  // plain URL): add `gen` so the CDN's cache (s-maxage=600 on /meta) can't answer with
  // pre-publication data for its whole TTL.
  useEffect(() => {
    let cancelled = false;
    api.meta(dataVersion > 0 ? dataGeneration : undefined)
      .then((d) => !cancelled && setMeta((m) => ({ data: keepPrevIfEqual(m.data, d), error: false })))
      .catch(() => !cancelled && setMeta((m) => (m.data ? m : { data: null, error: true })));
    return () => {
      cancelled = true;
    };
  }, [dataVersion, dataGeneration]);

  // The filter selection (owners/types/orbits) that produced the chart data currently shown —
  // compared against on a failed refetch (see below) to tell "the same filters' data just failed
  // to refresh" (keep what's shown) from "these filters' own request failed" (show the error).
  const tsShownKey = useRef<string | null>(null);
  const barsShownKey = useRef<string | null>(null);

  useEffect(() => {
    // Filters can change faster than the network responds (e.g. clicking two filter chips in a
    // row); without this guard, an earlier request's response arriving after a later one would
    // stomp the chart with stale data for the wrong filters.
    let cancelled = false;
    const regimes = regimesFor(orbits);
    const key = JSON.stringify({ owners, types, orbits });
    // See the meta effect above: only a dataVersion-driven refetch adds `gen`, to bust the CDN's
    // cache on /stats/* (s-maxage=3600) without changing the first load's URL.
    const gen = dataVersion > 0 ? dataGeneration : undefined;
    api.timeseries({ group_by: "type", owners, types, regimes, from: 1960, gen })
      .then((d) => {
        if (cancelled) return;
        tsShownKey.current = key;
        setTs((m) => ({ data: keepPrevIfEqual(m.data, d), error: false }));
      })
      .catch(() => {
        if (cancelled) return;
        // A background refresh (dataVersion changed, filters didn't) failing keeps the chart
        // already shown; these filters' own request failing shows the error, as before.
        setTs((m) => (m.data && tsShownKey.current === key ? m : { data: null, error: true }));
      });
    // Recorded alongside the response (not read back off the store) so a slower-to-arrive
    // response for a since-changed selection can be recognised as stale by ownerHighlight —
    // see chartData.ts and BarsLoad above.
    const rankFor = owners[0] ?? null;
    api.breakdown({ by: "owner", types, regimes, top: 5, gen, rank_of: owners[0] })
      .then((d) => {
        if (cancelled) return;
        barsShownKey.current = key;
        setBars((m) => ({ data: keepPrevIfEqual(m.data, d), error: false, rankFor }));
      })
      .catch(() => {
        if (cancelled) return;
        setBars((m) => (m.data && barsShownKey.current === key ? m : { data: null, error: true, rankFor: null }));
      });
    return () => {
      cancelled = true;
    };
  }, [owners, types, orbits, dataVersion, dataGeneration]);

  const ctx: PanelCtx = { meta, ts, bars };
  const panel = (id: PanelId, extra = "") => (
    <Panel id={id} title={PANELS.find((p) => p.id === id)!.title} className={extra}>{PANEL_CONTENT[id](ctx)}</Panel>
  );
  return (
    <main className="h-dvh overflow-hidden">
      <GlobeSection />
      {sheet !== false && <MobileSheet ctx={ctx} showBody={sheet === true} />}
      {sheet !== true && (
        <div className="sheet:hidden">
          <div className="pointer-events-none fixed inset-x-0 top-3 z-20 flex justify-center px-[calc(theme(spacing.4)+var(--col-l))]">
            <PanelDock />
          </div>
          <PanelColumn side="left" className="pointer-events-none fixed bottom-4 left-4 top-14 z-10 flex w-[var(--col-l)] flex-col justify-between gap-3 overflow-y-auto">
            <div className="flex flex-col gap-3">{panel("overview")}{panel("filters")}</div>
            {panel("history")}
          </PanelColumn>
          <PanelColumn side="right" className="pointer-events-none fixed bottom-4 right-4 top-14 z-10 flex w-[var(--col-r)] flex-col justify-between gap-3 overflow-y-auto">
            <div className="flex flex-col gap-3">{panel("search")}{panel("chat")}</div>
            {panel("owners")}
          </PanelColumn>
        </div>
      )}
    </main>
  );
}
