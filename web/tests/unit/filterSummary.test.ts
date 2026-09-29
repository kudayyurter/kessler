import { describe, expect, it } from "vitest";
import { filterScope, isDefaultFilters, orbitsText, ownersChartScope, ownerText, typesText } from "@/lib/filterSummary";
import type { ObjectType, OwnerSummary } from "@/lib/types";

const ALL: ObjectType[] = ["PAY", "R/B", "DEB", "UNK"];
const US: OwnerSummary = { code: "US", name: "United States", flag_emoji: "🇺🇸", in_orbit: 10, total: 12 };
const ESA: OwnerSummary = { code: "ESA", name: "European Space Agency", flag_emoji: null, in_orbit: 3, total: 5 };
const LEO = { leo: true, high: false };

describe("filterSummary", () => {
  it("knows the default filters", () => {
    expect(isDefaultFilters({ types: ALL, owners: [], orbits: LEO })).toBe(true);
    expect(isDefaultFilters({ types: ALL, owners: [], orbits: { leo: true, high: true } })).toBe(false);
    expect(isDefaultFilters({ types: ALL, owners: ["US"], orbits: LEO })).toBe(false);
    expect(isDefaultFilters({ types: ["PAY"], owners: [], orbits: LEO })).toBe(false);
  });

  it("words the orbits", () => {
    expect(orbitsText(LEO)).toBe("Low Earth orbit");
    expect(orbitsText({ leo: false, high: true })).toBe("Higher orbits");
    expect(orbitsText({ leo: true, high: true })).toBe("All orbits");
  });

  it("counts the types out of four", () => {
    expect(typesText(ALL)).toBe("all types");
    expect(typesText(["PAY", "DEB", "R/B"])).toBe("3 of 4 types");
    expect(typesText(["UNK"])).toBe("1 of 4 types");
  });

  it("names the owner with its flag, or falls back to the code", () => {
    expect(ownerText([], [US])).toBe("All owners");
    expect(ownerText(["US"], [US])).toBe("🇺🇸 United States");
    expect(ownerText(["ESA"], [ESA])).toBe("European Space Agency");
    expect(ownerText(["XYZ"], [US])).toBe("XYZ");
  });

  it("builds the summary / History scope and the Owners scope", () => {
    const f = { types: ["PAY", "R/B", "UNK"] as ObjectType[], owners: ["US"], orbits: { leo: false, high: true } };
    expect(filterScope(f, [US])).toBe("Higher orbits · 🇺🇸 United States · 3 of 4 types");
    expect(filterScope({ types: ALL, owners: [], orbits: LEO }, [])).toBe("Low Earth orbit · All owners · all types");
    expect(ownersChartScope(f)).toBe("All owners, ranked · Higher orbits · 3 of 4 types");
  });

  it("counts a pinned shell as a filter and names it in the summary", () => {
    const f = { types: ALL, owners: [], orbits: LEO };
    expect(isDefaultFilters({ ...f, shell: { row: 11, col: 27 } })).toBe(false);
    expect(filterScope({ ...f, shell: { row: 11, col: 27 } }, [])).toBe(
      "Low Earth orbit · All owners · all types · Shell 450–475 km · 52.5–54.5°",
    );
    expect(filterScope({ ...f, shell: null }, [])).toBe("Low Earth orbit · All owners · all types");
  });
});
