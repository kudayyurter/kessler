import { describe, expect, it } from "vitest";
import { countUp } from "@/lib/motion";

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
});
