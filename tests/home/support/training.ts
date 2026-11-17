// Logged training fixtures for the Home and Progress tests: completed sessions with ticked sets at local times.
import type { LoggedExercise, LoggedSession, LoggedSet } from "@/lib/training/muscle-history";

/** A local instant on a day key ("2026-11-18") at an hour. */
export function at(day: string, hour = 18, minute = 0): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date, hour, minute).toISOString();
}

const MUSCLES: Record<string, { primary: string; secondary: string[]; name: string }> = {
  bench_press: { primary: "chest", secondary: ["shoulders", "triceps"], name: "Bench press" },
  push_up: { primary: "chest", secondary: ["triceps"], name: "Push-up" },
  pushdown: { primary: "triceps", secondary: [], name: "Triceps pushdown" },
  row: { primary: "middle_back", secondary: ["lats", "biceps"], name: "Barbell row" },
  pull_up: { primary: "lats", secondary: ["biceps"], name: "Pull-up" },
  curl: { primary: "biceps", secondary: ["forearms"], name: "Biceps curl" },
  squat: { primary: "quadriceps", secondary: ["glutes", "hamstrings"], name: "Squat" },
  rdl: { primary: "hamstrings", secondary: ["glutes", "lower_back"], name: "Romanian deadlift" },
  leg_curl: { primary: "hamstrings", secondary: [], name: "Leg curl" },
  press: { primary: "shoulders", secondary: ["triceps"], name: "Overhead press" },
  plank: { primary: "abdominals", secondary: [], name: "Plank" },
};

export type SetSpec = { reps?: number | null; kg?: number | null; seconds?: number | null; done?: boolean };

/** An exercise with `count` ticked sets (8 reps at 40 kg unless given), ticked at `day`. */
export function exercise(id: string, day: string, count = 3, spec: SetSpec = {}, options: { timed?: number | null; unlinked?: boolean } = {}): LoggedExercise {
  const known = MUSCLES[id];
  const sets: LoggedSet[] = Array.from({ length: count }, (_, index) => ({
    reps: spec.reps === undefined ? 8 : spec.reps,
    weight_kg: spec.kg === undefined ? 40 : spec.kg,
    duration_seconds: spec.seconds ?? null,
    completed_at: spec.done === false ? null : at(day, 18, index),
    set_number: index + 1,
  }));
  return {
    id: `${id}-${day}-${Math.random().toString(36).slice(2, 8)}`,
    exercise_id: options.unlinked ? null : id,
    name: known?.name ?? id,
    target_duration_seconds: options.timed ?? null,
    library: options.unlinked || !known ? null : { id, name: known.name, primary_muscle: known.primary, secondary_muscles: known.secondary },
    sets,
  };
}

let counter = 0;

/** A completed session that started on `day` at 18:00. */
export function session(day: string, exercises: LoggedExercise[], status = "completed"): LoggedSession {
  counter += 1;
  return { id: `s${counter}`, name: `Workout ${counter}`, status, started_at: at(day, 18), completed_at: status === "completed" ? at(day, 19) : null, exercises };
}
