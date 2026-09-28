import { beforeEach, describe, expect, it } from "vitest";
import { isVisible, regimesFor, useExplorer } from "@/lib/store";

beforeEach(() => useExplorer.getState().reset());

describe("explorer store", () => {
  it("starts with all types, all owners and LEO only", () => {
    const s = useExplorer.getState();
    expect(s.types).toEqual(["PAY", "R/B", "DEB", "UNK"]);
    expect(s.owners).toEqual([]);
    expect(s.orbits).toEqual({ leo: true, high: false });
  });

  it("toggles types but never allows zero types", () => {
    const { toggleType } = useExplorer.getState();
    toggleType("DEB");
    expect(useExplorer.getState().types).toEqual(["PAY", "R/B", "UNK"]);
    toggleType("PAY"); toggleType("R/B"); toggleType("UNK");
    expect(useExplorer.getState().types).toEqual(["UNK"]);
  });

  it("never allows both orbit groups off", () => {
    useExplorer.getState().toggleOrbit("leo");
    expect(useExplorer.getState().orbits).toEqual({ leo: true, high: false });
    useExplorer.getState().toggleOrbit("high");
    useExplorer.getState().toggleOrbit("leo");
    expect(useExplorer.getState().orbits).toEqual({ leo: false, high: true });
  });
});

describe("regimesFor / isVisible", () => {
  it("maps orbit toggles to API regimes", () => {
    expect(regimesFor({ leo: true, high: false })).toEqual(["LEO"]);
    expect(regimesFor({ leo: false, high: true })).toEqual(["MEO", "GEO", "HEO"]);
    expect(regimesFor({ leo: true, high: true })).toBeUndefined();
  });

  it("filters by type, owner and orbit group", () => {
    const s = { types: ["PAY", "DEB"] as const, owners: ["US"], orbits: { leo: true, high: false } };
    expect(isVisible({ type: "PAY", owner: "US" }, "LEO", { ...s, types: [...s.types] })).toBe(true);
    expect(isVisible({ type: "R/B", owner: "US" }, "LEO", { ...s, types: [...s.types] })).toBe(false);
    expect(isVisible({ type: "PAY", owner: "PRC" }, "LEO", { ...s, types: [...s.types] })).toBe(false);
    expect(isVisible({ type: "PAY", owner: "US" }, "HIGH", { ...s, types: [...s.types] })).toBe(false);
  });
});

describe("panel visibility in the store", () => {
  it("starts from the defaults and toggles", () => {
    const s = useExplorer.getState();
    expect(s.panels.filters).toBe(false);
    s.togglePanel("filters");
    expect(useExplorer.getState().panels.filters).toBe(true);
    useExplorer.getState().setPanel("history", false);
    expect(useExplorer.getState().panels.history).toBe(false);
  });

  it("selecting an object reveals the search panel", () => {
    useExplorer.getState().setPanel("search", false);
    useExplorer.getState().select(25544);
    expect(useExplorer.getState().panels.search).toBe(true);
  });

  it("re-selecting the same object still reveals the search panel", () => {
    useExplorer.getState().select(25544);
    useExplorer.getState().setPanel("search", false);
    useExplorer.getState().select(25544);
    expect(useExplorer.getState().panels.search).toBe(true);
  });
});

describe("mobile sheet open state", () => {
  it("starts open, can be closed and reopened, and resets to open", () => {
    expect(useExplorer.getState().mobileSheetOpen).toBe(true);
    useExplorer.getState().setMobileSheetOpen(false);
    expect(useExplorer.getState().mobileSheetOpen).toBe(false);
    useExplorer.getState().setMobileSheetOpen(true);
    expect(useExplorer.getState().mobileSheetOpen).toBe(true);
    useExplorer.getState().setMobileSheetOpen(false);
    useExplorer.getState().reset();
    expect(useExplorer.getState().mobileSheetOpen).toBe(true);
  });
});

describe("mobile sheet measured top", () => {
  it("starts null (unmeasured), can be set and cleared, and resets to null", () => {
    expect(useExplorer.getState().mobileSheetTop).toBeNull();
    useExplorer.getState().setMobileSheetTop(505);
    expect(useExplorer.getState().mobileSheetTop).toBe(505);
    useExplorer.getState().setMobileSheetTop(null);
    expect(useExplorer.getState().mobileSheetTop).toBeNull();
    useExplorer.getState().setMobileSheetTop(322);
    useExplorer.getState().reset();
    expect(useExplorer.getState().mobileSheetTop).toBeNull();
  });
});

describe("top bar measured bottom", () => {
  it("starts null (unmeasured), can be set and cleared, and resets to null", () => {
    expect(useExplorer.getState().topBarBottom).toBeNull();
    useExplorer.getState().setTopBarBottom(92);
    expect(useExplorer.getState().topBarBottom).toBe(92);
    useExplorer.getState().setTopBarBottom(null);
    expect(useExplorer.getState().topBarBottom).toBeNull();
    useExplorer.getState().setTopBarBottom(80);
    useExplorer.getState().reset();
    expect(useExplorer.getState().topBarBottom).toBeNull();
  });
});

