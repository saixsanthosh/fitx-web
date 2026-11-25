/**
 * The plan builder's rows. The ordered list of rows is the plan; which library exercises are ticked is
 * read from it, so moving, swapping, ticking and removing can never fall out of step.
 *
 * Type-only imports, so `node --test` can load this file directly.
 */
import type { CatalogExercise } from "@/lib/training/catalog";

export type PlannedExercise = {
  exercise: CatalogExercise;
  sort_order: number;
  target_sets: number;
  reps_min: number;
  reps_max: number;
  rest_seconds: number;
  target_weight_kg: number | null;
  target_duration_seconds: number | null;
};

/** The most exercises one plan can hold. */
export const MAX_PLAN_EXERCISES = 20;

/** A catalogue exercise as a builder row, with its own default prescription. */
export function plannedFrom(exercise: CatalogExercise, sort_order: number): PlannedExercise {
  const timed = exercise.prescription_type === "time";
  return {
    exercise, sort_order, target_sets: exercise.recommended_sets, reps_min: timed ? 1 : exercise.reps_min, reps_max: timed ? 1 : exercise.reps_max,
    rest_seconds: exercise.rest_seconds, target_weight_kg: null, target_duration_seconds: timed ? exercise.default_duration_seconds ?? 30 : null,
  };
}

/** The ids of the exercises in the plan, in its order. */
export function selectedIds(rows: readonly PlannedExercise[]): string[] {
  return rows.map((row) => row.exercise.id);
}

function renumbered(rows: readonly PlannedExercise[]): PlannedExercise[] {
  return rows.map((row, sort_order) => (row.sort_order === sort_order ? row : { ...row, sort_order }));
}

/** Without that exercise's row; the rest keep their order. */
export function removeRow(rows: readonly PlannedExercise[], exerciseId: string): PlannedExercise[] {
  return renumbered(rows.filter((row) => row.exercise.id !== exerciseId));
}

/**
 * Ticking a library exercise adds it at the end with its default prescription; unticking removes its
 * row. Other rows keep their order and edits. Null when the plan is already full.
 */
export function toggleRow(rows: readonly PlannedExercise[], exercise: CatalogExercise): PlannedExercise[] | null {
  if (rows.some((row) => row.exercise.id === exercise.id)) return removeRow(rows, exercise.id);
  if (rows.length >= MAX_PLAN_EXERCISES) return null;
  return [...rows, plannedFrom(exercise, rows.length)];
}

/** The row moved one place earlier (-1) or later (1); unchanged at either end. */
export function moveRow(rows: readonly PlannedExercise[], index: number, direction: -1 | 1): PlannedExercise[] {
  const destination = index + direction;
  if (index < 0 || index >= rows.length || destination < 0 || destination >= rows.length) return [...rows];
  const next = [...rows];
  [next[index], next[destination]] = [next[destination], next[index]];
  return renumbered(next);
}

/**
 * The row at `index` with another movement. The user's sets and rest stay; reps or time follow the new
 * movement when its type differs (a hold for a rep exercise, or the reverse), otherwise they stay too.
 */
export function swapRow(rows: readonly PlannedExercise[], index: number, replacement: CatalogExercise): PlannedExercise[] {
  return rows.map((row, rowIndex) => {
    if (rowIndex !== index) return row;
    const fresh = plannedFrom(replacement, row.sort_order);
    const sameType = (row.exercise.prescription_type === "time") === (replacement.prescription_type === "time");
    return { ...fresh, target_sets: row.target_sets, rest_seconds: row.rest_seconds, ...(sameType ? { reps_min: row.reps_min, reps_max: row.reps_max, target_duration_seconds: row.target_duration_seconds } : {}) };
  });
}

/**
 * Where keyboard focus goes after an action removes the focused control (bug 14): after a swap, the Swap button of
 * the same row (the row is rebuilt for the new movement); after a remove, the Remove button of the row that takes the
 * removed one's place, else of the new last row, else the list's heading when no row is left.
 */
export type BuilderFocus = { row: number; control: "swap" | "remove" } | { heading: true };

export function focusAfterSwap(index: number): BuilderFocus {
  return { row: index, control: "swap" };
}

export function focusAfterRemove(countBefore: number, removedIndex: number): BuilderFocus {
  const left = countBefore - 1;
  if (left <= 0) return { heading: true };
  return { row: Math.max(0, Math.min(removedIndex, left - 1)), control: "remove" };
}

/** What screen readers hear after a swap or a remove (the builder's live region). */
export function swapNotice(from: string, to: string): string {
  return `Swapped ${from} for ${to}.`;
}

export function removeNotice(name: string, left: number): string {
  return `Removed ${name}. ${left === 0 ? "No exercises left." : `${left} ${left === 1 ? "exercise" : "exercises"} left.`}`;
}
