"use client";

import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { earthRadiusPx, fittedDistance, initialDistance, isOffFit, sheetInitialDistance, sheetViewOffset, shouldRefit, type FitState } from "@/lib/camera";
import { simClock } from "@/lib/clock";
import type { OrbitRecord } from "@/lib/snapshot";
import { useExplorer } from "@/lib/store";
import { useIsMobile } from "@/lib/useIsMobile";
import { Earth } from "@/components/globe/Earth";
import { flyTo, locate, type Locator } from "@/components/globe/flyTo";
import { LabelDriver } from "@/components/globe/LabelDriver";
import { Objects, type LabelSource } from "@/components/globe/Objects";
import { Picker } from "@/components/globe/Picker";

declare global {
  interface Window {
    /** Test-only hook: set before navigation to force the globe's render tree to throw, so
     * GlobeErrorBoundary's fallback path can be exercised end-to-end. Read only outside
     * production (see below) — this flag has no effect in a production build. */
    __LEO_FORCE_GLOBE_ERROR__?: boolean;
  }
}

export function GlobeScene({
  leo,
  high,
  active = true,
  labelsRef,
  sectionRef,
}: {
  leo: OrbitRecord[] | null;
  high: OrbitRecord[] | null;
  /** Whether the globe card is visible and the tab is foregrounded — see GlobeSection. Threaded
   * down to each Objects/usePropagation instance to pause the propagation worker's tick
   * interval while nothing is rendering the results. */
  active?: boolean;
  /** DOM overlay for object labels — filled by LabelDriver below. */
  labelsRef?: React.RefObject<HTMLDivElement | null>;
  /** GlobeSection's outer <section>. Written to (not read) here, outside production only —
   * throttled `data-earth-cy` / `data-earth-top` attributes exposing the Earth's projected centre
   * and top edge, in CSS px, so e2e tests can verify the sheet-layout framing. */
  sectionRef?: React.RefObject<HTMLElement | null>;
}) {
  if (process.env.NODE_ENV !== "production" && typeof window !== "undefined" && window.__LEO_FORCE_GLOBE_ERROR__) {
    throw new Error("Forced globe error (test-only, via window.__LEO_FORCE_GLOBE_ERROR__)");
  }
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const controls = useRef<OrbitControlsImpl>(null);
  const selectedId = useExplorer((s) => s.selectedId);
  const sheetTop = useExplorer((s) => s.mobileSheetTop);
  const topBarBottom = useExplorer((s) => s.topBarBottom);
  const sheetLayout = useIsMobile();
  // The whole-Earth camera distance for the current layout — null in the sheet layout before the
  // top bar has been measured. Recomputed every render (cheap trig); consumed by the fit-request
  // and auto-refit effects below and by the off-fit check inside useFrame.
  const fitted = fittedDistance(sheetLayout, size.width, size.height, topBarBottom);
  // Sparse: index 0 = LEO, 1 = HIGH. A group whose snapshot hasn't loaded (or errored) yet
  // leaves a hole here rather than a function — locate skips holes instead of calling them.
  const locators = useRef<(Locator | undefined)[]>([]);
  // Sparse by group index (0 = LEO, 1 = HIGH), same convention as `locators` above — fed by
  // Objects' onLabelSource and read every tick by LabelDriver.
  const labelSources = useRef<(LabelSource | undefined)[]>([]);
  // The initial camera distance is set exactly once; afterwards zoom belongs to the user.
  const positioned = useRef(false);
  // Throttle for the off-fit check inside useFrame — see below.
  const offFitElapsed = useRef(0);

  useEffect(() => {
    if (positioned.current) return;
    // Sheet layout: size from a fixed worst case (tallest sheet the CSS allows) — needs only the
    // top bar's height, never the sheet's content-dependent measurement.
    if (sheetLayout && topBarBottom === null) return;
    positioned.current = true;
    const d = sheetLayout ? sheetInitialDistance(size.width, size.height, topBarBottom!) : initialDistance(size.width / Math.max(size.height, 1));
    camera.position.copy(new THREE.Vector3(0.6, 0.9, 3.6).normalize().multiplyScalar(d));
    camera.lookAt(0, 0, 0);
  }, [camera, size.width, size.height, sheetLayout, topBarBottom]);

  // Sheet layout: shift (never scale) the projection so the Earth sits midway between the top bar
  // and the sheet's current top, following tab switches, collapse and resizes. Desktop clears it.
  // Only touches the projection matrix — OrbitControls and flyTo own camera.position.
  useEffect(() => {
    const offset = sheetLayout && topBarBottom !== null && sheetTop !== null ? sheetViewOffset(size.width, size.height, topBarBottom, sheetTop) : null;
    if (offset) camera.setViewOffset(offset.fullWidth, offset.fullHeight, offset.offsetX, offset.offsetY, offset.viewWidth, offset.viewHeight);
    else camera.clearViewOffset();
  }, [camera, size.width, size.height, sheetLayout, topBarBottom, sheetTop]);

  // Pending fly-to: every selection starts "pending" (see the store); each frame, look for the
  // object in the groups expected to be loaded and fly the moment it has a position — after Higher
  // orbits finish downloading, or the orbit worker's first frame. "absent" (its group loaded without
  // it) ends the wait; the object card then says why there's no position.
  const fly = useRef<{ cancel(): void } | null>(null);
  const resumeControls = useCallback(() => {
    const c = controls.current;
    if (!c) return;
    c.enabled = true;
    c.update();
  }, []);
  // Starts a new flight, first cancelling any flight already in progress: re-selecting the same
  // object (see the store's `select`) can bounce `selectionOnGlobe` back to "pending" without
  // `selectedId` changing, so the cleanup effect below never runs for it — without this, the
  // previous tween would keep animating alongside a second one, and whichever finished first would
  // clear `fly.current`/resume controls out from under the other. `live` marks whether THIS
  // flight's completion callback has already run (once, idempotently) or been cancelled — it
  // can't be a comparison against the returned handle itself, because flyTo's reduced-motion path
  // calls this callback synchronously, before flyTo has returned a handle to capture. The stored
  // handle's own `cancel` also flips `live` to false, so cancelling (from the next `startFlight`
  // call, or the cleanup effect below) reliably stops a stale completion from running even if the
  // underlying tween's own cancellation doesn't guarantee that on its own.
  const startFlight = useCallback(
    (target: THREE.Vector3, distance: number, arc = true) => {
      fly.current?.cancel();
      fly.current = null;
      if (controls.current) controls.current.enabled = false;
      let live = true;
      const handle = flyTo(camera, target, distance, () => {
        if (!live) return;
        live = false;
        fly.current = null;
        resumeControls();
      }, arc);
      // Reduced motion already ran the callback above, synchronously — nothing left to store.
      if (live) fly.current = { cancel: () => { live = false; handle.cancel(); } };
    },
    [camera, resumeControls],
  );

  // Whether the flight currently in progress (if any) is a fit flight (auto-refit or the Fit
  // button) rather than a selection fly-to. Only a fit flight is safe to retarget mid-flight when
  // a fresher `fitted` measurement arrives — a selection flight must never be hijacked by a
  // coincidental top-bar reflow. Set immediately before every startFlight call below.
  const fitFlightActive = useRef(false);

  // Fit on request (the "⤢ Fit globe" pill — see FitButton/store.ts's fitRequest): keeps the
  // current direction, only the distance changes. `startFlight` already cancels a running flight,
  // so pressing Fit mid fly-to cancels that flight and starts the fit flight cleanly.
  const fitRequest = useExplorer((s) => s.fitRequest);
  const seenFit = useRef(fitRequest);
  useEffect(() => {
    if (fitRequest === seenFit.current || fitted === null) return;
    seenFit.current = fitRequest;
    fitFlightActive.current = true;
    startFlight(camera.position.clone(), fitted, false);
  }, [fitRequest, fitted, camera, startFlight]);

  // Auto-refit on a layout switch (desktop <-> sheet), and on a sheet top-bar change while the
  // camera was still at the old fitted distance (never fights the user's own zoom — see
  // shouldRefit). Placed after startFlight and the initial-positioning effect above, so
  // `positioned.current` is already set by the time this effect first runs.
  //
  // The top bar can settle over a couple of ResizeObserver callbacks right after a layout switch
  // (the readout/pill row reflowing), so `fitted` may still refine slightly while a fit flight
  // from an earlier callback is already under way. shouldRefit alone would decline to restart it
  // (the camera, mid-flight, isn't at the *previous* fitted distance, so it looks like it could be
  // the user's own zoom) — but OrbitControls is disabled for the whole flight, so the user cannot
  // be zooming; it's safe to just retarget the same flight at the refined distance. Only a fit
  // flight (never a selection fly-to) is retargeted this way.
  const lastFit = useRef<FitState | null>(null);
  useEffect(() => {
    if (!positioned.current || fitted === null) return;
    const next = { sheet: sheetLayout, fitted };
    const prev = lastFit.current;
    const midFitFlight = fly.current !== null && fitFlightActive.current;
    const refit = midFitFlight ? prev !== null && isOffFit(next.fitted, prev.fitted) : shouldRefit(prev, next, camera.position.length());
    if (refit) {
      fitFlightActive.current = true;
      startFlight(camera.position.clone(), fitted, false);
    }
    lastFit.current = next;
  }, [sheetLayout, fitted, camera, startFlight]);

  // A new selection (or clearing it) cancels a flight still in progress.
  useEffect(
    () => () => {
      if (!fly.current) return;
      fly.current.cancel();
      fly.current = null;
      resumeControls();
    },
    [selectedId, resumeControls],
  );

  // A swap, or toggling Higher orbits, may add or fix the very object that's selected: an "absent"
  // verdict reached against the old data says nothing about the new data, so re-open the pending
  // wait and let the per-frame check below run again. Keyed on `leo`/`high` (not just `dataVersion`)
  // because turning Higher orbits on is a filter change, not a data swap, and never bumps
  // dataVersion — and because the records props change in the same R3F commit whose Objects layout
  // effects register the swap-aware locator (see Objects.tsx/instances.ts's duringSwap).
  const dataVersion = useExplorer((s) => s.dataVersion);
  const orbitsHigh = useExplorer((s) => s.orbits.high);
  useEffect(() => {
    const st = useExplorer.getState();
    if (st.selectedId !== null && st.selectionOnGlobe === "absent") st.setSelectionOnGlobe("pending");
  }, [dataVersion, leo, high, orbitsHigh]);

  const onReadyLeo = useCallback((f: Locator | undefined) => (locators.current[0] = f), []);
  const onReadyHigh = useCallback((f: Locator | undefined) => (locators.current[1] = f), []);
  const onLeoLabels = useCallback((s: LabelSource | null) => (labelSources.current[0] = s ?? undefined), []);
  const onHighLabels = useCallback((s: LabelSource | null) => (labelSources.current[1] = s ?? undefined), []);

  // Starts past the threshold so the very first frame writes immediately (tests don't have to
  // wait out a full throttle interval before the attribute exists at all).
  const earthCyElapsed = useRef(Infinity);
  const earthCyOrigin = useRef(new THREE.Vector3());
  useFrame((_, dt) => {
    simClock.tick();

    const st = useExplorer.getState();
    if (st.selectedId !== null && st.selectionOnGlobe === "pending") {
      const found = locate(locators.current, st.orbits.high ? [0, 1] : [0], st.selectedId);
      if (found === "absent") {
        st.setSelectionOnGlobe("absent");
      } else if (found !== "pending") {
        st.setSelectionOnGlobe("shown");
        fitFlightActive.current = false;
        startFlight(found, Math.max(1.35, found.length() + 0.45));
      }
    }

    // Off-fit detection, throttled to 250 ms. Skipped while a flight is running so an automatic
    // re-fit (or the Fit button's own flight) never flashes the pill on and back off.
    offFitElapsed.current += dt;
    if (offFitElapsed.current >= 0.25 && fitted !== null && positioned.current && fly.current === null) {
      offFitElapsed.current = 0;
      const off = isOffFit(camera.position.length(), fitted);
      if (st.offFit !== off) st.setOffFit(off);
    }

    // Test-only (never in production): where the Earth is rendered, throttled to 250 ms.
    if (process.env.NODE_ENV !== "production") {
      earthCyElapsed.current += dt;
      if (sectionRef?.current && earthCyElapsed.current >= 0.25) {
        earthCyElapsed.current = 0;
        earthCyOrigin.current.set(0, 0, 0).project(camera);
        const cy = ((1 - earthCyOrigin.current.y) / 2) * size.height;
        const r = earthRadiusPx(camera.position.length(), size.height, camera.fov);
        sectionRef.current.setAttribute("data-earth-cy", cy.toFixed(1));
        sectionRef.current.setAttribute("data-earth-top", (cy - r).toFixed(1));
      }
    }
  });

  return (
    <>
      <Earth />
      {leo && <Objects records={leo} group="LEO" onReady={onReadyLeo} active={active} onLabelSource={onLeoLabels} />}
      {high && <Objects records={high} group="HIGH" onReady={onReadyHigh} active={active} onLabelSource={onHighLabels} />}
      <OrbitControls ref={controls} enableDamping enablePan={false} minDistance={1.12} maxDistance={12} zoomSpeed={0.8} />
      <Picker sources={labelSources} />
      {labelsRef && <LabelDriver sources={labelSources} container={labelsRef} sheetLayout={sheetLayout} />}
    </>
  );
}
