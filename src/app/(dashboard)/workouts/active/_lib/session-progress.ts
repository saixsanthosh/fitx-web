/**
 * Where a live workout stands: the set being performed ("Set 2 of 4"), what is left in the exercise and in the
 * session, what comes next, and the rest timer's arithmetic. Pure (its one import, set-entry.ts, is too), so
 * `node --test` loads it directly; the live page (../page.tsx) and its components read everything from here.
 *
 * A set is done when it is ticked (completed_at set): the page only lets a set be ticked with reps or seconds,
 * the same rule the database uses when it totals the session. Sets are taken in set-number order, so the current
 * set is the first one not ticked yet.
 */
import { plausibleWeight } from "./set-entry";

export type ProgressSet = {
  id: string;
  set_number: number;
  completed_at: string | null;
  target_reps: number | null;
};

export type ProgressExercise = {
  id: string;
  name: string;
  exercise_id: string | null;
  reps_min: number;
  reps_max: number;
  rest_seconds: number;
  target_weight_kg: number | null;
  target_duration_seconds: number | null;
  sets: readonly ProgressSet[];
};

const isDone = (set: ProgressSet) => Boolean(set.completed_at);
const inOrder = <T extends ProgressSet>(sets: readonly T[]): T[] => [...sets].sort((a, b) => a.set_number - b.set_number);

export type ExerciseProgress = {
  /** Sets in the exercise (target sets plus any added). */
  total: number;
  /** Sets ticked. */
  done: number;
  /** Sets not ticked yet. */
  left: number;
  /** The set being performed: the first one not ticked, in set order; null when every set is done. */
  current: ProgressSet | null;
  /** Where `current` sits in the exercise, from 1 ("Set 2 of 4"); null when every set is done. */
  position: number | null;
};

export function exerciseProgress(exercise: Pick<ProgressExercise, "sets">): ExerciseProgress {
  const sets = inOrder(exercise.sets);
  const done = sets.filter(isDone).length;
  const index = sets.findIndex((set) => !isDone(set));
  return { total: sets.length, done, left: sets.length - done, current: index < 0 ? null : sets[index], position: index < 0 ? null : index + 1 };
}

/** "Set 2 of 4", or "All 4 sets done" ("No sets yet" for an exercise without sets). */
export function setHeadline(progress: ExerciseProgress): string {
  if (!progress.total) return "No sets yet";
  if (progress.position === null) return progress.total === 1 ? "The set is done" : `All ${progress.total} sets done`;
  return `Set ${progress.position} of ${progress.total}`;
}

/** "2 sets left", "Last set", or "" when the exercise is done. */
export function setsLeftLabel(progress: ExerciseProgress): string {
  if (!progress.left) return "";
  return progress.left === 1 ? "Last set" : `${progress.left} sets left`;
}

export type SessionProgress = {
  setsDone: number;
  setsTotal: number;
  setsLeft: number;
  /** Exercises with every set ticked (an exercise without sets is never complete). */
  exercisesDone: number;
  exercisesTotal: number;
};

export function sessionProgress(exercises: readonly Pick<ProgressExercise, "sets">[]): SessionProgress {
  let setsDone = 0;
  let setsTotal = 0;
  let exercisesDone = 0;
  for (const exercise of exercises) {
    const progress = exerciseProgress(exercise);
    setsDone += progress.done;
    setsTotal += progress.total;
    if (progress.total > 0 && progress.left === 0) exercisesDone += 1;
  }
  return { setsDone, setsTotal, setsLeft: setsTotal - setsDone, exercisesDone, exercisesTotal: exercises.length };
}

/**
 * The next exercise, after `from`, with a set still to do: forward first, then any earlier one that was skipped.
 * Null when no other exercise has one.
 */
export function nextExerciseWithOpenSets(exercises: readonly Pick<ProgressExercise, "sets">[], from: number): number | null {
  const count = exercises.length;
  for (let step = 1; step < count; step += 1) {
    const index = (from + step) % count;
    if (exerciseProgress(exercises[index]).left > 0) return index;
  }
  return null;
}

