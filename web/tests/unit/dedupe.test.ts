import { describe, expect, it } from "vitest";
import { keepPrevIfEqual } from "@/lib/dedupe";

describe("keepPrevIfEqual", () => {
  it("returns `next` when there's no previous value", () => {
    const next = { a: 1 };
    expect(keepPrevIfEqual(null, next)).toBe(next);
  });

  it("returns the SAME previous object when next is deep-equal, not the new one", () => {
    const prev = { a: 1, b: [1, 2] };
    const next = { a: 1, b: [1, 2] }; // same shape, different object identity
    expect(keepPrevIfEqual(prev, next)).toBe(prev);
  });

  it("returns `next` when it differs from the previous value", () => {
    const prev = { a: 1 };
    const next = { a: 2 };
    expect(keepPrevIfEqual(prev, next)).toBe(next);
  });
});
