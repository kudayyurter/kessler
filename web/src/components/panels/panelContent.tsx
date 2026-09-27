"use client";

import { chartTitle } from "@/lib/chartData";
import { filterScope, ownersChartScope } from "@/lib/filterSummary";
import type { PanelId } from "@/lib/panels";
import { useExplorer } from "@/lib/store";
import type { BreakdownResponse, Meta, TimeseriesResponse } from "@/lib/types";
import { BarChart } from "@/components/charts/BarChart";
import { LineChart } from "@/components/charts/LineChart";
import { ChatPanel } from "@/components/panels/ChatPanel";
import { Filters } from "@/components/panels/Filters";
import { ObjectCard } from "@/components/panels/ObjectCard";
import { Overview } from "@/components/panels/Overview";
import { SearchBox } from "@/components/panels/SearchBox";
import { Unavailable } from "@/components/ui/Unavailable";

export type Load<T> = { data: T | null; error: boolean };
// The owner `bars.data` actually asked `rank_of` for, alongside it (not derived from the current
// selection, which can change before a slower response for a previous owner arrives) — see
// chartData.ts's ownerHighlight and page.tsx's breakdown fetch.
export type BarsLoad = Load<BreakdownResponse> & { rankFor: string | null };
export type PanelCtx = { meta: Load<Meta>; ts: Load<TimeseriesResponse>; bars: BarsLoad };

function HistoryScope() {
  const types = useExplorer((s) => s.types);
  const owners = useExplorer((s) => s.owners);
  const orbits = useExplorer((s) => s.orbits);
  const directory = useExplorer((s) => s.ownerDirectory);
  return <p data-testid="history-scope" className="mt-1 text-[12px] text-ink-3">{filterScope({ types, owners, orbits }, directory)}</p>;
}

function OwnersChart({ c }: { c: PanelCtx }) {
  const types = useExplorer((s) => s.types);
  const orbits = useExplorer((s) => s.orbits);
  const selected = useExplorer((s) => s.owners[0] ?? null);
  return (
    <div>
      <h3 className="font-mono text-[16px] text-ink">Who owns what&apos;s up there</h3>
      <p data-testid="owners-scope" className="mt-1 text-[12px] text-ink-3">{ownersChartScope({ types, owners: [], orbits })}</p>
      <div className="mt-2">
        {c.bars.error ? <Unavailable what="owners" /> : c.bars.data && (
          <BarChart data={c.bars.data} owners={c.meta.data?.owners ?? []} selected={selected} rankFor={c.bars.rankFor} />
        )}
      </div>
    </div>
  );
}

export const PANEL_CONTENT: Record<PanelId, (c: PanelCtx) => React.ReactNode> = {
  overview: (c) => <Overview meta={c.meta.data} error={c.meta.error} />,
  search: () => (
    <div className="flex flex-col gap-3">
      <SearchBox />
      <ObjectCard />
    </div>
  ),
  history: (c) => (
    <div>
      <h3 className="font-mono text-[16px] text-ink">{c.ts.data ? chartTitle(c.ts.data) : "Objects in orbit by type"}</h3>
      <p className="mt-1 text-[13px] leading-snug text-ink-2">Objects in orbit at the end of each year.</p>
      <HistoryScope />
      <div className="mt-2">{c.ts.error ? <Unavailable what="yearly history" /> : c.ts.data && <LineChart data={c.ts.data} />}</div>
    </div>
  ),
  owners: (c) => <OwnersChart c={c} />,
  filters: (c) => <Filters meta={c.meta.data} />,
  chat: () => <ChatPanel />,
};
