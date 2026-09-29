import { describe, expect, it } from "vitest";
import { buildChange } from "@/lib/crowding/change";
import { ALL_ROWS } from "@/lib/crowding/draw";
import { buildMap } from "@/lib/crowding/grid";
import { changeRows, shellRows, topCells } from "@/lib/crowding/tables";
import { ALL, dayOf } from "./crowdingDays";

const day1 = dayOf("2026-09-22", [
  { id: 1, alt: 460, inc: 53 }, { id: 2, alt: 460, inc: 53 }, { id: 3, alt: 800, inc: 98.2, type: "DEB" }, { id: 4, alt: 530, inc: 70 },
]);
const day2 = dayOf("2026-09-23", [
  { id: 1, alt: 460, inc: 53 }, { id: 2, alt: 460, inc: 53 }, { id: 3, alt: 800, inc: 98.2, type: "DEB" }, { id: 4, alt: 505, inc: 70 },
  { id: 5, alt: 460, inc: 53 },
]);

describe("crowding tables", () => {
  const map = buildMap(day2, ALL);

  it("lists the busiest cells with their split by type", () => {
    const rows = topCells(map, ALL_ROWS, 2);
    expect(rows.map((r) => [r.label, r.total])).toEqual([["450–475 km · 52.5–54.5°", 3], ["500–525 km · 68.5–70.5°", 1]]);
    expect(rows[0].byType.PAY).toBe(3);
  });

  it("lists the LEO shells that hold objects, lowest first", () => {
    const shells = shellRows(map);
    expect(shells.map((s) => s.label)).toEqual(["450–475 km", "500–525 km", "800–825 km"]);
    expect(shells[2].byType.DEB).toBeCloseTo(shells[2].density, 12);
  });

  it("lists the biggest gains and losses with their causes", () => {
    const { gains, losses } = changeRows(buildChange(day1, day2, {}, ALL), ALL_ROWS);
    expect(gains.map((g) => [g.label, g.net, g.new, g.movedIn])).toEqual([
      ["450–475 km · 52.5–54.5°", 1, 1, 0],
      ["500–525 km · 68.5–70.5°", 1, 0, 1],
    ]);
    expect(losses.map((l) => [l.label, l.net, l.movedOut])).toEqual([["525–550 km · 68.5–70.5°", -1, 1]]);
  });
});
