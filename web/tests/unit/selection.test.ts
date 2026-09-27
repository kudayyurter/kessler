import { describe, expect, it } from "vitest";
import { fmtDate } from "@/lib/format";
import { filtersToShow, noPositionReason, type Findable } from "@/lib/selection";
import type { ObjectType } from "@/lib/types";

const ALL: ObjectType[] = ["PAY", "R/B", "DEB", "UNK"];
const DEFAULT = { types: ALL, owners: [] as string[], orbits: { leo: true, high: false } };
const obj = (over: Partial<Findable> = {}): Findable =>
  ({ norad_id: 1, object_type: "PAY", owner: "US", regime: "LEO", decayed: false, ...over });

describe("filtersToShow", () => {
  it("changes nothing when the object is already visible", () => {
    expect(filtersToShow(obj(), DEFAULT)).toBeNull();
  });

  it("turns on Higher orbits for MEO, GEO and HEO objects", () => {
    for (const regime of ["MEO", "GEO", "HEO"] as const) {
      expect(filtersToShow(obj({ regime }), DEFAULT)).toEqual({ orbits: { leo: true, high: true } });
    }
  });

  it("turns Low Earth orbit back on for a LEO object", () => {
    expect(filtersToShow(obj(), { ...DEFAULT, orbits: { leo: false, high: true } })).toEqual({ orbits: { leo: true, high: true } });
  });

  it("turns its type back on, keeping the canonical order", () => {
    expect(filtersToShow(obj({ object_type: "DEB" }), { ...DEFAULT, types: ["PAY", "UNK"] })).toEqual({ types: ["PAY", "DEB", "UNK"] });
  });

  it("clears an owner filter that would hide it, keeps one that matches", () => {
    expect(filtersToShow(obj({ owner: "PRC" }), { ...DEFAULT, owners: ["US"] })).toEqual({ owners: [] });
    expect(filtersToShow(obj({ owner: "US" }), { ...DEFAULT, owners: ["US"] })).toBeNull();
  });

  it("never changes filters for objects that aren't on the globe", () => {
    const hidden = { types: ["PAY"] as ObjectType[], owners: ["US"], orbits: { leo: false, high: true } };
    expect(filtersToShow(obj({ decayed: true, object_type: "DEB", owner: "PRC" }), hidden)).toBeNull();
    expect(filtersToShow(obj({ regime: "OTHER", object_type: "DEB" }), hidden)).toBeNull();
  });
});

describe("noPositionReason", () => {
  it("says the object re-entered", () => {
    expect(noPositionReason({ decay_date: "2024-03-08", regime: "LEO" }, "pending"))
      .toBe(`Re-entered on ${fmtDate("2024-03-08")} — no current position.`);
  });

  it("says objects beyond Earth orbit are not on the globe", () => {
    expect(noPositionReason({ decay_date: null, regime: "OTHER" }, "pending"))
      .toBe("Not shown on the globe: beyond Earth orbit or unknown orbit.");
  });

  it("says when its loaded group doesn't have it", () => {
    expect(noPositionReason({ decay_date: null, regime: "LEO" }, "absent")).toBe("No current orbit data for this object.");
  });

  it("says nothing while pending or once shown", () => {
    expect(noPositionReason({ decay_date: null, regime: "LEO" }, "pending")).toBeNull();
    expect(noPositionReason({ decay_date: null, regime: "GEO" }, "shown")).toBeNull();
  });
});
