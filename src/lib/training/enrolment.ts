import type { SupabaseClient } from "@supabase/supabase-js";
import { columnList, isMissingRelationshipError, isMissingTableError, withOptionalColumns } from "@/lib/domain/schema-fallback";
import { timedItemDay } from "@/lib/domain/todo";
import type { CatalogExercise } from "./catalog";
import { generateDay, type GeneratedExercise } from "./generator";
import { continuationStart, planningWindow, sessionsLeftToPlan, type PlanningWindow } from "./programme-calendar";
import { scheduleDays, type Programme } from "./programmes";
import { createPlanRecord, PLANNER_DAY_COLUMNS, schedulePlannerEvent, type PlanExerciseInput } from "./plans";
import type { Level, TrainingContext } from "./taxonomy";

type Db = SupabaseClient;

export type Enrolment = {
  id: string;
  programme_id: string;
  context: TrainingContext;
  status: string;
  weekdays: number[];
  preferred_time: string;
  next_day_index: number;
  sessions_completed: number;
  started_on: string;
  last_session_at: string | null;
};

/** A dated plan created for an enrolment. `last_done_key`: local day of its latest finished session. */
export type ProgrammePlan = { id: string; title: string; planned_for: string | null; programme_day_index: number | null; last_done_key: string | null };

const ENROLMENT_COLUMNS = "id,programme_id,context,status,weekdays,preferred_time,next_day_index,sessions_completed,started_on,last_session_at";

/** `available` is false until the programme migrations are applied. */
export async function loadActiveEnrolment(supabase: Db, userId: string): Promise<{ enrolment: Enrolment | null; available: boolean; error: unknown }> {
  const result = await supabase.from("programme_enrolments").select(ENROLMENT_COLUMNS).eq("user_id", userId).eq("status", "active").maybeSingle();
  if (result.error) {
    const missing = isMissingTableError(result.error);
    return { enrolment: null, available: !missing, error: missing ? null : result.error };
  }
  return { enrolment: (result.data as Enrolment | null) ?? null, available: true, error: null };
}

/**
 * The programme the member follows: the active enrolment, else the one they paused most recently. A member has at
 * most one of either through the app (following another needs leaving first); if an older app left both, the
 * active one wins. `available` is false until the programme migrations are applied.
 */
export async function loadCurrentEnrolment(supabase: Db, userId: string): Promise<{ enrolment: Enrolment | null; available: boolean; error: unknown }> {
  const result = await supabase.from("programme_enrolments").select(ENROLMENT_COLUMNS).eq("user_id", userId).in("status", ["active", "paused"])
    .order("status", { ascending: true }).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (result.error) {
    const missing = isMissingTableError(result.error);
    return { enrolment: null, available: !missing, error: missing ? null : result.error };
  }
  return { enrolment: (result.data as Enrolment | null) ?? null, available: true, error: null };
}

function localKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function addDaysToKey(key: string, days: number): string {
  const [year, month, day] = key.split("-").map(Number);
  return localKey(new Date(year, month - 1, day + days));
}

/**
 * The enrolment's plans dated from `fromKey` (to `toKey` when given), oldest first, with each plan's latest finished
 * day. At most `limit` plans (default 40).
 */
export async function loadEnrolmentPlans(supabase: Db, userId: string, enrolmentId: string, fromKey: string, options: { toKey?: string; limit?: number } = {}): Promise<{ plans: ProgrammePlan[]; error: unknown }> {
  const limit = Math.max(1, Math.min(400, Math.round(options.limit ?? 40)));
  const query = (withLastDone: boolean) => {
    let base = supabase.from("workout_plans")
      .select(withLastDone ? "id,title,planned_for,programme_day_index,workout_sessions(started_at)" : "id,title,planned_for,programme_day_index")
      .eq("user_id", userId).eq("programme_enrolment_id", enrolmentId).gte("planned_for", fromKey);
    if (options.toKey) base = base.lte("planned_for", options.toKey);
    return (withLastDone
      ? base.eq("workout_sessions.status", "completed").order("started_at", { referencedTable: "workout_sessions", ascending: false }).limit(1, { referencedTable: "workout_sessions" })
      : base).order("planned_for", { ascending: true }).limit(limit);
  };
  let result = await query(true);
  if (isMissingRelationshipError(result.error)) result = await query(false);
  if (result.error) return { plans: [], error: result.error };
  const rows = (result.data ?? []) as unknown as Array<Omit<ProgrammePlan, "last_done_key"> & { workout_sessions?: Array<{ started_at: string }> }>;
  return {
    plans: rows.map((row) => {
      const done = row.workout_sessions?.[0]?.started_at;
      return { id: row.id, title: row.title, planned_for: row.planned_for, programme_day_index: row.programme_day_index, last_done_key: done ? localKey(new Date(done)) : null };
    }),
    error: null,
  };
}

