// Admin's member view of the Workouts setup answers (experience, where they train, days a week). No imports, so tests
// can load it. Mirrors the app's trainingAnswersKnown (src/lib/domain/user-context.ts): until the member has done the
// Workouts setup, user_preferences holds only the column defaults, which are never shown as the member's own.

/**
 * The Workouts setup answers: null each until the member has done the setup (user_preferences.workout_setup_at, or a
 * saved equipment list, as the app's Profile decides through trainingAnswersKnown), since the stored values are only
 * the column defaults until then. `trainingKnown` null means the setup state could not be read.
 */
export type TrainingAnswers = { trainingKnown: boolean | null; experience: string | null; place: string | null; daysPerWeek: number | null };

/** The setup answers to show: the stored ones once the setup is done, else none (Admin shows "Not set"). */
export function trainingAnswers(row: { fitness_level?: unknown; workout_location?: unknown; workouts_per_week?: unknown; workout_setup_at?: unknown } | null, hasEquipmentList: boolean | null, setupColumn: boolean): TrainingAnswers {
  const known = row && setupColumn ? Boolean(row.workout_setup_at) || hasEquipmentList === true : hasEquipmentList === null ? null : hasEquipmentList;
  if (!known) return { trainingKnown: known, experience: null, place: null, daysPerWeek: null };
  const days = typeof row?.workouts_per_week === "number" && Number.isInteger(row.workouts_per_week) ? row.workouts_per_week : null;
  return {
    trainingKnown: true,
    experience: typeof row?.fitness_level === "string" && row.fitness_level ? row.fitness_level : null,
    place: typeof row?.workout_location === "string" && row.workout_location ? row.workout_location : null,
    daysPerWeek: days,
  };
}
