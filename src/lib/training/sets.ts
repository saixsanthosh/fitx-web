/**
 * Rules for logged sets, shared by the plan start, the live workout and the exercise history.
 *
 * A session exercise with a target in seconds is a timed movement (a hold, a stretch, cardio, a carry):
 * the live workout asks for its seconds, so its sets start without a rep target and never count as
 * lifts. Only lifts add to volume, estimated maxes and personal records; a timed set counts for its time.
 * The database functions apply the same rule (20261118130050_fitx_workout_rpcs.sql).
 */

type Prescription = { reps_min: number; reps_max: number; target_duration_seconds?: number | null };
type LoggedSet = { reps: number | null; duration_seconds?: number | null };

/** True for a timed movement: one with a target in seconds. */
export function isTimedPrescription(exercise: Pick<Prescription, "target_duration_seconds">): boolean {
  return exercise.target_duration_seconds != null;
}

/** The rep target a new set starts with: the middle of the range, or none for a timed movement. */
export function setTargetReps(exercise: Prescription): number | null {
  return isTimedPrescription(exercise) ? null : Math.round((exercise.reps_min + exercise.reps_max) / 2);
}

/** What the reps field shows before anything is logged: the set's rep target, never one for a timed movement. */
export function draftRepsFor(set: { reps: number | null; target_reps: number | null }, timed: boolean): string {
  if (set.reps != null) return String(set.reps);
  return timed || !set.target_reps ? "" : String(set.target_reps);
}

/** A logged set that counts as a lift: reps done, no seconds logged, not part of a timed movement. */
export function isLiftSet(set: LoggedSet, timed = false): boolean {
  return !timed && Number(set.reps) > 0 && !(Number(set.duration_seconds) > 0);
}

/** Kilograms lifted (weight × reps) over the sets that count as lifts. */
export function liftedVolume(sets: ReadonlyArray<LoggedSet & { weight_kg: number }>, timed = false): number {
  return sets.reduce((sum, set) => (isLiftSet(set, timed) ? sum + Number(set.reps) * Number(set.weight_kg) : sum), 0);
}

/**
 * A movement's reps and time after a swap: kept when the new movement is the same type, otherwise the
 * new movement's own (its rep range, or 1–1 and its default seconds when it is timed, as the builder
 * adds it), so a hold swapped for push-ups never asks for 1 rep, nor push-ups swapped for a hold for 10.
 */
export function swappedPrescription(
  current: Prescription,
  replacement: { prescription_type: string; reps_min: number; reps_max: number; default_duration_seconds: number | null },
): { reps_min: number; reps_max: number; target_duration_seconds: number | null } {
  const timed = replacement.prescription_type === "time";
  if (timed === isTimedPrescription(current)) return { reps_min: current.reps_min, reps_max: current.reps_max, target_duration_seconds: current.target_duration_seconds ?? null };
  return timed
    ? { reps_min: 1, reps_max: 1, target_duration_seconds: replacement.default_duration_seconds ?? 30 }
    : { reps_min: replacement.reps_min, reps_max: replacement.reps_max, target_duration_seconds: null };
}
