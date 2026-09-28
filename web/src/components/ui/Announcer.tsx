"use client";

import { useExplorer } from "@/lib/store";

/** One polite live region for short status messages (e.g. "Filters reset") whose source may have
 * just unmounted — rendered once, always present, so screen readers hear its changes. */
export function Announcer() {
  const announcement = useExplorer((s) => s.announcement);
  return (
    <p data-testid="announcer" role="status" aria-live="polite" className="sr-only">
      {announcement?.text ?? ""}
    </p>
  );
}
