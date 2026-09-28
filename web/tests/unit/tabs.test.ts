import { describe, expect, it } from "vitest";
import { nextTabIndex } from "@/lib/tabs";

describe("nextTabIndex", () => {
  it("moves right and left, wrapping", () => {
    expect(nextTabIndex("ArrowRight", 0, 6)).toBe(1);
    expect(nextTabIndex("ArrowRight", 5, 6)).toBe(0);
    expect(nextTabIndex("ArrowLeft", 0, 6)).toBe(5);
    expect(nextTabIndex("ArrowLeft", 3, 6)).toBe(2);
  });

  it("jumps to the first and last", () => {
    expect(nextTabIndex("Home", 4, 6)).toBe(0);
    expect(nextTabIndex("End", 1, 6)).toBe(5);
  });

  it("ignores other keys", () => {
    expect(nextTabIndex("Enter", 2, 6)).toBeNull();
    expect(nextTabIndex("ArrowDown", 2, 6)).toBeNull();
  });
});
