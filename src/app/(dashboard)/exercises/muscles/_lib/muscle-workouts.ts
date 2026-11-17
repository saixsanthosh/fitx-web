import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingColumnError } from "@/lib/domain/schema-fallback";
import { exerciseRegions, groupForRegion, regionsForGroup, regionsForMuscle, type RegionKey } from "@/lib/training/anatomy";
import type { CatalogExercise } from "@/lib/training/catalog";
import { survivingExerciseId } from "@/lib/training/exercise-merges";
import type { SlotSpec } from "@/lib/training/generator";
import type { Programme } from "@/lib/training/programmes";
import type { MuscleGroup } from "@/lib/training/taxonomy";

/**
 * "Workouts that train it" on Browse by muscle: the member's own saved plans whose exercises work the muscle (from
 * the catalogue's muscle labels), and the FITX programme days with a slot for it. Pure apart from loadSavedPlans.
 */

// ---------------------------------------------------------------- programme days

/**
 * How a programme slot trains a region: "direct" when the slot aims at it (its preferred muscles name the region,
 * or its group has no other region, like chest); "group" when the slot trains the region's group without saying
 * which part (a back slot with no preferred muscle). null when the slot is for another group.
 */
export function slotRole(slot: Pick<SlotSpec, "muscle" | "primary">, region: RegionKey): "direct" | "group" | null {
  const groups: readonly MuscleGroup[] = typeof slot.muscle === "string" ? [slot.muscle] : slot.muscle;
  const group = groupForRegion(region);
  if (!groups.includes(group)) return null;
  if (slot.primary?.length) return slot.primary.some((muscle) => regionsForMuscle(muscle).includes(region)) ? "direct" : null;
  return regionsForGroup(group).length === 1 ? "direct" : "group";
}

export type ProgrammeDayMatch = {
  key: string;
  title: string;
  /** The day's slots for the region, by label ("Main press", "Incline press"). */
  slots: string[];
  /** True when a slot aims at the region itself, not just its group. */
  direct: boolean;
};

export type ProgrammeMatch = { programme: Programme; days: ProgrammeDayMatch[] };

/** Programmes with at least one day that trains the region; days that aim at it first, the authored order kept. */
export function programmesTraining(programmes: readonly Programme[], region: RegionKey): ProgrammeMatch[] {
  const matches: ProgrammeMatch[] = [];
  for (const programme of programmes) {
    const days: ProgrammeDayMatch[] = [];
    for (const day of programme.days) {
      const slots = day.slots.flatMap((slot) => {
        const role = slotRole(slot, region);
        return role ? [{ role, label: slot.label?.trim() || day.title }] : [];
      });
      if (!slots.length) continue;
      days.push({ key: day.key, title: day.title, slots: [...new Set(slots.map((slot) => slot.label))], direct: slots.some((slot) => slot.role === "direct") });
    }
    if (days.length) matches.push({ programme, days });
  }
  const order = new Map(programmes.map((programme, index) => [programme.id, index]));
  const direct = (match: ProgrammeMatch) => (match.days.some((day) => day.direct) ? 0 : 1);
  return matches.sort((a, b) => direct(a) - direct(b) || (order.get(a.programme.id) ?? 0) - (order.get(b.programme.id) ?? 0));
}

// ---------------------------------------------------------------- the member's saved plans

export type SavedPlan = { id: string; title: string; status: string; planned_for: string | null };
export type SavedPlanExercise = { plan_id: string; exercise_id: string | null; exercise_name: string };

export type PlanMatch = {
  plan: SavedPlan;
  /** Exercises in the plan with the region as their main muscle (names, in plan order). */
  primary: string[];
  /** Exercises that work it as an assisting muscle. */
  assisting: string[];
};

type MuscleFields = Pick<CatalogExercise, "name" | "primary_muscle" | "secondary_muscles">;

