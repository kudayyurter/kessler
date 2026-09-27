import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { interpolate, locateIn } from "@/components/globe/instances";

describe("interpolate", () => {
  const frames = {
    prev: new Float32Array([1, 0, 0, NaN, NaN, NaN]),
    next: new Float32Array([0, 1, 0, 1, 1, 1]),
    prevTime: 1000,
    nextTime: 2000,
  };
  it("interpolates linearly between frames", () => {
    const v = new THREE.Vector3();
    expect(interpolate(frames, 1500, 0, v)).toBe(true);
    expect(v.toArray()).toEqual([0.5, 0.5, 0]);
  });
  it("reports NaN positions as not drawable", () => {
    expect(interpolate(frames, 1500, 1, new THREE.Vector3())).toBe(false);
  });
  it("is not drawable before any frame exists", () => {
    expect(interpolate({ prev: null, next: null, prevTime: 0, nextTime: 0 }, 0, 0, new THREE.Vector3())).toBe(false);
  });
});

describe("locateIn", () => {
  const frames = {
    prev: new Float32Array([1, 0, 0, NaN, NaN, NaN]),
    next: new Float32Array([0, 1, 0, 1, 1, 1]),
    prevTime: 1000,
    nextTime: 2000,
  };

  it("is absent when the object has no index in this group", () => {
    expect(locateIn(frames, undefined, 1500, new THREE.Vector3())).toBe("absent");
  });

  it("is pending before this group has produced a first frame", () => {
    expect(locateIn({ prev: null, next: null, prevTime: 0, nextTime: 0 }, 0, 0, new THREE.Vector3())).toBe("pending");
  });

  it("returns the interpolated position when it can be computed", () => {
    const v = new THREE.Vector3();
    expect(locateIn(frames, 0, 1500, v)).toBe(v);
    expect(v.toArray()).toEqual([0.5, 0.5, 0]);
  });

  it("is absent (not pending) when the object's positions are NaN", () => {
    expect(locateIn(frames, 1, 1500, new THREE.Vector3())).toBe("absent");
  });
});
