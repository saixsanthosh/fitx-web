/**
 * Programme days planned before the member's equipment list changed can hold exercises the list no longer allows
 * (bug 17: after Dumbbells were removed, the next Push day still had 3 of its 6 exercises needing them, and nothing
 * said so). Each programme day that has not started is checked against the list for its place; an exercise the list
 * does not allow is replaced by the planner's own choice for its slot (generator.ts pickForSlot: the day's slots,
 * the member's level, the day's seed, recent training), keeping the day's order and the sets, reps or time and rest
 * the member had. One nothing on the list can replace is left out and named, as the planner leaves out a slot it
 * cannot fill. A day that would be left with nothing the list allows is not changed: the member is warned instead.
 *
 * What a check may touch depends on how it was asked for (`ReplanMode`), so a member's own choices are never undone
 * behind their back:
 * - "asked": the member pressed "Re-plan this day". Every exercise the list rules out is replaced; one that fills none
 *   of the day's slots (added by hand) is replaced as Swap would choose (substitutions.ts).
 * - "list-saved": a list was just saved. Every day not started is checked. An exercise that fills none of the day's
 *   slots was added by the member, so it stays and is named; the Today card and Details flag it too.
 * - "visit": a page opened (the list may have changed in Profile or on another device). Only days saved before the list
 *   was last saved are checked: a day saved after it (the member's own edit, or a day planned with this list) already
 *   answers to it and is left as it is. Rows added by hand stay, as above.
 *
 * `replanDayRows` is pure; `replanUpcomingProgrammeDays` reads and saves through Supabase; `replanAfterListSaved`
 * also finds the programme, for a page that has not loaded it (the exercise library).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { programmeById } from "@/data/programmes";
import { withOptionalColumns } from "@/lib/domain/schema-fallback";
import type { CatalogExercise } from "./catalog";
import { loadProgrammes } from "./data";
import { loadCurrentEnrolment, type Enrolment } from "./enrolment";
import { expandOwnedEquipment, isDoableWith } from "./equipment";
import { survivingExerciseId } from "./exercise-merges";
import { pickForSlot, type GenerationContext, type SlotSpec } from "./generator";
import type { Programme } from "./programmes";
import { TARGET_COLUMNS, planExerciseSelect, type PlanExerciseInput, type PlanExerciseRow } from "./plans";
import { loadRecentExerciseDays } from "./recent-days";
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
  /** Exercises added by hand that the list does not allow, kept as they are (`keepAddedByHand`). */
  kept: string[];
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
  /**
   * An automatic check: an exercise that fills none of the day's slots was added by the member, so it stays as it is
   * and is named in `kept` instead of being swapped.
   */
  keepAddedByHand?: boolean;
}): DayReplan {
  const byId = new Map(input.catalog.map((exercise) => [exercise.id, exercise]));
  const known = input.rows.map((row) => (row.exercise_id ? byId.get(survivingExerciseId(row.exercise_id)) ?? null : null));
  // An exercise no longer in the catalogue cannot be judged: it stays as it is.
  const unfit = known.map((exercise) => Boolean(exercise && !isDoableWith(exercise.required_equipment, input.owned)));
  if (!unfit.some(Boolean)) return { changed: false, rows: input.rows.map(asInput), replaced: [], dropped: [], kept: [] };

  // Each row's slot: the first slot of the day, in order, that takes its kind of exercise and is not taken yet.
  const slotOf: Array<SlotSpec | null> = [];
  const taken = new Set<number>();
  for (const exercise of known) {
    const index = exercise ? input.slots.findIndex((slot, position) => !taken.has(position) && slotTakes(slot, exercise)) : -1;
    if (index >= 0) taken.add(index);
    slotOf.push(index >= 0 ? input.slots[index] : null);
  }
  // Rows added by hand stay on an automatic check: they keep their place, and nothing picked may repeat them.
  const keep = known.map((exercise, index) => Boolean(input.keepAddedByHand && exercise && unfit[index] && !slotOf[index]));

  const used = new Set(known.flatMap((exercise, index) => (exercise && (!unfit[index] || keep[index]) ? [exercise.id] : [])));
  const ctx: GenerationContext = { catalog: input.catalog, owned: input.owned, level: input.level, seed: input.seed, context: input.context, recentDays: input.recentDays };
  const rows: PlanExerciseInput[] = [];
  const replaced: DayReplan["replaced"] = [];
  const dropped: string[] = [];
  const kept: string[] = [];
  input.rows.forEach((row, index) => {
    const exercise = known[index];
    if (!exercise || !unfit[index]) { rows.push(asInput(row)); return; }
    if (keep[index]) { rows.push(asInput(row)); kept.push(row.exercise_name); return; }
    const slot = slotOf[index];
    const pick = slot
      ? pickForSlot(slot, ctx, used)
      : rankSubstitutes(exercise, input.catalog, { owned: input.owned, level: input.level, exclude: used, limit: 1 })[0]?.exercise ?? null;
    if (!pick) { dropped.push(row.exercise_name); return; }
    used.add(pick.id);
    rows.push(replacementRow(row, pick, slot));
    replaced.push({ from: row.exercise_name, to: pick.name });
  });
  return { changed: replaced.length > 0 || dropped.length > 0, rows, replaced, dropped, kept };
}

