/**
 * The exercise page's Save button, on the same saved list as the exercise library (exercise-preferences.ts,
 * kept on this device). One place to change if saved exercises move to the account (contract C16).
 */
import { readExerciseFavorites, toggleExerciseFavorite } from "@/lib/domain/exercise-preferences";
import { storedIdsFor, survivingExerciseIds } from "@/lib/training/exercise-merges";

/** Whether the member has saved the exercise (a merged duplicate saved earlier counts as its survivor). */
export function isExerciseSaved(userId: string, exerciseId: string): boolean {
  return survivingExerciseIds(readExerciseFavorites(userId)).includes(exerciseId);
}

/** Saves or un-saves the exercise, as the library's bookmark does; returns whether it is saved now. */
export function toggleSavedExercise(userId: string, exerciseId: string): boolean {
  // Un-saving removes every stored id that reads as this exercise, a merged duplicate's included.
  const stored = storedIdsFor(readExerciseFavorites(userId), exerciseId);
  let next: string[] = [];
  if (stored.length) for (const storedId of stored) next = toggleExerciseFavorite(userId, storedId);
  else next = toggleExerciseFavorite(userId, exerciseId);
  return survivingExerciseIds(next).includes(exerciseId);
}
