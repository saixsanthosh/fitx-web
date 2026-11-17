import type { ReactNode } from "react";
import { Camera, Check, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DraftField, LiveExercise, LiveSet } from "./types";

/** −/+ steps: 2.5 kg (the smallest common plate pair), one rep, five seconds. */
const STEPS: Record<DraftField, number> = { draftWeight: 2.5, draftReps: 1, draftDuration: 5 };

type SetListProps = {
  exercise: LiveExercise;
  /** The set being performed: shown large, with −/+ controls and a full-width Complete button. */
  currentSetId: string | null;
  /** Log seconds instead of reps (a timed movement on a database that can store them). */
  showDuration: boolean;
  /** True while the session is paused: nothing can be changed. */
  disabled: boolean;
  /** "Target 10 reps" or "Target 45 s" for the current set; null when no target was set. */
  currentTarget: string | null;
  /** What this set matched last time ("40 kg × 8"), or null. */
  lastFor: (set: LiveSet) => string | null;
  /** True when the set's count came from the camera (confirmed and still unchanged, or saved as such). */
  cameraFor: (set: LiveSet) => boolean;
  /** A timed movement's set timer for the current set: its text, whether it runs, and its Start/Stop button. */
  timer: { text: string; running: boolean; control: ReactNode } | null;
  onChange: (setId: string, field: DraftField, value: string) => void;
  onStep: (setId: string, field: DraftField, delta: number) => void;
  onToggle: (set: LiveSet) => void;
};

/**
 * The exercise's sets. Each row holds its own inputs and its Complete toggle as direct children (the e2e flows find
 * a set's Complete button from its reps box). The current set is drawn large with −/+ steppers for gym hands; the
 * others stay compact and editable, so sets can still be logged in any order.
 */
