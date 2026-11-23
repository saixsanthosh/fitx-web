/**
 * Home and Gym: the two modes of Workouts and the Exercise library (brief 3.4, phases 7 and 12). Both pages show
 * a tablist with the tabs "Home" and "Gym". The chosen mode is in the address (Workouts `?mode=`, the library
 * `?context=`) and remembered on this device, so switching on one page carries over to the other. Without either,
 * the member's training location decides (home: Home; gym or both: Gym).
 */
import type { TrainingContext } from "./taxonomy";

export type WorkoutMode = TrainingContext;
export const WORKOUT_MODES: readonly WorkoutMode[] = ["home", "gym"];
export const MODE_LABELS: Readonly<Record<WorkoutMode, string>> = { home: "Home", gym: "Gym" };
export const MODE_STORAGE_KEY = "fitx:workouts:v1:mode";

export function parseMode(value: unknown): WorkoutMode | null {
  return value === "home" || value === "gym" ? value : null;
}

/** The mode to open on: the address, else the one remembered on this device, else the training location. */
export function initialMode(input: { requested?: unknown; stored?: unknown; location?: unknown }): WorkoutMode {
  return parseMode(input.requested) ?? parseMode(input.stored) ?? (input.location === "home" || input.location === "outdoor" ? "home" : "gym");
}

/** The remembered mode, or null when browser storage is unavailable or holds nothing valid. */
export function readStoredMode(): WorkoutMode | null {
  try {
    return parseMode(window.localStorage.getItem(MODE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeStoredMode(mode: WorkoutMode) {
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // Browser storage may be unavailable; the mode still switches for this page.
  }
}

/** The tab after `mode` for an arrow key (two tabs: either arrow moves to the other), or null for other keys. */
export function modeForKey(key: string, mode: WorkoutMode): WorkoutMode | null {
  if (key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown") return mode === "home" ? "gym" : "home";
  if (key === "Home") return "home";
  if (key === "End") return "gym";
  return null;
}

/** +1 when moving towards Gym, -1 towards Home: the direction the panels slide. */
export function modeDirection(from: WorkoutMode, to: WorkoutMode): 1 | -1 | 0 {
  if (from === to) return 0;
  return to === "gym" ? 1 : -1;
}