describe("HIGH group status", () => {
  it("starts idle, can be set, and resets to idle", () => {
    expect(useExplorer.getState().highStatus).toBe("idle");
    useExplorer.getState().setHighStatus("error");
    expect(useExplorer.getState().highStatus).toBe("error");
    useExplorer.getState().reset();
    expect(useExplorer.getState().highStatus).toBe("idle");
  });
});

describe("setData", () => {
  it("does nothing at version 0 (nothing to publish on the first load), and sets both together once the version changes", () => {
    useExplorer.getState().reset();
    expect(useExplorer.getState().dataVersion).toBe(0);
    useExplorer.getState().setData(0, "g1");
    expect(useExplorer.getState().dataVersion).toBe(0);
    expect(useExplorer.getState().dataGeneration).toBeUndefined();
    useExplorer.getState().setData(1, "g1");
    expect(useExplorer.getState().dataVersion).toBe(1);
    expect(useExplorer.getState().dataGeneration).toBe("g1");
    useExplorer.getState().reset();
    expect(useExplorer.getState().dataVersion).toBe(0);
    expect(useExplorer.getState().dataGeneration).toBeUndefined();
  });
});

describe("selection and filter actions", () => {
  it("marks a new selection pending and clears it with the selection", () => {
    useExplorer.getState().reset();
    useExplorer.getState().select(7);
    expect(useExplorer.getState().selectionOnGlobe).toBe("pending");
    useExplorer.getState().setSelectionOnGlobe("shown");
    expect(useExplorer.getState().selectionOnGlobe).toBe("shown");
    useExplorer.getState().select(null);
    expect(useExplorer.getState().selectionOnGlobe).toBeNull();
    useExplorer.getState().setSelectionOnGlobe("absent");
    expect(useExplorer.getState().selectionOnGlobe).toBeNull();
  });

  it("re-selecting the object already shown keeps it shown instead of replaying the fly-to", () => {
    useExplorer.getState().reset();
    useExplorer.getState().select(7);
    useExplorer.getState().setSelectionOnGlobe("shown");
    useExplorer.getState().select(7);
    expect(useExplorer.getState().selectionOnGlobe).toBe("shown");
  });

  it("re-selecting an object still pending leaves it pending", () => {
    useExplorer.getState().reset();
    useExplorer.getState().select(7);
    expect(useExplorer.getState().selectionOnGlobe).toBe("pending");
    useExplorer.getState().select(7);
    expect(useExplorer.getState().selectionOnGlobe).toBe("pending");
  });

  it("re-selecting an object marked absent reopens the pending wait", () => {
    useExplorer.getState().reset();
    useExplorer.getState().select(7);
    useExplorer.getState().setSelectionOnGlobe("absent");
    useExplorer.getState().select(7);
    expect(useExplorer.getState().selectionOnGlobe).toBe("pending");
  });

  it("selectFromSearch shows the object first, then selects it", () => {
    useExplorer.getState().reset();
    useExplorer.getState().setOwners(["US"]);
    useExplorer.getState().selectFromSearch({ norad_id: 42, object_type: "PAY", owner: "PRC", regime: "GEO", decayed: false });
    const s = useExplorer.getState();
    expect(s.orbits).toEqual({ leo: true, high: true });
    expect(s.owners).toEqual([]);
    expect(s.selectedId).toBe(42);
    expect(s.selectionOnGlobe).toBe("pending");
  });

  it("resetFilters restores the default filters and keeps the selection", () => {
    useExplorer.getState().reset();
    useExplorer.getState().select(3);
    useExplorer.getState().toggleOrbit("high");
    useExplorer.getState().toggleType("DEB");
    useExplorer.getState().setOwners(["US"]);
    useExplorer.getState().resetFilters();
    const s = useExplorer.getState();
    expect(s.orbits).toEqual({ leo: true, high: false });
    expect(s.types).toEqual(["PAY", "R/B", "DEB", "UNK"]);
    expect(s.owners).toEqual([]);
    expect(s.selectedId).toBe(3);
  });

  it("openPanel shows the panel and bumps a request the sheet can follow", () => {
    useExplorer.getState().reset();
    useExplorer.getState().openPanel("filters");
    expect(useExplorer.getState().panels.filters).toBe(true);
    expect(useExplorer.getState().panelRequest).toEqual({ id: "filters", n: 1 });
    useExplorer.getState().openPanel("filters");
    expect(useExplorer.getState().panelRequest).toEqual({ id: "filters", n: 2 });
  });

  it("keeps the owner directory", () => {
    useExplorer.getState().reset();
    const list = [{ code: "US", name: "United States", flag_emoji: "🇺🇸", in_orbit: 1, total: 1 }];
    useExplorer.getState().setOwnerDirectory(list);
    expect(useExplorer.getState().ownerDirectory).toBe(list);
  });
});

describe("data tables", () => {
  it("start closed and toggle per chart", () => {
    useExplorer.getState().reset();
    expect(useExplorer.getState().dataTablesOpen).toEqual({ history: false, owners: false });
    useExplorer.getState().toggleDataTable("owners");
    expect(useExplorer.getState().dataTablesOpen).toEqual({ history: false, owners: true });
  });
});