export function SetList({ exercise, currentSetId, showDuration, disabled, currentTarget, lastFor, cameraFor, timer, onChange, onStep, onToggle }: SetListProps) {
  const workField: DraftField = showDuration ? "draftDuration" : "draftReps";
  const workLabel = showDuration ? "Seconds" : "Reps";
  return (
    <div>
      <div aria-hidden="true" className="grid grid-cols-[2.25rem_minmax(0,1fr)_minmax(0,1fr)_3rem] gap-2 px-1 pb-2 text-[11px] font-semibold uppercase tracking-[.08em] text-fitx-text-secondary">
        <span>Set</span><span>Weight · kg</span><span>{workLabel}</span><span />
      </div>
      <ol className="m-0 list-none space-y-2 p-0">
        {exercise.sets.map((set) => {
          const done = Boolean(set.completed_at);
          const current = set.id === currentSetId && !done;
          const label = `${exercise.name} set ${set.set_number}`;
          const last = lastFor(set);
          const camera = cameraFor(set);
          const locked = disabled || done;
          const input = (field: DraftField, large: boolean, place = "") => {
            const weight = field === "draftWeight";
            const seconds = field === "draftDuration";
            return (
              <input
                key={field}
                aria-label={weight ? `${label} weight in kg` : seconds ? `${label} duration in seconds` : `${label} repetitions`}
                disabled={locked}
                className={cn("fitx-field px-1 text-center tabular-nums sm:px-3", large ? "h-14 text-xl font-semibold [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" : "h-12", place)}
                type="number"
                inputMode={weight ? "decimal" : "numeric"}
                min="0"
                max={weight ? "2000" : seconds ? "86400" : "500"}
                step={weight ? "0.5" : "1"}
                value={set[field]}
                onChange={(event) => onChange(set.id, field, event.target.value)}
              />
            );
          };
          const stepper = (field: DraftField, direction: 1 | -1, place: string) => {
            const noun = field === "draftWeight" ? `${STEPS[field]} kg` : field === "draftReps" ? "1 rep" : `${STEPS[field]} seconds`;
            return (
              <button
                key={`${field}${direction > 0 ? "+" : "-"}`}
                type="button"
                disabled={locked}
                onClick={() => onStep(set.id, field, direction * STEPS[field])}
                aria-label={`${direction > 0 ? "Add" : "Take off"} ${noun}, set ${set.set_number}`}
                className={cn("grid h-14 place-items-center rounded-lg border border-fitx-border bg-fitx-surface-variant text-fitx-text transition-colors hover:border-fitx-primary/50 disabled:opacity-50", place)}
              >
                {direction > 0 ? <Plus size={18} aria-hidden="true" /> : <Minus size={18} aria-hidden="true" />}
              </button>
            );
          };
          const toggle = (large: boolean) => (
            <button
              key="toggle"
              type="button"
              disabled={disabled}
              onClick={() => onToggle(set)}
              aria-label={done ? "Mark set incomplete" : "Complete set"}
              className={large
                ? "fitx-button col-span-full mt-1 min-h-14 w-full text-base"
                : cn("grid h-12 w-12 place-items-center rounded-lg border transition-colors disabled:opacity-50", done ? "border-fitx-primary/50 bg-fitx-primary/10 text-fitx-primary" : "border-fitx-border text-fitx-text-secondary hover:border-fitx-primary/40 hover:text-fitx-primary")}
            >
              <Check size={large ? 20 : 19} aria-hidden="true" />{large ? "Complete set" : null}
            </button>
          );
          const notes = [last ? `Last time ${last}` : null].filter(Boolean);
          const caption = notes.length || camera ? (
            <p key="caption" className="col-span-full m-0 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-fitx-text-secondary">
              {notes.map((note) => <span key={note}>{note}</span>)}
              {camera ? <span className="inline-flex items-center gap-1 rounded-full bg-fitx-surface-variant px-2 py-0.5 font-semibold text-fitx-text"><Camera size={12} aria-hidden="true" />{done ? "Counted by camera" : "Camera count"}</span> : null}
            </p>
          ) : null;

          if (current) {
            // Phones: weight, then reps (or seconds), each a full-width −/value/+ row. From `sm` the two sit side by
            // side; the placement classes put each control in its column without changing the reading order.
            return (
              <li key={set.id} aria-current="step" data-set-number={set.set_number}
                className="grid grid-cols-[3.25rem_minmax(0,1fr)_3.25rem] items-center gap-x-2 gap-y-2 rounded-xl border-2 border-fitx-primary bg-fitx-surface p-3 sm:grid-cols-[3.25rem_minmax(0,1fr)_3.25rem_.75rem_3.25rem_minmax(0,1fr)_3.25rem] sm:p-4">
                <p key="head" className="col-span-full m-0 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="text-sm font-semibold text-fitx-text">Set {set.set_number} <span className="font-normal text-fitx-text-secondary">· now</span></span>
                  {currentTarget ? <span className="text-sm font-semibold text-fitx-primary">{currentTarget}</span> : null}
                </p>
                <span key="weight-label" aria-hidden="true" className="col-span-3 text-[11px] font-semibold uppercase tracking-[.08em] text-fitx-text-secondary sm:col-start-1 sm:row-start-2">Weight · kg</span>
                {stepper("draftWeight", -1, "sm:col-start-1 sm:row-start-3")}
                {input("draftWeight", true, "sm:col-start-2 sm:row-start-3")}
                {stepper("draftWeight", 1, "sm:col-start-3 sm:row-start-3")}
                <span key="work-label" aria-hidden="true" className="col-span-3 text-[11px] font-semibold uppercase tracking-[.08em] text-fitx-text-secondary sm:col-start-5 sm:row-start-2">{workLabel}</span>
                {stepper(workField, -1, "sm:col-start-5 sm:row-start-3")}
                {input(workField, true, "sm:col-start-6 sm:row-start-3")}
                {stepper(workField, 1, "sm:col-start-7 sm:row-start-3")}
                {timer ? (
                  <div key="timer" className="col-span-full flex flex-wrap items-center justify-between gap-3 rounded-lg bg-fitx-surface-variant p-3">
                    <p role={timer.running ? "timer" : undefined} className="m-0 text-sm font-semibold tabular-nums text-fitx-text">{timer.text}</p>
                    {timer.control}
                  </div>
                ) : null}
                {toggle(true)}
                {caption}
              </li>
            );
          }
          return (
            <li key={set.id} data-set-number={set.set_number} className="grid grid-cols-[2.25rem_minmax(0,1fr)_minmax(0,1fr)_3rem] items-center gap-2">
              <span key="number" className="text-sm font-semibold tabular-nums text-fitx-text-secondary"><span className="sr-only">Set </span>{String(set.set_number).padStart(2, "0")}</span>
              {input("draftWeight", false)}
              {input(workField, false)}
              {toggle(false)}
              {caption}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
