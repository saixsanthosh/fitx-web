/** Small texts and links of the exercise page, pure so node tests can cover them. */
import type { RegionKey } from "@/lib/training/anatomy";
import type { CatalogExercise } from "@/lib/training/catalog";
import { formatDuration } from "@/lib/training/exercise-progress";

/** "8–12 reps", "10 reps" or "30 s": the catalogue's suggested work per set. */
export function workPerSetText(exercise: Pick<CatalogExercise, "prescription_type" | "reps_min" | "reps_max" | "default_duration_seconds">): string {
  if (exercise.prescription_type === "time") return formatDuration(exercise.default_duration_seconds ?? 30);
  return exercise.reps_min === exercise.reps_max ? `${exercise.reps_min} reps` : `${exercise.reps_min}–${exercise.reps_max} reps`;
}

/** Where the written steps come from, from the catalogue row's own attribution; null when it names none. */
export function stepsSourceText(attribution: string | null | undefined): string | null {
  const text = attribution?.trim();
  if (!text) return null;
  return `Steps: ${text}${/\bunlicense\b/i.test(text) ? ", public domain" : ""}.`;
}

/** The Help form, which records the exercise page a report came from (its `from`, kept without a query string). */
export function reportProblemHref(exerciseId: string): string {
  return `/help?from=${encodeURIComponent(`/exercises/${exerciseId}`)}`;
}

/** "Browse by muscle" for one body-map region (the page exercise discovery builds). */
export function muscleBrowseHref(region: RegionKey): string {
  return `/exercises/muscles?region=${encodeURIComponent(region)}`;
}

/** One session's workout record (built by the workout history stream). */
export function workoutRecordHref(sessionId: string): string {
  return `/workouts/history/${encodeURIComponent(sessionId)}`;
}

/** The exercise library, filtered to a muscle group; at home, to what the member can do with their home list. */
export function libraryHref(muscleGroup: string, context: "home" | "gym"): string {
  const params = new URLSearchParams({ muscle: muscleGroup });
  if (context === "home") {
    params.set("context", "home");
    params.set("doable", "1");
  }
  return `/exercises?${params.toString()}`;
}

/** "Add to a workout": the Workouts page with this exercise ready to add. */
export function addToWorkoutHref(exerciseId: string): string {
  return `/workouts?exercise=${encodeURIComponent(exerciseId)}`;
}
