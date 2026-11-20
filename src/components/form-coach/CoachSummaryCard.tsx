"use client";

import type { ReactNode, Ref } from "react";
import { Check, RotateCcw } from "lucide-react";
import type { CoachSummary } from "@/lib/form-rules/session";
import type { ExerciseRule } from "@/lib/form-rules/types";
import { cn } from "@/lib/utils";
import { formatClock } from "./CoachStage";
import { ExerciseGlyph } from "./ExerciseGlyph";

interface CoachSummaryCardProps {
  rule: ExerciseRule;
  summary: CoachSummary;
  mode: "practice" | "workout";
  /** The pose model stopped mid-set; the summary covers the counting done until then. */
  endedEarly?: boolean;
  /** The heading, focused when the live camera view closes onto this card. */
  headingRef?: Ref<HTMLHeadingElement>;
  onAgain: () => void;
  /** Practice: choose another exercise. Workout: discard the count. */
  onSecondary: () => void;
  /** Workout only: use the count for this set. */
  onUse?: () => void;
  /** Practice: which set of today's this was, and what happens to it. */
  setNote?: ReactNode;
}

/** The result of one set: the count, form rep by rep, what to work on and what next. */
export function CoachSummaryCard({ rule, summary, mode, endedEarly, headingRef, onAgain, onSecondary, onUse, setNote }: CoachSummaryCardProps) {
  const hold = summary.kind === "hold";
  const headline = hold ? formatClock(summary.holdSeconds) : String(summary.reps);
  const counted = hold ? summary.holdSeconds > 0 : summary.reps > 0;
  const texts = new Map(summary.cues.map((cue) => [cue.id, cue.text]));
  const stats: Array<[string, string]> = hold
    ? [
        ["Time in position", formatClock(summary.positionSeconds)],
        ["Couldn't see you clearly", formatClock(summary.unclearSeconds)],
      ]
    : [
        ["Clean reps", summary.reps > 0 ? `${summary.cleanReps} of ${summary.reps}` : "–"],
        ["Partial, not counted", String(summary.partials)],
        ["Time", formatClock(summary.activeSeconds)],
        ["Couldn't see you clearly", formatClock(summary.unclearSeconds)],
      ];
  const toWorkOn = summary.cues.filter((cue) => cue.id !== "lost").slice(0, 3);

  return (
    <section className="overflow-hidden rounded-3xl border border-fitx-border bg-fitx-surface" aria-labelledby={`summary-${rule.id}`}>
      <div className="grid gap-6 p-5 sm:p-7 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] md:gap-10">
        <div>
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-fitx-surface-variant text-fitx-text">
              <ExerciseGlyph id={rule.id} className="h-10 w-10" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-medium text-fitx-text-secondary">{mode === "workout" ? "Camera count" : "Set result"}</p>
              <h2 ref={headingRef} tabIndex={-1} id={`summary-${rule.id}`} className="truncate font-heading text-xl font-semibold tracking-tight text-fitx-text outline-none">{rule.name}</h2>
            </div>
          </div>
          <p className="mt-6 flex items-baseline gap-3">
            <span className="font-heading text-[88px] font-bold leading-[.85] tracking-[-.05em] tabular-nums text-fitx-text">{headline}</span>
            <span className="text-sm font-medium text-fitx-text-secondary">{hold ? "held in good form" : summary.reps === 1 ? "full rep" : "full reps"}</span>
          </p>
          {setNote && <div className="mt-4 text-sm text-fitx-text-secondary">{setNote}</div>}
        </div>

        <div className="min-w-0">
          {!hold && summary.repLog.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-fitx-text">Form, rep by rep</h3>
              <ol className="mt-3 flex flex-wrap gap-1.5" aria-label="Form per rep">
                {summary.repLog.map((rep, index) => {
                  const label = rep.clean ? `Rep ${index + 1}: clean` : `Rep ${index + 1}: ${rep.cues.map((id) => texts.get(id) ?? id).join(" ")}`;
                  return (
                    <li
                      key={index}
                      title={label}
                      aria-label={label}
                      className={cn(
                        "grid h-9 min-w-9 place-items-center rounded-lg px-1.5 text-xs font-semibold tabular-nums",
                        rep.clean ? "bg-fitx-primary text-fitx-on-primary" : "border border-dashed border-fitx-warning text-fitx-text",
                      )}
                    >
                      {index + 1}
                    </li>
                  );
                })}
              </ol>
              <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fitx-text-secondary">
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-fitx-primary" aria-hidden="true" />Clean</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border border-dashed border-fitx-warning" aria-hidden="true" />Form cue</span>
              </p>
            </div>
          )}

          {endedEarly && (
            <p className="fitx-alert mt-4">The pose model stopped working on this device, so counting ended early. The count up to then is kept.</p>
          )}

          <dl className={cn("grid grid-cols-2 gap-2", !hold && summary.repLog.length > 0 && "mt-6")}>
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

          {mode === "workout" && <p className="mt-6 text-xs leading-5 text-fitx-text-secondary">Check the number before you use it; you can still edit the set afterwards.</p>}

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={onSecondary} className="fitx-button fitx-button-quiet">
              {mode === "workout" ? "Discard" : "All exercises"}
            </button>
            <button type="button" onClick={onAgain} className={mode === "workout" && counted ? "fitx-button fitx-button-secondary" : "fitx-button"}>
              <RotateCcw size={16} aria-hidden="true" />
              {mode === "workout" ? "Count again" : "Another set"}
            </button>
            {mode === "workout" && counted && onUse && (
              <button type="button" onClick={onUse} className="fitx-button">
                <Check size={16} aria-hidden="true" />
                Use {hold ? formatClock(summary.holdSeconds) : `${summary.reps} ${summary.reps === 1 ? "rep" : "reps"}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