/**
 * Whether a programme day is done. Each programme day is its own single-date plan, so any finished
 * session of it counts, also one done before its date. (A reusable plan differs: a workout done early
 * leaves that day planned.)
 */
export function programmeDayDone(plan: Pick<ProgrammePlan, "last_done_key">): boolean {
  return Boolean(plan.last_done_key);
}

/** The programme days still to do: dated today or later, and not done. */
export function upcomingProgrammeDays<T extends Pick<ProgrammePlan, "planned_for" | "last_done_key">>(plans: readonly T[], todayKey: string): T[] {
  return plans.filter((plan) => Boolean(plan.planned_for && plan.planned_for >= todayKey) && !programmeDayDone(plan));
}

/**
 * Where the next scheduling run starts: the day after the last plan already scheduled (continuing
 * its programme sequence), or today at the enrolment's next day when nothing is scheduled ahead.
 */
export function nextScheduleStart(existing: readonly ProgrammePlan[], nextDayIndex: number, todayKey: string, dayCount: number): { fromKey: string; startDay: number } {
  return continuationStart(existing, nextDayIndex, todayKey, dayCount);
}

export function toPlanExercises(items: readonly GeneratedExercise[]): PlanExerciseInput[] {
  return items.map((item) => ({
    exercise_id: item.exercise.id, exercise_name: item.exercise.name, target_sets: item.target_sets, reps_min: item.reps_min,
    reps_max: item.reps_max, rest_seconds: item.rest_seconds, target_weight_kg: null, target_duration_seconds: item.target_duration_seconds,
  }));
}

/** A short programme name for plan titles: "Push, Pull, Legs · 3 days" -> "Push, Pull, Legs". */
export function programmeShortTitle(programme: Pick<Programme, "title">) {
  return programme.title.split(" · ")[0];
}

export type ScheduleInput = {
  userId: string;
  enrolment: Pick<Enrolment, "id" | "weekdays" | "preferred_time" | "context">;
  programme: Programme;
  catalog: readonly CatalogExercise[];
  owned: ReadonlySet<string>;
  level: Level;
  recentDays?: ReadonlyMap<string, number>;
  fromKey: string;
  startDay: number;
  horizonDays?: number;
  includeTargets: boolean;
  /** Create at most this many days (the sessions left in a programme with a length). */
  maxDays?: number | null;
  /**
   * Check the enrolment's plans in the range first and leave out dates that already have one (another tab or device
   * planned them meanwhile). The cycle still advances over a date left out, so both runs agree on each day.
   */
  skipPlannedDates?: boolean;
};

/**
 * The dates a run creates: the training weekdays from `fromKey` within the horizon, each with its programme day in
 * order from `startDay`, without the dates in `planned` (the cycle still advances over them), at most `maxDays`.
 */
export function datesToSchedule(input: { fromKey: string; weekdays: readonly number[]; horizonDays: number; startDay: number; dayCount: number; planned?: ReadonlySet<string>; maxDays?: number | null }): Array<{ date: string; dayIndex: number }> {
  const [year, month, day] = input.fromKey.split("-").map(Number);
  const dates = scheduleDays({ from: new Date(year, month - 1, day), weekdays: input.weekdays, horizonDays: input.horizonDays, startDay: input.startDay, dayCount: input.dayCount });
  const open = input.planned ? dates.filter((entry) => !input.planned!.has(entry.date)) : dates;
  return input.maxDays == null ? open : open.slice(0, Math.max(0, input.maxDays));
}

