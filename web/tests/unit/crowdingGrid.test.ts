import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildMap, busiestShell, cellIndex, cellLabel, cellsOf, COLS, columnLabel, columnOf, columnRange, forEachRow,
  R_EARTH_KM, rowLabel, rowOf, rowRange, ROWS, rowTotal, semiMajorAxisKm, shellDensity, shellVolumeKm3, timeBelow,
} from "@/lib/crowding/grid";
import { ALL, dayOf, LEO } from "./crowdingDays";

const GTO = { sma: R_EARTH_KM + (250 + 35786) / 2, ecc: 35536 / (2 * R_EARTH_KM + 36036) };

describe("grid geometry", () => {
  it("has 79 rows and 91 columns", () => {
    expect([ROWS, COLS]).toEqual([79, 91]);
  });

  it.each([[0, 0], [0.49, 0], [0.5, 1], [52.5, 27], [53.05, 27], [54.49, 27], [54.5, 28], [70, 35], [97.6, 49], [178.5, 90], [180, 90]])(
    "puts %d° in column %d", (inc, col) => expect(columnOf(inc)).toBe(col),
  );

  it("gives each column its half-degree range", () => {
    expect(columnRange(0)).toEqual([0, 0.5]);
    expect(columnRange(27)).toEqual([52.5, 54.5]);
    expect(columnRange(90)).toEqual([178.5, 180]);
  });

  it.each([[-50, 0], [199.9, 0], [200, 1], [224.99, 1], [225, 2], [460, 11], [1999.9, 72], [2000, 73], [20182, 75], [35786, 77], [36000, 78]])(
    "puts %d km in row %d", (alt, row) => expect(rowOf(alt)).toBe(row),
  );

  it("gives row ranges and labels", () => {
    expect(rowRange(0)).toEqual([-Infinity, 200]);
    expect(rowRange(11)).toEqual([450, 475]);
    expect(rowRange(78)).toEqual([35986, Infinity]);
    expect(rowLabel(0)).toBe("< 200 km");
    expect(rowLabel(11)).toBe("450–475 km");
    expect(rowLabel(73)).toBe("2,000–8,000 km");
    expect(rowLabel(78)).toBe("> 35,986 km");
    expect(columnLabel(0)).toBe("0–0.5°");
    expect(columnLabel(27)).toBe("52.5–54.5°");
    expect(cellLabel({ row: 11, col: 27 })).toBe("450–475 km · 52.5–54.5°");
  });

  it("computes the ISS's semi-major axis", () => {
    expect(semiMajorAxisKm(15.49224498)).toBeCloseTo(6797.13, 1);
  });
});

describe("time weighting", () => {
  it("matches the closed form for the time spent below the semi-major axis", () => {
    expect(timeBelow(10000, 0.5, 10000)).toBeCloseTo(0.5 - 0.5 / Math.PI, 12);
    expect(timeBelow(10000, 0.5, 4999)).toBe(0);
    expect(timeBelow(10000, 0.5, 15001)).toBe(1);
  });

  it("puts a circular orbit's whole weight in one row", () => {
    const rows: [number, number][] = [];
    forEachRow(R_EARTH_KM + 460, 0, (r, w) => rows.push([r, w]));
    expect(rows).toEqual([[11, 1]]);
  });

  it("spreads a GTO over many rows with weights summing to 1", () => {
    let sum = 0;
    let count = 0;
    forEachRow(GTO.sma, GTO.ecc, (_, w) => { sum += w; count++; });
    expect(count).toBeGreaterThan(10);
    expect(sum).toBeCloseTo(1, 12);
  });

  it.each([[R_EARTH_KM + 500, 1, 53], [R_EARTH_KM + 500, 1.2, 53], [R_EARTH_KM + 500, -0.1, 53], [R_EARTH_KM + 500, 0.001, 190], [NaN, 0.001, 53], [-5, 0.001, 53]])(
    "refuses to place a = %d, e = %d, i = %d", (a, e, i) => expect(cellsOf(a, e, i)).toBeNull(),
  );
});

