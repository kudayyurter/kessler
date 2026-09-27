import { describe, expect, it } from "vitest";
import { LARGEST, ownerDisplay, pickerOptions } from "@/lib/ownerPicker";
import type { OwnerSummary } from "@/lib/types";

const o = (code: string, name: string, in_orbit: number, flag: string | null = null): OwnerSummary =>
  ({ code, name, flag_emoji: flag, in_orbit, total: in_orbit + 1 });
const LIST: OwnerSummary[] = [
  o("GER", "Germany", 102, "🇩🇪"), o("FGER", "France/Germany", 2), o("US", "United States", 18485, "🇺🇸"),
  o("PRC", "China", 6178, "🇨🇳"), o("CIS", "Russia / former USSR", 6674, "🇷🇺"), o("UK", "United Kingdom", 725, "🇬🇧"),
  o("FR", "France", 647, "🇫🇷"), o("JPN", "Japan", 338, "🇯🇵"), o("IND", "India", 200, "🇮🇳"),
  o("TBD", "To be determined", 151), o("ABS", "Asia Broadcast Satellite", 8), o("ESRO", "European Space Research Organization", 0),
];

describe("ownerDisplay", () => {
  it("prefixes the flag when there is one", () => {
    expect(ownerDisplay(LIST[0])).toBe("🇩🇪 Germany");
    expect(ownerDisplay(LIST[1])).toBe("France/Germany");
  });
});

describe("pickerOptions", () => {
  it("lists All owners, then the 8 largest, then everyone A–Z", () => {
    const opts = pickerOptions(LIST, "");
    expect(opts[0]).toMatchObject({ code: null, label: "All owners", count: null });
    const largest = opts.slice(1, 1 + LARGEST);
    expect(largest.map((x) => x.code)).toEqual(["US", "CIS", "PRC", "UK", "FR", "JPN", "IND", "TBD"]);
    expect(largest[0].heading).toBe("Largest");
    const az = opts.slice(1 + LARGEST);
    expect(az).toHaveLength(LIST.length);
    expect(az[0]).toMatchObject({ heading: "All owners A–Z", label: "Asia Broadcast Satellite" });
    const byName = [...LIST].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
    expect(az.map((x) => x.code)).toEqual(byName.map((x) => x.code));
  });

  it("gives every option a unique id", () => {
    const ids = pickerOptions(LIST, "").map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("dims owners with nothing in orbit and shows counts", () => {
    const esro = pickerOptions(LIST, "esro")[0];
    expect(esro).toMatchObject({ code: "ESRO", count: 0, dim: true });
    expect(pickerOptions(LIST, "germany")[0]).toMatchObject({ code: "GER", count: 102, dim: false });
  });

  it("matches name or code, case-insensitively, largest first", () => {
    expect(pickerOptions(LIST, "ger").map((x) => x.code)).toEqual(["GER", "FGER"]);
    expect(pickerOptions(LIST, "PrC").map((x) => x.code)).toEqual(["PRC"]);
    expect(pickerOptions(LIST, "  china ").map((x) => x.code)).toEqual(["PRC"]);
  });

  it("no match gives no options", () => {
    expect(pickerOptions(LIST, "zzzz")).toEqual([]);
  });
});
