/**
 * Programme days planned before the member's equipment list changed can hold exercises the list no longer allows
 * (bug 17: after Dumbbells were removed, the next Push day still had 3 of its 6 exercises needing them, and nothing
 * said so). Each programme day that has not started is checked against the list for its place; an exercise the list
 * does not allow is replaced by the planner's own choice for its slot (generator.ts pickForSlot: the day's slots,
 * the member's level, the day's seed, recent training), keeping the day's order and the sets, reps or time and rest
 * the member had. An exercise that fills none of the day's slots (one added by hand) is replaced as Swap would
 * choose (substitutions.ts). One nothing on the list can replace is left out and named, as the planner leaves out a
 * slot it cannot fill. A day that would be left empty is not changed: the caller warns instead.
 *
 * `replanDayRows` is pure; `replanUpcomingProgrammeDays` reads and saves through Supabase.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogExercise } from "./catalog";
import { isDoableWith } from "./equipment";
import { survivingExerciseId } from "./exercise-merges";
import { pickForSlot, type GenerationContext, type SlotSpec } from "./generator";
import type { Programme } from "./programmes";
import { planExerciseSelect, type PlanExerciseInput, type PlanExerciseRow } from "./plans";
import { rankSubstitutes } from "./substitutions";
import type { Level, TrainingContext } from "./taxonomy";

export type DayReplan = {
  /** True when an exercise was replaced or left out. */
  changed: boolean;
  /** The day's exercises after the check, in order (unchanged rows as they were). */
  rows: PlanExerciseInput[];
  replaced: Array<{ from: string; to: string }>;
  /** Exercises nothing on the list could replace, left out of the day. */
  dropped: string[];
};

const asList = <T,>(value: T | readonly T[]): readonly T[] => (Array.isArray(value) ? value : [value as T]);

/** Whether an exercise is the kind a slot asks for, whatever the equipment (category, muscle group, fine muscle). */
export function slotTakes(slot: SlotSpec, exercise: Pick<CatalogExercise, "category" | "muscle_group" | "primary_muscle">): boolean {
  return exercise.category === (slot.category ?? "strength")
    && asList(slot.muscle).includes(exercise.muscle_group)
    && (!slot.primaryOnly || !slot.primary?.length || slot.primary.includes(exercise.primary_muscle));
}

function asInput(row: PlanExerciseRow): PlanExerciseInput {
  return {
    exercise_id: row.exercise_id, exercise_name: row.exercise_name, target_sets: row.target_sets, reps_min: row.reps_min, reps_max: row.reps_max,
    rest_seconds: row.rest_seconds, target_weight_kg: row.target_weight_kg ?? null, target_duration_seconds: row.target_duration_seconds ?? null,
  };
}

/**
 * A row for the replacement: the member's sets and rest stay; reps or time stay when the new movement is of the same
 * kind (both timed, or both by reps), else they follow the slot or the movement's defaults. A target weight belonged
 * to the old movement, so it is cleared.
 */
function replacementRow(row: PlanExerciseRow, replacement: CatalogExercise, slot: SlotSpec | null): PlanExerciseInput {
  const wasTimed = row.target_duration_seconds != null;
  const isTimed = replacement.prescription_type === "time";
  const base = { exercise_id: replacement.id, exercise_name: replacement.name, target_sets: row.target_sets, rest_seconds: row.rest_seconds, target_weight_kg: null };
  if (wasTimed === isTimed) return { ...base, reps_min: row.reps_min, reps_max: row.reps_max, target_duration_seconds: row.target_duration_seconds ?? null };
  if (isTimed) return { ...base, reps_min: 1, reps_max: 1, target_duration_seconds: Math.max(5, Math.min(7200, slot?.seconds ?? replacement.default_duration_seconds ?? 30)) };
  const reps = slot?.reps ?? [replacement.reps_min, replacement.reps_max];
  const repsMin = Math.max(1, Math.min(100, reps[0]));
  return { ...base, reps_min: repsMin, reps_max: Math.max(repsMin, Math.min(100, reps[1])), target_duration_seconds: null };
}

