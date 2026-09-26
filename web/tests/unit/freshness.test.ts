import { describe, expect, it } from "vitest";
import { deriveStatus, formatAge, retryLabel, STALE_AFTER_MS, type PillGroup, type PillGroupStatus, type PillInput } from "@/lib/freshness";

const MIN = 60_000;
const H = 60 * MIN;
const T0 = Date.parse("2026-09-26T12:41:00Z");
const input = (
  leo: PillGroupStatus,
  high: PillGroupStatus,
  wanted: PillGroup[] = ["LEO"],
  generatedAt: number | null = T0,
): PillInput => ({ groups: { LEO: { status: leo }, HIGH: { status: high } }, wanted, generatedAt });

describe("formatAge", () => {
  it.each([
    [0, "just now"],
    [59_999, "just now"],
    [MIN, "1 min ago"],
    [59 * MIN, "59 min ago"],
    [H, "1h ago"],
    [47 * H + 59 * MIN, "47h ago"],
    [48 * H, "2d ago"],
    [80 * H, "3d ago"],
  ])("%d ms → %s", (ms, text) => {
    expect(formatAge(ms)).toBe(text);
  });
});

describe("deriveStatus", () => {
  it("shows loading before anything is ready", () => {
    expect(deriveStatus(input("loading", "idle"), T0)).toEqual({
      tone: "grey", word: "LOADING ORBITS…", note: null, age: null, retry: [], title: "Elements published 2026-09-26 12:41 UTC",
    });
  });

  it("counts an idle wanted group as loading", () => {
    expect(deriveStatus(input("idle", "idle", ["LEO"], null), T0)).toMatchObject({ tone: "grey", word: "LOADING ORBITS…", title: null });
  });

  it("says no data yet when nothing is published", () => {
    expect(deriveStatus(input("missing", "idle", ["LEO"], null), T0)).toMatchObject({ tone: "grey", word: "NO DATA YET", retry: [] });
  });

  it("says no orbit data, with Retry, when every wanted group failed", () => {
    expect(deriveStatus(input("error", "idle", ["LEO"], null), T0)).toMatchObject({ tone: "red", word: "NO ORBIT DATA", note: null, retry: ["LEO"] });
    expect(deriveStatus(input("error", "error", ["LEO", "HIGH"], null), T0).retry).toEqual(["LEO", "HIGH"]);
  });

  it("is LIVE with the age when fresh", () => {
    expect(deriveStatus(input("ready", "idle"), T0 + 2 * H)).toEqual({
      tone: "green", word: "LIVE", note: null, age: "2h ago", retry: [], title: "Elements published 2026-09-26 12:41 UTC",
    });
  });

  it("is still LIVE at exactly 12 hours and DELAYED after", () => {
    expect(deriveStatus(input("ready", "idle"), T0 + STALE_AFTER_MS)).toMatchObject({ tone: "green", word: "LIVE" });
    expect(deriveStatus(input("ready", "idle"), T0 + STALE_AFTER_MS + 1)).toMatchObject({ tone: "amber", word: "DELAYED", age: "12h ago" });
  });

  it("names a failed wanted group and offers Retry for it", () => {
    expect(deriveStatus(input("ready", "error", ["LEO", "HIGH"]), T0 + H)).toMatchObject({
      tone: "amber", word: "LIVE", note: "higher orbits failed", age: null, retry: ["HIGH"],
    });
  });

  it("ignores a failed group that is not wanted", () => {
    expect(deriveStatus(input("ready", "error", ["LEO"]), T0 + H)).toMatchObject({ tone: "green", word: "LIVE", age: "1h ago", retry: [] });
  });

  it("keeps DELAYED when stale and partial", () => {
    expect(deriveStatus(input("ready", "error", ["LEO", "HIGH"]), T0 + 14 * H)).toMatchObject({
      tone: "amber", word: "DELAYED", note: "higher orbits failed",
    });
  });

  it("says a wanted group is still loading", () => {
    expect(deriveStatus(input("ready", "loading", ["LEO", "HIGH"]), T0 + H)).toMatchObject({
      tone: "green", word: "LIVE", note: "loading higher orbits…", age: null,
    });
  });

  it("says a wanted group is not available when it was never published", () => {
    expect(deriveStatus(input("ready", "missing", ["LEO", "HIGH"]), T0 + H)).toMatchObject({
      tone: "amber", word: "LIVE", note: "higher orbits not available", retry: [],
    });
  });

  it("is NO ORBIT DATA when only higher orbits are wanted and they failed", () => {
    expect(deriveStatus(input("ready", "error", ["HIGH"]), T0 + H)).toMatchObject({ tone: "red", word: "NO ORBIT DATA", retry: ["HIGH"] });
  });

  it("names whichever wanted group failed", () => {
    expect(deriveStatus(input("ready", "error", ["LEO", "HIGH"]), T0).note).toBe("higher orbits failed");
    expect(deriveStatus(input("error", "ready", ["LEO", "HIGH"]), T0)).toMatchObject({ note: "low orbits failed", retry: ["LEO"] });
  });

  it("has no age or title before the publish time is known", () => {
    expect(deriveStatus(input("ready", "idle", ["LEO"], null), T0)).toMatchObject({ age: null, title: null, word: "LIVE", tone: "green" });
  });

  it("a publish time in the future reads just now", () => {
    expect(deriveStatus(input("ready", "idle"), T0 - 5 * MIN).age).toBe("just now");
  });

  // `new Date(NaN).toISOString()` throws RangeError, and StatusPill sits outside GlobeErrorBoundary
  // — a non-finite generatedAt (a bad header) must never reach that call.
  it("treats a non-finite generatedAt as unknown: no title, no age, never DELAYED", () => {
    expect(deriveStatus(input("ready", "idle", ["LEO"], NaN), T0)).toMatchObject({
      tone: "green", word: "LIVE", age: null, title: null,
    });
    expect(deriveStatus(input("ready", "idle", ["LEO"], Infinity), T0)).toMatchObject({ word: "LIVE", title: null });
  });
});

describe("retryLabel", () => {
  it("names the one failed group", () => {
    expect(retryLabel(["LEO"])).toBe("Retry low orbits");
    expect(retryLabel(["HIGH"])).toBe("Retry higher orbits");
  });

  it("says orbits, not both names, when both failed", () => {
    expect(retryLabel(["LEO", "HIGH"])).toBe("Retry orbits");
  });
});
