/**
 * Workout columns that arrive with two migrations which a database may not have
 * yet. The workout pages request them through `withOptionalColumns`
 * (src/lib/domain/schema-fallback.ts), so the builder and the live session keep
 * working, without these fields, until the migrations are applied.
 */

/**
 * `workout_plan_exercises` and `workout_session_exercises`, from
 * supabase/migrations/20261115110000_fitx_workout_prescription_targets.sql.
 */
export const PRESCRIPTION_TARGET_COLUMNS = ["target_weight_kg", "target_duration_seconds"] as const;

/** `workout_sets.duration_seconds`, from the same migration. */
export const SET_DURATION_COLUMNS = ["duration_seconds"] as const;

/** `workout_sessions`, from supabase/migrations/20261115100000_fitx_workout_session_pause_timing.sql. */
export const SESSION_PAUSE_COLUMNS = ["active_duration_seconds", "resumed_at", "paused_at"] as const;
