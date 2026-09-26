import { describe, expect, it } from "vitest";
import { isSearchable, SEARCH_LIMIT, searchStatus, searchView, type SearchAnswer } from "@/lib/searchState";
import type { SearchResult } from "@/lib/types";

const results = (n: number): SearchResult[] =>
  Array.from({ length: n }, (_, i) => ({
    norad_id: i + 1, name: `OBJECT ${i + 1}`, cospar_id: null, object_type: "PAY", owner: "US", regime: "LEO", decayed: false,
  }));
const answer = (query: string, found: SearchResult[] | null, attempt = 0): SearchAnswer => ({ query, attempt, results: found });

describe("isSearchable", () => {
  it.each([
    ["", false], [" ", false], ["i", false], ["is", true], [" is ", true], ["7", true], ["25544", true],
  ])("%j → %s", (text, ok) => {
    expect(isSearchable(text)).toBe(ok);
  });
});

describe("searchView", () => {
  it("is idle for an empty box", () => {
    expect(searchView("", 0, null)).toEqual({ kind: "idle" });
    expect(searchView("   ", 0, null)).toEqual({ kind: "idle" });
  });

  it("is short for one non-numeric character", () => {
    expect(searchView("i", 0, null)).toEqual({ kind: "short" });
  });

  it("is searching until the answer for this query and attempt arrives", () => {
    expect(searchView("iss", 0, null)).toEqual({ kind: "searching" });
    expect(searchView("7", 0, null)).toEqual({ kind: "searching" });
  });

  it("an answer for another query is hidden", () => {
    expect(searchView("iss", 0, answer("is", results(3)))).toEqual({ kind: "searching" });
  });

  it("an answer from an earlier attempt is hidden (Retry)", () => {
    expect(searchView("iss", 1, answer("iss", null, 0))).toEqual({ kind: "searching" });
  });

  it("cleared box is idle even with an answer", () => {
    expect(searchView("", 0, answer("iss", results(3)))).toEqual({ kind: "idle" });
  });

  it("shows results for the trimmed query", () => {
    expect(searchView(" iss ", 0, answer("iss", results(2)))).toEqual({ kind: "results", query: "iss", results: results(2) });
  });

  it("shows an error when the request failed", () => {
    expect(searchView("iss", 0, answer("iss", null))).toEqual({ kind: "error", query: "iss" });
  });
});

describe("searchStatus", () => {
  it("has nothing to say when idle", () => {
    expect(searchStatus({ kind: "idle" })).toBeNull();
  });

  it("hints at the minimum length", () => {
    expect(searchStatus({ kind: "short" })).toEqual({ text: "Type 2+ letters, or a NORAD number." });
  });

  it("says it is searching", () => {
    expect(searchStatus({ kind: "searching" })).toEqual({ text: "Searching…" });
  });

  it("counts matches", () => {
    expect(searchStatus({ kind: "results", query: "iss", results: results(1) })).toEqual({ text: "1 match" });
    expect(searchStatus({ kind: "results", query: "iss", results: results(3) })).toEqual({ text: "3 matches" });
  });

  it("says when the list is capped", () => {
    expect(searchStatus({ kind: "results", query: "starlink", results: results(SEARCH_LIMIT) })).toEqual({
      text: "Showing the first 20 — type more to narrow it down",
    });
  });

  it("says no matches with the formats to try", () => {
    expect(searchStatus({ kind: "results", query: "starlink 1007", results: [] })).toEqual({
      text: "No matches for “starlink 1007”.",
      hint: "Try a name (ISS), a NORAD number (25544) or a COSPAR ID (1998-067A).",
    });
  });

  it("says when search is unavailable", () => {
    expect(searchStatus({ kind: "error", query: "iss" })).toEqual({ text: "Search is unavailable right now." });
  });
});
