/**
 * Workout and planner columns that arrive with migrations which a database may
 * not have yet. The workout pages request them through `withOptionalColumns`
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

/**
 * `planner_events.local_date`, the item's calendar day, from
 * supabase/migrations/20261118120000_fitx_planner_todo_store.sql. Without it the database works the
 * day out from `starts_at` and the saved time zone.
 */
export const PLANNER_DAY_COLUMNS = ["local_date"] as const;

/**
 * `workout_sessions.planner_event_id`, the planner item a session was started from, from the same
 * migration.
 */
export const SESSION_PLANNER_COLUMNS = ["planner_event_id"] as const;

/**
 * `workout_sets.rep_source` ("manual" or "camera"), from
 * supabase/migrations/20261118170008_fitx_workout_sets_rep_source.sql.
 */
export const SET_REP_SOURCE_COLUMNS = ["rep_source"] as const;
