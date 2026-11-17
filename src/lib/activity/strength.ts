import type { DbResult, SupabaseLike } from "./repository";
import { isMissingTableError, isNetworkError } from "./repository";

/*
 * Completed strength sessions (public.workout_sessions, owner-only RLS) for the Activity timeline.
 * Read only: sessions are recorded on the Workouts screens. Only status 'completed' counts;
 * abandoned sessions stay out, as everywhere else in FITX. The training time is the session's own
 * duration_seconds (time spent training, pauses left out); the volume is what the session saved
 * (weight × reps of lifts only), shown only when there is some.
 */

export type StrengthSession = {
  id: string;
  name: string;
  startedAt: number;
  completedAt: number | null;
  /** Active training time, pauses excluded (workout_sessions.duration_seconds). */
  trainingSeconds: number;
  /** Logged volume in kg (weight × reps, lifts only); null when none was logged. */
  volumeKg: number | null;
};

type Row = Record<string, unknown>;
const num = (value: unknown): number | null => {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

export function sessionFromRow(row: Row): StrengthSession | null {
  const id = typeof row.id === "string" ? row.id : "";
  const startedAt = Date.parse(typeof row.started_at === "string" ? row.started_at : "");
  if (!id || !Number.isFinite(startedAt)) return null;
  const completed = Date.parse(typeof row.completed_at === "string" ? row.completed_at : "");
  const volume = num(row.total_volume);
  return {
    id,
    name: typeof row.name === "string" && row.name.trim() ? row.name.trim() : "Strength session",
    startedAt,
    completedAt: Number.isFinite(completed) ? completed : null,
    trainingSeconds: Math.max(0, num(row.duration_seconds) ?? 0),
    volumeKg: volume !== null && volume > 0 ? volume : null,
  };
}

const COLUMNS = "id,name,started_at,completed_at,duration_seconds,total_volume";

type Query = PromiseLike<{ data: unknown; error: unknown }> & Record<string, (...args: unknown[]) => Query>;

/** Completed sessions, newest first; `before` pages to older ones, `since` limits to a period. */
export async function listStrengthSessions(client: SupabaseLike, userId: string, options: { limit?: number; before?: number | null; since?: number | null } = {}): Promise<DbResult<StrengthSession[]>> {
  try {
    let query = (client.from("workout_sessions") as unknown as Query).select(COLUMNS).eq("user_id", userId).eq("status", "completed").order("started_at", { ascending: false }).limit(options.limit ?? 20);
    if (options.before) query = query.lt("started_at", new Date(options.before).toISOString());
    if (options.since) query = query.gte("started_at", new Date(options.since).toISOString());
    const result = await query;
    if (result.error) {
      if (isMissingTableError(result.error)) return { status: "unavailable" };
      const message = typeof (result.error as { message?: unknown }).message === "string" ? (result.error as { message: string }).message : "Request failed";
      return { status: "error", message, offline: isNetworkError(result.error) };
    }
    const rows = Array.isArray(result.data) ? (result.data as Row[]) : [];
    return { status: "ok", data: rows.map(sessionFromRow).filter((session): session is StrengthSession => session !== null) };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Request failed", offline: isNetworkError(error) };
  }
}

/** Sessions and training time in a period. */
export function strengthTotals(sessions: readonly StrengthSession[], start: number, end: number): { count: number; trainingSeconds: number } {
  let count = 0;
  let trainingSeconds = 0;
  for (const session of sessions) {
    if (session.startedAt < start || session.startedAt >= end) continue;
    count++;
    trainingSeconds += session.trainingSeconds;
  }
  return { count, trainingSeconds };
}
