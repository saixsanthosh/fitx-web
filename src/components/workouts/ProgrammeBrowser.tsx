"use client";

import { useState, type CSSProperties } from "react";
import { Layers, ListOrdered } from "lucide-react";
import { BodyMap } from "@/components/anatomy/BodyMap";
import { programmeLengthLabel, programmeMeta } from "@/data/programmes/meta";
import { equipmentLabel } from "@/lib/training/equipment";
import { FOCUS_AREAS, focusLabel, type FocusArea } from "@/lib/training/focus";
import { programmeRegionLevels, programmesForArea, slotPrescription, weeklyPattern, type Programme } from "@/lib/training/programmes";
import { Sheet } from "./Sheet";
import styles from "./ProgrammeBrowser.module.css";

const WEEKDAYS = [["Mon", 1], ["Tue", 2], ["Wed", 3], ["Thu", 4], ["Fri", 5], ["Sat", 6], ["Sun", 0]] as const;

/**
 * The programmes for one context as compact cards (phase 7.4): where each one's sets go on the body map, its name and
 * one line of facts. On phones the cards are a sideways rail; from 768 px a grid. "Days" opens the programme's days
 * in a sheet (with Follow there too); "Follow" opens the form to start following it. Filterable by body area.
 */
export function ProgrammeBrowser({ programmes, enrolAvailable, busy, onEnrol, disabledNote }: {
  programmes: readonly Programme[];
  enrolAvailable: boolean;
  busy: boolean;
  onEnrol: (programme: Programme, weekdays: number[], time: string) => Promise<string | null>;
  /** Why "Follow" is unavailable, shown under the list. */
  disabledNote?: string;
}) {
  const [daysOf, setDaysOf] = useState<Programme | null>(null);
  const [enrolling, setEnrolling] = useState<Programme | null>(null);
  const [area, setArea] = useState<FocusArea | null>(null);
  if (!programmes.length) return null;
  // Only areas some programme here trains, so a chip never leads to an empty list.
  const areas = FOCUS_AREAS.filter((key) => programmesForArea(programmes, key).length > 0);
  const shown = area ? programmesForArea(programmes, area) : programmes;
  return (
    <div className="space-y-3">
      {areas.length > 1 && (
        <div role="group" aria-label="Programmes by body area" className={styles.chips}>
          {[null, ...areas].map((key) => {
            const on = area === key;
            return <button key={key ?? "all"} type="button" aria-pressed={on} onClick={() => setArea(key)} className={styles.chip}>{key ? focusLabel(key) : "All"}</button>;
          })}
        </div>
      )}
      {area && <p className="sr-only" role="status">{shown.length} programme{shown.length === 1 ? "" : "s"}, the most work for {focusLabel(area).toLowerCase()} first.</p>}
      <ul className={styles.list} key={area ?? "all"}>
        {shown.map((programme, index) => {
          const meta = programmeMeta(programme.id);
          return (
            <li key={programme.id} className={styles.item} style={{ "--rise-delay": `${Math.min(index, 5) * 45}ms` } as CSSProperties}>
              <article className={styles.card} aria-labelledby={`programme-${programme.id}-title`}>
                <div className={styles.cardHead}>
                  <div className={styles.map}>
                    <BodyMap title={`${programme.title}: where its sets go`} levels={programmeRegionLevels(programme)} size="sm" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 id={`programme-${programme.id}-title`} className={styles.name}>{programme.title}</h3>
                    <p className={styles.facts}>{programmeLengthLabel(meta?.lengthDays)} · about {programme.sessionMinutes} min</p>
                    <p className={styles.level}>{programme.level}</p>
                  </div>
                </div>
                <div className={styles.cardActions}>
                  <button type="button" aria-haspopup="dialog" onClick={() => setDaysOf(programme)} className="fitx-button fitx-button-quiet min-h-11 flex-1 px-3 text-sm"><ListOrdered size={15} aria-hidden="true" />Days</button>
                  <button type="button" aria-haspopup="dialog" disabled={!enrolAvailable || busy} onClick={() => setEnrolling(programme)} className="fitx-button min-h-11 flex-1 px-4 text-sm">Follow</button>
                </div>
              </article>
            </li>
          );
        })}
      </ul>
      {!enrolAvailable && disabledNote && <p className="text-xs text-fitx-text-secondary">{disabledNote}</p>}
      {daysOf && <DaysSheet programme={daysOf} canFollow={enrolAvailable && !busy} onClose={() => setDaysOf(null)} onFollow={() => { const next = daysOf; setDaysOf(null); setEnrolling(next); }} />}
      {enrolling && <EnrolSheet programme={enrolling} busy={busy} onClose={() => setEnrolling(null)} onConfirm={async (weekdays, time) => {
        const error = await onEnrol(enrolling, weekdays, time);
        if (!error) setEnrolling(null);
        return error;
      }} />}
    </div>
  );
}

