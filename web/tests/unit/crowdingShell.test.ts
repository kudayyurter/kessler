import { describe, expect, it } from "vitest";
import { inShell, latitudeLimitDeg, ringAltitudeKm, shellLabel } from "@/lib/crowding/shell";

// Mean motions for circular orbits: 460 km ≈ 15.3531 rev/day, 530 km ≈ 15.1203 rev/day.
const circular = (meanMotion: number, inclination: number) => ({ meanMotion, eccentricity: 0.0001, inclination });

describe("shell", () => {
  it("labels a shell", () => {
    expect(shellLabel({ row: 11, col: 27 })).toBe("Shell 450–475 km · 52.5–54.5°");
  });

  it("finds orbits whose altitude range overlaps the cell and whose inclination is in its column", () => {
    const hot = { row: 11, col: 27 };
    expect(inShell(circular(15.3531, 53.05), hot)).toBe(true);
    expect(inShell(circular(15.3531, 55.0), hot)).toBe(false);
    expect(inShell(circular(15.1203, 53.05), hot)).toBe(false);
    // A GTO (perigee ~250 km, apogee ~35,786 km) passes through every LEO shell in its column.
    expect(inShell({ meanMotion: 2.2784, eccentricity: 0.7283, inclination: 27 }, { row: 11, col: 14 })).toBe(true);
    expect(inShell({ meanMotion: 15.5, eccentricity: 1.2, inclination: 53 }, hot)).toBe(false);
  });

  it("gives the highest latitude the band's orbits reach", () => {
    expect(latitudeLimitDeg({ row: 11, col: 27 })).toBe(54.5);
    expect(latitudeLimitDeg({ row: 11, col: 49 })).toBe(83.5); // 96.5–98.5°: retrograde
    expect(latitudeLimitDeg({ row: 11, col: 45 })).toBe(90); // 88.5–90.5° contains 90°
  });

  it("puts the ring at the middle of the row, halfway up the floor row, and nowhere for the top row", () => {
    expect(ringAltitudeKm({ row: 11, col: 27 })).toBe(462.5);
    expect(ringAltitudeKm({ row: 0, col: 27 })).toBe(100);
    expect(ringAltitudeKm({ row: 77, col: 0 })).toBe(35786);
    expect(ringAltitudeKm({ row: 78, col: 0 })).toBeNull();
  });
});