export type NextStep =
  /** Another set of the same exercise. `position` and `total` read as "Set 3 of 4". */
  | { kind: "set"; exerciseIndex: number; set: ProgressSet; position: number; total: number }
  /** The first open set of another exercise (`left` sets to do there). */
  | { kind: "exercise"; exerciseIndex: number; left: number }
  /** Every set is ticked: the workout can be finished. */
  | { kind: "finish" }
  /** Nothing to do yet: the session has no sets at all. */
  | { kind: "none" };

function openSetsOf(exercise: Pick<ProgressExercise, "sets">) {
  return inOrder(exercise.sets).map((set, index) => ({ set, position: index + 1 })).filter(({ set }) => !isDone(set));
}

function nextElsewhere(exercises: readonly Pick<ProgressExercise, "sets">[], from: number, fallback: NextStep): NextStep {
  const index = nextExerciseWithOpenSets(exercises, from);
  return index === null ? fallback : { kind: "exercise", exerciseIndex: index, left: exerciseProgress(exercises[index]).left };
}

/**
 * What to do when the current rest ends: the current exercise's open set, else the next exercise with sets to do,
 * else finish.
 */
export function stepAfterRest(exercises: readonly Pick<ProgressExercise, "sets">[], currentIndex: number): NextStep {
  if (!exercises.length) return { kind: "none" };
  const index = Math.max(0, Math.min(currentIndex, exercises.length - 1));
  const sets = inOrder(exercises[index].sets);
  const open = openSetsOf(exercises[index])[0];
  if (open) return { kind: "set", exerciseIndex: index, set: open.set, position: open.position, total: sets.length };
  const total = sessionProgress(exercises).setsTotal;
  return nextElsewhere(exercises, index, total ? { kind: "finish" } : { kind: "none" });
}

/**
 * "Up next" while a set is being performed: the set after the current one in this exercise, else the next exercise
 * with sets to do, else finish (the current set is the last one).
 */
export function stepAfterCurrentSet(exercises: readonly Pick<ProgressExercise, "sets">[], currentIndex: number): NextStep {
  if (!exercises.length) return { kind: "none" };
  const index = Math.max(0, Math.min(currentIndex, exercises.length - 1));
  const sets = inOrder(exercises[index].sets);
  const open = openSetsOf(exercises[index]);
  if (open.length > 1) return { kind: "set", exerciseIndex: index, set: open[1].set, position: open[1].position, total: sets.length };
  const total = sessionProgress(exercises).setsTotal;
  return nextElsewhere(exercises, index, total ? { kind: "finish" } : { kind: "none" });
}

/**
 * The exercises with one set replaced by `update(set)`; every other set and exercise is kept as given. A save that
 * returns applies itself to the exercises as they are then, so ticks and typing made while it was in flight stay.
 */
export function updateSet<E extends { id: string; sets: readonly { id: string }[] }>(exercises: readonly E[], exerciseId: string, setId: string, update: (set: E["sets"][number]) => E["sets"][number]): E[] {
  return exercises.map((exercise) => exercise.id !== exerciseId ? exercise : { ...exercise, sets: exercise.sets.map((set) => (set.id === setId ? update(set) : set)) });
}

/**
 * Where the page moves after a set is ticked: the same exercise while it has sets to do, else the next exercise
 * with sets to do (forward first), else it stays.
 */
export function exerciseAfterTick(exercises: readonly Pick<ProgressExercise, "sets">[], currentIndex: number): number {
  if (!exercises.length) return 0;
  const index = Math.max(0, Math.min(currentIndex, exercises.length - 1));
  if (exerciseProgress(exercises[index]).left > 0) return index;
  return nextExerciseWithOpenSets(exercises, index) ?? index;
}

/**
 * Whether a tick on exercise `ticked` moves the page on to another exercise (exerciseAfterTick), as the page does only
 * while the member is still on it (`shown`). The set list the member ticked in is then replaced by the next
 * exercise's, taking focus with it (D5), so the page hands focus on.
 */
