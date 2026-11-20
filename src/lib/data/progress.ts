/**
 * The Progress page's data: 12 weeks of completed workouts (with their sets and catalogue muscles), recorded
 * activities and logged food for the trends, the muscles card and "Focus next"; exact all-time workout totals;
 * and the newest workouts for the history list.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, mondayOf } from "@/lib/domain/day-keys";
import type { MealTotals } from "@/lib/domain/meal-totals";
import type { TrendActivity } from "@/lib/domain/trends";
import { loadMuscleHistory, type LoggedSession } from "@/lib/training/muscle-history";
import { loadActivitiesBetween } from "./activities";
import { loadFoodDays } from "./meals";
import { DataError } from "./missing-schema";
import { pagedRows, toNumber } from "./rows";

type Db = SupabaseClient;

export const TREND_WEEKS = 12;

export type TrendRows = {
  /** Completed sessions with sets, newest first, from the first trend week on. */
  sessions: LoggedSession[];
  /** True when the workouts were cut at the loader's limit. */
  sessionsCapped: boolean;
  /** Null when activities are not available on this database or could not be read (see activitiesState). */
  activities: TrendActivity[] | null;
  activitiesState: "ok" | "unavailable" | "error";
  activitiesCapped: boolean;
  foodDays: Map<string, MealTotals>;
  /** True when the food log could not be read: food numbers are then unknown, not empty. */
  foodError: boolean;
  foodCapped: boolean;
  /** The first day covered (a Monday). */
  from: string;
};

function startOf(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** The rows behind the trends, from the Monday `weeks - 1` weeks before this one to today. */
export async function loadTrendRows(db: Db, userId: string, today: string, weeks = TREND_WEEKS): Promise<TrendRows> {
  const from = addDays(mondayOf(today), -7 * (Math.max(1, weeks) - 1));
  const [history, activities, food] = await Promise.all([
    loadMuscleHistory(db, userId, { since: startOf(from), maxSessions: 600 }),
    loadActivitiesBetween(db, userId, from, today).catch(() => null),
    loadFoodDays(db, userId, from, today).catch(() => null),
  ]);
  if (history.error) throw new DataError("Your workouts could not be loaded.", history.error);
  return {
    sessions: history.sessions,
    sessionsCapped: history.truncated,
    activities: activities?.available ? activities.activities.map(({ startedAt, distanceM, movingSeconds }) => ({ startedAt, distanceM, movingSeconds })) : null,
    activitiesState: activities === null ? "error" : activities.available ? "ok" : "unavailable",
    activitiesCapped: activities?.capped ?? false,
    foodDays: food?.days ?? new Map(),
    foodError: food === null,
    foodCapped: food?.capped ?? false,
    from,
  };
}

export type AllTimeTotals = {
  /** Completed workouts, counted exactly by the database. */
  workouts: number;
  /** Kilograms lifted (each workout's recorded volume: weight × reps of its lift sets); null when none had any. */
  volumeKg: number | null;
  /** Average training time (pauses excluded) of workouts that recorded one; null when none did. */
  averageTrainingSeconds: number | null;
  /** Workouts the volume and average were worked out from. */
  measured: number;
  /** True when there were more workouts than were read for the volume and average. */
  capped: boolean;
};

const TOTAL_PAGES = 5;
export const TOTAL_PAGE_SIZE = 1000;

export async function loadAllTimeTotals(db: Db, userId: string): Promise<AllTimeTotals> {
  const [count, rows] = await Promise.all([
    db.from("workout_sessions").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "completed"),
    pagedRows<{ total_volume: unknown; duration_seconds: unknown }>((from, to) => db.from("workout_sessions")
      .select("total_volume,duration_seconds").eq("user_id", userId).eq("status", "completed")
      .order("started_at", { ascending: false }).order("id", { ascending: true }).range(from, to), { pageSize: TOTAL_PAGE_SIZE, maxPages: TOTAL_PAGES }),
  ]);
  if (count.error) throw new DataError("Your workout totals could not be loaded.", count.error);
  if (rows.error) throw new DataError("Your workout totals could not be loaded.", rows.error);
  let volume = 0;
  let weighted = 0;
  let seconds = 0;
  let timed = 0;
  for (const row of rows.rows) {
    const kg = toNumber(row.total_volume);
    if (kg !== null && kg > 0) { volume += kg; weighted += 1; }
    const duration = toNumber(row.duration_seconds);
    if (duration !== null && duration > 0) { seconds += duration; timed += 1; }
  }
  return {
    workouts: typeof count.count === "number" ? count.count : rows.rows.length,
    volumeKg: weighted ? Math.round(volume) : null,
    averageTrainingSeconds: timed ? Math.round(seconds / timed) : null,
    measured: rows.rows.length,
    capped: rows.capped,
  };
}

export type RecentWorkout = { id: string; name: string; startedAt: string; trainingSeconds: number | null; volumeKg: number | null };

