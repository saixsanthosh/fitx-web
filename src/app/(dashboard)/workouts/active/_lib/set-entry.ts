/**
 * A set's boxes, checked before the set is saved: each number within the database's limits (workout_sets: weight
 * 0–2,000 kg, reps 0–500, seconds 0–86,400), and a ticked set with work in it. A problem names the box at fault, so
 * the page marks that box and says what is wrong with it: an over-limit weight is about the weight, never about reps
 * (bug 48). Pure, so `node --test` loads it directly.
 */

/** The live page's number boxes (components/session/types.ts DraftField). */
export type SetField = "draftWeight" | "draftReps" | "draftDuration";

/** The database's ranges for a logged set. */
export const SET_LIMITS = { weightKg: 2000, reps: 500, seconds: 86400 } as const;

export type SetEntryValues = { weight: number; reps: number; duration: number };

export type SetEntryProblem = { field: SetField; message: string };

/** The numbers in a set's boxes; an empty box is 0. Seconds count only where the database can store them. */
export function readSetEntry(draft: { draftWeight: string; draftReps: string; draftDuration: string }, timedSupported: boolean): SetEntryValues {
  return {
    weight: Number(draft.draftWeight.trim() || 0),
    reps: Number(draft.draftReps.trim() || 0),
    duration: timedSupported ? Number(draft.draftDuration.trim() || 0) : 0,
  };
}

/**
 * What stops a set from being saved, box by box (weight, then reps, then seconds), then, when it is being ticked, a
 * set with nothing done: seconds for a timed movement (`timed`), reps otherwise. Null when the set can be saved.
 */
export function setEntryProblem(values: SetEntryValues, options: { complete: boolean; timed: boolean }): SetEntryProblem | null {
  const { weight, reps, duration } = values;
  if (!Number.isFinite(weight)) return { field: "draftWeight", message: "Enter the weight as a number of kilograms, such as 40 or 42.5." };
  if (weight < 0) return { field: "draftWeight", message: "The weight can’t be below 0 kg." };
  if (weight > SET_LIMITS.weightKg) return { field: "draftWeight", message: "The weight must be 2,000 kg or less." };
  if (!Number.isFinite(reps) || !Number.isInteger(reps)) return { field: "draftReps", message: "Enter reps as a whole number, such as 8." };
  if (reps < 0) return { field: "draftReps", message: "Reps can’t be below 0." };
  if (reps > SET_LIMITS.reps) return { field: "draftReps", message: "Reps must be 500 or fewer." };
  if (!Number.isFinite(duration) || !Number.isInteger(duration)) return { field: "draftDuration", message: "Enter the time as whole seconds, such as 45." };
  if (duration < 0) return { field: "draftDuration", message: "The time can’t be below 0 seconds." };
  if (duration > SET_LIMITS.seconds) return { field: "draftDuration", message: "The time must be 86,400 seconds (24 hours) or less." };
  if (!options.complete) return null;
  if (options.timed && duration === 0) return { field: "draftDuration", message: "Enter the seconds you did before logging this set." };
  if (!options.timed && reps === 0 && duration === 0) return { field: "draftReps", message: "Enter your reps before completing this set." };
  return null;
}

/** A typed weight the page may repeat back (for example in "Up next"): only one the set could be saved with. */
export function plausibleWeight(typed: string | undefined): number | null {
  const value = Number(typed);
  return typed !== undefined && typed.trim() !== "" && Number.isFinite(value) && value > 0 && value <= SET_LIMITS.weightKg ? value : null;
}

/** The id of a set's number box, so a problem can mark it and move focus to it. */
export function setInputId(setId: string, field: SetField): string {
  return `set-${setId}-${field === "draftWeight" ? "weight" : field === "draftReps" ? "reps" : "seconds"}`;
}

/** The id of a set's problem message, which its boxes and Complete button point to (aria-describedby). */
export function setProblemId(setId: string): string {
  return `set-${setId}-problem`;
}
