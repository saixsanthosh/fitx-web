"use client";

import { useState } from "react";
import { CalendarDays, ChevronDown, Clock3, Layers } from "lucide-react";
import { equipmentLabel } from "@/lib/training/equipment";
import type { Programme } from "@/lib/training/programmes";
import { Sheet } from "./Sheet";

const WEEKDAYS = [["Mon", 1], ["Tue", 2], ["Wed", 3], ["Thu", 4], ["Fri", 5], ["Sat", 6], ["Sun", 0]] as const;

/** The programmes for one context, each with its days, and a form to start following one. */
export function ProgrammeBrowser({ programmes, enrolAvailable, busy, onEnrol, disabledNote }: {
  programmes: readonly Programme[];
  enrolAvailable: boolean;
  busy: boolean;
  onEnrol: (programme: Programme, weekdays: number[], time: string) => Promise<string | null>;
  /** Why "Follow" is unavailable, shown under the list. */
  disabledNote?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState<Programme | null>(null);
  if (!programmes.length) return null;
  return (
    <div className="space-y-2">
      {programmes.map((programme) => {
        const open = openId === programme.id;
        return (
          <article key={programme.id} className="rounded-lg border border-fitx-border bg-fitx-surface">
            <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <h4 className="font-medium">{programme.title}</h4>
                <p className="mt-1 text-sm text-fitx-text-secondary">{programme.summary}</p>
                <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fitx-text-secondary">
                  <span className="inline-flex items-center gap-1"><CalendarDays size={13} aria-hidden="true" />{programme.daysPerWeek} days a week</span>
                  <span className="inline-flex items-center gap-1"><Clock3 size={13} aria-hidden="true" />About {programme.sessionMinutes} min</span>
                  <span className="capitalize">{programme.level}</span>
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button type="button" onClick={() => setOpenId(open ? null : programme.id)} aria-expanded={open} className="fitx-button fitx-button-quiet min-h-11 px-3 text-sm">Days<ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" /></button>
                <button type="button" disabled={!enrolAvailable || busy} onClick={() => setEnrolling(programme)} className="fitx-button min-h-11 px-4 text-sm">Follow</button>
              </div>
            </div>
            {open && (
              <div className="border-t border-fitx-divider px-4 py-3">
                <ol className="grid gap-2 sm:grid-cols-2">
                  {programme.days.map((day, index) => (
                    <li key={day.key} className="rounded-md bg-fitx-surface-variant p-3">
                      <p className="text-sm font-medium"><span className="mr-1.5 text-xs tabular-nums text-fitx-text-secondary">Day {index + 1}</span>{day.title}</p>
                      <p className="mt-1 text-xs text-fitx-text-secondary">{day.slots.filter((slot) => !slot.optional).map((slot) => slot.label ?? "Exercise").join(" · ")}</p>
                    </li>
                  ))}
                </ol>
                {programme.builtAround.length > 0 && <p className="mt-3 flex items-center gap-1.5 text-xs text-fitx-text-secondary"><Layers size={13} aria-hidden="true" />Built around {programme.builtAround.map(equipmentLabel).join(", ").toLowerCase()}; exercises adapt to your list.</p>}
                <p className="mt-2 text-xs text-fitx-text-secondary">{programme.sourceNotes}</p>
              </div>
            )}
          </article>
        );
      })}
      {!enrolAvailable && disabledNote && <p className="text-xs text-fitx-text-secondary">{disabledNote}</p>}
      {enrolling && <EnrolSheet programme={enrolling} busy={busy} onClose={() => setEnrolling(null)} onConfirm={async (weekdays, time) => {
        const error = await onEnrol(enrolling, weekdays, time);
        if (!error) setEnrolling(null);
        return error;
      }} />}
    </div>
  );
}

function EnrolSheet({ programme, busy, onClose, onConfirm }: { programme: Programme; busy: boolean; onClose: () => void; onConfirm: (weekdays: number[], time: string) => Promise<string | null> }) {
  const [weekdays, setWeekdays] = useState<number[]>([...programme.defaultWeekdays]);
  const [time, setTime] = useState("18:00");
  const [error, setError] = useState("");
  const toggle = (day: number) => setWeekdays((current) => current.includes(day) ? current.filter((value) => value !== day) : [...current, day]);
  return (
    <Sheet title={`Follow ${programme.title}`} onClose={onClose}
      description="FITX plans the next 7 days on the days you pick. Each workout you finish moves you to the next day of the programme."
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
      <label className="mt-4 grid max-w-48 gap-1.5 text-sm">Usual start time<input type="time" className="fitx-field" value={time} onChange={(event) => setTime(event.target.value)} /></label>
      {weekdays.length !== programme.daysPerWeek && <p className="mt-3 text-xs text-fitx-text-secondary">You picked {weekdays.length} day{weekdays.length === 1 ? "" : "s"}; the programme cycles through its {programme.days.length} days in order either way.</p>}
      {error && <p role="alert" className="fitx-alert fitx-alert-danger mt-4 px-3 py-2 text-sm">{error}</p>}
    </Sheet>
  );
}
