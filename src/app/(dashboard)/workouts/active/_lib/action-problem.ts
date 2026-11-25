/**
 * Why an action on the live workout did not work, shown beside the control that was used (bug 11): the clock's Pause
 * or Resume, the paused banner's Resume, Swap, Add set, a set's Complete button (with the box at fault), or Finish and
 * Abandon. Swap and Add set are about one exercise, as a set's problem is about one set, so each names it: the page
 * shows it only while that exercise is on screen, and moving to another exercise (its chip, Previous or Next) clears
 * it, so it never sits under the next exercise's buttons (review round, workouts-r3). Pure.
 */
import type { DraftField } from "@/components/session/types";

export type ActionProblem =
  | { at: "clock" | "banner" | "finish"; message: string }
  | { at: "swap" | "add-set"; exerciseId: string; message: string }
  | { at: "set"; setId: string; field: DraftField | null; message: string };

/** The Swap or Add set message for the exercise on screen, or null (none, another place, or another exercise's). */
export function exerciseProblem(problem: ActionProblem | null, place: "swap" | "add-set", exerciseId: string | null | undefined): string | null {
  return problem && problem.at === place && exerciseId && problem.exerciseId === exerciseId ? problem.message : null;
}

/**
 * The problem left once the member moves to another exercise: Swap's and Add set's were about the exercise left, so
 * they go; a set's stays with its set (and its box), and the clock's, the banner's and Finish's are not about one.
 */
export function problemAfterExerciseChange(problem: ActionProblem | null): ActionProblem | null {
  return problem && (problem.at === "swap" || problem.at === "add-set") ? null : problem;
}
