import { describe, expect, it } from "vitest";
import { buildChange, moversInCell } from "@/lib/crowding/change";
import { cellIndex, R_EARTH_KM } from "@/lib/crowding/grid";
import { ALL, dayOf, LEO, type Obj } from "./crowdingDays";

const HOT = cellIndex(11, 27); // 450–475 km · 52.5–54.5°
const pair = (a: Obj[], b: Obj[]) => [dayOf("2026-09-22", a), dayOf("2026-09-23", b)] as const;
const sum = (xs: Float64Array) => xs.reduce((s, v) => s + v, 0);

describe("buildChange", () => {
  it("counts a newly catalogued object", () => {
    const [a, b] = pair([], [{ id: 1, alt: 460, inc: 53 }]);
    const c = buildChange(a, b, {}, ALL);
    expect(c.cause.new[HOT]).toBe(1);
    expect(c.net[HOT]).toBe(1);
    expect(c.counts).toEqual({ new: 1, reentered: 0, untracked: 0, moved: 0 });
  });

  it("tells a re-entry (decay date on or before the later day) from an object that is no longer tracked", () => {
    const [a, b] = pair([{ id: 1, alt: 190, inc: 51.6 }, { id: 2, alt: 700, inc: 82 }, { id: 3, alt: 700, inc: 82 }], []);
    const c = buildChange(a, b, { "1": "2026-09-23", "3": "2026-09-30" }, ALL);
    expect(c.counts).toEqual({ new: 0, reentered: 1, untracked: 2, moved: 0 });
    expect(c.cause.reentered[cellIndex(0, 26)]).toBe(1);
    expect(c.net[cellIndex(0, 26)]).toBe(-1);
  });

  it("moves an object that changed shell", () => {
    const [a, b] = pair([{ id: 1, alt: 530, inc: 70 }], [{ id: 1, alt: 505, inc: 70 }]);
    const c = buildChange(a, b, {}, ALL);
    expect(c.cause.movedOut[cellIndex(14, 35)]).toBe(1);
    expect(c.cause.movedIn[cellIndex(13, 35)]).toBe(1);
    expect(c.net[cellIndex(14, 35)]).toBe(-1);
    expect(c.net[cellIndex(13, 35)]).toBe(1);
    expect(c.counts.moved).toBe(1);
  });

  it("ignores jitter below the thresholds, even across a cell edge", () => {
    const [a, b] = pair([{ id: 1, alt: 549, inc: 70 }], [{ id: 1, alt: 551, inc: 70.09 }]);
    const c = buildChange(a, b, {}, ALL);
    expect(sum(c.cause.movedIn) + sum(c.cause.movedOut)).toBe(0);
    expect(c.counts.moved).toBe(0);
  });

  it("counts exactly 5 km or exactly 0.1° as a move (compared in the file's units)", () => {
    // Values as decoded from a file: whole 0.1 km and 0.01° steps. Each pair crosses a cell edge
    // (521.9 → 526.9 km; 70.45° → 70.55°), since only objects whose cells change are counted.
    const alt = pair([{ id: 1, alt: 0, sma: 6900, inc: 70 }], [{ id: 1, alt: 0, sma: 6905, inc: 70 }]);
    expect(buildChange(alt[0], alt[1], {}, ALL).counts.moved).toBe(1);
    const inc = pair([{ id: 1, alt: 549, inc: 7045 / 100 }], [{ id: 1, alt: 549, inc: 7055 / 100 }]);
    expect(buildChange(inc[0], inc[1], {}, ALL).counts.moved).toBe(1);
    const under = pair([{ id: 1, alt: 0, sma: 6900, inc: 70 }], [{ id: 1, alt: 0, sma: 6904.9, inc: 70 }]);
    expect(buildChange(under[0], under[1], {}, ALL).counts.moved).toBe(0);
  });

  it("judges a reclassified object by its later type, so it is neither new nor gone", () => {
    const [a, b] = pair([{ id: 1, alt: 460, inc: 53, type: "UNK" }], [{ id: 1, alt: 460, inc: 53, type: "DEB" }]);
    const debris = buildChange(a, b, {}, { ...ALL, types: ["DEB"] });
    expect(debris.counts).toEqual({ new: 0, reentered: 0, untracked: 0, moved: 0 });
    const unknown = buildChange(a, b, {}, { ...ALL, types: ["UNK"] });
    expect(unknown.counts).toEqual({ new: 0, reentered: 0, untracked: 0, moved: 0 });
  });

  it("keeps only the rows the orbit filter allows", () => {
    const gto = { alt: 0, sma: R_EARTH_KM + 18018, ecc: 0.7, inc: 27 };
    const [a, b] = pair([{ id: 1, ...gto }], [{ id: 1, ...gto, sma: gto.sma - 500 }]);
    const leo = buildChange(a, b, {}, LEO);
    const all = buildChange(a, b, {}, ALL);
    expect(sum(leo.net.slice(cellIndex(73, 0)))).toBe(0);
    expect(sum(all.cause.movedIn)).toBeGreaterThan(sum(leo.cause.movedIn));
  });

  it("nets out the causes cell by cell", () => {
    const [a, b] = pair(
      [{ id: 1, alt: 460, inc: 53 }, { id: 2, alt: 460, inc: 53 }],
      [{ id: 2, alt: 460, inc: 53 }, { id: 3, alt: 460, inc: 53 }, { id: 4, alt: 460, inc: 53 }],
    );
    const c = buildChange(a, b, {}, ALL);
    expect(c.net[HOT]).toBe(1);
    expect(c.counts).toEqual({ new: 2, reentered: 0, untracked: 1, moved: 0 });
  });
});

describe("moversInCell", () => {
  it("lists the objects behind a cell's change, biggest first, with before and after", () => {
    const [a, b] = pair(
      [{ id: 7, alt: 530, inc: 70 }, { id: 8, alt: 540, inc: 70 }, { id: 9, alt: 530, inc: 70 }],
      [{ id: 7, alt: 505, inc: 70 }, { id: 8, alt: 540, inc: 70 }, { id: 10, alt: 530, inc: 70 }],
    );
    const movers = moversInCell(a, b, { "9": "2026-09-23" }, ALL, cellIndex(14, 35));
    expect(movers.map((m) => [m.noradId, m.cause])).toEqual([[7, "movedOut"], [9, "reentered"], [10, "new"]]);
    expect(movers[0].before?.altKm).toBeCloseTo(530, 6);
    expect(movers[0].after?.altKm).toBeCloseTo(505, 6);
    expect(movers[1].after).toBeNull();
    expect(movers[2].before).toBeNull();
    expect(moversInCell(a, b, {}, ALL, cellIndex(14, 35), 1)).toHaveLength(1);
  });
});
