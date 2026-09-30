"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { DataDisclosure } from "@/components/charts/ChartData";
import { CellCard } from "@/components/crowding/CellCard";
import { useCrowding, useCrowdingChange, useCrowdingMap } from "@/components/crowding/CrowdingProvider";
import { retryButton } from "@/components/crowding/CrowdingPanel";
import { CrowdingTables } from "@/components/crowding/CrowdingTables";
import { DensityStrip } from "@/components/crowding/DensityStrip";
import { GridCanvas } from "@/components/crowding/GridCanvas";
import { MethodNote } from "@/components/crowding/MethodNote";
import { Timeline } from "@/components/crowding/Timeline";
import { Unavailable } from "@/components/ui/Unavailable";
import { GAIN_STOPS, HIGH_STRIP_ROWS, LEO_AND_FLOOR_ROWS, LOSS_STOPS, NOW_STOPS } from "@/lib/crowding/draw";
import type { Cell } from "@/lib/crowding/grid";
import { cellAnnouncement, changeAnnouncement, shortStamp, summaryLine } from "@/lib/crowding/text";
import { CHIP_GAPS, daysBetween, defaultGap, gapEnabled, gapHint, gapLabel, playFrames, windowFor, type Gap } from "@/lib/crowding/timeline";
import { useExplorer } from "@/lib/store";
import { useIsMobile } from "@/lib/useIsMobile";

const PLAY_MS = 700;
const css = (stops: readonly (readonly number[])[]) => stops.map((c) => `rgb(${c.join(",")})`).join(", ");

export function CrowdingView() {
  const open = useExplorer((s) => s.crowdingView);
  return open ? <CrowdingDialog /> : null;
}

/** The expanded crowding view: a non-modal dialog over the globe (desktop: to the right of the left
 * column, which stays usable; phone: the whole screen). */
