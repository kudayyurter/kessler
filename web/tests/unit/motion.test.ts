import { afterEach, describe, expect, it, vi } from "vitest";
import { countUp } from "@/lib/motion";

afterEach(() => vi.unstubAllGlobals());

// A duck-typed element: countUp only ever assigns to `textContent`, so a plain object with that
// property is enough — no DOM needed (this suite runs with vitest's `node` environment).
function fakeEl(): HTMLElement {
  return { textContent: "" } as unknown as HTMLElement;
}

describe("countUp", () => {
  it("tweens from 0 by default", () => {
    const el = fakeEl();
    const anim = countUp(el, 100, 0);
    // seek() scrubs the tween deterministically instead of waiting on real time/rAF. 1ms in
    // (rather than exactly 0) so at least one onUpdate tick has actually run.
    anim!.seek(1);
    expect(el.textContent).toBe("0");
  });

  it("tweens from the given `from` value instead of 0", () => {
    const el = fakeEl();
    const anim = countUp(el, 100, 0, 42);
    anim!.seek(1);
    expect(el.textContent).toBe("42");
  });

  // Overview's Count tile tracks the value actually on screen (not the target) so a mid-tween
  // update counts up from there instead of jumping, and Strict Mode's mount->cleanup->remount
  // doesn't lose the first count-up (animating value->value because the ref had already jumped
  // to the target before the tween was cancelled).
  it("reports the value shown on each tick via onValue", () => {
    const el = fakeEl();
    const seen: number[] = [];
    const anim = countUp(el, 100, 0, 0, (v) => seen.push(v));
    anim!.seek(1);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1]).toBe(Number(el.textContent));
    expect(seen[seen.length - 1]).toBeLessThan(100);
  });

  it("reports the final value via onValue on the reduced-motion instant path", () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    const el = fakeEl();
    let shown: number | undefined;
    const anim = countUp(el, 100, 0, 0, (v) => (shown = v));
    expect(anim).toBeNull();
    expect(el.textContent).toBe("100");
    expect(shown).toBe(100);
  });
});