export function tickMovesOn(exercises: readonly Pick<ProgressExercise, "sets">[], ticked: number, shown: number): boolean {
  if (ticked < 0 || ticked >= exercises.length) return false;
  return Math.max(0, Math.min(shown, exercises.length - 1)) === ticked && exerciseAfterTick(exercises, ticked) !== ticked;
}

// ---------------------------------------------------------------- prescriptions

const trim = (value: number) => String(Math.round(value * 100) / 100);

/** A weight as typed: 40 → "40", 42.5 → "42.5", 12.255 → "12.26". */
export function formatKg(value: number): string {
  return trim(value);
}

/** The work per set: "8–10 reps", "10 reps" or "45 s" for a timed movement. */
export function workTarget(exercise: Pick<ProgressExercise, "reps_min" | "reps_max" | "target_duration_seconds">): string {
  if (exercise.target_duration_seconds != null) return `${exercise.target_duration_seconds} s`;
  return exercise.reps_min === exercise.reps_max ? `${exercise.reps_min} reps` : `${exercise.reps_min}–${exercise.reps_max} reps`;
}

/**
 * What the current set asks for, from its own rep target (the middle of the range when the session started) or the
 * movement's seconds. Null when neither is known.
 */
export function setTarget(exercise: Pick<ProgressExercise, "target_duration_seconds">, set: Pick<ProgressSet, "target_reps"> | null): { kind: "reps"; value: number } | { kind: "seconds"; value: number } | null {
  if (exercise.target_duration_seconds != null && exercise.target_duration_seconds > 0) return { kind: "seconds", value: exercise.target_duration_seconds };
  if (set?.target_reps != null && set.target_reps > 0) return { kind: "reps", value: set.target_reps };
  return null;
}

/** A set as the page holds it: its typed weight decides the "60 kg" in "Up next". */
type DescribedSet = ProgressSet & { draftWeight?: string };
type DescribedExercise = Omit<ProgressExercise, "sets"> & { sets: readonly DescribedSet[] };

/**
 * "Up next" in words: { title, detail }, e.g. { "Set 3 of 4", "10 reps · 60 kg" }, { "Bent-over row",
 * "3 sets · 8–12 reps" } or { "Finish the workout", "Every set is done" }. Null when there is nothing to say.
 */
export function describeNextStep(step: NextStep, exercises: readonly DescribedExercise[]): { title: string; detail: string } | null {
  if (step.kind === "none") return null;
  if (step.kind === "finish") return { title: "Finish the workout", detail: "Every set is done" };
  const exercise = exercises[step.exerciseIndex];
  if (!exercise) return null;
  if (step.kind === "exercise") {
    const weight = exercise.target_weight_kg !== null && exercise.target_weight_kg > 0 ? `${formatKg(exercise.target_weight_kg)} kg` : null;
    return { title: exercise.name, detail: [`${step.left} ${step.left === 1 ? "set" : "sets"}`, workTarget(exercise), weight].filter(Boolean).join(" · ") };
  }
  const set = exercise.sets.find((item) => item.id === step.set.id) ?? step.set;
  const target = setTarget(exercise, set);
  // A weight the set could not be saved with (over 2,000 kg, say) is not repeated back as the plan.
  const typed = plausibleWeight((set as DescribedSet).draftWeight);
  const weight = typed !== null ? `${formatKg(typed)} kg` : null;
  const work = target ? (target.kind === "reps" ? `${target.value} ${target.value === 1 ? "rep" : "reps"}` : `${target.value} s`) : workTarget(exercise);
  return { title: `Set ${step.position} of ${step.total}`, detail: [work, weight].filter(Boolean).join(" · ") };
}

// ---------------------------------------------------------------- rest timer

/** How much −/+ changes the rest by, and the longest rest the page counts down (the plan's rest is 15–600 s). */
export const REST_STEP_SECONDS = 15;
export const REST_MAX_SECONDS = 600;

export type RestState = {
  /** When the rest ends (ms since the epoch). */
  endsAt: number;
  /** The rest as set: the planned rest plus any adjustments; what the ring measures against. */
  totalSeconds: number;
};

