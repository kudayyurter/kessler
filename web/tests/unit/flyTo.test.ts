import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { locate, shortestAngle, type Locator } from "@/components/globe/flyTo";

describe("shortestAngle", () => {
  it("goes the short way round the globe", () => {
    expect(shortestAngle(0.1, 0.3)).toBeCloseTo(0.2, 10);
    expect(shortestAngle(3.0, -3.0)).toBeCloseTo(2 * Math.PI - 6, 10);
    expect(shortestAngle(-3.0, 3.0)).toBeCloseTo(-(2 * Math.PI - 6), 10);
  });
});

describe("locate", () => {
  const at = new THREE.Vector3(1, 2, 3);
  const has = (id: number): Locator => (x) => (x === id ? at : "absent");
  const notYet = (id: number): Locator => (x) => (x === id ? "pending" : "absent");

  it("returns the position from whichever expected group has it", () => {
    expect(locate([has(5), has(9)], [0, 1], 9)).toBe(at);
  });

  it("waits while the object's group hasn't computed positions yet", () => {
    expect(locate([notYet(5)], [0], 5)).toBe("pending");
  });

  it("a group that hasn't loaded keeps it pending", () => {
    expect(locate([has(5), undefined], [0, 1], 9)).toBe("pending");
  });

  it("is absent only when every expected group is loaded and none has it", () => {
    expect(locate([has(5), has(6)], [0, 1], 9)).toBe("absent");
  });

  it("ignores groups that aren't expected", () => {
    expect(locate([has(5), has(9)], [0], 9)).toBe("absent");
  });
});