/**
 * Creates dated plans (and planner events) for the programme days that fall on the enrolment's
 * weekdays within the horizon, continuing from `startDay`. Days the user cannot do at all with their
 * equipment are skipped and reported; slots that could not be filled are reported by label.
 */
export async function scheduleProgrammeDays(supabase: Db, input: ScheduleInput): Promise<{ created: number; skippedDays: string[]; unfilledSlots: string[]; error: unknown }> {
  const horizonDays = input.horizonDays ?? 7;
  let planned: Set<string> | undefined;
  if (input.skipPlannedDates) {
    const toKey = addDaysToKey(input.fromKey, horizonDays - 1);
    const existing = await supabase.from("workout_plans").select("planned_for").eq("user_id", input.userId)
      .eq("programme_enrolment_id", input.enrolment.id).gte("planned_for", input.fromKey).lte("planned_for", toKey);
    if (existing.error) return { created: 0, skippedDays: [], unfilledSlots: [], error: existing.error };
    planned = new Set(((existing.data ?? []) as Array<{ planned_for: string | null }>).flatMap((row) => (row.planned_for ? [row.planned_for] : [])));
  }
  const dates = datesToSchedule({ fromKey: input.fromKey, weekdays: input.enrolment.weekdays, horizonDays, startDay: input.startDay, dayCount: input.programme.days.length, planned, maxDays: input.maxDays });
  let created = 0;
  const skippedDays: string[] = [];
  const unfilledSlots = new Set<string>();
  for (const { date, dayIndex } of dates) {
    const programmeDay = input.programme.days[dayIndex];
    const generated = generateDay(programmeDay.slots, {
      catalog: input.catalog, owned: input.owned, level: input.level, seed: `${input.enrolment.id}:${date}`,
      context: input.enrolment.context, recentDays: input.recentDays, sessionMinutes: input.programme.sessionMinutes,
    });
    for (const slot of generated.unfilled) unfilledSlots.add(slot.label ?? "An exercise");
    if (!generated.items.length) { skippedDays.push(programmeDay.title); continue; }
    const title = `${programmeDay.title} · ${programmeShortTitle(input.programme)}`.slice(0, 120);
    const saved = await createPlanRecord(supabase, input.userId, {
      title, split: input.programme.split, workout_location: input.enrolment.context, planned_for: date,
      notes: `${input.programme.title}, day ${dayIndex + 1} of ${input.programme.days.length}`,
      programme_enrolment_id: input.enrolment.id, programme_day_index: dayIndex,
    }, toPlanExercises(generated.items), { includeTargets: input.includeTargets });
    if (saved.error || !saved.planId) return { created, skippedDays, unfilledSlots: [...unfilledSlots], error: saved.error ?? new Error("plan not saved") };
    await schedulePlannerEvent(supabase, input.userId, saved.planId, title, date, input.enrolment.preferred_time.slice(0, 5));
    created++;
  }
  return { created, skippedDays, unfilledSlots: [...unfilledSlots], error: null };
}

export type TopUpInput = Omit<ScheduleInput, "fromKey" | "startDay" | "horizonDays" | "maxDays" | "skipPlannedDates" | "enrolment"> & {
  enrolment: Pick<Enrolment, "id" | "weekdays" | "preferred_time" | "context" | "next_day_index" | "sessions_completed" | "status">;
  /**
   * The enrolment's plans dated today or later, as loaded (loadEnrolmentPlans): a first check only. A run reads them
   * again once it holds the lock and plans from those.
   */
  plans: readonly ProgrammePlan[];
  todayKey: string;
  /** The programme's target sessions (programme-calendar.ts targetSessions); null for an ongoing programme. */
  target: number | null;
  horizonDays?: number;
};

