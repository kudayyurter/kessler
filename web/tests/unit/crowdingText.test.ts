import { describe, expect, it } from "vitest";
import { buildMap } from "@/lib/crowding/grid";
import { busiestLine, cellAnnouncement, cellSummary, fmtAvg, fmtDensity } from "@/lib/crowding/text";
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
