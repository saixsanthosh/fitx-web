/**
 * The data behind Home's "Today's plan" (src/lib/domain/today-plan.ts decides what to show):
 *  - a workout in progress (any day: it can be resumed);
 *  - today's planned workouts: workout items in the planner, and the programme's day when one is planned for
 *    today, with each plan's exercises (count and main muscles) for the preview;
 *  - the programme the member follows: whether today is one of its training weekdays and the next programme day;
 *  - the next workout planned in the coming week.
 * Databases without the programme tables simply have no programme. Nothing here is guessed: a plan's muscles
 * come from its exercises' catalogue labels, and a projected programme day is marked as projected.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { programmeById } from "@/data/programmes";
import { addDays } from "@/lib/domain/day-keys";
import { isMissingColumnError, isMissingTableError } from "@/lib/domain/schema-fallback";
import { programmeDayTitle, programmeNext, trainsOn, type NextWorkout, type PlanWorkout, type ProgrammeToday, type TodayPlanInput } from "@/lib/domain/today-plan";
import type { TodoItem } from "@/lib/domain/todo";
import { BODY_REGIONS, exerciseRegions, type RegionKey } from "@/lib/training/anatomy";
import { survivingExerciseId } from "@/lib/training/exercise-merges";
import { loadLibraryMuscles } from "@/lib/training/muscle-history";
import { DataError } from "./missing-schema";
import { loadTodos } from "./todo";

type Db = SupabaseClient;

export type TodayPlanData = Pick<TodayPlanInput, "inProgress" | "workouts" | "programme" | "nextPlanned">;

type EnrolmentRow = { id: string; programme_id: string; weekdays: number[] | null; next_day_index: number | null };
type ProgrammePlanRow = { id: string; title: string; planned_for: string | null; programme_enrolment_id: string | null; programme_day_index: number | null };
type PlanExerciseRow = { plan_id: string; exercise_id: string | null };

/** "Push, Pull, Legs · 3 days" → "Push, Pull, Legs". */
const shortTitle = (title: string) => title.split(" · ")[0];

async function loadEnrolment(db: Db, userId: string): Promise<EnrolmentRow | null> {
  const result = await db.from("programme_enrolments").select("id,programme_id,weekdays,next_day_index").eq("user_id", userId).eq("status", "active").limit(1);
  if (result.error) {
    if (isMissingTableError(result.error) || isMissingColumnError(result.error)) return null;
    throw new DataError("Your programme could not be loaded.", result.error);
  }
  return ((result.data ?? []) as EnrolmentRow[])[0] ?? null;
}

async function loadProgrammePlans(db: Db, userId: string, today: string): Promise<ProgrammePlanRow[]> {
  const result = await db.from("workout_plans")
    .select("id,title,planned_for,programme_enrolment_id,programme_day_index")
    .eq("user_id", userId).not("programme_enrolment_id", "is", null)
    .gte("planned_for", today).lte("planned_for", addDays(today, 13))
    .order("planned_for", { ascending: true }).limit(40);
  if (result.error) {
    if (isMissingColumnError(result.error) || isMissingTableError(result.error)) return [];
    throw new DataError("Your programme days could not be loaded.", result.error);
  }
  return (result.data ?? []) as ProgrammePlanRow[];
}

/** Exercise counts and main muscles per plan; empty when they cannot be read (the preview then shows less). */
async function loadPlanMuscles(db: Db, userId: string, planIds: readonly string[]): Promise<Map<string, { exercises: number; regions: RegionKey[]; secondary: RegionKey[] }>> {
  const plans = new Map<string, { exercises: number; regions: RegionKey[]; secondary: RegionKey[] }>();
  if (!planIds.length) return plans;
  const result = await db.from("workout_plan_exercises").select("plan_id,exercise_id").eq("user_id", userId).in("plan_id", [...planIds]).limit(500);
  if (result.error) return plans;
  const rows = (result.data ?? []) as PlanExerciseRow[];
  const library = await loadLibraryMuscles(db, rows.map((row) => row.exercise_id)).catch((error: unknown) => ({ error, rows: new Map() }));
  const order = new Map(BODY_REGIONS.map((region, index) => [region, index]));
  for (const planId of planIds) {
    const own = rows.filter((row) => row.plan_id === planId);
    if (!own.length) continue;
    const primary = new Map<RegionKey, number>();
    const secondary = new Set<RegionKey>();
    for (const row of own) {
      const entry = row.exercise_id && !library.error ? library.rows.get(survivingExerciseId(row.exercise_id)) : undefined;
      if (!entry) continue;
      const regions = exerciseRegions(entry.primary_muscle, entry.secondary_muscles);
      for (const region of regions.primary) primary.set(region, (primary.get(region) ?? 0) + 1);
      for (const region of regions.secondary) secondary.add(region);
    }
    const ranked = [...primary.entries()].sort((a, b) => b[1] - a[1] || (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0)).map(([region]) => region);
    plans.set(planId, { exercises: own.length, regions: ranked, secondary: BODY_REGIONS.filter((region) => secondary.has(region) && !primary.has(region)) });
  }
  return plans;
}

