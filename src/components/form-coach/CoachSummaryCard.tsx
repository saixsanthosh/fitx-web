"use client";

import { Check, RotateCcw } from "lucide-react";
import type { CoachSummary } from "@/lib/form-rules/session";
import type { ExerciseRule } from "@/lib/form-rules/types";
import { formatClock } from "./CoachStage";
import { ExerciseGlyph } from "./ExerciseGlyph";

interface CoachSummaryCardProps {
  rule: ExerciseRule;
  summary: CoachSummary;
  mode: "practice" | "workout";
  onAgain: () => void;
  /** Practice: choose another exercise. Workout: discard the count. */
  onSecondary: () => void;
  /** Workout only: use the count for this set. */
  onUse?: () => void;
}

export function CoachSummaryCard({ rule, summary, mode, onAgain, onSecondary, onUse }: CoachSummaryCardProps) {
  const hold = summary.kind === "hold";
  const headline = hold ? formatClock(summary.holdSeconds) : String(summary.reps);
  const counted = hold ? summary.holdSeconds > 0 : summary.reps > 0;
  const stats: Array<[string, string]> = hold
    ? [
        ["Time in a plank", formatClock(summary.positionSeconds)],
        ["Couldn't see you clearly", formatClock(summary.unclearSeconds)],
      ]
    : [
        ["Partial reps, not counted", String(summary.partials)],
        ["Reps without a form cue", summary.reps > 0 ? `${summary.cleanReps} of ${summary.reps}` : "–"],
        ["Time", formatClock(summary.activeSeconds)],
        ["Couldn't see you clearly", formatClock(summary.unclearSeconds)],
      ];
  const toWorkOn = summary.cues.filter((cue) => cue.id !== "lost").slice(0, 3);

  return (
    <section className="fitx-panel overflow-hidden" aria-labelledby={`summary-${rule.id}`}>
      <div className="flex items-start gap-4 border-b border-fitx-divider p-5 sm:p-6">
        <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-fitx-surface-variant text-fitx-primary">
          <ExerciseGlyph id={rule.id} className="h-10 w-10" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium text-fitx-text-secondary">{mode === "workout" ? "Camera count" : "Practice summary"}</p>
          <h2 id={`summary-${rule.id}`} className="text-xl font-semibold tracking-tight text-fitx-text">{rule.name}</h2>
        </div>
      </div>
      <div className="p-5 sm:p-6">
        <p className="flex items-baseline gap-3">
          <span className="text-6xl font-bold leading-none tracking-tight tabular-nums text-fitx-text">{headline}</span>
          <span className="text-sm font-medium text-fitx-text-secondary">{hold ? "held in good form" : summary.reps === 1 ? "full rep" : "full reps"}</span>
        </p>
        <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map(([label, value]) => (
            <div key={label} className="rounded-xl bg-fitx-surface-variant px-3.5 py-3">
              <dt className="text-xs leading-5 text-fitx-text-secondary">{label}</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums text-fitx-text">{value}</dd>
            </div>
          ))}
        </dl>

        {toWorkOn.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-fitx-text">What to work on</h3>
            <ul className="mt-2 divide-y divide-fitx-divider">
              {toWorkOn.map((cue) => (
                <li key={cue.id} className="flex items-start justify-between gap-4 py-2.5 text-sm leading-6 text-fitx-text-secondary">
                  <span>{cue.text}</span>
                  <span className="shrink-0 tabular-nums text-fitx-text-disabled">{cue.count}×</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!counted && (
          <p className="mt-6 text-sm leading-6 text-fitx-text-secondary">
            Nothing was counted. Check that the camera sees your whole body from the {rule.view === "side" ? "side" : "front"}, in good light, then try again.
          </p>
        )}

        <p className="mt-6 text-xs leading-5 text-fitx-text-secondary">
          {mode === "workout" ? "Check the number before you use it; you can still edit the set afterwards." : "Practice sessions aren't saved. Counts come from a single 2D camera view and can be off."}
        </p>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onSecondary} className="fitx-button fitx-button-quiet">
            {mode === "workout" ? "Discard" : "Choose another exercise"}
          </button>
          <button type="button" onClick={onAgain} className={mode === "workout" && counted ? "fitx-button fitx-button-secondary" : "fitx-button"}>
            <RotateCcw size={16} aria-hidden="true" />
            {mode === "workout" ? "Count again" : "Practice again"}
          </button>
          {mode === "workout" && counted && onUse && (
            <button type="button" onClick={onUse} className="fitx-button">
              <Check size={16} aria-hidden="true" />
              Use {hold ? formatClock(summary.holdSeconds) : `${summary.reps} ${summary.reps === 1 ? "rep" : "reps"}`}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
