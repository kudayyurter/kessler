import type { SearchResult } from "@/lib/types";

/** The API's default result limit (api/app/api/routes.py): a full page means there may be more. */
export const SEARCH_LIMIT = 20;

export type SearchView =
  | { kind: "idle" }
  | { kind: "short" }
  | { kind: "searching" }
  | { kind: "results"; query: string; results: SearchResult[] }
  | { kind: "error"; query: string };

/** What a finished request returned: `results` null = the request failed. */
export interface SearchAnswer {
  query: string;
  attempt: number;
  results: SearchResult[] | null;
}

export function isSearchable(text: string): boolean {
  const t = text.trim();
  return t.length >= 2 || /^\d+$/.test(t);
}

/** The panel's state for the text in the box. An answer shows only if it is for exactly this query
 * and attempt, so old results never sit under a new query. */
export function searchView(input: string, attempt: number, answer: SearchAnswer | null): SearchView {
  const text = input.trim();
  if (text === "") return { kind: "idle" };
  if (!isSearchable(text)) return { kind: "short" };
  if (!answer || answer.query !== text || answer.attempt !== attempt) return { kind: "searching" };
  if (answer.results === null) return { kind: "error", query: text };
  return { kind: "results", query: text, results: answer.results };
}

/** The status line under the input (a polite live region); null = say nothing. */
export function searchStatus(view: SearchView): { text: string; hint?: string } | null {
  switch (view.kind) {
    case "idle":
      return null;
    case "short":
      return { text: "Type 2+ letters, or a NORAD number." };
    case "searching":
      return { text: "Searching…" };
    case "error":
      return { text: "Search is unavailable right now." };
    case "results": {
      const n = view.results.length;
      if (n === 0) {
        return {
          text: `No matches for “${view.query}”.`,
          hint: "Try a name (ISS), a NORAD number (25544) or a COSPAR ID (1998-067A).",
        };
      }
      if (n >= SEARCH_LIMIT) return { text: `Showing the first ${SEARCH_LIMIT} — type more to narrow it down` };
      return { text: `${n} ${n === 1 ? "match" : "matches"}` };
    }
  }
}