describe("golden fixture from tools/crowding", () => {
  type Golden = { objects: { norad_id: number; sma_km: number; ecc: number; inc: number; cells: [number, number, number][] | null }[] };
  const golden = JSON.parse(readFileSync(new URL("../fixtures/crowding/golden.json", import.meta.url), "utf8")) as Golden;

  it("covers enough objects", () => {
    expect(golden.objects.length).toBeGreaterThanOrEqual(150);
  });

  it("matches the Python reference cell by cell", () => {
    for (const o of golden.objects) {
      const got = cellsOf(o.sma_km, o.ecc, o.inc);
      if (o.cells === null) {
        expect(got, `object ${o.norad_id}`).toBeNull();
        continue;
      }
      expect(got?.map(([r, c]) => [r, c]), `object ${o.norad_id}`).toEqual(o.cells.map(([r, c]) => [r, c]));
      got!.forEach(([, , w], k) => expect(Math.abs(w - o.cells![k][2]), `object ${o.norad_id} cell ${k}`).toBeLessThan(1e-9));
    }
  });
});

describe("buildMap", () => {
  const day = dayOf("2026-09-28", [
    { id: 1, alt: 460, inc: 53 },
    { id: 2, alt: 460, inc: 53, type: "DEB", owner: "PRC" },
    { id: 3, alt: 800, inc: 98.2, type: "DEB", owner: "PRC" },
    { id: 4, alt: 0, inc: 27, type: "R/B", sma: GTO.sma, ecc: GTO.ecc },
    { id: 5, alt: 35786, inc: 0.05 },
    { id: 6, alt: 500, inc: 53, ecc: 1.2 },
  ], 2);

  it("sums weights per cell and type and counts objects passing through", () => {
    const m = buildMap(day, ALL);
    const hot = cellIndex(11, 27);
    expect(m.total[hot]).toBeCloseTo(2, 12);
    expect(m.byType.PAY[hot]).toBeCloseTo(1, 12);
    expect(m.byType.DEB[hot]).toBeCloseTo(1, 12);
    expect(m.passing[hot]).toBe(2);
    expect(m.objects).toBe(5);
    const sum = m.total.reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(5, 9);
  });

  it("skips unplaceable objects and counts them with the file's own skipped", () => {
    const m = buildMap(day, ALL);
    expect(m.skipped).toBe(3);
    expect(m.total.every(Number.isFinite)).toBe(true);
  });

  it("applies the type and owner filters", () => {
    const debris = buildMap(day, { ...ALL, types: ["DEB"] });
    expect(debris.objects).toBe(2);
    const prc = buildMap(day, { ...ALL, owners: ["PRC"] });
    expect(prc.total[cellIndex(11, 27)]).toBeCloseTo(1, 12);
  });

  it("fills only LEO rows (and the floor) for Low Earth orbit, only the high strip for Higher orbits", () => {
    const leo = buildMap(day, LEO);
    expect(leo.total[cellIndex(77, 0)]).toBe(0);
    expect(rowTotal(leo, 11)).toBeCloseTo(2 + (rowTotal(buildMap(day, ALL), 11) - 2), 12);
    const high = buildMap(day, { ...ALL, orbits: { leo: false, high: true } });
    expect(high.total[cellIndex(11, 27)]).toBe(0);
    expect(high.total[cellIndex(77, 0)]).toBeCloseTo(1, 12);
    expect(high.objects).toBe(2); // the GEO payload and the GTO's high rows
  });

  it("a filter that excludes everything gives an empty map", () => {
    const m = buildMap(day, { ...ALL, owners: ["NOBODY"] });
    expect(m.objects).toBe(0);
    expect(m.total.every((v) => v === 0)).toBe(true);
    expect(busiestShell(m)).toBeNull();
  });

  it("computes spatial density per 10⁹ km³ and the busiest shell", () => {
    const m = buildMap(day, LEO);
    expect(shellVolumeKm3(11) / 1e9).toBeCloseTo(14.7, 1);
    expect(shellDensity(m, 11)).toBeCloseTo((rowTotal(m, 11) / shellVolumeKm3(11)) * 1e9, 12);
    expect(shellDensity(m, 11, "DEB")).toBeCloseTo((1 / shellVolumeKm3(11)) * 1e9, 3);
    expect(shellDensity(m, 0)).toBe(0);
    expect(busiestShell(m)?.row).toBe(11);
  });
});
