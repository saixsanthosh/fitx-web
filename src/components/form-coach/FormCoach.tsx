"use client";

import type { ExerciseId, ExerciseRule } from "@/lib/form-rules/types";
import { CoachSetup } from "./CoachSetup";
import { CoachStage } from "./CoachStage";
import { CoachSummaryCard } from "./CoachSummaryCard";
import { useCoachRefs, useFormCoach } from "./useFormCoach";

/** What a workout gets back from the camera: a count, nothing else. */
export type CameraCountResult =
  | { exerciseId: ExerciseId; kind: "reps"; reps: number }
  | { exerciseId: ExerciseId; kind: "hold"; seconds: number };

interface FormCoachProps {
  rule: ExerciseRule;
  mode: "practice" | "workout";
  /** Target reps (or seconds, for a hold) for this set. */
  target?: number | null;
  /** Shown above the setup tips (workout context). */
  context?: string;
  onChangeExercise?: () => void;
  /** Workout: the user confirmed the count. */
  onUse?: (result: CameraCountResult) => void;
  /** Workout: the user discarded the count. */
  onDiscard?: () => void;
}

/** One exercise from camera set-up to summary. Practice mode saves nothing; workout mode hands back a count. */
export function FormCoach({ rule, mode, target, context, onChangeExercise, onUse, onDiscard }: FormCoachProps) {
  const refs = useCoachRefs();
  const coach = useFormCoach(refs);
  const { stage } = coach;

  return (
    <>
      {stage.name === "finished" ? (
        <CoachSummaryCard
          rule={rule}
          summary={stage.summary}
          mode={mode}
          onAgain={() => coach.start(rule)}
          onSecondary={() => {
            coach.reset();
            if (mode === "workout") onDiscard?.();
            else onChangeExercise?.();
          }}
          onUse={onUse ? () => {
            const summary = stage.summary;
            onUse(summary.kind === "hold"
              ? { exerciseId: rule.id, kind: "hold", seconds: summary.holdSeconds }
              : { exerciseId: rule.id, kind: "reps", reps: summary.reps });
          } : undefined}
        />
      ) : (
        <CoachSetup rule={rule} coach={coach} context={context} onChangeExercise={onChangeExercise} />
      )}
      <CoachStage rule={rule} coach={coach} refs={refs} mode={mode} target={target} />
    </>
  );
}