function CrowdingDialog() {
  const setOpen = useExplorer((s) => s.setCrowdingView);
  const pinShell = useExplorer((s) => s.pinShell);
  const announce = useExplorer((s) => s.announce);
  const { status, index, client, retry } = useCrowding();
  const sheet = useIsMobile();
  const titleId = useId();
  const helpId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const entries = useMemo(() => index?.days ?? [], [index]);
  const days = useMemo(() => entries.map((d) => d.day), [entries]);
  const [mode, setMode] = useState<"now" | "change">("now");
  const [gapChoice, setGapChoice] = useState<Gap | null>(null);
  const [toChoice, setToChoice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Cell | null>(null);
  const [playing, setPlaying] = useState(false);

  const gap = gapChoice ?? defaultGap(days);
  const to = toChoice ?? days.at(-1) ?? null;
  const span = to ? windowFor(to, gap, days) : null;
  const from = span?.from ?? null;
  const map = useCrowdingMap(mode === "now" ? to : null);
  const change = useCrowdingChange(mode === "change" ? from : null, mode === "change" ? to : null);
  const frames = useMemo(() => playFrames(days, mode, gap), [days, mode, gap]);
  const toRef = useRef(to);
  useEffect(() => {
    toRef.current = to;
  });

  useEffect(() => heading.current?.focus(), []);

  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-crowding-expand]")?.focus());
  };

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const k = frames.indexOf(toRef.current ?? "");
      if (k < 0 || k >= frames.length - 1) setPlaying(false);
      else setToChoice(frames[k + 1]);
    }, PLAY_MS);
    return () => clearInterval(id);
  }, [playing, frames]);

  // While playing, fetch the next two frames' days ahead of time.
  useEffect(() => {
    if (!playing || !client || !to) return;
    const k = frames.indexOf(to);
    for (const d of frames.slice(k + 1, k + 3)) {
      void client.ensure(d).catch(() => {});
      const w = mode === "change" ? windowFor(d, gap, days) : null;
      if (w) void client.ensure(w.from).catch(() => {});
    }
  }, [playing, client, to, frames, gap, days, mode]);

  const play = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (to === frames.at(-1)) setToChoice(frames[0]);
    setPlaying(true);
  };

  const values = mode === "now" ? (map.data?.total ?? null) : (change.data?.net ?? null);
  const loading = (mode === "now" ? map.loading : change.loading) ? to : null;
  const stampOf = (day: string) => shortStamp(entries.find((e) => e.day === day)?.generated_at ?? `${day}T00:00`);
  const onFocusCell = (c: Cell) => {
    setSelected(c);
    if (mode === "now" && map.data) announce(cellAnnouncement(map.data, c));
    if (mode === "change" && change.data) announce(changeAnnouncement(change.data, c));
  };
  const onEscape = () => {
    if (!selected) return false;
    setSelected(null);
    return true;
  };
  const cellW = sheet ? 3.2 : 5;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          close();
        }
      }}
      className={sheet
        ? "fixed inset-0 z-40 overflow-y-auto bg-[#080808] p-3"
        : "pointer-events-auto fixed bottom-4 left-[calc(var(--col-l)+2rem)] right-4 top-14 z-30 overflow-y-auto rounded-[16px] border-2 border-line bg-[#080808] p-4"}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 ref={heading} id={titleId} tabIndex={-1} className="font-mono text-[15px] text-ink outline-none">Crowding by altitude × inclination</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-full border-2 border-line text-[11px]">
            {(["now", "change"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                disabled={m === "change" && days.length < 2}
                onClick={() => {
                  setMode(m);
                  setPlaying(false);
                }}
                className={`px-3 py-1 disabled:opacity-40 ${mode === m ? "bg-[#1d1d1d] text-ink" : "text-ink-3"}`}
              >
                {m === "now" ? "Now" : "Change"}
              </button>
            ))}
          </div>
          {mode === "change" && CHIP_GAPS.map((g) => {
            const enabled = gapEnabled(g, days);
            return (
              <button
                key={String(g)}
                type="button"
                aria-pressed={gap === g}
                disabled={!enabled}
                title={enabled ? undefined : gapHint(g)}
                onClick={() => setGapChoice(g)}
                className={`min-h-7 rounded-full border-2 px-2.5 text-[11px] disabled:opacity-40 ${gap === g ? "border-[#555] text-ink" : "border-line text-ink-3"}`}
              >
                {gapLabel(g)}
              </button>
            );
          })}
          <button type="button" aria-label="Close crowding view" onClick={close} className="h-8 w-8 rounded-full border-2 border-line text-ink-2 hover:text-ink">✕</button>
        </div>
      </div>

      <p id={helpId} className="sr-only">
        Altitude increases upwards and inclination to the right. Arrow keys move between cells; Shift with an arrow jumps to the next
        drawn cell; Enter selects a cell and shows its details; Escape clears the selection, then closes the view.
      </p>
      {status === "empty" && <p className="mt-3 text-[13px] text-ink-2">No crowding data yet.</p>}
      {status === "error" && (
        <div className="mt-3 flex items-center gap-3">
          <Unavailable what="crowding" />
          <button type="button" onClick={retry} className={retryButton}>Retry</button>
        </div>
      )}
      {mode === "change" && change.data && from && (
        <p className="mt-2 text-[12px] text-ink-2">{summaryLine(change.data.counts, stampOf(from))}</p>
      )}
      {mode === "change" && to && !span && <p className="mt-2 text-[12px] text-ink-3">Pick a later day to compare with an earlier one.</p>}

      {values && (
        <div className={`mt-2 flex gap-4 ${sheet ? "flex-col" : "flex-row flex-wrap"}`}>
          <div className="min-w-0">
            <div className="flex gap-2">
              <GridCanvas values={values} rows={LEO_AND_FLOOR_ROWS} mode={mode} cellW={cellW} cellH={sheet ? 3.6 : 5} axes="ticks"
                pinned={selected} label="Crowding map" describedBy={helpId} onHover={() => {}} onSelect={setSelected} onFocusCell={onFocusCell} onEscape={onEscape} />
              {!sheet && (
                <DensityStrip rows={LEO_AND_FLOOR_ROWS} cellH={5} width={140} padBottom={18}
                  map={mode === "now" ? map.data : null} change={mode === "change" ? change.data : null} />
              )}
            </div>
            <div className="mt-2">
              <GridCanvas values={values} rows={HIGH_STRIP_ROWS} mode={mode} cellW={cellW} cellH={11} axes="names"
                pinned={selected} label="Higher orbits map" describedBy={helpId} onHover={() => {}} onSelect={setSelected} onFocusCell={onFocusCell} onEscape={onEscape} />
            </div>
            <div className="mt-2 flex items-center gap-2 text-[10px] text-ink-3" aria-hidden="true">
              <span>{mode === "now" ? "fewer" : "lost"}</span>
              <span className="h-2 w-40 rounded-[2px]" style={{ background: `linear-gradient(90deg, ${mode === "now" ? css(NOW_STOPS) : `${css([...LOSS_STOPS].reverse())}, ${css(GAIN_STOPS)}`})` }} />
              <span>{mode === "now" ? "more objects" : "gained"}</span>
              <span className="ml-2">log scale</span>
            </div>
          </div>
          {selected && (
            <CellCard cell={selected} mode={mode} map={map.data} change={change.data} from={from} to={to}
              onShowOnGlobe={() => {
                pinShell(selected);
                close();
              }} />
          )}
        </div>
      )}

      {to && (
        <Timeline
          entries={entries}
          mode={mode}
          from={from}
          to={to}
          onFrom={(d) => {
            if (d < to) setGapChoice(daysBetween(d, to));
          }}
          onTo={(d) => setToChoice(d)}
          playing={playing}
          canPlay={frames.length > 1}
          onPlay={play}
          loading={loading}
        />
      )}
      {index && <MethodNote index={index} skipped={map.data?.skipped ?? 0} />}
      {values && (
        <DataDisclosure which="crowding" label="Crowding data">
          <CrowdingTables mode={mode} map={map.data} change={change.data} />
        </DataDisclosure>
      )}
    </div>
  );
}