export function replanDayRows(input: {
  rows: readonly PlanExerciseRow[];
  /** The programme day's slots (programme.days[programme_day_index].slots). */
  slots: readonly SlotSpec[];
  catalog: readonly CatalogExercise[];
  /** The member's equipment for the day's place, expanded (expandOwnedEquipment). */
  owned: ReadonlySet<string>;
  level: Level;
  /** The planner's seed for the day: `${enrolmentId}:${date}`. */
  seed: string;
  context: TrainingContext;
  recentDays?: ReadonlyMap<string, number>;
}): DayReplan {
  const byId = new Map(input.catalog.map((exercise) => [exercise.id, exercise]));
  const known = input.rows.map((row) => (row.exercise_id ? byId.get(survivingExerciseId(row.exercise_id)) ?? null : null));
  // An exercise no longer in the catalogue cannot be judged: it stays as it is.
  const unfit = known.map((exercise) => Boolean(exercise && !isDoableWith(exercise.required_equipment, input.owned)));
  if (!unfit.some(Boolean)) return { changed: false, rows: input.rows.map(asInput), replaced: [], dropped: [] };

  // Each row's slot: the first slot of the day, in order, that takes its kind of exercise and is not taken yet.
  const slotOf: Array<SlotSpec | null> = [];
  const taken = new Set<number>();
  for (const exercise of known) {
    const index = exercise ? input.slots.findIndex((slot, position) => !taken.has(position) && slotTakes(slot, exercise)) : -1;
    if (index >= 0) taken.add(index);
    slotOf.push(index >= 0 ? input.slots[index] : null);
  }

  const used = new Set(known.flatMap((exercise, index) => (exercise && !unfit[index] ? [exercise.id] : [])));
  const ctx: GenerationContext = { catalog: input.catalog, owned: input.owned, level: input.level, seed: input.seed, context: input.context, recentDays: input.recentDays };
  const rows: PlanExerciseInput[] = [];
  const replaced: DayReplan["replaced"] = [];
  const dropped: string[] = [];
  input.rows.forEach((row, index) => {
    const exercise = known[index];
    if (!exercise || !unfit[index]) { rows.push(asInput(row)); return; }
    const slot = slotOf[index];
    const pick = slot
      ? pickForSlot(slot, ctx, used)
      : rankSubstitutes(exercise, input.catalog, { owned: input.owned, level: input.level, exclude: used, limit: 1 })[0]?.exercise ?? null;
    if (!pick) { dropped.push(row.exercise_name); return; }
    used.add(pick.id);
    rows.push(replacementRow(row, pick, slot));
    replaced.push({ from: row.exercise_name, to: pick.name });
  });
  return { changed: true, rows, replaced, dropped };
}

/** What the member is told after a check: the days re-planned, and those left alone because nothing would be left. */
export type ReplanOutcome = {
  replanned: Array<{ planId: string; title: string; replaced: DayReplan["replaced"]; dropped: string[] }>;
  /** Days every exercise of which the list rules out, with nothing to replace them: kept as they are, and warned about. */
  unfixable: Array<{ planId: string; title: string }>;
  error: unknown;
};

type PlanRow = { id: string; title: string; split: string; workout_location: string | null; planned_for: string | null; notes: string | null; programme_day_index: number | null };

/**
 * Checks the programme's days from `todayKey` on that have not started (no finished or running session) against the
 * member's list for the programme's place, and saves each day that changes (fitx_save_workout_plan, one transaction
 * per day; the day keeps its date, title and planner item). `onlyPlanId` checks one day (the card's "Re-plan").
 */
