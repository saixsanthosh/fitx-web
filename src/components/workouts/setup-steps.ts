/** The Workouts setup's steps for a training location: where, then each equipment list it needs, then the rest. */
import { contextsFor, type WorkoutLocation } from "@/lib/training/setup";

export type SetupStep = "where" | "home" | "gym" | "you";

export function setupSteps(location: WorkoutLocation): SetupStep[] {
  return ["where", ...contextsFor(location), "you"];
}

/**
 * Whether a move between steps takes away the button that was pressed (D5): Back from the second step reaches the
 * first, which has no Back, so focus needs a new home (the step's title). Next and Save setup are one button that
 * stays, and Back stays on every later step.
 */
export function stepMoveRemovesButton(index: number, delta: 1 | -1): boolean {
  return delta < 0 && index === 1;
}

/** localStorage key for "Later" on this device, per member: the inline setup then waits for the member to open it. */
export function setupLaterKey(userId: string): string {
  return `fitx:workouts:v1:setup-later:${userId}`;
}
