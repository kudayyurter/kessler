"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { fmtInt } from "@/lib/format";
import { ownerDisplay, pickerOptions, type PickerOption } from "@/lib/ownerPicker";
import type { OwnerSummary } from "@/lib/types";

interface Block {
  /** Set only on the group's first block (see pickerOptions); undefined for the ungrouped run of
   * options ("All owners" alone, or every match when there's a query — pickerOptions gives none
   * of those a heading). */
  heading?: string;
  items: PickerOption[];
}

/** Chunks the flat, already-ordered `options` into the runs pickerOptions groups them into: a new
 * block starts at every option carrying a heading (or at the very first option). */
function chunkByHeading(options: PickerOption[]): Block[] {
  const out: Block[] = [];
  for (const o of options) {
    if (o.heading || out.length === 0) out.push({ heading: o.heading, items: [] });
    out[out.length - 1].items.push(o);
  }
  return out;
}

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
  const wrapperRef = useRef<HTMLDivElement>(null);
  const options = useMemo(() => pickerOptions(owners, query), [owners, query]);
  const blocks = useMemo(() => chunkByHeading(options), [options]);
  const selected = value === null ? null : owners.find((o) => o.code === value) ?? null;
  const shown = open ? query : selected ? ownerDisplay(selected) : "";
  const optionDomId = (o: PickerOption) => `${listId}-${o.id}`;

  const close = () => {
    setOpen(false);
    setQuery("");
    // Otherwise a stray Arrow key right after Escape/Enter (focus stays in the input) would move
    // from wherever the list was last left, not from the top.
    setActive(0);
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
  // Where the list should start highlighted when it opens: the selected owner's own row (so
  // Tab-then-Enter re-confirms it instead of silently clearing it to "All owners"), or the top.
  const initialActiveIndex = () => {
    if (value === null) return 0;
    const idx = options.findIndex((o) => o.code === value);
    return idx === -1 ? 0 : idx;
  };

  // Critical fix: the list used to be absolutely positioned, which desktop's scrolling panel
  // column and the phone sheet's scrolling tab panel both clip (and their own stacking contexts,
  // from `.panel`'s backdrop-filter, could paint over it regardless of z-index). It now renders in
  // normal flow instead — no portal, no clipping — so opening it can push the input (and itself)
  // outside its scrolling ancestor's viewport; bring the whole picker back into view once the list
  // (rendered in the same pass) has actually painted.
  useEffect(() => {
    if (open) wrapperRef.current?.scrollIntoView({ block: "nearest" });
  }, [open]);

  // Arrow-key navigation used to move `active` without ever scrolling its row into view, so
  // holding ArrowDown just walked off the bottom of the (still `max-h-64 overflow-auto`) list.
  useEffect(() => {
    if (!open) return;
    const o = options[active];
    if (!o) return;
    document.getElementById(optionDomId(o))?.scrollIntoView({ block: "nearest" });
    // optionDomId is a plain closure over the stable `listId`, not state — omitted from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, open, options, listId]);

  // ARIA: a single owner can appear twice in the ungrouped list (once under "Largest", once again
  // under "A–Z") — only the first occurrence may claim aria-selected (a listbox has one selected
  // option), though both are still styled to show the selection.
  let firstSelectedSeen = false;
  let globalIndex = 0;
  const renderOption = (o: PickerOption) => {
    const i = globalIndex++;
    const isSelected = o.code === value;
    const ariaSelectedHere = isSelected && !firstSelectedSeen;
    if (isSelected) firstSelectedSeen = true;
    return (
      <li
        key={o.id}
        id={optionDomId(o)}
        role="option"
        aria-selected={ariaSelectedHere}
        onClick={() => choose(o)}
        onMouseEnter={() => setActive(i)}
        className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-[13px] ${i === active ? "bg-[#1d1d1d]" : ""} ${isSelected ? "text-ink" : o.dim ? "text-ink-3" : "text-ink"}`}
      >
        <span className="flex min-w-0 items-center gap-1.5 truncate">
          {isSelected && <span aria-hidden="true">✓</span>}
          <span className={isSelected ? "font-medium" : ""}>{o.label}</span>
        </span>
        {o.count !== null && <span className="shrink-0 font-mono text-[12px] text-ink-3">{fmtInt(o.count)}</span>}
      </li>
    );
  };

  return (
    <div ref={wrapperRef} className="mt-2">
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        // Only while the list actually exists — an id with nothing behind it is a broken reference.
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? optionDomId(options[active]) : undefined}
        autoComplete="off"
        value={shown}
        // Hints the current selection while the field is emptied out for typing, instead of always
        // reading the generic "All owners" even when an owner is already chosen.
        placeholder={selected ? ownerDisplay(selected) : "All owners"}
        onFocus={() => {
          setOpen(true);
          setActive(initialActiveIndex());
        }}
        onClick={() => {
          // Selecting an owner (click or Enter) leaves focus in the input, so re-clicking it right
          // after doesn't re-fire onFocus (focus never left) — without this, that reopen would
          // start at whatever close() reset `active` to, not the selected owner's own row.
          if (!open) {
            setOpen(true);
            setActive(initialActiveIndex());
          }
        }}
        onBlur={close}
        onChange={(e) => {
          const raw = e.target.value;
          // Selecting an owner leaves focus in the box (so a following keystroke doesn't have to
          // refocus it first) but closes the list and shows the owner's label as the value; a
          // keystroke right then arrives as "<label><new char>", not a fresh query. While the box
          // was closed, start the query from whatever the user typed beyond that stale label
          // instead of searching for the label-plus-keystrokes (which can never match anything).
          const next = open ? raw : raw.startsWith(shown) ? raw.slice(shown.length) : raw.length < shown.length ? "" : raw.replace(shown, "");
          setQuery(next);
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
        <ul
          id={listId}
          role="listbox"
          aria-label="Owners"
          // Anywhere in the list — the scrollbar, a group heading, the "no match" row, not just an
          // option — mousedown must not blur the input first, or the click that follows never lands
          // (blur closes the list, click then hits whatever is left behind).
          onMouseDown={(e) => e.preventDefault()}
          className="mt-1 max-h-64 overflow-auto rounded-[10px] border-2 border-line bg-[#121212] py-1"
        >
          {options.length === 0 ? (
            <li role="option" aria-selected={false} aria-disabled="true" className="px-3 py-1.5 text-[13px] text-ink-3">
              No owners match
            </li>
          ) : (
            blocks.map((block, bi) => {
              if (!block.heading) return block.items.map((o) => renderOption(o));
              const headingId = `${listId}-heading-${bi}`;
              return (
                <li key={`group-${bi}`} role="presentation">
                  <div id={headingId} className="px-3 pb-0.5 pt-2 text-[11px] tracking-wide text-ink-3">
                    {block.heading}
                  </div>
                  <ul role="group" aria-labelledby={headingId}>
                    {block.items.map((o) => renderOption(o))}
                  </ul>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
