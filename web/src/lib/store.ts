import { create } from "zustand";
import { inShell, type Shell } from "@/lib/crowding/shell";
import type { Orbits } from "@/lib/filterSummary";
import type { GroupStatus } from "@/lib/globeData";
import { browserStorage, DEFAULT_VISIBILITY, loadVisibility, saveVisibility, type PanelId } from "@/lib/panels";
import { filtersToShow, type Findable, type GlobePresence } from "@/lib/selection";
import { OBJECT_TYPES, type ObjectType, type OwnerSummary, type Regime } from "@/lib/types";

type Filters = { types: ObjectType[]; owners: string[]; orbits: Orbits; shell: Shell | null };

interface ExplorerState extends Filters {
  selectedId: number | null;
  // Where the selected object stands on the globe (see GlobeScene's pending fly-to); null when
  // nothing is selected.
  selectionOnGlobe: GlobePresence | null;
  panels: Record<PanelId, boolean>;
  // Whether the phone bottom sheet (see MobileSheet.tsx) is expanded. Lives here, not as local
  // component state, so GlobeScene (inside the <Canvas> tree, not a descendant of MobileSheet)
  // can react to it too, shifting the globe's framing to clear the sheet while it's open.
  mobileSheetOpen: boolean;
  // The sheet's real measured top edge (getBoundingClientRect().top, in viewport px), pushed by
  // MobileSheet via a ResizeObserver — null before the first measurement. GlobeScene uses this
  // (not a CSS-derived guess) to know exactly how much of the screen the sheet covers.
  mobileSheetTop: number | null;
  // Bottom edge (viewport px) of the globe's top bar (readout + status pill) in the bottom-sheet
  // layout, measured by GlobeSection — with mobileSheetTop it bounds the visible globe area.
  topBarBottom: number | null;
  // Bumped by GlobeSection whenever a newly published generation is swapped in (see
  // createGlobeData's `version`); the page re-fetches the overview and charts when it changes.
  dataVersion: number;
  // The shown generation string, set alongside `dataVersion`. The CDN caches /meta and
  // /stats/* for minutes to hours, so a refetch keyed only on `dataVersion` (which is per-tab and
  // starts at 0 in every tab) can still get pre-publication data back from cache; the page adds
  // this to those requests instead, once dataVersion says a swap actually happened.
  dataGeneration: string | undefined;
  // The owners list from /meta, for components outside the page's panel context (the summary
  // pill, chart scope lines) to name the selected owner.
  ownerDirectory: OwnerSummary[];
  // Bumped by openPanel so the phone sheet (MobileSheet) can switch to that tab.
  panelRequest: { id: PanelId; n: number } | null;
  // The HIGH globe-data group's load status (see globeData.ts), published by GlobeSection —
  // ObjectCard reads it so a MEO/GEO/HEO selection that can never resolve (the group failed or
  // came back missing) gets a reason instead of sitting "pending" forever. See noPositionReason.
  highStatus: GroupStatus;
  // Whether each chart's "View data" disclosure (see ChartData.tsx) is open, per chart.
  dataTablesOpen: { history: boolean; owners: boolean };
  // Whether the camera has moved away from the whole-Earth fitted framing (see lib/camera.ts's
  // isOffFit), published by GlobeScene's throttled per-frame check — drives FitButton's visibility.
  offFit: boolean;
  // Bumped by FitButton to ask GlobeScene to fly the camera back to the fitted framing.
  fitRequest: number;
  // A short status message for the sr-only Announcer (e.g. "Filters reset"); `n` counts how many
  // times announce() has fired, for tests that need to tell two identical announcements apart.
  announcement: { text: string; n: number } | null;
  // The crowding cell under the pointer (see CrowdingPanel): the globe dims every object outside
  // it and draws its rings. Not a filter — Reset leaves it alone, and it clears when the pointer leaves.
  hoverShell: Shell | null;
  // Whether the expanded crowding view is open (see CrowdingView).
  crowdingView: boolean;
  pinShell: (s: Shell | null) => void;
  setHoverShell: (s: Shell | null) => void;
  setCrowdingView: (open: boolean) => void;
  toggleType: (t: ObjectType) => void;
  setOwners: (codes: string[]) => void;
  toggleOrbit: (k: keyof Orbits) => void;
  select: (id: number | null) => void;
  setPanel: (id: PanelId, shown: boolean) => void;
  togglePanel: (id: PanelId) => void;
  hydratePanels: () => void;
  setMobileSheetOpen: (open: boolean) => void;
  setMobileSheetTop: (top: number | null) => void;
  setTopBarBottom: (bottom: number | null) => void;
  // Publishes a newly swapped-in generation: updates dataVersion and dataGeneration together, and
  // only when `version` actually differs from the stored dataVersion. Without that guard, the
  // first load's pointer (which sets `generation` while `version` is still 0) would still publish
  // a dataGeneration change on its own, and page.tsx's effects (keyed on both) would re-run with
  // an identical URL — see GlobeSection.tsx.
  setData: (version: number, generation: string | undefined) => void;
  setSelectionOnGlobe: (p: GlobePresence) => void;
  selectFromSearch: (o: Findable) => void;
  resetFilters: () => void;
  setOwnerDirectory: (list: OwnerSummary[]) => void;
  openPanel: (id: PanelId) => void;
  setHighStatus: (status: GroupStatus) => void;
  toggleDataTable: (which: "history" | "owners") => void;
  setOffFit: (offFit: boolean) => void;
  requestFit: () => void;
  announce: (text: string) => void;
  reset: () => void;
}

