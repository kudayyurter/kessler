import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, api, buildQuery } from "@/lib/api";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(response: Response) {
  // Clone on each call: a Response body can only be read once, and some tests now drive multiple
  // fetch() calls off one stub (e.g. two api.snapshot() calls sharing one stubbed response).
  const fn = vi.fn(async () => response.clone());
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("buildQuery", () => {
  it("joins arrays with commas and skips undefined and empty arrays", () => {
    expect(buildQuery({ owners: ["US", "PRC"], types: [], from: 2006, to: undefined })).toBe("?owners=US%2CPRC&from=2006");
    expect(buildQuery({})).toBe("");
  });
});

describe("api", () => {
  it("requests same-origin paths", async () => {
    const fn = stubFetch(Response.json({ metric: "in_orbit", group_by: "type", years: [], series: [] }));
    await api.timeseries({ group_by: "type", regimes: ["LEO"], from: 2006, to: 2011 });
    expect((fn.mock.calls[0] as unknown[])[0]).toBe("/api/stats/timeseries?group_by=type&regimes=LEO&from=2006&to=2011");
  });

  it("throws ApiRequestError with the API's code and message", async () => {
    stubFetch(Response.json({ error: { code: "invalid_filter", message: "unknown owner code 'XX'" } }, { status: 422 }));
    await expect(api.meta()).rejects.toMatchObject({ status: 422, code: "invalid_filter", message: "unknown owner code 'XX'" });
  });

  it("falls back to a generic error when the body is not JSON", async () => {
    stubFetch(new Response("Bad Gateway", { status: 502 }));
    const err = await api.events().catch((e) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err.code).toBe("http_error");
  });

  it("returns null for a missing snapshot and bytes otherwise", async () => {
    stubFetch(Response.json({ error: { code: "not_found", message: "no globe snapshot" } }, { status: 404 }));
    expect(await api.snapshot("LEO")).toBeNull();
    stubFetch(new Response(new Uint8Array([1, 2, 3])));
    expect(Array.from((await api.snapshot("HIGH"))!)).toEqual([1, 2, 3]);
  });

  it("encodes search text", async () => {
    const fn = stubFetch(Response.json([]));
    await api.search("50%_ off");
    expect((fn.mock.calls[0] as unknown[])[0]).toBe("/api/objects/search?q=50%25_+off");
  });

  it("requests the names endpoint and returns body.names", async () => {
    const fn = stubFetch(Response.json({ generated_at: "2026-09-23T10:00:00Z", names: { "25544": "ISS (ZARYA)" } }));
    const result = await api.names("LEO");
    expect((fn.mock.calls[0] as unknown[])[0]).toBe("/api/globe/names?group=LEO");
    expect(result).toEqual({ "25544": "ISS (ZARYA)" });
  });

  it("throws ApiRequestError on names endpoint 500", async () => {
    stubFetch(Response.json({ error: { code: "server_error", message: "internal error" } }, { status: 500 }));
    await expect(api.names("HIGH")).rejects.toMatchObject({ status: 500, code: "server_error" });
  });

  it("reads the globe pointer and treats 404 as no generation yet", async () => {
    stubFetch(Response.json({ error: { code: "not_found", message: "none" } }, { status: 404 }));
    expect(await api.current()).toBeNull();
    const pointer = { generation: "20260925T064112Z-r42", generated_at: "2026-09-25T06:41:12+00:00", groups: { LEO: { count: 1 }, HIGH: { count: 0 } } };
    const fn = stubFetch(Response.json(pointer));
    expect(await api.current()).toEqual(pointer);
    expect((fn.mock.calls[0] as unknown[])[0]).toBe("/api/globe/current");
  });

  describe("when a tab's generation has been deleted", () => {
    const gen = "20260925T064112Z-r42";
    const gone = () => Response.json({ error: { code: "not_found", message: "not found" } }, { status: 404 });
    // 404 for any versioned URL; `current` answers the un-versioned one.
    function stubGenerationGone(current: () => Response) {
      const fn = vi.fn(async (url: string) => (url.includes("gen=") ? gone() : current()));
      vi.stubGlobal("fetch", fn);
      return fn;
    }

    it("loads the snapshot from the current generation instead", async () => {
      const fn = stubGenerationGone(() => new Response(new Uint8Array([7, 8])));
      expect(Array.from((await api.snapshot("HIGH", gen))!)).toEqual([7, 8]);
      expect(fn.mock.calls.map((c) => c[0])).toEqual([`/api/globe/snapshot?group=HIGH&gen=${gen}`, "/api/globe/snapshot?group=HIGH"]);
    });

    it("loads the names from the current generation instead", async () => {
      const fn = stubGenerationGone(() => Response.json({ generated_at: null, names: { "4": "GAMMA GEO" } }));
      expect(await api.names("HIGH", gen)).toEqual({ "4": "GAMMA GEO" });
      expect(fn.mock.calls.map((c) => c[0])).toEqual([`/api/globe/names?group=HIGH&gen=${gen}`, "/api/globe/names?group=HIGH"]);
    });

    it("retries once, and never an un-versioned request", async () => {
      const fn = stubGenerationGone(gone);
      expect(await api.snapshot("LEO", gen)).toBeNull();
      expect(fn).toHaveBeenCalledTimes(2);
      expect(await api.snapshot("LEO")).toBeNull();
      expect(fn).toHaveBeenCalledTimes(3);
      await expect(api.names("LEO", gen)).rejects.toMatchObject({ status: 404 });
      expect(fn).toHaveBeenCalledTimes(5);
    });
  });

  it("addresses snapshots and names by generation when given one", async () => {
    const fn = stubFetch(new Response(new Uint8Array([1])));
    await api.snapshot("LEO", "20260925T064112Z-r42");
    expect((fn.mock.calls[0] as unknown[])[0]).toBe("/api/globe/snapshot?group=LEO&gen=20260925T064112Z-r42");
    await api.snapshot("HIGH");
    expect((fn.mock.calls[1] as unknown[])[0]).toBe("/api/globe/snapshot?group=HIGH");
    const names = stubFetch(Response.json({ generated_at: null, names: { "1": "A" } }));
    expect(await api.names("LEO", "20260925T064112Z-r42")).toEqual({ "1": "A" });
    expect((names.mock.calls[0] as unknown[])[0]).toBe("/api/globe/names?group=LEO&gen=20260925T064112Z-r42");
  });

  // The CDN caches /meta and /stats/* for minutes to hours; a refetch triggered by a newly
  // published globe generation must bust past that cache (the proxy passes unknown query params
  // through, FastAPI ignores them) or it can keep serving pre-publication data for the CDN's
  // whole TTL. See globeData's `dataGeneration` (store.ts) and page.tsx.
  it("adds gen to meta/timeseries/breakdown when given, and omits it otherwise", async () => {
    let fn = stubFetch(Response.json({}));
    await api.meta();
    expect((fn.mock.calls[0] as unknown[])[0]).toBe("/api/meta");
    fn = stubFetch(Response.json({}));
    await api.meta("20260926T064100Z-r43");
    expect((fn.mock.calls[0] as unknown[])[0]).toBe("/api/meta?gen=20260926T064100Z-r43");

    fn = stubFetch(Response.json({ metric: "in_orbit", group_by: "type", years: [], series: [] }));
    await api.timeseries({ group_by: "type", from: 2006 });
    expect((fn.mock.calls[0] as unknown[])[0]).toBe("/api/stats/timeseries?group_by=type&from=2006");
    fn = stubFetch(Response.json({ metric: "in_orbit", group_by: "type", years: [], series: [] }));
    await api.timeseries({ group_by: "type", from: 2006, gen: "20260926T064100Z-r43" });
    expect((fn.mock.calls[0] as unknown[])[0]).toBe("/api/stats/timeseries?group_by=type&from=2006&gen=20260926T064100Z-r43");

    fn = stubFetch(Response.json({ by: "owner", at: 0, items: [] }));
    await api.breakdown({ by: "owner", top: 5, gen: "20260926T064100Z-r43" });
    expect((fn.mock.calls[0] as unknown[])[0]).toBe("/api/stats/breakdown?by=owner&top=5&gen=20260926T064100Z-r43");
  });

  it("adds rank_of to the breakdown request when given", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      urls.push(u);
      return new Response(JSON.stringify({ at: 2026, by: "owner", rows: [] }), { status: 200 });
    }));
    await api.breakdown({ by: "owner", top: 5, rank_of: "GER" });
    await api.breakdown({ by: "owner", top: 5 });
    expect(new URL(urls[0], "http://x").searchParams.get("rank_of")).toBe("GER");
    expect(new URL(urls[1], "http://x").searchParams.has("rank_of")).toBe(false);
    vi.unstubAllGlobals();
  });

  // A request that never settles must not block every later check for the session — see
  // globeData.ts `check()`, which awaits `api.current()` (the pointer). AbortSignal.timeout gives
  // it (and the snapshot fetches) a hard ceiling.
  it("times out the pointer fetch", async () => {
    const fn = stubFetch(Response.json({ error: { code: "not_found", message: "none" } }, { status: 404 }));
    await api.current();
    const init = (fn.mock.calls[0] as unknown[])[1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("times out snapshot and names fetches", async () => {
    let fn = stubFetch(new Response(new Uint8Array([1])));
    await api.snapshot("LEO");
    let init = (fn.mock.calls[0] as unknown[])[1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);

    fn = stubFetch(Response.json({ generated_at: null, names: {} }));
    await api.names("LEO");
    init = (fn.mock.calls[0] as unknown[])[1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("crowding API", () => {
  it("returns null for a missing index or day", async () => {
    stubFetch(Response.json({ error: { code: "not_found", message: "none" } }, { status: 404 }));
    expect(await api.crowdingIndex()).toBeNull();
    expect(await api.crowdingDay("2026-09-20")).toBeNull();
  });

  it("returns the index and a day's bytes, passing gen through", async () => {
    stubFetch(Response.json({ latest: { day: "2026-09-23", generation: null } }));
    expect((await api.crowdingIndex())?.latest?.day).toBe("2026-09-23");
    const fn = stubFetch(new Response(new Uint8Array([1, 2, 3])));
    expect(Array.from((await api.crowdingDay("2026-09-23", "20260923T120000Z-r1"))!)).toEqual([1, 2, 3]);
    expect((fn.mock.calls[0] as unknown[])[0]).toBe("/api/crowding/day/2026-09-23?gen=20260923T120000Z-r1");
  });
});
