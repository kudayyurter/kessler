"use client";

import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { api } from "@/lib/api";
import { createGlobeData, type GlobeData, type GroupName } from "@/lib/globeData";
import { nameCache } from "@/lib/names";
import { loadSnapshot } from "@/lib/snapshot";

/** Globe data for the page (see createGlobeData): first load, background checks every 10 minutes
 * while the tab is visible and whenever it becomes visible, retry. HIGH loads the first time
 * `wantHigh` is true. */
export function useGlobeData(wantHigh: boolean): GlobeData & { retry: (g: GroupName) => void } {
  const [ctl] = useState(() =>
    createGlobeData({
      current: () => api.current(),
      snapshot: (group, generation) => api.snapshot(group, generation),
      decode: loadSnapshot,
      setNamesGeneration: (generation) => nameCache.useGeneration(generation),
    }),
  );
  const state = useStore(ctl.store);

  useEffect(() => {
    void ctl.start();
    const stop = ctl.poll({
      isVisible: () => document.visibilityState === "visible",
      onVisible: (cb) => {
        const handler = () => {
          if (document.visibilityState === "visible") cb();
        };
        document.addEventListener("visibilitychange", handler);
        // A laptop can wake with the tab already visible, before the network is back — `online`
        // fires in that case even though visibilitychange didn't.
        window.addEventListener("online", handler);
        return () => {
          document.removeEventListener("visibilitychange", handler);
          window.removeEventListener("online", handler);
        };
      },
    });
    return () => {
      stop();
      ctl.dispose();
    };
  }, [ctl]);

  useEffect(() => {
    if (wantHigh) void ctl.want("HIGH");
  }, [ctl, wantHigh]);

  return { ...state, retry: (g) => void ctl.retry(g) };
}