/** Whole seconds of rest left at `now` (0 when it is over). */
export function restRemaining(rest: Pick<RestState, "endsAt"> | null, now: number): number {
  return rest ? Math.max(0, Math.ceil((rest.endsAt - now) / 1000)) : 0;
}

/** A rest starting at `now`: the exercise's planned rest, clamped to 1–600 s (90 s when unknown). */
export function startRest(plannedSeconds: number | null | undefined, now: number): RestState {
  const planned = Number.isFinite(Number(plannedSeconds)) && Number(plannedSeconds) > 0 ? Math.round(Number(plannedSeconds)) : 90;
  const seconds = Math.min(REST_MAX_SECONDS, Math.max(1, planned));
  return { endsAt: now + seconds * 1000, totalSeconds: seconds };
}

/**
 * The rest after −/+ `deltaSeconds`: the time left moves by that much, never past 600 s; null when it reaches 0 (the
 * rest is over). The total moves with it, so the ring keeps measuring the rest as it now stands.
 */
export function adjustRest(rest: RestState, deltaSeconds: number, now: number): RestState | null {
  const remaining = Math.max(0, (rest.endsAt - now) / 1000);
  const next = Math.min(REST_MAX_SECONDS, remaining + deltaSeconds);
  if (next <= 0) return null;
  const applied = next - remaining;
  return { endsAt: now + next * 1000, totalSeconds: Math.max(Math.ceil(next), Math.round(rest.totalSeconds + applied)) };
}

/** 0..1: how much of the rest is left, for the ring. */
export function restFraction(remainingSeconds: number, totalSeconds: number): number {
  if (!(totalSeconds > 0) || !(remainingSeconds > 0)) return 0;
  return Math.min(1, remainingSeconds / totalSeconds);
}

/** 90 → "1:30", 5 → "0:05", 3725 → "1:02:05". */
export function formatCountdown(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/**
 * Whole seconds a set timer has run at `at`: at least 1, never more than it was set for. Stopping or pausing early
 * records this as the set's seconds.
 */
export function timerSecondsDone(timer: { startedAt: number; seconds: number }, at: number): number {
  return Math.min(Math.max(1, Math.round(timer.seconds)), Math.max(1, Math.round((at - timer.startedAt) / 1000)));
}

/**
 * The live workout's tally line: "4 completed sets · 1,200 kg logged · 0:25 timed". The weight part is left out when
 * no completed set carries a weight (a body-weight workout is never "0 kg"), and the time part when no timed set is
 * logged or `showTimed` is false. Takes session-stats.ts numbers.
 */
export function sessionTally(stats: { completedSets: number; volumeKg: number | null; timedSets: number; timedSeconds: number }, showTimed: boolean, locale?: string): string {
  return [
    `${stats.completedSets.toLocaleString(locale)} completed ${stats.completedSets === 1 ? "set" : "sets"}`,
    stats.volumeKg === null ? null : `${Math.round(stats.volumeKg).toLocaleString(locale)} kg logged`,
    showTimed && stats.timedSets > 0 ? `${formatCountdown(stats.timedSeconds)} timed` : null,
  ].filter(Boolean).join(" · ");
}

/** 90 → "90 s", 120 → "2 min", 150 → "2 min 30 s" (under two minutes reads in seconds, as gym timers do). */
export function formatRest(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  if (whole < 120) return `${whole} s`;
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

/** A number box's value after −/+: within [min, max], on the step's grid where possible ("" counts as 0). */
export function stepValue(current: string, delta: number, options: { min?: number; max: number; decimals?: number }): string {
  const min = options.min ?? 0;
  const base = Number(current);
  const value = Number.isFinite(base) && current.trim() !== "" ? base : 0;
  const step = Math.abs(delta) || 1;
  // A typed 41 steps to 42.5 / 40 rather than 43.5 / 38.5, so plates line up again.
  const snapped = delta > 0 ? Math.floor(value / step + 1e-9) * step + step : Math.ceil(value / step - 1e-9) * step - step;
  const next = Math.min(options.max, Math.max(min, snapped));
  const decimals = options.decimals ?? 2;
  return String(Math.round(next * 10 ** decimals) / 10 ** decimals);
}
