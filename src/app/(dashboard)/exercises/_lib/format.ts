import type { CatalogExercise } from "@/lib/training/catalog";

/** "middle_back" -> "middle back". */
export function readable(value: string) {
  return value.replaceAll("_", " ");
}

export function capitalize(value: string) {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

/** 45 -> "45 s", 600 -> "10 min", 90 -> "1 min 30 s". */
export function formatSeconds(seconds: number) {
  const whole = Math.max(0, Math.round(seconds));
  if (whole < 60) return `${whole} s`;
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

/** The work for one set: a rep range, or a time for holds, stretches and cardio. */
export function workPerSet(exercise: Pick<CatalogExercise, "prescription_type" | "reps_min" | "reps_max" | "default_duration_seconds">) {
  if (exercise.prescription_type === "time") return formatSeconds(exercise.default_duration_seconds ?? 30);
  return exercise.reps_min === exercise.reps_max ? `${exercise.reps_min} reps` : `${exercise.reps_min}–${exercise.reps_max} reps`;
}
