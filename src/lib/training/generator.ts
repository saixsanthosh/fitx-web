import { programmeById } from "@/data/programmes";
import type { CatalogExercise } from "./catalog";
import { isDoableWith } from "./equipment";
import { focusRole, normaliseFocusAreas, type FocusArea } from "./focus";
import { hashString, seededUnit } from "./seeded";
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
  /** Only exercises whose primary muscle is in `primary` fill the slot (otherwise `primary` is a preference). */
  primaryOnly?: boolean;
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
    && (!slot.primaryOnly || !slot.primary?.length || slot.primary.includes(exercise.primary_muscle))
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

/**
 * The exercise generateDay puts in a slot: the best-scoring candidate at the user's level, else one level up
 * (a beginner with little equipment may only have intermediate options for a muscle group); null when
 * nothing fits. `used` holds the ids already in the workout.
 */
export function pickForSlot(slot: SlotSpec, ctx: GenerationContext, used: ReadonlySet<string>): CatalogExercise | null {
  let candidates = slotCandidates(slot, ctx, used);
  if (!candidates.length) candidates = slotCandidates(slot, ctx, used, 1);
  if (!candidates.length) return null;
  return candidates.reduce((winner, exercise) => scoreForSlot(exercise, slot, ctx) > scoreForSlot(winner, slot, ctx) ? exercise : winner);
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
    const best = pickForSlot(slot, ctx, used);
    if (!best) { unfilled.push(slot); continue; }
    used.add(best.id);
    items.push({ exercise: best, slot, sort_order: items.length, ...prescriptionFor(best, slot, ctx.level) });
  }
  return { items, unfilled, dropped };
}

// ---------------------------------------------------------------- focus workouts

/*
 * A workout built from the focus areas a member picked (focus.ts) and the equipment they have. Each area has an
 * ordered list of slots, main compound movements first; the full-body area uses FITX's authored full-body days
 * (full-body-3 at the gym or with free weights, home-bodyweight-3 otherwise), one of three picked by the seed.
 * Several areas take turns, so a chest and arms workout alternates their slots, compound movements first.
 * Level sets the length: 4, 5 or 6 slots for one area (beginner, intermediate, advanced), one more for two
 * areas, two more for three or more, at most 8 and at least one per area. The first slots of each area are
 * required (3 of one area, 2 each of two, 1 each of more); the rest are optional, so generateDay's
 * sessionMinutes drops them first. The slots only name muscles and movement types; generateDay fills them with
 * exercises the member can do at their level, so the workout never needs equipment they do not have.
 */

const fslot = (muscle: MuscleGroup | readonly MuscleGroup[], sets: number, reps: readonly [number, number], rest: number, extra: Omit<SlotSpec, "muscle" | "sets" | "reps" | "rest"> = {}): SlotSpec =>
  ({ muscle, sets, reps, rest, ...extra });

const NOT_MAIN_PRESS = ["decline", "close-grip", "guillotine", "powerlifting", "chains", "bands", "one arm", "one-arm", "floor"];
const NOT_MAIN_SQUAT = ["jump", "sissy", "chains", "bands", "box squat", "overhead", "zercher", "speed"];
const HINGE = ["romanian_deadlift", "dumbbell_rdl", "free-exercise-db-Stiff-Legged_Dumbbell_Deadlift", "free-exercise-db-Good_Morning", "free-exercise-db-Kettlebell_One-Legged_Deadlift"];
const UNILATERAL = ["split_squat", "free-exercise-db-Split_Squat_with_Dumbbells", "walking_lunge", "free-exercise-db-Dumbbell_Lunges", "step_up"];
const SHRUG = ["free-exercise-db-Barbell_Shrug", "free-exercise-db-Dumbbell_Shrug"];

