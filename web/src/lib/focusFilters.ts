/** Where focus goes after Reset: the Filters panel's first type chip if it is on screen, otherwise
 * whatever opens Filters (the dock button on desktop, the sheet tab on phones). Only rendered,
 * displayed elements count (`offsetParent !== null`): a layout's copy that CSS hides must never
 * take focus. */
export function focusFiltersEntry(doc: Document = document): void {
  const shown = (selector: string) =>
    Array.from(doc.querySelectorAll<HTMLElement>(selector)).find((el) => el.offsetParent !== null);
  (shown("[data-filters-first]") ?? shown("[data-opens='filters']"))?.focus();
}
