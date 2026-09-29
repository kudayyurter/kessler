export type PanelId = "overview" | "search" | "history" | "owners" | "crowding" | "filters" | "chat";

export const PANELS: readonly { id: PanelId; title: string; soon?: boolean }[] = [
  { id: "search", title: "Search" },
  { id: "filters", title: "Filters" },
  { id: "overview", title: "Overview" },
  { id: "history", title: "History" },
  { id: "owners", title: "Owners" },
  { id: "crowding", title: "Crowding" },
  { id: "chat", title: "Ask AI", soon: true },
];

/** The accessible name for a panel's dock button / sheet tab — undefined (use the text) unless it
 * carries the visual-only "soon" tag. */
export function panelLabel(p: { title: string; soon?: boolean }): string | undefined {
  return p.soon ? `${p.title}, soon` : undefined;
}

export const DEFAULT_VISIBILITY: Record<PanelId, boolean> = {
  overview: true, search: true, history: true, owners: true, crowding: true, filters: false, chat: false,
};

export const STORAGE_KEY = "kessler.panels.v1";

export function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadVisibility(storage: Pick<Storage, "getItem"> | null): Record<PanelId, boolean> {
  const out = { ...DEFAULT_VISIBILITY };
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return out;
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      for (const p of PANELS) {
        const v = (parsed as Record<string, unknown>)[p.id];
        if (typeof v === "boolean") out[p.id] = v;
      }
    }
  } catch {
    return { ...DEFAULT_VISIBILITY };
  }
  return out;
}

export function saveVisibility(storage: Pick<Storage, "setItem"> | null, v: Record<PanelId, boolean>): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch {
    // Private mode / quota: keep the in-memory state only.
  }
}
