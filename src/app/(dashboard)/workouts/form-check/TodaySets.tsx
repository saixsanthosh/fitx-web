"use client";

import Link from "next/link";
import { Check, LoaderCircle, Save, X } from "lucide-react";
import { ExerciseThumb } from "@/components/form-check/ExerciseThumb";
import type { LoggedSet } from "@/lib/home-workout/log";
import { setResult } from "@/lib/home-workout/log";

export type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; href: string }
  | { status: "error"; message: string };

interface TodaySetsProps {
  sets: readonly LoggedSet[];
  save: SaveState;
  onSave: () => void;
  onRemove: (id: string) => void;
}

/** Today's sets on this device, with their form, until they are saved to workout history. */
export function TodaySets({ sets, save, onSave, onRemove }: TodaySetsProps) {
  if (save.status === "saved" && sets.length === 0) {
    return (
      <section aria-label="Today" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-fitx-success-border bg-fitx-success-bg px-5 py-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-fitx-text">
          <Check size={17} className="text-fitx-success" aria-hidden="true" />
          Saved to workout history
        </p>
        <Link href={save.href} className="inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-semibold text-fitx-primary-text hover:underline">View workout</Link>
      </section>
    );
  }
  if (sets.length === 0) return null;
  const reps = sets.filter((set) => set.kind === "reps");
  const totalReps = reps.reduce((sum, set) => sum + set.reps, 0);
  const cleanReps = reps.reduce((sum, set) => sum + set.cleanReps, 0);
  const held = sets.reduce((sum, set) => sum + set.holdSeconds, 0);
  const summary = [
    `${sets.length} ${sets.length === 1 ? "set" : "sets"}`,
    totalReps > 0 ? `${totalReps} reps, ${cleanReps} clean` : null,
    held > 0 ? `${setResult({ kind: "hold", reps: 0, holdSeconds: held })} held` : null,
  ].filter(Boolean).join(" · ");

  return (
    <section aria-labelledby="today-sets-title" className="rounded-3xl border border-fitx-border bg-fitx-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-fitx-divider px-5 py-4 sm:px-6">
        <div>
          <h2 id="today-sets-title" className="font-heading text-lg font-bold tracking-tight text-fitx-text">Today</h2>
          <p className="text-sm text-fitx-text-secondary">{summary}</p>
        </div>
        <button type="button" onClick={onSave} disabled={save.status === "saving"} className="fitx-button">
          {save.status === "saving" ? <LoaderCircle size={17} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Save size={17} aria-hidden="true" />}
          {save.status === "saving" ? "Saving" : "Save workout"}
        </button>
      </div>
      {save.status === "error" && <p role="alert" className="fitx-alert fitx-alert-danger mx-5 mt-4 sm:mx-6">{save.message}</p>}
      <ol className="divide-y divide-fitx-divider">
        {sets.map((set, index) => {
          const form = set.kind === "reps" ? `${set.cleanReps} of ${set.reps} clean` : "Good-form hold";
          return (
            <li key={set.id} className="flex items-center gap-3 px-5 py-3 sm:px-6">
              <ExerciseThumb id={set.exerciseId} size={40} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-fitx-text">{set.exerciseName}</span>
                <span className="block text-xs text-fitx-text-secondary">{form}</span>
              </span>
              {set.kind === "reps" && set.repLog.length > 0 && (
                <span className="hidden gap-0.5 sm:flex" aria-hidden="true">
                  {set.repLog.slice(0, 20).map((rep, i) => (
                    <span key={i} className={rep.clean ? "h-4 w-1.5 rounded-full bg-fitx-primary" : "h-4 w-1.5 rounded-full border border-fitx-warning"} />
                  ))}
                </span>
              )}
              <span className="w-16 shrink-0 text-right font-heading text-base font-bold tabular-nums text-fitx-text">{setResult(set)}</span>
              <button
                type="button"
                onClick={() => onRemove(set.id)}
                aria-label={`Remove set ${index + 1}, ${set.exerciseName}`}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-fitx-text-secondary transition-colors hover:bg-fitx-hover hover:text-fitx-text"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
