/**
 * Recorded walks, runs and rides for Home, Progress and Goals: only the summary numbers (no routes). A database
 * without the activity tables reports `available: false`, so screens say activities are unavailable instead of
 * showing zeros.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays } from "@/lib/domain/day-keys";
import { DataError, isMissingTableError } from "./missing-schema";
import { pagedRows, startOfDayIso, toNumber } from "./rows";

type Db = Pick<SupabaseClient, "from">;

export type ActivityRow = { id: string; sport: string; startedAt: string; distanceM: number; movingSeconds: number };
export type ActivitiesResult = {
  /** False when this database has no activities table yet. */
  available: boolean;
  activities: ActivityRow[];
  /** True when more rows existed than were read. */
  capped: boolean;
};

type Row = { id?: unknown; sport?: unknown; started_at?: unknown; distance_m?: unknown; moving_seconds?: unknown };

/** Activities that started on the member's days from `fromKey` to `toKey` (inclusive), oldest first. */
export async function loadActivitiesBetween(db: Db, userId: string, fromKey: string, toKey: string): Promise<ActivitiesResult> {
  const result = await pagedRows<Row>((from, to) => db.from("activities")
    .select("id,sport,started_at,distance_m,moving_seconds")
    .eq("user_id", userId)
    .gte("started_at", startOfDayIso(fromKey))
    .lt("started_at", startOfDayIso(addDays(toKey, 1)))
    .order("started_at", { ascending: true })
    .order("id", { ascending: true })
    .range(from, to), { maxPages: 5 });
  if (result.error) {
    if (isMissingTableError(result.error)) return { available: false, activities: [], capped: false };
    throw new DataError("Your activities could not be loaded.", result.error);
  }
  return {
    available: true,
    capped: result.capped,
    activities: result.rows.flatMap((row) => {
      const startedAt = typeof row.started_at === "string" ? row.started_at : null;
      if (!startedAt || typeof row.id !== "string") return [];
      return [{
        id: row.id,
        sport: typeof row.sport === "string" ? row.sport : "",
        startedAt,
        distanceM: Math.max(0, toNumber(row.distance_m) ?? 0),
        movingSeconds: Math.max(0, toNumber(row.moving_seconds) ?? 0),
      }];
    }),
  };
}
