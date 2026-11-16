"use client";

import Link from "next/link";
import { CircleCheck, Lightbulb } from "lucide-react";
import type { CoachWorkoutPlan } from "@/lib/ai/types";
import { ActionButton, type ActionState } from "./ActionButton";

/** A suggested session built only from FITX's exercise library. */
export function WorkoutPlanCard({ plan, state, onSave }: { plan: CoachWorkoutPlan; state: ActionState; onSave: () => void }) {
  const minutes = Math.round(plan.exercises.reduce((sum, exercise) => sum + exercise.sets * ((exercise.holdSeconds ?? 40) + exercise.restSeconds), 0) / 60);
  return (
    <article className="fitx-panel overflow-hidden" aria-label={`Workout: ${plan.title}`}>
      <header className="border-b border-fitx-divider p-4 sm:p-5">
        <p className="text-xs font-semibold uppercase tracking-[.12em] text-fitx-primary-text">Workout</p>
        <h3 className="mt-1 text-lg font-semibold leading-snug text-fitx-text">{plan.title}</h3>
        {plan.summary && <p className="mt-1 text-sm leading-6 text-fitx-text-secondary">{plan.summary}</p>}
        <p className="mt-3 text-xs text-fitx-text-secondary">
          {plan.exercises.length} exercises · about {minutes} min · <span className="capitalize">{plan.location}</span>
        </p>
      </header>
      <ol className="divide-y divide-fitx-divider">
        {plan.exercises.map((exercise, index) => (
          <li key={exercise.exerciseId} className="flex items-start gap-3 p-4 sm:px-5">
            <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-fitx-surface-variant text-xs font-semibold text-fitx-text-secondary">{index + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <Link href={`/exercises/${encodeURIComponent(exercise.exerciseId)}`} className="text-sm font-semibold text-fitx-text underline-offset-4 hover:text-fitx-primary-text hover:underline">{exercise.name}</Link>
                <span className="text-sm font-medium text-fitx-text">
                  {exercise.sets} × {exercise.holdSeconds ? `${exercise.holdSeconds} s hold` : exercise.repsMin === exercise.repsMax ? exercise.repsMin : `${exercise.repsMin}–${exercise.repsMax}`} <span className="font-normal text-fitx-text-secondary">· rest {exercise.restSeconds} s</span>
                </span>
              </div>
              <p className="mt-0.5 text-xs capitalize text-fitx-text-secondary">{exercise.primaryMuscle.replace(/_/g, " ")} · {exercise.equipment.length ? exercise.equipment.join(", ").replace(/_/g, " ") : "no equipment"}</p>
              {exercise.note && <p className="mt-1 text-xs leading-5 text-fitx-text-secondary">{exercise.note}</p>}
            </div>
          </li>
        ))}
      </ol>
      <footer className="space-y-4 border-t border-fitx-divider bg-fitx-surface-variant/40 p-4 sm:p-5">
        {plan.actionId && (
          <ActionButton state={state} onApply={onSave} label="Save as a workout draft" doneLabel="Saved as a draft" doneHref="/workouts" doneLinkLabel="Open Workouts" size="regular" />
        )}
        {plan.checks.map((check) => (
          <p key={check} className="flex gap-2 text-sm leading-6 text-fitx-text"><CircleCheck size={16} aria-hidden="true" className="mt-1 shrink-0 text-fitx-success" />{check}</p>
        ))}
        {plan.tips.length > 0 && (
          <ul className="space-y-1.5">
            {plan.tips.map((tip) => (
              <li key={tip} className="flex gap-2 text-sm leading-6 text-fitx-text"><Lightbulb size={16} aria-hidden="true" className="mt-1 shrink-0 text-fitx-gold" />{tip}</li>
            ))}
          </ul>
        )}
      </footer>
    </article>
  );
}
