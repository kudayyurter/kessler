"use client";

import { useExplorer } from "@/lib/store";

/** One polite live region for short status messages (e.g. "Filters reset") whose source may have
 * just unmounted — rendered once, always present, so screen readers hear its changes. A repeated,
 * identical message (e.g. Reset, change a filter, Reset again) must still change this element's
 * text node, or React never writes to the DOM and there is no mutation for the live region to
 * report — screen readers stay silent on the second announcement. Appending a no-break space on
 * odd counts flips the rendered text on every announce() call without remounting the <p> itself
 * (a freshly inserted live region is often not announced at all).
 */
export function Announcer() {
  const announcement = useExplorer((s) => s.announcement);
  return (
    <p data-testid="announcer" role="status" aria-live="polite" className="sr-only">
      {announcement ? announcement.text + (announcement.n % 2 ? "\u00A0" : "") : ""}
    </p>
  );
}
