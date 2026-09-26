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
 */
export function countUp(el: HTMLElement, to: number, delayMs = 0, from = 0): JSAnimation | null {
  if (prefersReducedMotion()) {
    el.textContent = fmtInt(to);
    return null;
  }
  const o = { v: from };
  return animate(o, {
    v: to,
    duration: 1600,
    delay: delayMs,
    ease: "outExpo",
    onUpdate: () => {
      el.textContent = fmtInt(Math.round(o.v));
    },
  });
}
