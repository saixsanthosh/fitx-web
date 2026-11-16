import type { CatalogExercise } from "./catalog";
import { isDoableWith } from "./equipment";
import { seededUnit } from "./seeded";
import { stapleRank } from "./staples";
import { levelRank, type ExerciseCategory, type Level, type Mechanic, type MuscleGroup, type TrainingContext } from "./taxonomy";

/**
 * One exercise slot in a workout day: what it trains and how it is prescribed. Programmes are
 * lists of days made of slots; the generator fills each slot with the best exercise the user can
 * actually do. A slot is never filled with an off-target movement or a stretch.
 */
export type SlotSpec = {
  /** Muscle group(s) trained; the first is preferred. */
  muscle: MuscleGroup | readonly MuscleGroup[];
  /** Defaults to strength. */
  category?: ExerciseCategory;
  /** Preferred mechanic; compound slots come first in authored days. */
  mechanic?: Mechanic;
  /** Preferred fine muscles, e.g. ["lats"] for a vertical pull or ["middle_back"] for a row. */
  primary?: readonly string[];
  /** Soft name preferences, matched case-insensitively ("incline", "squat"). */
  nameIncludes?: readonly string[];
  /** Soft name avoidances ("decline", "close-grip"). */
  nameExcludes?: readonly string[];
  /** Exercise ids preferred in this order (FITX starter or staple lifts). */
  preferred?: readonly string[];
  sets: number;
  reps: readonly [number, number];
  rest: number;
  /** Work time for holds and other time-prescribed movements. */
  seconds?: number;
  /** Dropped first when the session is short. */
  optional?: boolean;
  label?: string;
};

export type GenerationContext = {
  catalog: readonly CatalogExercise[];
  /** Equipment the user has, already expanded (see expandOwnedEquipment). */
  owned: ReadonlySet<string>;
  level: Level;
  /** Same seed, same picks: use the planned date plus the programme day. */
  seed: string;
  context?: TrainingContext;
  /** Exercise id -> days since the user last did it, for variety. */
  recentDays?: ReadonlyMap<string, number>;
  /** Exercise ids not to use. */
  exclude?: ReadonlySet<string>;
  /** Optional slots are dropped from the end until the day fits. */
  sessionMinutes?: number;
};

export type GeneratedExercise = {
  exercise: CatalogExercise;
  slot: SlotSpec;
  sort_order: number;
  target_sets: number;
  reps_min: number;
  reps_max: number;
  rest_seconds: number;
  target_duration_seconds: number | null;
};

export type GeneratedDay = {
  items: GeneratedExercise[];
  /** Slots nothing in the catalogue could fill with this equipment and level. */
  unfilled: SlotSpec[];
  /** Optional slots left out to fit the session length. */
  dropped: SlotSpec[];
};

const asList = <T,>(value: T | readonly T[]): readonly T[] => (Array.isArray(value) ? value : [value as T]);
const lower = (value: string) => value.toLowerCase();

/** Exercises that can fill the slot at all: right kind, right muscles, doable, not too advanced. */
export function slotCandidates(slot: SlotSpec, ctx: GenerationContext, used: ReadonlySet<string>, levelAllowance = 0): CatalogExercise[] {
  const groups = asList(slot.muscle);
  const category = slot.category ?? "strength";
  const maxLevel = levelRank(ctx.level) + levelAllowance;
  return ctx.catalog.filter((exercise) =>
    exercise.category === category
    && groups.includes(exercise.muscle_group)
    && !used.has(exercise.id)
    && !ctx.exclude?.has(exercise.id)
    && levelRank(exercise.difficulty) <= maxLevel
    && isDoableWith(exercise.required_equipment, ctx.owned));
}