/** How a check was asked for: see the top of this file. */
export type ReplanMode = "asked" | "list-saved" | "visit";

/** What the member is told after a check: the days re-planned, those left alone, and what was kept. */
export type ReplanOutcome = {
  replanned: Array<{ planId: string; title: string; replaced: DayReplan["replaced"]; dropped: string[] }>;
  /** Days that would be left with nothing the list allows (nothing replaces what it rules out): kept as they are, and warned about. */
  unfixable: Array<{ planId: string; title: string }>;
  /** Exercises the member added by hand that the list does not allow, left as they are by an automatic check. */
  kept: Array<{ planId: string; title: string; names: string[] }>;
  error: unknown;
};

type PlanRow = { id: string; title: string; split: string; workout_location: string | null; planned_for: string | null; notes: string | null; programme_day_index: number | null };

const NOTHING: ReplanOutcome = { replanned: [], unfixable: [], kept: [], error: null };

/**
 * Checks the programme's days from `todayKey` on that have not started (no finished or running session) against the
 * member's list for the programme's place, and saves each day that changes (fitx_save_workout_plan, one transaction
 * per day; the day keeps its date, title, notes and planner item). `mode` says which days and rows it may change;
 * `onlyPlanId` checks one day (the Today card's "Re-plan this day"). The first save that fails stops the run.
 */
export async function replanUpcomingProgrammeDays(supabase: SupabaseClient, input: {
  userId: string;
  enrolment: Pick<Enrolment, "id" | "context">;
  programme: Programme;
  catalog: readonly CatalogExercise[];
  owned: ReadonlySet<string>;
  level: Level;
  /** The planner's recent training, or a loader for it, called only when there is a day to check. */
  recentDays?: ReadonlyMap<string, number> | (() => Promise<ReadonlyMap<string, number>>);
  todayKey: string;
  includeTargets: boolean;
  mode: ReplanMode;
  /** For "visit": when the list for the programme's place was last saved (user_equipment_profiles.updated_at). */
  listSavedAt?: string | null;
  onlyPlanId?: string;
}): Promise<ReplanOutcome> {
  // A visit with no saved list has nothing newer than the days to check them against.
  if (input.mode === "visit" && !input.listSavedAt) return { ...NOTHING };
  let planQuery = supabase.from("workout_plans").select("id,title,split,workout_location,planned_for,notes,programme_day_index")
    .eq("user_id", input.userId).eq("programme_enrolment_id", input.enrolment.id).gte("planned_for", input.todayKey);
  // workout_plans.updated_at is stamped by every save of a day (fitx_save_workout_plan), the member's edits included.
  if (input.mode === "visit" && input.listSavedAt) planQuery = planQuery.lt("updated_at", input.listSavedAt);
  if (input.onlyPlanId) planQuery = planQuery.eq("id", input.onlyPlanId);
  const plans = await planQuery.order("planned_for", { ascending: true }).limit(60);
  if (plans.error) return { ...NOTHING, error: plans.error };
  const days = (plans.data ?? []) as PlanRow[];
  if (!days.length) return { ...NOTHING };
  const ids = days.map((day) => day.id);
  const [started, exercises] = await Promise.all([
    supabase.from("workout_sessions").select("plan_id").eq("user_id", input.userId).in("status", ["completed", "in_progress"]).in("plan_id", ids),
    withOptionalColumns(TARGET_COLUMNS, (include) =>
      supabase.from("workout_plan_exercises").select(`plan_id,${planExerciseSelect(include)}`).eq("user_id", input.userId).in("plan_id", ids).order("sort_order"),
    { includeOptional: input.includeTargets }),
  ]);
  if (started.error || exercises.result.error) return { ...NOTHING, error: started.error ?? exercises.result.error };
  const begun = new Set(((started.data ?? []) as Array<{ plan_id: string | null }>).flatMap((row) => (row.plan_id ? [row.plan_id] : [])));
  const rowsOf = new Map<string, PlanExerciseRow[]>();
  for (const row of (exercises.result.data ?? []) as unknown as Array<PlanExerciseRow & { plan_id: string }>) rowsOf.set(row.plan_id, [...(rowsOf.get(row.plan_id) ?? []), row]);

  const toCheck = days.filter((day) => day.planned_for && !begun.has(day.id) && day.programme_day_index !== null && input.programme.days[day.programme_day_index]);
  if (!toCheck.length) return { ...NOTHING };
  const recentDays = typeof input.recentDays === "function" ? await input.recentDays() : input.recentDays;
  const outcome: ReplanOutcome = { replanned: [], unfixable: [], kept: [], error: null };
  for (const day of toCheck) {
    const programmeDay = input.programme.days[day.programme_day_index!];
    const plan = replanDayRows({
      rows: rowsOf.get(day.id) ?? [], slots: programmeDay.slots, catalog: input.catalog, owned: input.owned, level: input.level,
      seed: `${input.enrolment.id}:${day.planned_for}`, context: input.enrolment.context, recentDays, keepAddedByHand: input.mode !== "asked",
    });
    if (plan.kept.length) outcome.kept.push({ planId: day.id, title: day.title, names: plan.kept });
    if (!plan.changed) continue;
    // Nothing left that the list allows (every row left out, or only rows the member added that it rules out): the
    // day stays as it was, and the member is told.
    if (plan.rows.length <= plan.kept.length) { outcome.unfixable.push({ planId: day.id, title: day.title }); continue; }
    const saved = await supabase.rpc("fitx_save_workout_plan", {
      p_plan: { id: day.id, title: day.title, split: day.split, workout_location: day.workout_location, planned_for: day.planned_for, notes: day.notes },
      p_exercises: plan.rows,
    });
    if (saved.error) return { ...outcome, error: saved.error };
    outcome.replanned.push({ planId: day.id, title: day.title, replaced: plan.replaced, dropped: plan.dropped });
  }
  return outcome;
}

