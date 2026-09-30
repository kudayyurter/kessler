import { describe, expect, it } from "vitest";
import { buildChange } from "@/lib/crowding/change";
import { buildMap } from "@/lib/crowding/grid";
import {
  busiestLine, cellAnnouncement, cellSummary, changeAnnouncement, changeCardRows, fmtAvg, fmtDensity, moverLine, shortStamp, summaryLine,
} from "@/lib/crowding/text";
import { ALL, dayOf } from "./crowdingDays";

describe("crowding text", () => {
  it("formats averages and densities", () => {
    expect([fmtAvg(4369.8), fmtAvg(9), fmtAvg(2.64), fmtAvg(0.2), fmtAvg(0)]).toEqual(["4,370", "9", "2.6", "0.2", "0"]);
    expect([fmtDensity(417.7), fmtDensity(5.44), fmtDensity(0.612)]).toEqual(["418", "5.4", "0.61"]);
  });

  const map = buildMap(dayOf("2026-09-23", [
    ...Array.from({ length: 8 }, (_, k) => ({ id: 101 + k, alt: 460, inc: 53 })),
    { id: 401, alt: 460, inc: 53, type: "DEB" as const, owner: "PRC" },
  ]), ALL);

  it("summarises a cell", () => {
    expect(cellSummary(map, { row: 11, col: 27 })).toEqual({
      title: "450–475 km · 52.5–54.5°",
      lines: ["≈ 9 objects at any moment", "8 payloads · 1 debris", "9 pass through · shell 0.61 per 10⁹ km³"],
    });
    expect(cellSummary(map, { row: 0, col: 27 }).lines).toEqual(["≈ 0 objects at any moment", "0 pass through"]);
    expect(cellAnnouncement(map, { row: 11, col: 27 })).toBe(
      "450–475 km · 52.5–54.5°. ≈ 9 objects at any moment. 8 payloads · 1 debris. 9 pass through · shell 0.61 per 10⁹ km³",
    );
  });

  it("names the busiest shell, or says there is none", () => {
    expect(busiestLine(map)).toBe("Busiest shell 450–475 km · 0.61 per 10⁹ km³");
    expect(busiestLine(buildMap(dayOf("2026-09-23", []), ALL))).toBe("No objects in low Earth orbit under these filters.");
  });
});

describe("change text", () => {
  it("writes the summary line with signs and the untracked count only when there is one", () => {
    expect(shortStamp("2026-09-22T18:41:32+00:00")).toBe("09-22 18:41");
    expect(summaryLine({ new: 1, reentered: 1, untracked: 1, moved: 1 }, "09-22 18:41")).toBe(
      "Since 09-22 18:41 UTC: +1 newly catalogued · −1 re-entered · −1 no longer tracked · 1 moved between cells · net −1",
    );
    expect(summaryLine({ new: 23, reentered: 9, untracked: 0, moved: 333 }, "09-25 06:41")).toBe(
      "Since 09-25 06:41 UTC: +23 newly catalogued · −9 re-entered · 333 moved between cells · net +14",
    );
    expect(summaryLine({ new: 0, reentered: 0, untracked: 0, moved: 0 }, "09-25 06:41")).toContain("net 0");
  });

  it("lists a cell's causes and describes movers", () => {
    const a = dayOf("2026-09-22", [{ id: 301, alt: 530, inc: 70 }]);
    const b = dayOf("2026-09-23", [{ id: 301, alt: 505, inc: 70 }]);
    const change = buildChange(a, b, {}, ALL);
    expect(changeCardRows(change, { row: 14, col: 35 })).toEqual([
      { label: "net change", value: "−1" },
      { label: "moved out", value: "1" },
      { label: "moved in", value: "0" },
      { label: "newly catalogued", value: "0" },
      { label: "re-entered", value: "0" },
    ]);
    expect(changeAnnouncement(change, { row: 14, col: 35 })).toBe(
      "525–550 km · 68.5–70.5°. net change −1, moved out 1, moved in 0, newly catalogued 0, re-entered 0",
    );
    const moved = { noradId: 301, cause: "movedOut" as const, before: { altKm: 530, incDeg: 70 }, after: { altKm: 505, incDeg: 70 }, delta: -1 };
    expect(moverLine(moved, "301")).toBe("301: 530 → 505 km");
    expect(moverLine({ ...moved, after: { altKm: 530, incDeg: 72.4 } }, "X")).toBe("X: 530 → 530 km, 70° → 72.4°");
    expect(moverLine({ ...moved, cause: "new", before: null, after: { altKm: 460, incDeg: 53 } }, "Y")).toBe("Y: newly catalogued at 460 km");
    expect(moverLine({ ...moved, cause: "reentered", after: null }, "Z")).toBe("Z: re-entered");
    expect(moverLine({ ...moved, cause: "untracked", after: null }, "Z")).toBe("Z: no longer tracked");
  });
});