/** The newest completed workouts, for the list that links to each workout's record. */
export async function loadRecentWorkouts(db: Db, userId: string, limit = 8): Promise<RecentWorkout[]> {
  const result = await db.from("workout_sessions").select("id,name,started_at,duration_seconds,total_volume")
    .eq("user_id", userId).eq("status", "completed").order("started_at", { ascending: false }).limit(limit);
  if (result.error) throw new DataError("Your recent workouts could not be loaded.", result.error);
  return ((result.data ?? []) as Array<{ id: string; name: string; started_at: string; duration_seconds: unknown; total_volume: unknown }>).map((row) => {
    const seconds = toNumber(row.duration_seconds);
    const kg = toNumber(row.total_volume);
    return { id: row.id, name: row.name, startedAt: row.started_at, trainingSeconds: seconds !== null && seconds > 0 ? seconds : null, volumeKg: kg !== null && kg > 0 ? kg : null };
  });
}

// ─── Pure summaries for the page (no database) ────────────────────────────────────────────────────

/** How regularly the member trained: finished weeks with at least one workout, against their weekly plan. */
export type Consistency = {
  /** Finished Monday-to-Sunday weeks counted (this week, still running, is left out). */
  weeks: number;
  /** Of those, weeks with at least one finished workout. */
  trainedWeeks: number;
  /** Weeks that reached the member's own workouts-a-week plan; null without a plan. */
  planWeeks: number | null;
  /** The plan from setup (2 to 7 a week), or null when not set. */
  plan: number | null;
  /** Finished workouts in the counted weeks. */
  workouts: number;
};

export function trainingConsistency(weeks: ReadonlyArray<{ workouts: number; inProgress: boolean }>, plan: number | null): Consistency {
  const finished = weeks.filter((week) => !week.inProgress);
  const validPlan = plan !== null && Number.isInteger(plan) && plan >= 1 && plan <= 7 ? plan : null;
  return {
    weeks: finished.length,
    trainedWeeks: finished.filter((week) => week.workouts > 0).length,
    planWeeks: validPlan === null ? null : finished.filter((week) => week.workouts >= validPlan).length,
    plan: validPlan,
    workouts: finished.reduce((sum, week) => sum + week.workouts, 0),
  };
}

export type BodyMetricRow = { id: string; date: string; weight: number | null; body_fat: number | null; measurements: Record<string, number> | null };

export type WeightSummary = {
  /** Weigh-ins in the range, oldest first. */
  points: Array<{ date: string; kg: number }>;
  latest: { date: string; kg: number } | null;
  /** Latest minus the first weigh-in in the range; null with fewer than two. */
  changeKg: number | null;
};

const daysBefore = (today: string, key: string) => (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${key}T12:00:00Z`)) / 86_400_000;

/**
 * Weigh-ins over the last `rangeDays` days (0: all of them). On a day with two weigh-ins the later one counts,
 * as Profile and Home take it. Rows arrive newest first.
 */
export function weightSummary(rows: readonly BodyMetricRow[], today: string, rangeDays: number): WeightSummary {
  const byDay = new Map<string, number>();
  for (const row of rows) {
    const kg = row.weight === null || row.weight === undefined ? null : Number(row.weight);
    if (kg === null || !Number.isFinite(kg) || kg <= 0 || byDay.has(row.date)) continue;
    if (rangeDays > 0 && daysBefore(today, row.date) > rangeDays) continue;
    byDay.set(row.date, kg);
  }
  const points = [...byDay.entries()].map(([date, kg]) => ({ date, kg })).sort((a, b) => a.date.localeCompare(b.date));
  const latest = points.at(-1) ?? null;
  return { points, latest, changeKg: points.length >= 2 ? Math.round((points.at(-1)!.kg - points[0].kg) * 10) / 10 : null };
}

export type MeasurementLine = { name: string; latest: number; date: string; changeCm: number | null; unit: "cm" | "%" };

/** The newest value of each tape measurement (and body fat) ever logged, with the change since its first one. */
export function latestMeasurements(rows: readonly BodyMetricRow[]): MeasurementLine[] {
  const series = new Map<string, Array<{ date: string; value: number }>>();
  const add = (name: string, date: string, value: unknown) => {
    const number = Number(value);
    if (value === null || value === undefined || !Number.isFinite(number) || number <= 0) return;
    const list = series.get(name) ?? [];
    list.push({ date, value: number });
    series.set(name, list);
  };
  for (const row of rows) {
    add("body_fat", row.date, row.body_fat);
    for (const [name, value] of Object.entries(row.measurements ?? {})) add(name, row.date, value);
  }
  return [...series.entries()].map(([name, list]) => {
    // Rows arrive newest first: the first entry is the latest, the last the oldest.
    const latest = list[0];
    const oldest = list.at(-1)!;
    return { name, latest: latest.value, date: latest.date, changeCm: list.length > 1 ? Math.round((latest.value - oldest.value) * 10) / 10 : null, unit: name === "body_fat" ? "%" : "cm" } as MeasurementLine;
  }).sort((a, b) => (a.name === "body_fat" ? -1 : b.name === "body_fat" ? 1 : a.name.localeCompare(b.name)));
}
