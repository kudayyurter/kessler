import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodeCrowdingDay } from "@/lib/crowding/format";

const fx = (n: string) => new Uint8Array(gunzipSync(readFileSync(new URL(`../fixtures/crowding/${n}`, import.meta.url))));

describe("decodeCrowdingDay", () => {
  it("decodes a file written by the independent Python encoder", () => {
    const d = decodeCrowdingDay(fx("day-2026-09-23.bin.gz"));
    expect(d.header.day).toBe("2026-09-23");
    expect(d.header.source).toBe("live");
    expect(d.header.count).toBe(14);
    expect(d.header.owners).toEqual(["PRC", "US"]);
    expect(Array.from(d.norad.slice(0, 3))).toEqual([101, 102, 103]);
    expect(Array.from(d.norad.slice(-2))).toEqual([302, 401]);
    const i = d.norad.indexOf(401);
    expect(d.header.owners[d.owner[i]]).toBe("PRC");
    expect(d.header.types[d.type[i]]).toBe("DEB");
    expect(d.smaKm[i]).toBeCloseTo(6378.137 + 460, 1);
    expect(d.ecc[i]).toBeCloseTo(0.0001, 6);
    expect(d.incDeg[i]).toBeCloseTo(53, 2);
  });

  it("rejects other files and truncated ones", () => {
    expect(() => decodeCrowdingDay(new TextEncoder().encode("LEO1xxxxxxxx"))).toThrow("not a CRW1 day file");
    const raw = fx("day-2026-09-22.bin.gz");
    expect(() => decodeCrowdingDay(raw.subarray(0, raw.length - 3))).toThrow("truncated");
  });

  it("rejects an unexpected column layout", () => {
    // Patch one header byte in place (same length): "sma_dkm" → "sma_xkm".
    const raw = fx("day-2026-09-22.bin.gz").slice();
    const needle = new TextEncoder().encode("sma_dkm");
    const at = raw.findIndex((_, i) => needle.every((b, k) => raw[i + k] === b));
    expect(at).toBeGreaterThan(0);
    raw[at + 4] = "x".charCodeAt(0);
    expect(() => decodeCrowdingDay(raw)).toThrow("unsupported CRW1 columns");
  });
});