/** Upcoming plans first (soonest first), then undated ones, then past ones (latest first). */
function planOrder(todayKey: string) {
  const rank = (plan: SavedPlan) => (plan.planned_for === null ? 1 : plan.planned_for >= todayKey ? 0 : 2);
  return (a: PlanMatch, b: PlanMatch) => {
    const byRank = rank(a.plan) - rank(b.plan);
    if (byRank) return byRank;
    const dateA = a.plan.planned_for ?? "";
    const dateB = b.plan.planned_for ?? "";
    if (dateA !== dateB) return rank(a.plan) === 0 ? dateA.localeCompare(dateB) : dateB.localeCompare(dateA);
    return a.plan.title.localeCompare(b.plan.title) || a.plan.id.localeCompare(b.plan.id);
  };
}

/**
 * The member's plans that work the region, read from the catalogue's muscles of each planned exercise (a merged
 * duplicate reads as its survivor; a free-text exercise or one no longer in the catalogue is not counted).
 */
export function plansTraining(
  plans: readonly SavedPlan[],
  exercises: readonly SavedPlanExercise[],
  catalogById: ReadonlyMap<string, MuscleFields>,
  region: RegionKey,
  todayKey: string,
): PlanMatch[] {
  const byPlan = new Map<string, SavedPlanExercise[]>();
  for (const exercise of exercises) {
    const list = byPlan.get(exercise.plan_id) ?? [];
    list.push(exercise);
    byPlan.set(exercise.plan_id, list);
  }
  const matches: PlanMatch[] = [];
  for (const plan of plans) {
    const primary: string[] = [];
    const assisting: string[] = [];
    for (const item of byPlan.get(plan.id) ?? []) {
      const library = item.exercise_id ? catalogById.get(survivingExerciseId(item.exercise_id)) : undefined;
      if (!library) continue;
      const regions = exerciseRegions(library.primary_muscle, library.secondary_muscles);
      const name = item.exercise_name?.trim() || library.name;
      if (regions.primary.includes(region)) { if (!primary.includes(name)) primary.push(name); }
      else if (regions.secondary.includes(region) && !assisting.includes(name)) assisting.push(name);
    }
    if (primary.length || assisting.length) matches.push({ plan, primary, assisting });
  }
  const byDate = planOrder(todayKey);
  return matches.sort((a, b) => Number(b.primary.length > 0) - Number(a.primary.length > 0) || byDate(a, b));
}

type Db = Pick<SupabaseClient, "from">;

/** Plans read at most, and plan ids per request for their exercises. */
export const SAVED_PLAN_LIMIT = 100;
const PLAN_CHUNK = 50;
/** Draft and scheduled plans, as the Workouts page lists them. */
const LISTED_STATUSES = ["draft", "scheduled"];

/**
 * The member's own draft and scheduled plans (newest first, at most SAVED_PLAN_LIMIT) and their exercises. Plans a
 * programme made are left out where the database records that (`programme_enrolment_id`); on databases without the
 * column every listed plan is read.
 */
export async function loadSavedPlans(db: Db, userId: string): Promise<{ error: unknown | null; plans: SavedPlan[]; exercises: SavedPlanExercise[] }> {
  const run = (ownOnly: boolean) => {
    const query = db.from("workout_plans").select("id,title,status,planned_for").eq("user_id", userId).in("status", LISTED_STATUSES);
    return (ownOnly ? query.is("programme_enrolment_id", null) : query).order("created_at", { ascending: false }).limit(SAVED_PLAN_LIMIT);
  };
  let result = await run(true);
  if (result.error && isMissingColumnError(result.error, ["programme_enrolment_id"])) result = await run(false);
  if (result.error) return { error: result.error, plans: [], exercises: [] };
  const plans = ((result.data ?? []) as SavedPlan[]).map((plan) => ({ id: plan.id, title: plan.title, status: plan.status, planned_for: plan.planned_for ?? null }));
  const exercises: SavedPlanExercise[] = [];
  for (let index = 0; index < plans.length; index += PLAN_CHUNK) {
    const ids = plans.slice(index, index + PLAN_CHUNK).map((plan) => plan.id);
    const rows = await db.from("workout_plan_exercises").select("plan_id,exercise_id,exercise_name").eq("user_id", userId).in("plan_id", ids).order("sort_order").limit(1000);
    if (rows.error) return { error: rows.error, plans: [], exercises: [] };
    exercises.push(...((rows.data ?? []) as SavedPlanExercise[]));
  }
  return { error: null, plans, exercises };
}
