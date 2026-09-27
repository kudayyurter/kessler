import { describe, expect, it, vi } from "vitest";
import { createNameCache } from "@/lib/names";

describe("name cache", () => {
  it("fetches a group once and serves it from memory", async () => {
    const fetcher = vi.fn(async () => ({ "25544": "ISS (ZARYA)" }));
    const c = createNameCache(fetcher);
    const [a, b] = await Promise.all([c.get("LEO"), c.get("LEO")]);
    expect(a?.get(25544)).toBe("ISS (ZARYA)");
    expect(b).toBe(a);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(c.peek("LEO")?.get(25544)).toBe("ISS (ZARYA)");
    expect(c.peek("HIGH")).toBeNull();
  });

  it("returns null on failure and retries after the cooldown", async () => {
    let t = 0;
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("404")).mockResolvedValue({ "1": "A" });
    const c = createNameCache(fetcher, () => t, 60_000);
    expect(await c.get("LEO")).toBeNull();
    t = 30_000;
    expect(await c.get("LEO")).toBeNull(); // still cooling down, no refetch
    expect(fetcher).toHaveBeenCalledTimes(1);
    t = 61_000;
    expect((await c.get("LEO"))?.get(1)).toBe("A");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("fetches names for the current generation, falling back to the previous one until it loads", async () => {
    const fetcher = vi.fn(async (_g: "LEO" | "HIGH", gen?: string) => ({ "1": gen ?? "none" }));
    const c = createNameCache(fetcher);
    c.useGeneration("g1");
    expect((await c.get("LEO"))?.get(1)).toBe("g1");
    c.useGeneration("g1"); // same generation: keeps the cache
    expect(c.peek("LEO")?.get(1)).toBe("g1");
    c.useGeneration("g2");
    expect(c.peek("LEO")?.get(1)).toBe("g1"); // fallback until g2's own map loads (see the test below)
    expect((await c.get("LEO"))?.get(1)).toBe("g2");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenLastCalledWith("LEO", "g2");
  });

  it("falls back to the previous generation's names until the new generation's own load, per group", async () => {
    const fetcher = vi.fn(async (g: "LEO" | "HIGH", gen?: string) => ({ "1": `${gen}:${g}` }));
    const c = createNameCache(fetcher);
    c.useGeneration("g1");
    await Promise.all([c.get("LEO"), c.get("HIGH")]);
    expect(c.peek("LEO")?.get(1)).toBe("g1:LEO");
    expect(c.peek("HIGH")?.get(1)).toBe("g1:HIGH");

    c.useGeneration("g2");
    // Nothing loaded for g2 yet: LabelDriver would otherwise find peek() null and drop every
    // label until g2's own file arrives — serve g1's map (right for objects present in both,
    // keyed by NORAD ID) as a fallback instead.
    expect(c.peek("LEO")?.get(1)).toBe("g1:LEO");
    expect(c.peek("HIGH")?.get(1)).toBe("g1:HIGH");

    await c.get("LEO");
    // LEO's own g2 map has arrived: it wins over the g1 fallback. HIGH hasn't loaded yet, so it
    // still falls back to g1.
    expect(c.peek("LEO")?.get(1)).toBe("g2:LEO");
    expect(c.peek("HIGH")?.get(1)).toBe("g1:HIGH");

    await c.get("HIGH");
    expect(c.peek("HIGH")?.get(1)).toBe("g2:HIGH");
  });
});

// Models LabelDriver's own reselect pattern (peek for what to show now; independently kick a
// fetch whenever the CURRENT generation's map isn't loaded, regardless of what peek returned) —
// see LabelDriver.tsx's reselect(). Returns the pending fetch (if one was started) so tests can
// await it, standing in for the real 250ms cadence that lets it land on its own.
function reselectNames(c: ReturnType<typeof createNameCache>, g: "LEO" | "HIGH") {
  const names = c.peek(g);
  const pending = c.ready(g) ? null : c.get(g);
  return { names, pending };
}

describe("name cache — LabelDriver's peek/ready/get pattern across generation switches", () => {
  it("(a) fetches the new generation's names on the first reselect after a switch, replacing the fallback", async () => {
    const fetcher = vi.fn(async (_g: "LEO" | "HIGH", gen?: string) => ({ "1": gen ?? "none" }));
    const c = createNameCache(fetcher);
    c.useGeneration("g1");
    await reselectNames(c, "LEO").pending;

    c.useGeneration("g2");
    const first = reselectNames(c, "LEO");
    expect(first.names?.get(1)).toBe("g1"); // fallback shown immediately
    expect(first.pending).not.toBeNull(); // g2's own map must be requested despite the fallback
    await first.pending;
    expect(c.peek("LEO")?.get(1)).toBe("g2"); // new generation's names replace the fallback
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenLastCalledWith("LEO", "g2");
  });

  it("(b) two switches before a load keep serving the last good map and fetch only the newest generation", async () => {
    const fetcher = vi.fn(async (_g: "LEO" | "HIGH", gen?: string) => ({ "1": gen ?? "none" }));
    const c = createNameCache(fetcher);
    c.useGeneration("g1");
    await reselectNames(c, "LEO").pending;

    c.useGeneration("g2"); // no reselect in between: nothing g2-related is ever fetched
    c.useGeneration("g3");
    const first = reselectNames(c, "LEO");
    expect(first.names?.get(1)).toBe("g1"); // last GOOD map, not the never-loaded g2
    expect(first.pending).not.toBeNull();
    await first.pending;
    expect(c.peek("LEO")?.get(1)).toBe("g3");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenLastCalledWith("LEO", "g3");
  });

  it("(c) a failed fetch keeps the fallback and is retried after the cooldown", async () => {
    let t = 0;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ "1": "g1" })
      .mockRejectedValueOnce(new Error("404"))
      .mockResolvedValue({ "1": "g2" });
    const c = createNameCache(fetcher, () => t, 60_000);
    c.useGeneration("g1");
    await reselectNames(c, "LEO").pending;

    c.useGeneration("g2");
    let r = reselectNames(c, "LEO");
    expect(r.names?.get(1)).toBe("g1");
    await r.pending; // fails
    expect(c.peek("LEO")?.get(1)).toBe("g1"); // fallback still shown

    t = 30_000; // still cooling down
    r = reselectNames(c, "LEO");
    expect(r.pending).not.toBeNull(); // get() is still called every reselect...
    await r.pending;
    expect(fetcher).toHaveBeenCalledTimes(2); // ...but the cooldown means no new fetcher call
    expect(c.peek("LEO")?.get(1)).toBe("g1");

    t = 61_000; // cooldown over
    r = reselectNames(c, "LEO");
    await r.pending;
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(c.peek("LEO")?.get(1)).toBe("g2");
  });
});
