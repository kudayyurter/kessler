import type { CrowdingIndex } from "@/lib/api";
import { fmtDate, fmtInt } from "@/lib/format";

/** How the crowding numbers are made (see docs/superpowers/specs/2026-09-28-crowding-design.md). */
export function MethodNote({ index, skipped }: { index: CrowdingIndex; skipped: number }) {
  const archived = index.days.filter((d) => d.source === "archive").length;
  return (
    <details className="mt-3 text-[12px] leading-relaxed text-ink-2">
      <summary className="cursor-pointer text-ink">Method</summary>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        <li>
          Each object is spread over the altitudes it passes through, weighted by the time it spends at each (Kepler&apos;s equation), so a
          cell holds the average number of objects in it at any moment.
        </li>
        <li>
          Cells are 25 km of altitude (below 2,000 km) by 2° of inclination. Column edges sit on half degrees (…, 52.5°, 54.5°, …) so the
          main shells fall mid-column. Density is objects per 10⁹ km³ of each shell.
        </li>
        <li>
          An object counts as moved when its mean altitude changes by at least 5 km or its inclination by at least 0.1°. Smaller changes are
          measurement jitter and are ignored, so a cell&apos;s net change can differ slightly from the difference between the two maps.
        </li>
        <li>The objects are the ones on the globe: catalogued, not re-entered, with current orbit data.</li>
        <li>
          History since {fmtDate(index.history_start)}.
          {archived > 0 && ` ${fmtInt(archived)} earlier ${archived === 1 ? "day was" : "days were"} rebuilt from the orbit-history archive.`}
        </li>
        {skipped > 0 && <li>{fmtInt(skipped)} objects couldn&apos;t be placed (e.g. escape orbits) and are left out.</li>}
      </ul>
    </details>
  );
}