/** Higher is better. Exported for tests and the substitution ranking's tie-breaks. */
export function scoreForSlot(exercise: CatalogExercise, slot: SlotSpec, ctx: GenerationContext): number {
  let score = 0;
  const name = lower(exercise.name);
  const preferredIndex = slot.preferred?.indexOf(exercise.id) ?? -1;
  // A slot's own preference order is authoritative; the staple list only ranks everything else.
  if (preferredIndex >= 0) score += 100 - preferredIndex * 10;
  else {
    const staple = stapleRank(exercise.id);
    if (staple !== null) score += Math.max(4, 30 - staple * 2);
  }
  if (asList(slot.muscle)[0] === exercise.muscle_group) score += 6;
  if (slot.mechanic) score += exercise.mechanic === slot.mechanic ? 20 : -12;
  // FITX starter rows name the group itself ("back"); that says nothing either way.
  if (slot.primary?.length && exercise.primary_muscle !== exercise.muscle_group) score += slot.primary.includes(exercise.primary_muscle) ? 14 : -4;
  if (slot.nameIncludes?.some((word) => name.includes(lower(word)))) score += 12;
  if (slot.nameExcludes?.some((word) => name.includes(lower(word)))) score -= 25;
  if (slot.seconds) score += exercise.prescription_type === "time" ? 10 : -6;
  else if (exercise.prescription_type === "time") score -= 6;
  const gap = levelRank(ctx.level) - levelRank(exercise.difficulty);
  score += gap === 0 ? 4 : gap === 1 ? 2 : gap < 0 ? -15 : 0;
  if (ctx.context === "home") score -= exercise.required_equipment.length * 2;
  const days = ctx.recentDays?.get(exercise.id);
  if (days !== undefined) score -= days <= 2 ? 18 : days <= 6 ? 9 : 0;
  return score + seededUnit(ctx.seed, exercise.id) * 5;
}

/** Rough minutes for a slot: sets x (work + rest), with time for setting up. */
export function slotMinutes(slot: SlotSpec): number {
  const work = slot.seconds ?? ((slot.reps[0] + slot.reps[1]) / 2) * 3.5 + 15;
  return (slot.sets * (work + slot.rest)) / 60;
}

function prescriptionFor(exercise: CatalogExercise, slot: SlotSpec, level: Level) {
  const sets = Math.max(1, Math.min(10, level === "beginner" ? Math.min(slot.sets, 3) : slot.sets));
  // A slot's `seconds` applies to holds; a reps movement picked for the same slot keeps reps.
  if (exercise.prescription_type === "time") {
    const seconds = slot.seconds ?? exercise.default_duration_seconds ?? 30;
    return { target_sets: sets, reps_min: 1, reps_max: 1, rest_seconds: slot.rest, target_duration_seconds: Math.max(5, Math.min(7200, seconds)) };
  }
  const repsMin = Math.max(1, Math.min(100, slot.reps[0]));
  return { target_sets: sets, reps_min: repsMin, reps_max: Math.max(repsMin, Math.min(100, slot.reps[1])), rest_seconds: Math.max(15, Math.min(600, slot.rest)), target_duration_seconds: null };
}

/** Fills each slot, in order, with the best exercise the user can do. */
export function generateDay(slots: readonly SlotSpec[], ctx: GenerationContext): GeneratedDay {
  const dropped: SlotSpec[] = [];
  let kept = [...slots];
  if (ctx.sessionMinutes) {
    const budget = ctx.sessionMinutes;
    const total = () => kept.reduce((sum, slot) => sum + slotMinutes(slot), 0);
    for (let index = kept.length - 1; index >= 0 && total() > budget; index--) {
      if (kept[index].optional) { dropped.unshift(kept[index]); kept = kept.filter((_, position) => position !== index); }
    }
  }
  const used = new Set<string>();
  const items: GeneratedExercise[] = [];
  const unfilled: SlotSpec[] = [];
  for (const slot of kept) {
    let candidates = slotCandidates(slot, ctx, used);
    // A beginner with little equipment may only have intermediate options for a muscle group.
    if (!candidates.length) candidates = slotCandidates(slot, ctx, used, 1);
    if (!candidates.length) { unfilled.push(slot); continue; }
    const best = candidates.reduce((winner, exercise) => scoreForSlot(exercise, slot, ctx) > scoreForSlot(winner, slot, ctx) ? exercise : winner);
    used.add(best.id);
    items.push({ exercise: best, slot, sort_order: items.length, ...prescriptionFor(best, slot, ctx.level) });
  }
  return { items, unfilled, dropped };
}
