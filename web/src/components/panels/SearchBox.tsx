"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { isSearchable, searchStatus, searchView, type SearchAnswer } from "@/lib/searchState";
import { useExplorer } from "@/lib/store";
import { TYPE_LABELS } from "@/lib/types";

export function SearchBox() {
  const [q, setQ] = useState("");
  // Bumped by Retry: re-runs the same query, and hides the failed answer until the new one arrives.
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<SearchAnswer | null>(null);
  const select = useExplorer((s) => s.select);
  const text = q.trim();

  useEffect(() => {
    if (!isSearchable(text)) return;
    // `cancelled` guards against responses arriving out of order (the debounce only protects
    // against a pending timer being superseded); the view also shows an answer only for the
    // query and attempt it belongs to (see searchView).
    let cancelled = false;
    const id = window.setTimeout(() => {
      api.search(text)
        .then((results) => { if (!cancelled) setAnswer({ query: text, attempt, results }); })
        .catch(() => { if (!cancelled) setAnswer({ query: text, attempt, results: null }); });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [text, attempt]);

  const view = searchView(q, attempt, answer);
  const status = searchStatus(view);
  return (
    <div>
      <label className="label" htmlFor="search">Find an object</label>
      <input
        id="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="ISS, 25544, 1999-025…"
        maxLength={100}
        className="mt-2 w-full rounded-[10px] border-2 border-line bg-[#121212] px-3 py-2 text-[13px] text-ink placeholder:text-ink-3"
      />
      <div className={`${status ? "mt-2 " : ""}flex flex-wrap items-baseline gap-x-2`}>
        <p role="status" className="text-[13px] text-ink-3">
          {status && (
            <>
              <span className={view.kind === "results" && view.results.length === 0 ? "text-ink-2" : undefined}>{status.text}</span>
              {status.hint && (
                <>
                  <br />
                  {status.hint}
                </>
              )}
            </>
          )}
        </p>
        {view.kind === "error" && (
          <button
            type="button"
            onClick={() => setAttempt((a) => a + 1)}
            className="rounded-full border-2 border-line bg-[#1a1a1a] px-2 text-[11px] text-ink hover:bg-[#222]"
          >
            Retry
          </button>
        )}
      </div>
      {view.kind === "results" && view.results.length > 0 && (
        <ul className="mt-2 max-h-56 overflow-auto rounded-[10px] border-2 border-line">
          {view.results.map((r) => (
            <li key={r.norad_id}>
              <button type="button" onClick={() => { select(r.norad_id); setQ(""); }} className="flex w-full justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-[#161616]">
                <span className="text-ink">{r.name}</span>
                <span className="font-mono text-[12px] text-ink-3">{TYPE_LABELS[r.object_type]} · {r.decayed ? "re-entered" : r.regime}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
