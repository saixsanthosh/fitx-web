/**
 * The exercise page's Save button, on the same saved list as the exercise library (exercise-preferences.ts): the
 * account's exercise_favorites when that table exists, else this device (contract C16).
 */
import { loadSavedExercises, setExerciseSaved, type SavedStore } from "@/lib/domain/exercise-preferences";

type Db = Parameters<typeof loadSavedExercises>[0];

export type SavedState = { saved: boolean; store: SavedStore };

/** Whether the member has saved the exercise (a merged duplicate saved earlier counts as its survivor), and where. */
export async function loadSavedState(db: Db, userId: string, exerciseId: string): Promise<SavedState> {
  const list = await loadSavedExercises(db, userId);
  return { saved: list.ids.includes(exerciseId), store: list.store };
}

/** Saves or un-saves the exercise where the list lives, as the library's bookmark does. */
export async function setSavedExercise(db: Db, userId: string, store: SavedStore, exerciseId: string, saved: boolean): Promise<{ error: unknown | null }> {
  return setExerciseSaved(db, userId, store, exerciseId, saved);
}
