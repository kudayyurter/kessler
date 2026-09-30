"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, type CrowdingIndex } from "@/lib/api";
import type { CrowdingChange, Mover } from "@/lib/crowding/change";
import { createCrowdingClient, staleDays, type CrowdingClient } from "@/lib/crowding/client";
import type { CrowdingFilter, CrowdingMap } from "@/lib/crowding/grid";
import { gunzip } from "@/lib/snapshot";
import { useExplorer } from "@/lib/store";

export type CrowdingStatus = "loading" | "ready" | "empty" | "error";
export type Result<T> = { data: T | null; error: boolean; loading: boolean };

interface CrowdingContext {
  status: CrowdingStatus;
  index: CrowdingIndex | null;
  client: CrowdingClient | null;
  /** Bumped when the latest day's file was replaced (a new generation): results must recompute. */
  version: number;
  retry: () => void;
}

const Ctx = createContext<CrowdingContext>({ status: "loading", index: null, client: null, version: 0, retry: () => {} });

export const useCrowding = (): CrowdingContext => useContext(Ctx);

/** Loads the crowding index (again after every globe swap, with `gen` to bust the CDN) and owns the
 * crowding worker, for the panel and the expanded view. */
export function CrowdingProvider({ children }: { children: React.ReactNode }) {
  const dataVersion = useExplorer((s) => s.dataVersion);
  const dataGeneration = useExplorer((s) => s.dataGeneration);
  const [client, setClient] = useState<CrowdingClient | null>(null);
  const [index, setIndex] = useState<CrowdingIndex | null>(null);
  const [status, setStatus] = useState<CrowdingStatus>("loading");
  const [attempt, setAttempt] = useState(0);
  const [version, setVersion] = useState(0);
  const clientRef = useRef<CrowdingClient | null>(null);
  const latest = useRef<{ day: string; generation: string | null } | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL("../../workers/crowding.worker.ts", import.meta.url), { type: "module" });
    const c = createCrowdingClient(worker, async (day) => {
      const gen = latest.current?.day === day ? (latest.current.generation ?? undefined) : undefined;
      const gz = await api.crowdingDay(day, gen);
      return gz && gunzip(gz);
    });
    clientRef.current = c;
    // One worker per mount (Strict Mode mounts twice and disposes the first); consumers need the
    // client in state so they re-run once it exists.
    setClient(c);
    return () => {
      c.dispose();
      clientRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Like the page's /meta fetch: only a swap-driven refetch adds `gen`.
    api.crowdingIndex(dataVersion > 0 ? dataGeneration : undefined)
      .then((next) => {
        if (cancelled) return;
        if (next === null || next.latest === null) {
          setIndex(null);
          setStatus("empty");
          return;
        }
        const stale = staleDays(latest.current, next.latest);
        latest.current = next.latest;
        if (stale.length > 0) {
          for (const day of stale) clientRef.current?.forget(day);
          setVersion((v) => v + 1);
        }
        setIndex(next);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus((s) => (s === "ready" ? s : "error"));
      });
    return () => {
      cancelled = true;
    };
  }, [dataVersion, dataGeneration, attempt]);

  const value = useMemo<CrowdingContext>(
    () => ({ status, index, client, version, retry: () => { setStatus("loading"); setAttempt((a) => a + 1); } }),
    [status, index, client, version],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The explorer's type, owner and orbit filters, as the crowding modules take them. */
export function useCrowdingFilter(): CrowdingFilter {
  const types = useExplorer((s) => s.types);
  const owners = useExplorer((s) => s.owners);
  const orbits = useExplorer((s) => s.orbits);
  return useMemo(() => ({ types, owners, orbits }), [types, owners, orbits]);
}

/** Runs `load` whenever `key` changes; keeps the previous data while the next loads. */
function useKeyed<T>(key: string | null, load: () => Promise<T | null>): Result<T> {
  const [state, setState] = useState<{ key: string | null; data: T | null; error: boolean }>({ key: null, data: null, error: false });
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    loadRef.current().then(
      (data) => {
        if (!cancelled) setState({ key, data, error: false });
      },
      () => {
        if (!cancelled) setState((s) => ({ key, data: s.data, error: true }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key]);
  return { data: state.data, error: state.key === key && state.error, loading: key !== null && state.key !== key };
}

export function useCrowdingMap(day: string | null): Result<CrowdingMap> {
  const { client, version } = useCrowding();
  const filter = useCrowdingFilter();
  const key = client && day ? JSON.stringify(["map", day, filter, version]) : null;
  return useKeyed(key, () => client!.map(day!, filter));
}

export function useCrowdingChange(from: string | null, to: string | null): Result<CrowdingChange> {
  const { client, version, index } = useCrowding();
  const filter = useCrowdingFilter();
  const key = client && index && from && to ? JSON.stringify(["change", from, to, filter, version]) : null;
  return useKeyed(key, () => client!.change(from!, to!, filter, index!.reentries));
}

export function useCrowdingMovers(from: string | null, to: string | null, cell: number | null): Result<Mover[]> {
  const { client, version, index } = useCrowding();
  const filter = useCrowdingFilter();
  const key = client && index && from && to && cell !== null ? JSON.stringify(["movers", from, to, cell, filter, version]) : null;
  return useKeyed(key, () => client!.movers(from!, to!, filter, index!.reentries, cell!));
}