/** The days a top-up would plan now, or null when the next week is already planned (or nothing is left to plan). */
export function topUpWindow(input: Pick<TopUpInput, "enrolment" | "plans" | "todayKey" | "target" | "horizonDays"> & { dayCount: number }): PlanningWindow | null {
  const sessionsLeft = sessionsLeftToPlan({ target: input.target, sessionsCompleted: input.enrolment.sessions_completed, plans: input.plans, todayKey: input.todayKey });
  return planningWindow({ plans: input.plans, enrolment: input.enrolment, todayKey: input.todayKey, dayCount: input.dayCount, horizonDays: input.horizonDays, sessionsLeft });
}

/** Enrolments being topped up in this tab. */
const toppingUp = new Set<string>();

type LockManager = { request: (name: string, options: { ifAvailable: boolean }, callback: (lock: unknown) => Promise<unknown>) => Promise<unknown> };

/** Runs `work` while holding a lock shared by this browser's tabs, or not at all when another tab holds it. */
async function withTabLock<T>(name: string, work: () => Promise<T>): Promise<T | null> {
  const locks = (globalThis as { navigator?: { locks?: LockManager } }).navigator?.locks;
  if (!locks || typeof locks.request !== "function") return work();
  let outcome: T | null = null;
  await locks.request(name, { ifAvailable: true }, async (lock) => { if (lock) outcome = await work(); });
  return outcome;
}

/** Why a top-up planned nothing: the days are planned already (or nothing is left), or a run is under way. */
export type TopUpSkip = "nothing" | "busy";

export type TopUpOutcome = { created: number; skippedDays: string[]; unfilledSlots: string[]; error: unknown; ran: boolean; skipped: TopUpSkip | null };

/**
 * Keeps the next week of a followed programme planned: plans the training days after the last planned one up to a
 * week from today, as "Plan the next 7 days" does, and does nothing when they are planned already, so it can run on
 * every visit. One run at a time per enrolment (in this tab, and across this browser's tabs where the browser
 * supports locks); a run skipped for that says `skipped: "busy"`. Once it holds the lock it reads the enrolment and
 * its plans from today again, so days another tab planned, a session finished since, or a pause or leave meanwhile
 * are taken into account and no day is planned twice or past the programme's length. A paused programme, or one with
 * a length whose sessions are all planned or done, is left alone.
 */
export async function topUpProgrammeDays(supabase: Db, input: TopUpInput): Promise<TopUpOutcome> {
  const idle = (skipped: TopUpSkip): TopUpOutcome => ({ created: 0, skippedDays: [], unfilledSlots: [], error: null, ran: false, skipped });
  const dayCount = input.programme.days.length;
  if (!topUpWindow({ ...input, dayCount })) return idle("nothing");
  if (toppingUp.has(input.enrolment.id)) return idle("busy");
  toppingUp.add(input.enrolment.id);
  try {
    const result = await withTabLock(`fitx-programme-plan-${input.enrolment.id}`, async (): Promise<TopUpOutcome> => {
      const [current, fresh] = await Promise.all([
        supabase.from("programme_enrolments").select("status,next_day_index,sessions_completed").eq("id", input.enrolment.id).eq("user_id", input.userId).maybeSingle(),
        loadEnrolmentPlans(supabase, input.userId, input.enrolment.id, input.todayKey, { limit: 400 }),
      ]);
      const failed = current.error ?? fresh.error;
      if (failed) return { created: 0, skippedDays: [], unfilledSlots: [], error: failed, ran: true, skipped: null };
      if (!current.data) return idle("nothing");
      const enrolment = { ...input.enrolment, ...(current.data as Pick<Enrolment, "status" | "next_day_index" | "sessions_completed">) };
      const window = topUpWindow({ enrolment, plans: fresh.plans, todayKey: input.todayKey, target: input.target, horizonDays: input.horizonDays, dayCount });
      if (!window) return idle("nothing");
      const scheduled = await scheduleProgrammeDays(supabase, {
        ...input, enrolment, fromKey: window.fromKey, startDay: window.startDay, horizonDays: window.horizonDays, maxDays: window.maxDays, skipPlannedDates: true,
      });
      return { ...scheduled, ran: true, skipped: null };
    });
    return result ?? idle("busy");
  } finally {
    toppingUp.delete(input.enrolment.id);
  }
}