/** Each area's slots, most important first. Preferred ids must be active catalogue exercises (tests check). */
export const FOCUS_TEMPLATES: Readonly<Record<Exclude<FocusArea, "full_body">, readonly SlotSpec[]>> = {
  chest: [
    fslot("chest", 4, [6, 10], 120, { mechanic: "compound", preferred: ["bench_press", "dumbbell_bench_press", "push_up"], nameIncludes: ["bench press", "push-up", "pushups"], nameExcludes: NOT_MAIN_PRESS, label: "Main press" }),
    fslot("chest", 3, [8, 12], 90, { mechanic: "compound", preferred: ["incline_dumbbell_press", "free-exercise-db-Barbell_Incline_Bench_Press_-_Medium_Grip", "free-exercise-db-Decline_Push-Up", "free-exercise-db-Incline_Push-Up"], nameIncludes: ["incline", "decline push"], label: "Incline press" }),
    fslot("chest", 3, [10, 15], 60, { mechanic: "isolation", preferred: ["free-exercise-db-Dumbbell_Flyes", "cable_fly", "free-exercise-db-Cable_Crossover", "free-exercise-db-Butterfly", "free-exercise-db-Cross_Over_-_With_Bands"], nameIncludes: ["fly", "flye", "crossover", "cross over"], label: "Chest fly" }),
    fslot("chest", 3, [8, 15], 60, { mechanic: "compound", preferred: ["free-exercise-db-Dips_-_Chest_Version", "push_up", "free-exercise-db-Push-Up_Wide"], nameIncludes: ["dip", "push-up", "pushup"], label: "Dips or push-ups" }),
    fslot("chest", 2, [12, 15], 60, { mechanic: "isolation", preferred: ["free-exercise-db-Cable_Crossover", "free-exercise-db-Butterfly"], label: "Cable or machine fly" }),
    fslot("chest", 2, [10, 15], 60, { mechanic: "compound", nameIncludes: ["press", "push-up"], nameExcludes: ["decline"], label: "Another press" }),
  ],
  back: [
    fslot("back", 4, [6, 10], 120, { mechanic: "compound", primary: ["lats"], preferred: ["pull_up", "free-exercise-db-Chin-Up", "lat_pulldown", "free-exercise-db-Band_Assisted_Pull-Up"], nameIncludes: ["pull", "chin"], label: "Vertical pull" }),
    fslot("back", 3, [8, 12], 90, { mechanic: "compound", primary: ["middle_back"], preferred: ["barbell_row", "seated_cable_row", "one_arm_dumbbell_row", "free-exercise-db-Bent_Over_Two-Dumbbell_Row", "free-exercise-db-Inverted_Row", "band_row"], nameIncludes: ["row"], label: "Row" }),
    fslot("back", 3, [10, 12], 90, { mechanic: "compound", primary: ["middle_back", "lats"], preferred: ["seated_cable_row", "one_arm_dumbbell_row", "free-exercise-db-Close-Grip_Front_Lat_Pulldown", "band_row"], nameIncludes: ["row", "pulldown"], label: "Second pull" }),
    fslot("back", 3, [10, 15], 60, { primary: ["lower_back"], primaryOnly: true, preferred: ["free-exercise-db-Hyperextensions_Back_Extensions", "free-exercise-db-Superman"], label: "Lower back" }),
    fslot("back", 3, [10, 12], 60, { mechanic: "isolation", primary: ["traps"], primaryOnly: true, preferred: SHRUG, nameIncludes: ["shrug"], label: "Shrugs" }),
    fslot("back", 2, [10, 12], 60, { primary: ["lats", "middle_back"], primaryOnly: true, label: "Back accessory" }),
  ],
  shoulders: [
    fslot("shoulders", 4, [6, 10], 120, { mechanic: "compound", preferred: ["free-exercise-db-Standing_Military_Press", "dumbbell_shoulder_press", "free-exercise-db-Arnold_Dumbbell_Press", "free-exercise-db-Shoulder_Press_-_With_Bands"], nameIncludes: ["press"], nameExcludes: ["behind", "bradford"], label: "Overhead press" }),
    fslot("shoulders", 3, [12, 15], 60, { mechanic: "isolation", preferred: ["lateral_raise", "free-exercise-db-Cable_Seated_Lateral_Raise", "band_lateral_raise"], nameIncludes: ["lateral raise"], label: "Lateral raise" }),
    fslot("shoulders", 3, [12, 15], 60, { mechanic: "isolation", preferred: ["free-exercise-db-Face_Pull", "free-exercise-db-Reverse_Flyes", "free-exercise-db-Dumbbell_Lying_Rear_Lateral_Raise", "free-exercise-db-Band_Pull_Apart"], nameIncludes: ["face pull", "rear", "reverse fl", "pull apart"], label: "Rear delts" }),
    fslot("shoulders", 3, [8, 12], 90, { mechanic: "compound", preferred: ["free-exercise-db-Arnold_Dumbbell_Press", "dumbbell_shoulder_press"], nameIncludes: ["press"], nameExcludes: ["behind", "bradford"], label: "Dumbbell press" }),
    fslot("back", 3, [10, 12], 60, { mechanic: "isolation", primary: ["traps"], primaryOnly: true, preferred: SHRUG, nameIncludes: ["shrug"], label: "Shrugs" }),
    fslot("shoulders", 2, [10, 12], 60, { mechanic: "isolation", preferred: ["free-exercise-db-Front_Dumbbell_Raise", "free-exercise-db-Front_Cable_Raise"], nameIncludes: ["front raise"], label: "Front raise" }),
  ],
  arms: [
    fslot("triceps", 3, [6, 10], 90, { mechanic: "compound", preferred: ["free-exercise-db-Close-Grip_Barbell_Bench_Press", "free-exercise-db-Dips_-_Triceps_Version", "free-exercise-db-Bench_Dips", "free-exercise-db-Push-Ups_-_Close_Triceps_Position"], label: "Close-grip press or dips" }),
    fslot("biceps", 3, [8, 12], 60, { mechanic: "isolation", preferred: ["free-exercise-db-Barbell_Curl", "biceps_curl", "free-exercise-db-EZ-Bar_Curl"], nameIncludes: ["curl"], label: "Biceps curl" }),
    fslot("triceps", 3, [10, 12], 60, { mechanic: "isolation", preferred: ["free-exercise-db-Triceps_Pushdown", "free-exercise-db-Triceps_Pushdown_-_Rope_Attachment", "free-exercise-db-Lying_Triceps_Press", "triceps_extension", "free-exercise-db-Standing_Towel_Triceps_Extension"], label: "Triceps extension" }),
    fslot("biceps", 3, [10, 12], 60, { mechanic: "isolation", preferred: ["free-exercise-db-Hammer_Curls", "free-exercise-db-Cable_Hammer_Curls_-_Rope_Attachment", "free-exercise-db-Preacher_Curl"], nameIncludes: ["hammer", "preacher"], label: "Hammer or preacher curl" }),
    fslot("forearms", 2, [12, 15], 60, { mechanic: "isolation", nameIncludes: ["wrist"], label: "Forearms" }),
    fslot("triceps", 2, [12, 15], 60, { mechanic: "isolation", nameIncludes: ["overhead", "extension", "kickback"], preferred: ["triceps_extension", "free-exercise-db-Tricep_Dumbbell_Kickback"], label: "Triceps, overhead" }),
  ],
  abs: [
    fslot("core", 3, [10, 15], 45, { mechanic: "isolation", preferred: ["plank", "free-exercise-db-Side_Bridge"], seconds: 40, label: "Plank or hold" }),
    fslot("core", 3, [12, 20], 45, { mechanic: "isolation", preferred: ["free-exercise-db-Cable_Crunch", "free-exercise-db-Crunches", "free-exercise-db-Ab_Roller"], nameIncludes: ["crunch", "sit-up", "roller", "rollout"], label: "Crunch" }),
    fslot("core", 3, [10, 15], 45, { mechanic: "isolation", preferred: ["free-exercise-db-Hanging_Leg_Raise", "free-exercise-db-Flat_Bench_Lying_Leg_Raise", "free-exercise-db-Reverse_Crunch"], nameIncludes: ["leg raise", "knee raise", "reverse crunch"], label: "Leg raise" }),
    fslot("core", 3, [12, 20], 45, { preferred: ["free-exercise-db-Russian_Twist", "free-exercise-db-Cable_Russian_Twists", "free-exercise-db-Standing_Cable_Wood_Chop"], nameIncludes: ["twist", "wood chop", "oblique"], label: "Rotation" }),
    fslot("core", 3, [10, 15], 45, { mechanic: "isolation", preferred: ["dead_bug"], nameIncludes: ["dead bug"], label: "Dead bug" }),
    fslot("core", 2, [10, 15], 45, { preferred: ["free-exercise-db-Side_Bridge", "plank"], seconds: 30, label: "Side plank or hold" }),
  ],
  legs: [
    fslot("quadriceps", 4, [6, 10], 150, { mechanic: "compound", preferred: ["barbell_back_squat", "free-exercise-db-Barbell_Full_Squat", "goblet_squat", "bodyweight_squat"], nameIncludes: ["squat"], nameExcludes: NOT_MAIN_SQUAT, label: "Squat" }),
    fslot("hamstrings", 3, [8, 10], 120, { mechanic: "compound", preferred: HINGE, nameIncludes: ["deadlift", "good morning"], label: "Hinge" }),
    fslot("quadriceps", 3, [10, 12], 90, { mechanic: "compound", preferred: ["free-exercise-db-Leg_Press", "free-exercise-db-Hack_Squat", ...UNILATERAL], nameIncludes: ["leg press", "lunge", "split squat"], label: "Leg press or lunge" }),
    fslot("hamstrings", 3, [10, 12], 60, { mechanic: "isolation", preferred: ["free-exercise-db-Lying_Leg_Curls", "free-exercise-db-Seated_Leg_Curl", "free-exercise-db-Glute_Ham_Raise"], nameIncludes: ["curl"], label: "Leg curl" }),
    fslot("calves", 3, [12, 15], 60, { preferred: ["calf_raise", "free-exercise-db-Standing_Calf_Raises", "free-exercise-db-Seated_Calf_Raise", "free-exercise-db-Calf_Raise_On_A_Dumbbell"], nameIncludes: ["calf raise"], label: "Calves" }),
    fslot("quadriceps", 3, [12, 15], 60, { mechanic: "isolation", preferred: ["free-exercise-db-Leg_Extensions"], nameIncludes: ["extension"], label: "Leg extension" }),
    fslot("hips", 2, [12, 15], 60, { mechanic: "isolation", label: "Inner or outer thigh" }),
  ],
  glutes: [
    fslot("glutes", 4, [8, 12], 90, { mechanic: "compound", preferred: ["hip_thrust", "glute_bridge", "free-exercise-db-Single_Leg_Glute_Bridge"], nameIncludes: ["hip thrust", "bridge"], label: "Hip thrust or bridge" }),
    fslot("hamstrings", 3, [8, 12], 120, { mechanic: "compound", preferred: HINGE, nameIncludes: ["deadlift", "good morning"], label: "Hinge" }),
    fslot("quadriceps", 3, [10, 12], 90, { mechanic: "compound", preferred: UNILATERAL, nameIncludes: ["lunge", "split squat", "step"], label: "Lunge or step-up" }),
    fslot("glutes", 3, [12, 15], 60, { mechanic: "isolation", preferred: ["free-exercise-db-Glute_Kickback", "free-exercise-db-One-Legged_Cable_Kickback"], nameIncludes: ["kickback"], label: "Kickback" }),
    fslot("glutes", 3, [10, 15], 60, { mechanic: "compound", preferred: ["free-exercise-db-Single_Leg_Glute_Bridge", "glute_bridge"], nameIncludes: ["bridge", "step-up"], label: "Single-leg bridge" }),
    fslot("hips", 2, [12, 15], 60, { mechanic: "isolation", primary: ["abductors"], primaryOnly: true, nameIncludes: ["abduct"], label: "Hip abduction" }),
  ],
};

