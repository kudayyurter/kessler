/** A small "soon" marker for a feature that isn't built yet (Ask AI). Hidden from assistive tech:
 * the button/tab carrying it says "<title>, soon" in its aria-label instead (see panelLabel). */
export function SoonTag() {
  return (
    <span aria-hidden="true" className="ml-1.5 rounded-[6px] border border-[#333] px-1 text-[10px] leading-4 text-ink-3">
      soon
    </span>
  );
}