/** Starts following a programme from the member's local today. Fails with `alreadyActive` when the user already follows one. */
export async function enrolInProgramme(supabase: Db, input: { userId: string; programme: Programme; context: TrainingContext; weekdays: number[]; time: string; todayKey?: string }): Promise<{ enrolment: Enrolment | null; alreadyActive: boolean; error: unknown }> {
  const result = await supabase.from("programme_enrolments").insert({
    user_id: input.userId, programme_id: input.programme.id, context: input.context, weekdays: [...new Set(input.weekdays)].sort(),
    preferred_time: `${input.time || "18:00"}:00`, next_day_index: 0, status: "active",
    // The member's own day, as every calendar rule reads it; the column's default is the database's (UTC) date.
    started_on: input.todayKey ?? localKey(new Date()),
  }).select(ENROLMENT_COLUMNS).single();
  if (result.error) {
    const code = (result.error as { code?: string }).code;
    return { enrolment: null, alreadyActive: code === "23505", error: result.error };
  }
  return { enrolment: result.data as Enrolment, alreadyActive: false, error: null };
}

type DatedPlan = { id: string; planned_for: string | null };
/** `local_date` is read when the database has it (Planner v2). */
type LinkedItem = { id: string; workout_plan_id: string | null; starts_at: string | null; local_date?: string | null };

/** The programme days a member leaving it drops: those not started (no finished or running session). */
export function programmeDaysToRemove<T extends DatedPlan>(days: readonly T[], startedPlanIds: ReadonlySet<string>): T[] {
  return days.filter((day) => !startedPlanIds.has(day.id));
}

/**
 * The planner items FITX scheduled for these programme days: each day's timed workout item on its own
 * date (the rule plan saves use, see plannerEventsForPlan). To-Do items a member linked to a day, untimed
 * or on another day, are theirs and are not among them. An item's day is its local_date, the day it was
 * scheduled on, so a phone that has since changed time zone still finds the right items.
 */
export function ownProgrammeItems(items: readonly LinkedItem[], days: readonly DatedPlan[]): string[] {
  const dateOf = new Map(days.map((day) => [day.id, day.planned_for]));
  return items.filter((item) => {
    const date = item.workout_plan_id ? dateOf.get(item.workout_plan_id) : undefined;
    return Boolean(date && timedItemDay(item, (iso) => localKey(new Date(iso))) === date);
  }).map((item) => item.id);
}

/**
 * Stops following a programme. Its days from today on that were not started are removed, and the
 * planner items FITX scheduled for them are cancelled; To-Do items the member linked to those days stay
 * in the planner (the plan link is cleared with the plan). Days with a finished or running session, and
 * earlier days, stay, so workouts keep their history.
 */
export async function leaveProgramme(supabase: Db, input: { userId: string; enrolmentId: string; todayKey: string }): Promise<{ error: unknown }> {
  const removed = await removeUpcomingProgrammeDays(supabase, input);
  if (removed.error) return removed;
  const left = await supabase.from("programme_enrolments").update({ status: "left", updated_at: new Date().toISOString() }).eq("id", input.enrolmentId).eq("user_id", input.userId);
  return { error: left.error };
}

/**
 * Pauses a programme: its days from today on that were not started are removed (with the planner items FITX
 * scheduled for them, as leaving does) and the enrolment keeps its place in the cycle, so resuming continues at the
 * day the member is on. Only an active enrolment is paused.
 */
export async function pauseProgramme(supabase: Db, input: { userId: string; enrolmentId: string; todayKey: string }): Promise<{ error: unknown }> {
  const removed = await removeUpcomingProgrammeDays(supabase, input);
  if (removed.error) return removed;
  const paused = await supabase.from("programme_enrolments").update({ status: "paused", updated_at: new Date().toISOString() })
    .eq("id", input.enrolmentId).eq("user_id", input.userId).eq("status", "active");
  return { error: paused.error };
}

/**
 * Resumes a paused programme; the caller then plans its next week. Fails with `alreadyActive` when the member
 * follows another programme now (one active programme per member).
 */