/** Free weights that make the gym's full-body days a better fit than the bodyweight ones at home. */
const FREE_WEIGHTS = ["dumbbell", "kettlebell", "barbell"];

/** Used only if the authored full-body programmes are missing: a squat, a press, a pull, a hinge and core. */
const FULL_BODY_FALLBACK: readonly SlotSpec[] = [
  fslot("quadriceps", 3, [8, 12], 120, { mechanic: "compound", nameIncludes: ["squat"], label: "Squat" }),
  fslot("chest", 3, [8, 12], 90, { mechanic: "compound", nameIncludes: ["press", "push-up"], label: "Press" }),
  fslot("back", 3, [8, 12], 90, { mechanic: "compound", nameIncludes: ["row", "pull"], label: "Pull" }),
  fslot("hamstrings", 3, [8, 12], 90, { mechanic: "compound", label: "Hinge" }),
  fslot("core", 3, [10, 15], 45, { mechanic: "isolation", seconds: 40, label: "Core" }),
];

/**
 * The slots of one area, most important first. Full body: an authored full-body day, the gym's (full-a/b/c)
 * at the gym or when the member has free weights, else the bodyweight home days (home-a/b/c); the seed picks
 * which of the three.
 */
export function focusTemplate(area: FocusArea, context: TrainingContext, owned: ReadonlySet<string>, seed = ""): readonly SlotSpec[] {
  if (area !== "full_body") return FOCUS_TEMPLATES[area];
  const gymDays = context === "gym" || FREE_WEIGHTS.some((key) => owned.has(key));
  const days = programmeById(gymDays ? "full-body-3" : "home-bodyweight-3")?.days ?? [];
  if (!days.length) return FULL_BODY_FALLBACK;
  return days[seed ? hashString(seed) % days.length : 0].slots;
}