/** Plans among `planIds` with a finished session (a programme day done, also one done before its date). */
async function loadFinishedPlans(db: Db, userId: string, planIds: readonly string[]): Promise<Set<string>> {
  if (!planIds.length) return new Set();
  const result = await db.from("workout_sessions").select("plan_id").eq("user_id", userId).eq("status", "completed").in("plan_id", [...planIds]).limit(200);
  if (result.error) return new Set();
  return new Set(((result.data ?? []) as Array<{ plan_id: string | null }>).flatMap((row) => (row.plan_id ? [row.plan_id] : [])));
}

export async function loadTodayPlanData(db: Db, userId: string, today: string): Promise<TodayPlanData> {
  const [running, enrolment, programmePlans, planner] = await Promise.all([
    db.from("workout_sessions").select("id,name,started_at,plan_id").eq("user_id", userId).eq("status", "in_progress").order("started_at", { ascending: false }).limit(1),
    loadEnrolment(db, userId),
    loadProgrammePlans(db, userId, today),
    loadTodos(db, userId, today, addDays(today, 7)).then((result) => result.items),
  ]);
  if (running.error) throw new DataError("Your workouts could not be loaded.", running.error);
  const session = ((running.data ?? []) as Array<{ id: string; name: string; started_at: string; plan_id: string | null }>)[0] ?? null;

  const programme = enrolment ? programmeById(enrolment.programme_id) ?? null : null;
  const ownPlans = enrolment ? programmePlans.filter((plan) => plan.programme_enrolment_id === enrolment.id) : [];
  const programmePlanIds = new Set(ownPlans.map((plan) => plan.id));
  const dayTitle = (plan: ProgrammePlanRow) => (plan.programme_day_index !== null && programme?.days[plan.programme_day_index]?.title) || programmeDayTitle(plan.title);
  const programmeName = enrolment ? (programme ? shortTitle(programme.title) : "your programme") : null;

  const workoutItems = planner.filter((item: TodoItem) => item.kind === "workout" && item.status !== "cancelled");
  const todayItems = workoutItems.filter((item) => item.localDate === today);
  const todayProgramme = ownPlans.filter((plan) => plan.planned_for === today);
  const todayPlanIds = [...new Set([...todayItems.flatMap((item) => (item.workoutPlanId ? [item.workoutPlanId] : [])), ...todayProgramme.map((plan) => plan.id)])];

  const [muscles, finished] = await Promise.all([
    loadPlanMuscles(db, userId, todayPlanIds).catch(() => new Map()),
    loadFinishedPlans(db, userId, todayPlanIds.filter((id) => programmePlanIds.has(id))).catch(() => new Set<string>()),
  ]);

  const describe = (planId: string | null) => {
    const found = planId ? muscles.get(planId) : undefined;
    return { exercises: found?.exercises ?? null, regions: found?.regions ?? [], secondary: found?.secondary ?? [] };
  };
  const workouts: PlanWorkout[] = todayItems.map((item) => {
    const plan = item.workoutPlanId ? ownPlans.find((entry) => entry.id === item.workoutPlanId) : undefined;
    return {
      planId: item.workoutPlanId,
      eventId: item.id,
      title: plan ? dayTitle(plan) : item.title,
      startsAt: item.startsAt,
      done: item.status === "completed" || Boolean(item.workoutPlanId && finished.has(item.workoutPlanId)),
      programme: plan ? programmeName : null,
      ...describe(item.workoutPlanId),
    };
  });
  for (const plan of todayProgramme) {
    if (workouts.some((workout) => workout.planId === plan.id)) continue;
    workouts.push({ planId: plan.id, eventId: null, title: dayTitle(plan), startsAt: null, done: finished.has(plan.id), programme: programmeName, ...describe(plan.id) });
  }

  let programmeToday: ProgrammeToday | null = null;
  if (enrolment) {
    const weekdays = Array.isArray(enrolment.weekdays) ? enrolment.weekdays.map(Number).filter((day) => day >= 0 && day <= 6) : [];
    const days = programme?.days ?? [];
    const nextIndex = days.length ? (((enrolment.next_day_index ?? 0) % days.length) + days.length) % days.length : null;
    programmeToday = {
      title: programmeName ?? "your programme",
      trainsToday: trainsOn(weekdays, today),
      next: programmeNext({
        today,
        weekdays,
        planned: ownPlans.filter((plan) => plan.planned_for && plan.planned_for > today).map((plan) => ({ date: plan.planned_for!, title: dayTitle(plan) })),
        nextDayTitle: nextIndex === null ? null : days[nextIndex]?.title ?? null,
      }),
    };
  }

  const upcoming = workoutItems
    .filter((item) => item.localDate > today && item.status === "scheduled" && !(item.workoutPlanId && programmePlanIds.has(item.workoutPlanId)))
    .sort((a, b) => a.localDate.localeCompare(b.localDate) || (a.startsAt ?? "").localeCompare(b.startsAt ?? ""))[0];
  const nextPlanned: NextWorkout | null = upcoming ? { date: upcoming.localDate, title: upcoming.title, projected: false } : null;

  return {
    inProgress: session ? { id: session.id, name: session.name, startedAt: session.started_at, planId: session.plan_id } : null,
    workouts,
    programme: programmeToday,
    nextPlanned,
  };
}
