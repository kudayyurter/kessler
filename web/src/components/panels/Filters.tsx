"use client";

import { TYPE_ORDER } from "@/lib/chartData";
import { useExplorer } from "@/lib/store";
import { CHART_COLORS, TYPE_LABELS, type Meta } from "@/lib/types";
import { OwnerPicker } from "@/components/panels/OwnerPicker";

export function Filters({ meta }: { meta: Meta | null }) {
  const { types, owners, orbits, toggleType, setOwners, toggleOrbit } = useExplorer();
  const chip = (on: boolean) =>
    `rounded-full border-2 px-3 py-1.5 text-[13px] ${on ? "border-ink text-ink" : "border-line text-ink-2"} bg-[#121212]`;

  return (
    <div>
      <p className="label">Object types</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {TYPE_ORDER.map((t) => (
          <button key={t} type="button" aria-pressed={types.includes(t)} className={chip(types.includes(t))} onClick={() => toggleType(t)}>
            <span className="mr-1.5 inline-block h-2 w-2 rounded-[2px]" style={{ background: CHART_COLORS[t] }} />
            {TYPE_LABELS[t]}
          </button>
        ))}
      </div>
      <p className="label mt-4">Orbits</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" aria-pressed={orbits.leo} className={chip(orbits.leo)} onClick={() => toggleOrbit("leo")}>Low Earth orbit</button>
        <button type="button" aria-pressed={orbits.high} className={chip(orbits.high)} onClick={() => toggleOrbit("high")}>Higher orbits</button>
      </div>
      <label className="label mt-4 block" htmlFor="owner">Owner</label>
      <OwnerPicker id="owner" owners={meta?.owners ?? []} value={owners[0] ?? null} onChange={(code) => setOwners(code ? [code] : [])} />
    </div>
  );
}