const BASE_SLOTS: Readonly<Record<Level, number>> = { beginner: 4, intermediate: 5, advanced: 6 };
export const MAX_FOCUS_SLOTS = 8;

/** How many slots a focus workout has: by level, one more for two areas, two more for three or more (at most 8). */
export function focusSlotBudget(level: Level, areaCount: number): number {
  if (areaCount <= 0) return 0;
  const extra = areaCount === 1 ? 0 : areaCount === 2 ? 1 : 2;
  return Math.min(MAX_FOCUS_SLOTS, Math.max((BASE_SLOTS[level] ?? BASE_SLOTS.beginner) + extra, areaCount));
}

/** Required slots per area: 3 for one area, 2 each for two, 1 each for more. */
function requiredPerArea(areaCount: number): number {
  return areaCount === 1 ? 3 : areaCount === 2 ? 2 : 1;
}

export type FocusSlotOptions = {
  /** The member's level; sets the length (default beginner). */
  level?: Level;
  /** Picks the full-body day and, with a catalogue, breaks ties the way generateDay will. */
  seed?: string;
  /**
   * With the catalogue, a slot nothing in it can fill (with this equipment and level, after the exercises
   * already picked) is replaced by the area's next slot, so the workout keeps its length where it can.
   */
  catalog?: readonly CatalogExercise[];
  exclude?: ReadonlySet<string>;
  recentDays?: ReadonlyMap<string, number>;
};

