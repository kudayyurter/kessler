import { describe, expect, it } from "vitest";
import { dashedLatitude, ringRadius, silhouette, unitCircle } from "@/lib/crowding/rings";

describe("shell rings", () => {
  it("scales altitudes from R_E into scene units (Earth radius 6371 km = 1)", () => {
    expect(ringRadius(0)).toBeCloseTo(6378.137 / 6371, 12);
    expect(ringRadius(462.5)).toBeCloseTo((6378.137 + 462.5) / 6371, 12);
  });

  it("finds a sphere's silhouette circle as seen from a distance", () => {
    const s = 1.07, d = 3;
    const { offset, radius } = silhouette(s, d);
    expect(offset).toBeCloseTo((s * s) / d, 12);
    expect(radius).toBeCloseTo(s * Math.sqrt(1 - (s * s) / (d * d)), 12);
    expect(silhouette(1.07, 1)).toEqual({ offset: 0, radius: 1.07 });
  });

  it("draws a unit circle in the view plane", () => {
    const c = unitCircle(64);
    expect(c.length).toBe(64 * 3);
    for (let i = 0; i < 64; i++) expect(Math.hypot(c[3 * i], c[3 * i + 1])).toBeCloseTo(1, 6);
    expect(Array.from({ length: 64 }, (_, i) => c[3 * i + 2]).every((z) => z === 0)).toBe(true);
  });

  it("draws dashed latitude circles on the shell, around the scene's y (north) axis", () => {
    const r = 1.07, lat = 53;
    const pts = dashedLatitude(r, lat, 96);
    expect(pts.length).toBe((96 / 2) * 2 * 3);
    for (let i = 0; i < pts.length / 3; i++) {
      const [x, y, z] = [pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]];
      expect(Math.hypot(x, y, z)).toBeCloseTo(r, 6);
      expect(y).toBeCloseTo(r * Math.sin((lat * Math.PI) / 180), 6);
    }
    expect(dashedLatitude(r, -lat, 96)[1]).toBeCloseTo(-r * Math.sin((lat * Math.PI) / 180), 6);
    expect(dashedLatitude(r, 90, 96).length).toBe(0);
  });
});
