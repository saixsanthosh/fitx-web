"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Info } from "lucide-react";
import { STEPS_FOLD_AFTER, visibleStepCount, type GuideStep } from "@/lib/training/exercise-guide";

/**
 * The catalogue's own steps, numbered, each with its first sentence in full weight and the rest quieter so a
 * step can be scanned. Long lists show their first steps until "Show all steps". Nothing is added: an exercise
 * without written steps says so.
 */
export function ExerciseSteps({ steps }: { steps: readonly GuideStep[] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = visibleStepCount(steps.length, expanded);
  const foldable = steps.length > STEPS_FOLD_AFTER;
  return (
    <section aria-labelledby="exercise-steps-heading">
      <h2 id="exercise-steps-heading" className="text-base font-semibold text-fitx-text">Steps</h2>
      {steps.length ? (
        <ol id="exercise-steps" className="m-0 mt-3 list-none space-y-3 p-0">
          {steps.slice(0, shown).map((step) => (
            <li key={step.number} className="flex gap-3">
              <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-fitx-surface-variant text-xs font-bold tabular-nums text-fitx-primary-text">{step.number}</span>
              <p className="m-0 min-w-0 pt-0.5 text-sm leading-6">
                <span className="sr-only">Step {step.number}: </span>
                <span className="font-medium text-fitx-text">{step.lead}</span>
                {step.rest ? <>{" "}<span className="text-fitx-text-secondary">{step.rest}</span></> : null}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-3 rounded-lg border border-dashed border-fitx-border px-3 py-3 text-sm leading-6 text-fitx-text-secondary">
          No written steps are recorded for this exercise yet. If the movement is new to you, start light or choose an alternative you know.
        </p>
      )}
      {foldable && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="exercise-steps"
          onClick={() => setExpanded((value) => !value)}
          className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-md px-1 text-sm font-semibold text-fitx-primary-text hover:underline"
        >
          {expanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
          {expanded ? "Show fewer steps" : `Show all ${steps.length} steps`}
        </button>
      )}
      <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-fitx-text-secondary">
        <Info size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-fitx-primary" />
        General guidance only. Use a controlled range of motion, adjust the load to your experience, and stop if a movement causes pain.
      </p>
    </section>
  );
}