/** A programme's days: what it is for, each day's exercises with sets and reps, and how it adapts. */
function DaysSheet({ programme, canFollow, onClose, onFollow }: { programme: Programme; canFollow: boolean; onClose: () => void; onFollow: () => void }) {
  const meta = programmeMeta(programme.id);
  const week = weeklyPattern(programme.defaultWeekdays);
  return (
    <Sheet title={programme.title} size="lg" onClose={onClose}
      description={`${programmeLengthLabel(meta?.lengthDays)} · ${programme.daysPerWeek} days a week, ${week.rest} rest · about ${programme.sessionMinutes} min`}
      footer={<>
        <button type="button" onClick={onClose} className="fitx-button fitx-button-quiet">Close</button>
        <button type="button" disabled={!canFollow} onClick={onFollow} className="fitx-button">Follow</button>
      </>}>
      <p className="text-sm text-fitx-text-secondary">{meta?.objective ?? programme.summary}</p>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2">
        {programme.days.map((day, index) => (
          <li key={day.key} className="rounded-lg bg-fitx-surface-variant p-3">
            <p className="text-sm font-medium"><span className="mr-1.5 text-xs tabular-nums text-fitx-text-secondary">Day {index + 1}</span>{day.title}</p>
            <ul className="mt-1.5 space-y-0.5 text-xs text-fitx-text-secondary">
              {day.slots.filter((slot) => !slot.optional).map((slot, position) => <li key={`${position}-${slot.label ?? ""}`} className="flex justify-between gap-2"><span className="min-w-0 truncate">{slot.label ?? "Exercise"}</span><span className="shrink-0 tabular-nums">{slotPrescription(slot)}</span></li>)}
            </ul>
          </li>
        ))}
      </ol>
      {programme.builtAround.length > 0 && <p className="mt-3 flex items-center gap-1.5 text-xs text-fitx-text-secondary"><Layers size={13} aria-hidden="true" />Built around {programme.builtAround.map(equipmentLabel).join(", ").toLowerCase()}; exercises adapt to your list.</p>}
      <p className="mt-2 text-xs text-fitx-text-secondary">{programme.sourceNotes}</p>
    </Sheet>
  );
}

function EnrolSheet({ programme, busy, onClose, onConfirm }: { programme: Programme; busy: boolean; onClose: () => void; onConfirm: (weekdays: number[], time: string) => Promise<string | null> }) {
  const [weekdays, setWeekdays] = useState<number[]>([...programme.defaultWeekdays]);
  const [time, setTime] = useState("18:00");
  const [error, setError] = useState("");
  const meta = programmeMeta(programme.id);
  const week = weeklyPattern(weekdays);
  const toggle = (day: number) => setWeekdays((current) => current.includes(day) ? current.filter((value) => value !== day) : [...current, day]);
  return (
    <Sheet title={`Follow ${programme.title}`} onClose={onClose}
      description={`${programmeLengthLabel(meta?.lengthDays)}. FITX keeps the next 7 days planned on the days you pick. Each workout you finish moves you to the next day of the programme.`}
      footer={<>
        <button type="button" onClick={onClose} className="fitx-button fitx-button-quiet">Cancel</button>
        <button type="button" disabled={busy || !weekdays.length} onClick={async () => { setError(""); const message = await onConfirm(weekdays, time); if (message) setError(message); }} className="fitx-button">{busy ? "Planning…" : "Start programme"}</button>
      </>}>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Training days <span className="font-normal text-fitx-text-secondary">· suggested {programme.daysPerWeek} a week</span></legend>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map(([label, day]) => {
            const on = weekdays.includes(day);
            return <button key={day} type="button" aria-pressed={on} onClick={() => toggle(day)} className={`min-h-11 min-w-12 rounded-md border px-3 text-sm ${on ? "border-fitx-primary bg-fitx-primary/[.08] font-medium" : "border-fitx-border text-fitx-text-secondary"}`}>{label}</button>;
          })}
        </div>
      </fieldset>
      <div className="mt-3 rounded-lg bg-fitx-surface-variant p-3" role="status">
        <p className="text-sm font-medium">{week.training} training day{week.training === 1 ? "" : "s"} and {week.rest} rest day{week.rest === 1 ? "" : "s"} a week</p>
        <ol aria-hidden="true" className="mt-2 grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-[.06em]">
          {WEEKDAYS.map(([label, day]) => {
            const on = weekdays.includes(day);
            return <li key={day} className={`rounded-md py-1.5 ${on ? "bg-fitx-primary/10 text-fitx-primary-text" : "text-fitx-text-secondary"}`}>{label.slice(0, 2)}<span className="mt-0.5 block font-normal normal-case tracking-normal">{on ? "Train" : "Rest"}</span></li>;
          })}
        </ol>
        <p className="mt-2 text-xs text-fitx-text-secondary">Rest days are part of the plan, never a missed workout.</p>
      </div>
      <label className="mt-4 grid max-w-48 gap-1.5 text-sm">Usual start time<input type="time" className="fitx-field" value={time} onChange={(event) => setTime(event.target.value)} /></label>
      {weekdays.length !== programme.daysPerWeek && <p className="mt-3 text-xs text-fitx-text-secondary">You picked {weekdays.length} day{weekdays.length === 1 ? "" : "s"}; the programme cycles through its {programme.days.length} days in order either way.</p>}
      {error && <p role="alert" className="fitx-alert fitx-alert-danger mt-4 px-3 py-2 text-sm">{error}</p>}
    </Sheet>
  );
}
