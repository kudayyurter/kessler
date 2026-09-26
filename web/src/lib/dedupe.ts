/** Returns `prev` unchanged when it's deep-equal to `next` (by JSON.stringify), so a caller
 * storing `next` in state doesn't hand out a new object identity for identical data — e.g. a
 * background refresh (see `dataVersion` in store.ts) that comes back with the same payload should
 * not retrigger effects/animations keyed on that object's reference (chart entrance animations in
 * LineChart.tsx/BarChart.tsx run in a `useEffect` with `[data]` as its dependency). */
export function keepPrevIfEqual<T>(prev: T | null, next: T): T {
  return prev !== null && JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
}
