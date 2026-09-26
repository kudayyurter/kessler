import { animate, type JSAnimation } from "animejs";
import { fmtInt } from "@/lib/format";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Animates `el`'s text content from `from` (0 by default) up to `to`. Returns the underlying
 * animejs animation (or null on the reduced-motion instant path) so callers can `.cancel()`
 * it — e.g. in a `useEffect` cleanup — to stop a stale tween from overwriting the
 * value after the component re-renders with new data. Pass the previously shown value as `from`
 * so a later update (e.g. a background refresh) counts up from there instead of resetting to 0.
 * `onValue`, called with the value actually on screen on every tick (and once with `to` on the
 * reduced-motion path), lets a caller track that instead of the target: recording the target
 * itself as "shown" the moment the tween starts is wrong on two counts — an update arriving
 * mid-tween would count up from a value never actually displayed, and under Strict Mode's
 * mount-cleanup-remount, the remount would then animate target->target (no visible count-up at
 * all) because "shown" jumped to the target before the first tween was cancelled.
 */
export function countUp(el: HTMLElement, to: number, delayMs = 0, from = 0, onValue?: (v: number) => void): JSAnimation | null {
  if (prefersReducedMotion()) {
    el.textContent = fmtInt(to);
    onValue?.(to);
    return null;
  }
  const o = { v: from };
  return animate(o, {
    v: to,
    duration: 1600,
    delay: delayMs,
    ease: "outExpo",
    onUpdate: () => {
      const v = Math.round(o.v);
      el.textContent = fmtInt(v);
      onValue?.(v);
    },
  });
}