const initial = (): Filters &
  Pick<
    ExplorerState,
    | "selectedId"
    | "selectionOnGlobe"
    | "panels"
    | "mobileSheetOpen"
    | "mobileSheetTop"
    | "topBarBottom"
    | "dataVersion"
    | "dataGeneration"
    | "ownerDirectory"
    | "panelRequest"
    | "highStatus"
    | "dataTablesOpen"
    | "offFit"
    | "fitRequest"
    | "announcement"
    | "hoverShell"
    | "crowdingView"
  > => ({
  types: [...OBJECT_TYPES],
  owners: [],
  orbits: { leo: true, high: false },
  selectedId: null,
  selectionOnGlobe: null,
  panels: { ...DEFAULT_VISIBILITY },
  mobileSheetOpen: true,
  mobileSheetTop: null,
  topBarBottom: null,
  dataVersion: 0,
  dataGeneration: undefined,
  ownerDirectory: [],
  panelRequest: null,
  highStatus: "idle",
  dataTablesOpen: { history: false, owners: false },
  offFit: false,
  fitRequest: 0,
  announcement: null,
  shell: null,
  hoverShell: null,
  crowdingView: false,
});

export const useExplorer = create<ExplorerState>((set, get) => ({
  ...initial(),
  toggleType: (t) =>
    set((s) => {
      const has = s.types.includes(t);
      if (has && s.types.length === 1) return s;
      return { types: has ? s.types.filter((x) => x !== t) : OBJECT_TYPES.filter((x) => x === t || s.types.includes(x)) };
    }),
  setOwners: (codes) => set({ owners: codes }),
  toggleOrbit: (k) =>
    set((s) => {
      const next = { ...s.orbits, [k]: !s.orbits[k] };
      return next.leo || next.high ? { orbits: next } : s;
    }),
  select: (id) =>
    set((s) => {
      if (id === null) return { selectedId: null, selectionOnGlobe: null };
      // Re-selecting the object already on screen (e.g. clicking its search result again while
      // its card is open) must not replay the fly-to arc — only reopen the pending wait when the
      // last attempt came up "absent" (a natural retry point; GlobeScene's per-frame check runs
      // again from there). Still reveals Search like a fresh selection does: its card is where the
      // retry (or the object's details) shows, which must come back even if the panel was closed
      // since the last time this same object was selected.
      if (id === s.selectedId) {
        const panels = { ...s.panels, search: true };
        saveVisibility(browserStorage(), panels);
        return s.selectionOnGlobe === "absent" ? { selectionOnGlobe: "pending", panels } : { panels };
      }
      return { selectedId: id, selectionOnGlobe: "pending", panels: { ...s.panels, search: true } };
    }),
  setPanel: (id, shown) =>
    set((s) => {
      const panels = { ...s.panels, [id]: shown };
      saveVisibility(browserStorage(), panels);
      return { panels };
    }),
  togglePanel: (id) =>
    set((s) => {
      const panels = { ...s.panels, [id]: !s.panels[id] };
      saveVisibility(browserStorage(), panels);
      return { panels };
    }),
  hydratePanels: () => set({ panels: loadVisibility(browserStorage()) }),
  setMobileSheetOpen: (mobileSheetOpen) => set({ mobileSheetOpen }),
  setMobileSheetTop: (mobileSheetTop) => set({ mobileSheetTop }),
  setTopBarBottom: (topBarBottom) => set({ topBarBottom }),
  setHighStatus: (highStatus) => set({ highStatus }),
  setData: (version, generation) =>
    set((s) => (version === s.dataVersion ? s : { dataVersion: version, dataGeneration: generation })),
  setSelectionOnGlobe: (p) => set((s) => (s.selectedId === null ? s : { selectionOnGlobe: p })),
  selectFromSearch: (o) => {
    const changes = filtersToShow(o, get());
    if (changes) set(changes);
    get().select(o.norad_id);
  },
  resetFilters: () => {
    const { types, owners, orbits, shell } = initial();
    set({ types, owners, orbits, shell });
  },
  setOwnerDirectory: (ownerDirectory) => set({ ownerDirectory }),
  openPanel: (id) =>
    set((s) => {
      const panels = { ...s.panels, [id]: true };
      saveVisibility(browserStorage(), panels);
      return { panels, panelRequest: { id, n: (s.panelRequest?.n ?? 0) + 1 } };
    }),
  toggleDataTable: (which) => set((s) => ({ dataTablesOpen: { ...s.dataTablesOpen, [which]: !s.dataTablesOpen[which] } })),
  setOffFit: (offFit) => set({ offFit }),
  requestFit: () => set((s) => ({ fitRequest: s.fitRequest + 1 })),
  announce: (text) => set((s) => ({ announcement: { text, n: (s.announcement?.n ?? 0) + 1 } })),
  pinShell: (shell) => set({ shell }),
  setHoverShell: (hoverShell) => set({ hoverShell }),
  setCrowdingView: (crowdingView) => set({ crowdingView }),
  reset: () => set(initial()),
}));

export function regimesFor(orbits: Orbits): Regime[] | undefined {
  if (orbits.leo && orbits.high) return undefined;
  return orbits.leo ? ["LEO"] : ["MEO", "GEO", "HEO"];
}

/** Visibility on the globe. A record without orbit numbers (a search result) can't be placed in a
 * pinned shell, so it counts as outside it. */
export function isVisible(
  record: { type: ObjectType; owner: string; meanMotion?: number; eccentricity?: number; inclination?: number },
  group: "LEO" | "HIGH",
  s: Omit<Filters, "shell"> & { shell?: Shell | null },
): boolean {
  if (group === "LEO" ? !s.orbits.leo : !s.orbits.high) return false;
  if (!s.types.includes(record.type)) return false;
  if (s.owners.length > 0 && !s.owners.includes(record.owner)) return false;
  if (!s.shell) return true;
  const { meanMotion, eccentricity, inclination } = record;
  if (meanMotion === undefined || eccentricity === undefined || inclination === undefined) return false;
  return inShell({ meanMotion, eccentricity, inclination }, s.shell);
}