export async function replanUpcomingProgrammeDays(supabase: SupabaseClient, input: {
  userId: string;
  enrolment: { id: string; context: TrainingContext };
  programme: Programme;
  catalog: readonly CatalogExercise[];
  owned: ReadonlySet<string>;
  level: Level;
  recentDays?: ReadonlyMap<string, number>;
  todayKey: string;
  includeTargets: boolean;
  onlyPlanId?: string;
}): Promise<ReplanOutcome> {
  const empty: ReplanOutcome = { replanned: [], unfixable: [], error: null };
  let planQuery = supabase.from("workout_plans").select("id,title,split,workout_location,planned_for,notes,programme_day_index")
    .eq("user_id", input.userId).eq("programme_enrolment_id", input.enrolment.id).gte("planned_for", input.todayKey);
  if (input.onlyPlanId) planQuery = planQuery.eq("id", input.onlyPlanId);
  const plans = await planQuery.order("planned_for", { ascending: true }).limit(60);
  if (plans.error) return { ...empty, error: plans.error };
  const days = (plans.data ?? []) as PlanRow[];
  if (!days.length) return empty;
  const ids = days.map((day) => day.id);
  const [started, exercises] = await Promise.all([
    supabase.from("workout_sessions").select("plan_id").eq("user_id", input.userId).in("status", ["completed", "in_progress"]).in("plan_id", ids),
    supabase.from("workout_plan_exercises").select(`plan_id,${planExerciseSelect(input.includeTargets)}`).eq("user_id", input.userId).in("plan_id", ids).order("sort_order"),
  ]);
  if (started.error || exercises.error) return { ...empty, error: started.error ?? exercises.error };
  const begun = new Set(((started.data ?? []) as Array<{ plan_id: string | null }>).flatMap((row) => (row.plan_id ? [row.plan_id] : [])));
  const rowsOf = new Map<string, PlanExerciseRow[]>();
  for (const row of (exercises.data ?? []) as unknown as Array<PlanExerciseRow & { plan_id: string }>) rowsOf.set(row.plan_id, [...(rowsOf.get(row.plan_id) ?? []), row]);

  const outcome: ReplanOutcome = { replanned: [], unfixable: [], error: null };
  for (const day of days) {
    const programmeDay = day.programme_day_index !== null ? input.programme.days[day.programme_day_index] : undefined;
    if (!programmeDay || !day.planned_for || begun.has(day.id)) continue;
    const plan = replanDayRows({
      rows: rowsOf.get(day.id) ?? [], slots: programmeDay.slots, catalog: input.catalog, owned: input.owned, level: input.level,
      seed: `${input.enrolment.id}:${day.planned_for}`, context: input.enrolment.context, recentDays: input.recentDays,
    });
    if (!plan.changed) continue;
    if (!plan.rows.length) { outcome.unfixable.push({ planId: day.id, title: day.title }); continue; }
    const saved = await supabase.rpc("fitx_save_workout_plan", {
      p_plan: { id: day.id, title: day.title, split: day.split, workout_location: day.workout_location, planned_for: day.planned_for, notes: day.notes },
      p_exercises: plan.rows,
    });
    if (saved.error) return { ...outcome, error: saved.error };
    outcome.replanned.push({ planId: day.id, title: day.title, replaced: plan.replaced, dropped: plan.dropped });
  }
  return outcome;
}

/** The programme's short day name for a message: "Push" from "Push · Push, Pull, Legs". */
function dayName(title: string): string {
  return title.split(" · ")[0] || title;
}

function listOf(items: readonly string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The member's words for an outcome ("" when nothing changed): which days changed, what was left out, what was not. */
export function replanMessage(outcome: Pick<ReplanOutcome, "replanned" | "unfixable">, listName: string): string {
  const parts: string[] = [];
  const days = outcome.replanned.map((day) => dayName(day.title));
  if (days.length) parts.push(`${days.length === 1 ? `${days[0]} was` : `${listOf(days)} were`} re-planned for your ${listName} list: exercises it no longer allows were swapped for ones it does.`);
  const dropped = [...new Set(outcome.replanned.flatMap((day) => day.dropped))];
  if (dropped.length) parts.push(`Nothing on your list replaces ${listOf(dropped)}, so ${dropped.length === 1 ? "it was" : "they were"} left out.`);
  const unfixable = outcome.unfixable.map((day) => dayName(day.title));
  if (unfixable.length) parts.push(`Nothing on your list fits ${listOf(unfixable)}. Add equipment, or edit ${unfixable.length === 1 ? "that day" : "those days"}.`);
  return parts.join(" ");
}