export async function resumeProgramme(supabase: Db, input: { userId: string; enrolmentId: string }): Promise<{ error: unknown; alreadyActive: boolean }> {
  const resumed = await supabase.from("programme_enrolments").update({ status: "active", updated_at: new Date().toISOString() })
    .eq("id", input.enrolmentId).eq("user_id", input.userId).eq("status", "paused");
  const code = (resumed.error as { code?: string } | null)?.code;
  return { error: resumed.error, alreadyActive: code === "23505" };
}

/**
 * Finishes a programme with a length once its sessions are done: like leaving, the days not started from today on
 * are removed, and the enrolment is marked completed.
 */
export async function finishProgramme(supabase: Db, input: { userId: string; enrolmentId: string; todayKey: string }): Promise<{ error: unknown }> {
  const removed = await removeUpcomingProgrammeDays(supabase, input);
  if (removed.error) return removed;
  const finished = await supabase.from("programme_enrolments").update({ status: "completed", updated_at: new Date().toISOString() }).eq("id", input.enrolmentId).eq("user_id", input.userId);
  return { error: finished.error };
}

/**
 * Removes a programme's days from today on that were not started, and cancels the planner items FITX scheduled for
 * them; To-Do items the member linked to those days stay (unlinked). Days with a finished or running session, and
 * earlier days, stay, so workouts keep their history.
 */
export async function removeUpcomingProgrammeDays(supabase: Db, input: { userId: string; enrolmentId: string; todayKey: string }): Promise<{ error: unknown }> {
  const ahead = await supabase.from("workout_plans").select("id,planned_for").eq("user_id", input.userId).eq("programme_enrolment_id", input.enrolmentId).gte("planned_for", input.todayKey);
  if (ahead.error) return { error: ahead.error };
  const days = (ahead.data ?? []) as DatedPlan[];
  if (days.length) {
    const started = await supabase.from("workout_sessions").select("plan_id").eq("user_id", input.userId).in("status", ["completed", "in_progress"]).in("plan_id", days.map((day) => day.id));
    if (started.error) return { error: started.error };
    const removable = programmeDaysToRemove(days, new Set(((started.data ?? []) as Array<{ plan_id: string | null }>).flatMap((row) => (row.plan_id ? [row.plan_id] : []))));
    const ids = removable.map((day) => day.id);
    if (ids.length) {
      // local_date arrives with the planner migration (20261118120000); before it, days come from the start times.
      const linked = await withOptionalColumns(PLANNER_DAY_COLUMNS, (include) =>
        supabase.from("planner_events").select(columnList(["id", "workout_plan_id", "starts_at"], PLANNER_DAY_COLUMNS, include))
          .eq("user_id", input.userId).eq("event_type", "workout").eq("status", "scheduled").in("workout_plan_id", ids));
      if (linked.result.error) return { error: linked.result.error };
      const own = ownProgrammeItems((linked.result.data ?? []) as unknown as LinkedItem[], removable);
      if (own.length) {
        const cancelled = await supabase.from("planner_events").update({ status: "cancelled" }).eq("user_id", input.userId).eq("status", "scheduled").in("id", own);
        if (cancelled.error) return { error: cancelled.error };
      }
      const removed = await supabase.from("workout_plans").delete().eq("user_id", input.userId).in("id", ids);
      if (removed.error) return { error: removed.error };
    }
  }
  return { error: null };
}

/** Moves an enrolment to the day after `dayIndex` when the database function is not there to do it. */
export async function advanceEnrolmentFallback(supabase: Db, input: { userId: string; enrolmentId: string; dayIndex: number; dayCount: number }) {
  const current = await supabase.from("programme_enrolments").select("sessions_completed").eq("id", input.enrolmentId).eq("user_id", input.userId).maybeSingle();
  if (current.error || !current.data) return { error: current.error };
  return supabase.from("programme_enrolments").update({
    next_day_index: input.dayCount > 0 ? (input.dayIndex + 1) % input.dayCount : 0,
    sessions_completed: Number((current.data as { sessions_completed: number }).sessions_completed) + 1,
    last_session_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", input.enrolmentId).eq("user_id", input.userId).eq("status", "active");
}
