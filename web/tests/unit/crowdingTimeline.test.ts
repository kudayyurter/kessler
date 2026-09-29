import { describe, expect, it } from "vitest";
import { addDays, daysBetween, defaultGap, gapEnabled, gapHint, gapLabel, playFrames, snapDay, windowFor } from "@/lib/crowding/timeline";

const days = ["2026-09-25", "2026-09-26", "2026-09-28", "2026-09-29", "2026-10-02"]; // 09-27, 09-30, 10-01 missing

describe("crowding timeline", () => {
  it("does day arithmetic in UTC", () => {
    expect(addDays("2026-09-30", 2)).toBe("2026-10-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-09-25", "2026-10-02")).toBe(7);
  });

  it("enables a window chip once the history spans it", () => {
    expect(gapEnabled(1, days)).toBe(true);
    expect(gapEnabled(7, days)).toBe(true);
    expect(gapEnabled(30, days)).toBe(false);
    expect(gapEnabled("all", days)).toBe(true);
    expect(gapEnabled("all", ["2026-09-25"])).toBe(false);
    expect(defaultGap(days)).toBe(7);
    expect(defaultGap(days.slice(0, 2))).toBe("all");
    expect([gapLabel(7), gapLabel("all")]).toEqual(["7 d", "All"]);
    expect([gapHint(7), gapHint(30), gapHint("all")]).toEqual(["needs 7 days of history", "needs 30 days of history", "needs 2 days of history"]);
  });

  it("snaps a missing day to the nearest earlier one, or to the earliest", () => {
    expect(snapDay("2026-09-27", days)).toBe("2026-09-26");
    expect(snapDay("2026-09-28", days)).toBe("2026-09-28");
    expect(snapDay("2026-09-01", days)).toBe("2026-09-25");
    expect(snapDay("2026-09-27", [])).toBeNull();
  });

  it("builds the window ending on a day, or none when it would be empty", () => {
    expect(windowFor("2026-10-02", 1, days)).toEqual({ from: "2026-09-29", to: "2026-10-02" });
    expect(windowFor("2026-10-02", 7, days)).toEqual({ from: "2026-09-25", to: "2026-10-02" });
    expect(windowFor("2026-09-28", "all", days)).toEqual({ from: "2026-09-25", to: "2026-09-28" });
    expect(windowFor("2026-09-25", 1, days)).toBeNull();
  });

  it("plays every day in Now mode and every comparable day in Change mode, at most 60 frames ending on the latest", () => {
    expect(playFrames(days, "now", 1)).toEqual(days);
    expect(playFrames(days, "change", 1)).toEqual(days.slice(1));
    const long = Array.from({ length: 121 }, (_, k) => addDays("2026-01-01", k));
    const frames = playFrames(long, "now", 1);
    expect(frames.length).toBeLessThanOrEqual(60);
    expect(frames.at(-1)).toBe(long.at(-1));
  });
});