export type FocusSlot = SlotSpec & { focus: FocusArea };

/**
 * The generator's entry point for focus workouts: the slots for the chosen areas (any order, repeats ignored)
 * at a context with the member's equipment (expanded, see expandOwnedEquipment). Deterministic. Fill them
 * with generateDay; pass the same catalogue, level and seed in `options` to leave out slots that cannot be
 * filled. Each slot carries the area it serves in `focus`.
 */
export function focusSlots(areas: readonly FocusArea[], context: TrainingContext, owned: ReadonlySet<string>, options: FocusSlotOptions = {}): FocusSlot[] {
  const chosen = normaliseFocusAreas(areas);
  if (!chosen.length) return [];
  const level = options.level ?? "beginner";
  const budget = focusSlotBudget(level, chosen.length);
  const required = requiredPerArea(chosen.length);
  const queues = chosen.map((area) => [...focusTemplate(area, context, owned, options.seed)]);
  const placed = chosen.map(() => 0);
  const ctx: GenerationContext | null = options.catalog
    ? { catalog: options.catalog, owned, level, seed: options.seed ?? "", context, exclude: options.exclude, recentDays: options.recentDays }
    : null;
  const used = new Set<string>();
  const slots: FocusSlot[] = [];
  let progressed = true;
  // Round by round, each area adds its next slot that can be filled, until the budget is used or nothing is left.
  while (slots.length < budget && progressed) {
    progressed = false;
    for (let index = 0; index < chosen.length && slots.length < budget; index++) {
      const queue = queues[index];
      while (queue.length) {
        const template = queue.shift()!;
        // The same movement for two areas (legs and glutes both hinge) is done once.
        if (template.label && slots.some((slot) => slot.label === template.label)) continue;
        const area = chosen[index];
        const slot: FocusSlot = { ...template, optional: placed[index] >= required, focus: area };
        if (ctx) {
          const pick = pickForSlot(slot, ctx, used);
          // Nothing fits, or only something that does not train the area: try the area's next slot.
          if (!pick || (area !== "full_body" && !focusRole(pick, area))) continue;
          used.add(pick.id);
        }
        slots.push(slot);
        placed[index] += 1;
        progressed = true;
        break;
      }
    }
  }
  return slots;
}

export type FocusDay = GeneratedDay & {
  /** The areas the workout covers, in display order. */
  areas: FocusArea[];
  /**
   * Areas that got fewer exercises than their share (3 for one area, 2 each for two, 1 each for more),
   * because few exercises in the catalogue fit the equipment and level. Say so rather than padding.
   */
  short: FocusArea[];
};

/** A whole focus workout: focusSlots with the context's catalogue, level and seed, filled by generateDay. */
export function generateFocusDay(areas: readonly FocusArea[], ctx: GenerationContext): FocusDay {
  const chosen = normaliseFocusAreas(areas);
  const slots = focusSlots(chosen, ctx.context ?? "gym", ctx.owned, { level: ctx.level, seed: ctx.seed, catalog: ctx.catalog, exclude: ctx.exclude, recentDays: ctx.recentDays });
  const day = generateDay(slots, ctx);
  const required = requiredPerArea(chosen.length);
  const short = chosen.filter((area) => slots.filter((slot) => slot.focus === area).length < required);
  return { ...day, areas: chosen, short };
}
