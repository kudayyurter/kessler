"use client";

import { Fragment, useId, useMemo, useState } from "react";
import { fmtInt } from "@/lib/format";
import { ownerDisplay, pickerOptions, type PickerOption } from "@/lib/ownerPicker";
import type { OwnerSummary } from "@/lib/types";

/** Type-to-filter owner picker (ARIA combobox): "All owners", the largest owners, then everyone
 * A–Z; typing narrows by name or code. Single selection; `value` is an owner code or null. */
export function OwnerPicker({
  id,
  owners,
  value,
  onChange,
}: {
  id: string;
  owners: readonly OwnerSummary[];
  value: string | null;
  onChange: (code: string | null) => void;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const options = useMemo(() => pickerOptions(owners, query), [owners, query]);
  const selected = value === null ? null : owners.find((o) => o.code === value) ?? null;
  const shown = open ? query : selected ? ownerDisplay(selected) : "";
  const optionId = (o: PickerOption) => `${listId}-${o.id}`;

  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const choose = (o: PickerOption | undefined) => {
    if (!o) return; // Enter with nothing matching selects nothing.
    onChange(o.code);
    close();
  };
  const move = (step: number) => {
    setOpen(true);
    setActive((a) => Math.min(Math.max(a + step, 0), Math.max(options.length - 1, 0)));
  };

  return (
    <div className="relative mt-2">
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? optionId(options[active]) : undefined}
        autoComplete="off"
        value={shown}
        placeholder="All owners"
        onFocus={() => {
          setOpen(true);
          setActive(0);
        }}
        onClick={() => setOpen(true)}
        onBlur={close}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            move(1);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            move(-1);
          } else if (e.key === "Enter" && open) {
            e.preventDefault();
            choose(options[active]);
          } else if (e.key === "Escape") {
            close();
          }
        }}
        className="w-full rounded-[10px] border-2 border-line bg-[#121212] px-3 py-2 text-sm text-ink placeholder:text-ink-3"
      />
      {open && (
        <ul id={listId} role="listbox" aria-label="Owners" className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-auto rounded-[10px] border-2 border-line bg-[#121212] py-1">
          {options.length === 0 && <li className="px-3 py-1.5 text-[13px] text-ink-3">No owners match</li>}
          {options.map((o, i) => (
            <Fragment key={o.id}>
              {o.heading && (
                <li role="presentation" className="px-3 pb-0.5 pt-2 text-[11px] tracking-wide text-ink-3">
                  {o.heading}
                </li>
              )}
              <li
                id={optionId(o)}
                role="option"
                aria-selected={o.code === value}
                // Keep focus in the input so its blur doesn't close the list before the click lands.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(o)}
                onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer justify-between gap-3 px-3 py-1.5 text-[13px] ${i === active ? "bg-[#1d1d1d]" : ""} ${o.dim ? "text-ink-3" : "text-ink"}`}
              >
                <span>{o.label}</span>
                {o.count !== null && <span className="font-mono text-[12px] text-ink-3">{fmtInt(o.count)}</span>}
              </li>
            </Fragment>
          ))}
        </ul>
      )}
    </div>
  );
}