/**
 * After a list is saved on a page that has not loaded the programme (the exercise library's "Save as my … list"):
 * the programme the member follows, when it is active and for that list's place, checked against the new list as
 * "list-saved". Null when there is nothing to check (no programme, paused, for the other place, no catalogue).
 */
export async function replanAfterListSaved(supabase: SupabaseClient, input: {
  userId: string;
  context: TrainingContext;
  keys: readonly string[];
  catalog: readonly CatalogExercise[];
  level: Level;
  todayKey: string;
}): Promise<ReplanOutcome | null> {
  if (!input.catalog.length) return null;
  const current = await loadCurrentEnrolment(supabase, input.userId);
  if (current.error) return { ...NOTHING, error: current.error };
  const enrolment = current.enrolment;
  if (!enrolment || enrolment.status !== "active" || enrolment.context !== input.context) return null;
  const { programmes } = await loadProgrammes(supabase);
  const programme = programmes.find((item) => item.id === enrolment.programme_id) ?? programmeById(enrolment.programme_id);
  if (!programme) return null;
  return replanUpcomingProgrammeDays(supabase, {
    userId: input.userId, enrolment, programme, catalog: input.catalog, owned: expandOwnedEquipment(input.keys), level: input.level,
    recentDays: () => loadRecentExerciseDays(supabase, input.userId), todayKey: input.todayKey, includeTargets: true, mode: "list-saved",
  });
}

/** The programme's short day name for a message: "Push" from "Push · Push, Pull, Legs". */
function dayName(title: string): string {
  return title.split(" · ")[0] || title;
}

function listOf(items: readonly string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The member's words for an outcome ("" when there is nothing to say): which days changed, what was left out, what
 * could not be changed, and what the member added that the list does not allow. A programme repeats its days, so a
 * day's name is said once.
 */
export function replanMessage(outcome: Pick<ReplanOutcome, "replanned" | "unfixable"> & Partial<Pick<ReplanOutcome, "kept">>, listName: string): string {
  const parts: string[] = [];
  const days = [...new Set(outcome.replanned.map((day) => dayName(day.title)))];
  if (days.length) parts.push(`${days.length === 1 ? `${days[0]} was` : `${listOf(days)} were`} re-planned for your ${listName} list: exercises it doesn’t allow were swapped for ones it does.`);
  const dropped = [...new Set(outcome.replanned.flatMap((day) => day.dropped))];
  if (dropped.length) parts.push(`Nothing on your list replaces ${listOf(dropped)}, so ${dropped.length === 1 ? "it was" : "they were"} left out.`);
  const unfixable = [...new Set(outcome.unfixable.map((day) => dayName(day.title)))];
  if (unfixable.length) parts.push(`Nothing on your list fits ${listOf(unfixable)}. Add equipment, or edit ${unfixable.length === 1 ? "that day" : "those days"}.`);
  const kept = [...new Set((outcome.kept ?? []).flatMap((day) => day.names.map((name) => `${name} on ${dayName(day.title)}`)))];
  if (kept.length) {
    const one = kept.length === 1;
    parts.push(`${listOf(kept)} ${one ? "stays" : "stay"}: you added ${one ? "it" : "them"} yourself, though your list doesn’t allow ${one ? "it" : "them"}.`);
  }
  return parts.join(" ");
}
