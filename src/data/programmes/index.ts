import type { SlotSpec } from "@/lib/training/generator";
import type { Programme, ProgrammeDay } from "@/lib/training/programmes";
import type { MuscleGroup } from "@/lib/training/taxonomy";

/*
 * FITX's authored training programmes. Each follows a widely used public split structure
 * (compound lifts first, 3-5 working sets for main lifts, 6-15 reps, longer rest for heavy work).
 * They are slots, not fixed exercises: the generator fills each slot from the user's equipment,
 * level and recent history. No ratings, enrolment counts or reviews are invented.
 * Not yet reviewed by a FITX coach; `sourceNotes` says so in the app.
 *
 * This file is the source of truth. supabase/migrations/20261118130040_fitx_training_programmes_seed.sql
 * is generated from it (scripts/catalog/build-programmes.mjs) and a test keeps the two in sync.
 */

const slot = (muscle: MuscleGroup | readonly MuscleGroup[], sets: number, reps: readonly [number, number], rest: number, extra: Omit<SlotSpec, "muscle" | "sets" | "reps" | "rest"> = {}): SlotSpec =>
  ({ muscle, sets, reps, rest, ...extra });

// Preferred exercises, most standard first. Ids must exist in the catalogue (tests check).
const PRESS_FLAT = ["bench_press", "dumbbell_bench_press", "push_up"];
const PRESS_INCLINE = ["incline_dumbbell_press", "free-exercise-db-Barbell_Incline_Bench_Press_-_Medium_Grip", "free-exercise-db-Decline_Push-Up"];
const PRESS_OVERHEAD = ["free-exercise-db-Standing_Military_Press", "dumbbell_shoulder_press", "free-exercise-db-Arnold_Dumbbell_Press"];
const CHEST_FLY = ["free-exercise-db-Dumbbell_Flyes", "cable_fly", "free-exercise-db-Cable_Crossover", "free-exercise-db-Butterfly"];
const LATERAL_RAISE = ["lateral_raise", "free-exercise-db-Cable_Seated_Lateral_Raise", "band_lateral_raise"];
const REAR_DELT = ["free-exercise-db-Face_Pull", "free-exercise-db-Reverse_Flyes", "free-exercise-db-Dumbbell_Lying_Rear_Lateral_Raise"];
const VERTICAL_PULL = ["pull_up", "free-exercise-db-Chin-Up", "lat_pulldown"];
const ROW = ["barbell_row", "seated_cable_row", "one_arm_dumbbell_row", "free-exercise-db-Bent_Over_Two-Dumbbell_Row", "free-exercise-db-Inverted_Row", "band_row"];
const BICEPS = ["free-exercise-db-Barbell_Curl", "biceps_curl", "free-exercise-db-EZ-Bar_Curl"];
const HAMMER = ["free-exercise-db-Hammer_Curls", "free-exercise-db-Cable_Hammer_Curls_-_Rope_Attachment"];
const TRICEPS_COMPOUND = ["free-exercise-db-Close-Grip_Barbell_Bench_Press", "free-exercise-db-Dips_-_Triceps_Version", "free-exercise-db-Bench_Dips"];
const TRICEPS_ISOLATION = ["free-exercise-db-Triceps_Pushdown", "free-exercise-db-Triceps_Pushdown_-_Rope_Attachment", "free-exercise-db-Lying_Triceps_Press", "triceps_extension"];
const SQUAT = ["barbell_back_squat", "free-exercise-db-Barbell_Full_Squat", "goblet_squat", "bodyweight_squat"];
const SQUAT_SECONDARY = ["free-exercise-db-Leg_Press", "free-exercise-db-Hack_Squat", "split_squat", "free-exercise-db-Split_Squat_with_Dumbbells", "walking_lunge", "free-exercise-db-Dumbbell_Lunges"];
const UNILATERAL = ["split_squat", "free-exercise-db-Split_Squat_with_Dumbbells", "walking_lunge", "free-exercise-db-Dumbbell_Lunges", "step_up"];
const HINGE = ["romanian_deadlift", "dumbbell_rdl", "free-exercise-db-Stiff-Legged_Dumbbell_Deadlift", "free-exercise-db-Good_Morning", "free-exercise-db-Kettlebell_One-Legged_Deadlift"];
const LEG_CURL = ["free-exercise-db-Lying_Leg_Curls", "free-exercise-db-Seated_Leg_Curl", "free-exercise-db-Glute_Ham_Raise"];
const LEG_EXTENSION = ["free-exercise-db-Leg_Extensions"];
const GLUTES = ["hip_thrust", "glute_bridge", "free-exercise-db-Single_Leg_Glute_Bridge"];
const CALVES = ["calf_raise", "free-exercise-db-Standing_Calf_Raises", "free-exercise-db-Seated_Calf_Raise", "free-exercise-db-Calf_Raise_On_A_Dumbbell"];
const CORE = ["plank", "dead_bug", "free-exercise-db-Hanging_Leg_Raise", "free-exercise-db-Cable_Crunch", "free-exercise-db-Side_Bridge"];
const SHRUG = ["free-exercise-db-Barbell_Shrug", "free-exercise-db-Dumbbell_Shrug"];

const NOT_MAIN_PRESS = ["decline", "close-grip", "guillotine", "powerlifting", "chains", "bands", "one arm", "one-arm", "floor"];
const NOT_MAIN_SQUAT = ["jump", "sissy", "chains", "bands", "box squat", "overhead", "zercher", "speed"];

const core = (optional = true) => slot("core", 3, [10, 15], 45, { mechanic: "isolation", preferred: CORE, seconds: 40, optional, label: "Core" });

const pushA: ProgrammeDay = {
  key: "push-a", title: "Push", focus: ["chest", "shoulders", "triceps"], slots: [
    slot("chest", 4, [6, 8], 150, { mechanic: "compound", preferred: PRESS_FLAT, nameIncludes: ["bench press", "push-up", "pushups"], nameExcludes: NOT_MAIN_PRESS, label: "Main press" }),
    slot("shoulders", 3, [8, 10], 120, { mechanic: "compound", preferred: PRESS_OVERHEAD, nameIncludes: ["press"], nameExcludes: ["behind", "push press", "bradford"], label: "Overhead press" }),
    slot("chest", 3, [8, 12], 90, { mechanic: "compound", preferred: PRESS_INCLINE, nameIncludes: ["incline"], label: "Incline press" }),
    slot("shoulders", 3, [12, 15], 60, { mechanic: "isolation", preferred: LATERAL_RAISE, nameIncludes: ["lateral raise"], label: "Side delts" }),
    slot("triceps", 3, [10, 12], 60, { mechanic: "isolation", preferred: TRICEPS_ISOLATION, label: "Triceps" }),
    slot("triceps", 2, [12, 15], 60, { mechanic: "isolation", nameIncludes: ["overhead", "extension"], preferred: ["triceps_extension"], optional: true, label: "Triceps, overhead" }),
  ],
};
const pullA: ProgrammeDay = {
  key: "pull-a", title: "Pull", focus: ["back", "biceps"], slots: [
    slot("back", 4, [6, 10], 150, { mechanic: "compound", primary: ["lats"], preferred: VERTICAL_PULL, nameIncludes: ["pull", "chin"], label: "Vertical pull" }),
    slot("back", 3, [8, 10], 120, { mechanic: "compound", primary: ["middle_back"], preferred: ROW, nameIncludes: ["row"], label: "Row" }),
    slot("shoulders", 3, [12, 15], 60, { mechanic: "isolation", preferred: REAR_DELT, nameIncludes: ["face pull", "rear", "reverse fl"], label: "Rear delts" }),
    slot("biceps", 3, [8, 12], 60, { mechanic: "isolation", preferred: BICEPS, nameIncludes: ["curl"], label: "Biceps" }),
    slot("biceps", 2, [10, 12], 60, { mechanic: "isolation", preferred: HAMMER, nameIncludes: ["hammer"], optional: true, label: "Hammer curl" }),
  ],
};
const legsA: ProgrammeDay = {
  key: "legs-a", title: "Legs", focus: ["quadriceps", "hamstrings", "glutes", "calves"], slots: [
    slot("quadriceps", 4, [6, 8], 180, { mechanic: "compound", preferred: SQUAT, nameIncludes: ["squat"], nameExcludes: NOT_MAIN_SQUAT, label: "Squat" }),
    slot("hamstrings", 3, [8, 10], 150, { mechanic: "compound", preferred: HINGE, nameIncludes: ["deadlift", "good morning"], label: "Hinge" }),
    slot("quadriceps", 3, [10, 12], 90, { mechanic: "compound", preferred: SQUAT_SECONDARY, nameIncludes: ["leg press", "lunge", "split squat"], label: "Leg press or lunge" }),
    slot("hamstrings", 3, [10, 12], 60, { mechanic: "isolation", preferred: LEG_CURL, nameIncludes: ["curl"], label: "Leg curl" }),
    slot("calves", 3, [12, 15], 60, { preferred: CALVES, nameIncludes: ["calf raise"], label: "Calves" }),
    core(),
  ],
};
const pushB: ProgrammeDay = {
  key: "push-b", title: "Push B", focus: ["shoulders", "chest", "triceps"], slots: [
    slot("shoulders", 4, [6, 8], 150, { mechanic: "compound", preferred: PRESS_OVERHEAD, nameIncludes: ["press"], nameExcludes: ["behind", "bradford"], label: "Overhead press" }),
    slot("chest", 3, [8, 10], 120, { mechanic: "compound", preferred: PRESS_INCLINE, nameIncludes: ["incline"], label: "Incline press" }),
    slot("triceps", 3, [8, 10], 90, { mechanic: "compound", preferred: TRICEPS_COMPOUND, label: "Triceps press or dips" }),
    slot("chest", 3, [10, 15], 60, { mechanic: "isolation", preferred: CHEST_FLY, nameIncludes: ["fly", "flye", "crossover"], label: "Chest fly" }),
    slot("shoulders", 3, [12, 15], 60, { mechanic: "isolation", preferred: LATERAL_RAISE, nameIncludes: ["lateral raise"], label: "Side delts" }),
    slot("triceps", 2, [12, 15], 60, { mechanic: "isolation", preferred: TRICEPS_ISOLATION, optional: true, label: "Triceps" }),
  ],
};
const pullB: ProgrammeDay = {
  key: "pull-b", title: "Pull B", focus: ["back", "biceps"], slots: [
    slot("back", 4, [6, 8], 150, { mechanic: "compound", primary: ["middle_back"], preferred: ROW, nameIncludes: ["row"], label: "Row" }),
    slot("back", 3, [8, 12], 120, { mechanic: "compound", primary: ["lats"], preferred: VERTICAL_PULL, nameIncludes: ["pull", "chin"], label: "Vertical pull" }),
    slot("shoulders", 3, [12, 15], 60, { mechanic: "isolation", preferred: REAR_DELT, nameIncludes: ["face pull", "rear", "reverse fl"], label: "Rear delts" }),
    slot("biceps", 3, [10, 12], 60, { mechanic: "isolation", preferred: HAMMER, nameIncludes: ["hammer"], label: "Hammer curl" }),
    slot("back", 3, [10, 12], 60, { mechanic: "isolation", primary: ["traps"], preferred: SHRUG, nameIncludes: ["shrug"], optional: true, label: "Shrugs" }),
  ],
};
const legsB: ProgrammeDay = {
  key: "legs-b", title: "Legs B", focus: ["hamstrings", "glutes", "quadriceps", "calves"], slots: [
    slot("hamstrings", 4, [6, 8], 180, { mechanic: "compound", preferred: HINGE, nameIncludes: ["deadlift"], label: "Hinge" }),
    slot("quadriceps", 3, [8, 10], 120, { mechanic: "compound", preferred: UNILATERAL, nameIncludes: ["split squat", "lunge", "step"], label: "Single-leg squat" }),
    slot("glutes", 3, [8, 12], 90, { mechanic: "compound", preferred: GLUTES, nameIncludes: ["hip thrust", "bridge"], label: "Hip thrust" }),
    slot("quadriceps", 3, [12, 15], 60, { mechanic: "isolation", preferred: LEG_EXTENSION, nameIncludes: ["extension"], label: "Leg extension" }),
    slot("calves", 3, [12, 15], 60, { preferred: CALVES, nameIncludes: ["calf raise"], label: "Calves" }),
    core(),
  ],
};

const GYM_SOURCE = "Follows the widely used %SPLIT% structure: compound lifts first, then accessories, each muscle trained once or twice a week. Exercises are chosen from your gym equipment. Built by FITX from public training guidance; not yet reviewed by a FITX coach.";
const gymNotes = (split: string) => GYM_SOURCE.replace("%SPLIT%", split);

export const PROGRAMMES: readonly Programme[] = [
  {
    id: "ppl-3", title: "Push, Pull, Legs · 3 days", summary: "Pushing muscles, pulling muscles and legs on separate days, each once a week. A good first split.",
    context: "gym", split: "push_pull_legs", level: "beginner", daysPerWeek: 3, defaultWeekdays: [1, 3, 5], sessionMinutes: 60,
    builtAround: ["barbell", "dumbbell", "bench", "cable_machine", "machine"], days: [pushA, pullA, legsA], isPremium: false,
    sourceNotes: gymNotes("push/pull/legs"),
  },
  {
    id: "ppl-6", title: "Push, Pull, Legs · 6 days", summary: "The same split twice a week, with a different main lift each time. For lifters who train most days.",
    context: "gym", split: "push_pull_legs", level: "intermediate", daysPerWeek: 6, defaultWeekdays: [1, 2, 3, 4, 5, 6], sessionMinutes: 65,
    builtAround: ["barbell", "dumbbell", "bench", "cable_machine", "machine"], days: [pushA, pullA, legsA, pushB, pullB, legsB], isPremium: false,
    sourceNotes: gymNotes("push/pull/legs"),
  },
  {
    id: "bro-split-5", title: "Bro split · 5 days", summary: "One muscle group a day (chest, back, shoulders, legs, arms) with high volume for each.",
    context: "gym", split: "bro_split", level: "intermediate", daysPerWeek: 5, defaultWeekdays: [1, 2, 3, 4, 5], sessionMinutes: 60,
    builtAround: ["barbell", "dumbbell", "bench", "cable_machine", "machine"], isPremium: false, sourceNotes: gymNotes("body-part (bro) split"),
    days: [
      { key: "chest", title: "Chest", focus: ["chest"], slots: [
        slot("chest", 4, [6, 8], 150, { mechanic: "compound", preferred: PRESS_FLAT, nameIncludes: ["bench press"], nameExcludes: NOT_MAIN_PRESS, label: "Main press" }),
        slot("chest", 3, [8, 10], 120, { mechanic: "compound", preferred: PRESS_INCLINE, nameIncludes: ["incline"], label: "Incline press" }),
        slot("chest", 3, [8, 12], 90, { mechanic: "compound", preferred: ["free-exercise-db-Dips_-_Chest_Version", "push_up"], nameIncludes: ["dip", "push-up", "pushup"], label: "Dips or push-ups" }),
        slot("chest", 3, [10, 15], 60, { mechanic: "isolation", preferred: CHEST_FLY, nameIncludes: ["fly", "flye", "crossover"], label: "Chest fly" }),
        slot("chest", 2, [12, 15], 60, { mechanic: "isolation", preferred: ["free-exercise-db-Cable_Crossover", "free-exercise-db-Butterfly"], optional: true, label: "Cable or machine fly" }),
      ] },
      { key: "back", title: "Back", focus: ["back"], slots: [
        slot("back", 4, [6, 10], 150, { mechanic: "compound", primary: ["lats"], preferred: VERTICAL_PULL, nameIncludes: ["pull", "chin"], label: "Vertical pull" }),
        slot("back", 4, [6, 8], 150, { mechanic: "compound", primary: ["middle_back"], preferred: ROW, nameIncludes: ["row"], label: "Heavy row" }),
        slot("back", 3, [10, 12], 90, { mechanic: "compound", primary: ["middle_back", "lats"], preferred: ["seated_cable_row", "one_arm_dumbbell_row", "free-exercise-db-Close-Grip_Front_Lat_Pulldown"], nameIncludes: ["row", "pulldown"], label: "Second pull" }),
        slot("back", 3, [10, 12], 90, { mechanic: "isolation", primary: ["traps"], preferred: SHRUG, nameIncludes: ["shrug"], label: "Shrugs" }),
        slot("back", 2, [12, 15], 60, { primary: ["lower_back"], preferred: ["free-exercise-db-Hyperextensions_Back_Extensions", "free-exercise-db-Superman"], optional: true, label: "Lower back" }),
      ] },
      { key: "shoulders", title: "Shoulders", focus: ["shoulders"], slots: [
        slot("shoulders", 4, [6, 8], 150, { mechanic: "compound", preferred: PRESS_OVERHEAD, nameIncludes: ["press"], nameExcludes: ["behind", "bradford"], label: "Overhead press" }),
        slot("shoulders", 3, [8, 12], 90, { mechanic: "compound", preferred: ["free-exercise-db-Arnold_Dumbbell_Press", "dumbbell_shoulder_press"], nameIncludes: ["press"], label: "Dumbbell press" }),
        slot("shoulders", 4, [12, 15], 60, { mechanic: "isolation", preferred: LATERAL_RAISE, nameIncludes: ["lateral raise"], label: "Side delts" }),
        slot("shoulders", 3, [12, 15], 60, { mechanic: "isolation", preferred: REAR_DELT, nameIncludes: ["face pull", "rear", "reverse fl"], label: "Rear delts" }),
        slot("shoulders", 2, [10, 12], 60, { mechanic: "isolation", nameIncludes: ["front raise"], optional: true, label: "Front delts" }),
      ] },
      { key: "legs", title: "Legs", focus: ["quadriceps", "hamstrings", "glutes", "calves"], slots: [
        slot("quadriceps", 4, [6, 8], 180, { mechanic: "compound", preferred: SQUAT, nameIncludes: ["squat"], nameExcludes: NOT_MAIN_SQUAT, label: "Squat" }),
        slot("quadriceps", 3, [10, 12], 120, { mechanic: "compound", preferred: SQUAT_SECONDARY, nameIncludes: ["leg press", "hack", "lunge"], label: "Leg press" }),
        slot("hamstrings", 3, [8, 10], 120, { mechanic: "compound", preferred: HINGE, nameIncludes: ["deadlift"], label: "Hinge" }),
        slot("hamstrings", 3, [10, 12], 60, { mechanic: "isolation", preferred: LEG_CURL, nameIncludes: ["curl"], label: "Leg curl" }),
        slot("quadriceps", 3, [12, 15], 60, { mechanic: "isolation", preferred: LEG_EXTENSION, nameIncludes: ["extension"], label: "Leg extension" }),
        slot("calves", 4, [12, 15], 60, { preferred: CALVES, nameIncludes: ["calf raise"], label: "Calves" }),
      ] },
      { key: "arms", title: "Arms", focus: ["biceps", "triceps", "forearms"], slots: [
        slot("triceps", 3, [6, 10], 120, { mechanic: "compound", preferred: TRICEPS_COMPOUND, label: "Close-grip press or dips" }),
        slot("biceps", 3, [8, 10], 90, { mechanic: "isolation", preferred: BICEPS, nameIncludes: ["curl"], label: "Biceps curl" }),
        slot("triceps", 3, [10, 12], 60, { mechanic: "isolation", preferred: TRICEPS_ISOLATION, label: "Triceps extension" }),
        slot("biceps", 3, [10, 12], 60, { mechanic: "isolation", preferred: [...HAMMER, "free-exercise-db-Preacher_Curl"], label: "Hammer or preacher curl" }),
        slot("forearms", 2, [12, 15], 60, { mechanic: "isolation", nameIncludes: ["wrist"], optional: true, label: "Forearms" }),
      ] },
    ],
  },
  {
    id: "upper-lower-4", title: "Upper / Lower · 4 days", summary: "Upper body and lower body on alternating days: a heavier day and a higher-rep day for each.",
    context: "gym", split: "upper_lower", level: "beginner", daysPerWeek: 4, defaultWeekdays: [1, 2, 4, 5], sessionMinutes: 60,
    builtAround: ["barbell", "dumbbell", "bench", "cable_machine", "machine"], isPremium: false, sourceNotes: gymNotes("upper/lower"),
    days: [
      { key: "upper-a", title: "Upper A", focus: ["chest", "back", "shoulders"], slots: [
        slot("chest", 4, [5, 8], 150, { mechanic: "compound", preferred: PRESS_FLAT, nameIncludes: ["bench press"], nameExcludes: NOT_MAIN_PRESS, label: "Bench press" }),
        slot("back", 4, [6, 8], 150, { mechanic: "compound", primary: ["middle_back"], preferred: ROW, nameIncludes: ["row"], label: "Row" }),
        slot("shoulders", 3, [6, 10], 120, { mechanic: "compound", preferred: PRESS_OVERHEAD, nameIncludes: ["press"], nameExcludes: ["behind", "bradford"], label: "Overhead press" }),
        slot("back", 3, [8, 10], 120, { mechanic: "compound", primary: ["lats"], preferred: VERTICAL_PULL, nameIncludes: ["pull", "chin"], label: "Vertical pull" }),
        slot("biceps", 2, [10, 12], 60, { mechanic: "isolation", preferred: BICEPS, optional: true, label: "Biceps" }),
        slot("triceps", 2, [10, 12], 60, { mechanic: "isolation", preferred: TRICEPS_ISOLATION, optional: true, label: "Triceps" }),
      ] },
      { key: "lower-a", title: "Lower A", focus: ["quadriceps", "hamstrings", "calves"], slots: [
        slot("quadriceps", 4, [5, 8], 180, { mechanic: "compound", preferred: SQUAT, nameIncludes: ["squat"], nameExcludes: NOT_MAIN_SQUAT, label: "Squat" }),
        slot("hamstrings", 3, [6, 10], 150, { mechanic: "compound", preferred: HINGE, nameIncludes: ["deadlift"], label: "Romanian deadlift" }),
        slot("quadriceps", 3, [10, 12], 90, { mechanic: "compound", preferred: SQUAT_SECONDARY, nameIncludes: ["leg press", "lunge", "split squat"], label: "Leg press or lunge" }),
        slot("hamstrings", 3, [10, 12], 60, { mechanic: "isolation", preferred: LEG_CURL, nameIncludes: ["curl"], label: "Leg curl" }),
        slot("calves", 3, [10, 15], 60, { preferred: CALVES, nameIncludes: ["calf raise"], label: "Calves" }),
        core(),
      ] },
      { key: "upper-b", title: "Upper B", focus: ["chest", "back", "shoulders", "biceps", "triceps"], slots: [
        slot("chest", 3, [8, 12], 120, { mechanic: "compound", preferred: PRESS_INCLINE, nameIncludes: ["incline"], label: "Incline press" }),
        slot("back", 3, [8, 12], 120, { mechanic: "compound", primary: ["lats"], preferred: VERTICAL_PULL, nameIncludes: ["pull", "chin"], label: "Vertical pull" }),
        slot("shoulders", 3, [10, 12], 90, { mechanic: "compound", preferred: ["dumbbell_shoulder_press", "free-exercise-db-Arnold_Dumbbell_Press"], nameIncludes: ["press"], label: "Dumbbell press" }),
        slot("back", 3, [10, 12], 90, { mechanic: "compound", primary: ["middle_back"], preferred: ["seated_cable_row", "one_arm_dumbbell_row", ...ROW], nameIncludes: ["row"], label: "Row" }),
        slot("shoulders", 3, [12, 15], 60, { mechanic: "isolation", preferred: LATERAL_RAISE, nameIncludes: ["lateral raise"], label: "Side delts" }),
        slot("biceps", 2, [10, 12], 60, { mechanic: "isolation", preferred: HAMMER, optional: true, label: "Hammer curl" }),
        slot("triceps", 2, [10, 12], 60, { mechanic: "isolation", preferred: TRICEPS_ISOLATION, optional: true, label: "Triceps" }),
      ] },
      { key: "lower-b", title: "Lower B", focus: ["hamstrings", "glutes", "quadriceps", "calves"], slots: [
        slot("hamstrings", 3, [5, 8], 180, { mechanic: "compound", preferred: ["free-exercise-db-Barbell_Deadlift", ...HINGE], nameIncludes: ["deadlift"], label: "Deadlift" }),
        slot("quadriceps", 3, [8, 10], 120, { mechanic: "compound", preferred: UNILATERAL, nameIncludes: ["split squat", "lunge"], label: "Single-leg squat" }),
        slot("glutes", 3, [8, 12], 90, { mechanic: "compound", preferred: GLUTES, nameIncludes: ["hip thrust", "bridge"], label: "Hip thrust" }),
        slot("quadriceps", 3, [12, 15], 60, { mechanic: "isolation", preferred: LEG_EXTENSION, nameIncludes: ["extension"], label: "Leg extension" }),
        slot("calves", 3, [12, 15], 60, { preferred: CALVES, nameIncludes: ["calf raise"], label: "Calves" }),
        core(),
      ] },
    ],
  },
  {
    id: "full-body-3", title: "Full Body · 3 days", summary: "Every main muscle group in each session, three times a week. The simplest way to start lifting.",
    context: "gym", split: "full_body", level: "beginner", daysPerWeek: 3, defaultWeekdays: [1, 3, 5], sessionMinutes: 55,
    builtAround: ["barbell", "dumbbell", "bench", "cable_machine", "machine"], isPremium: false, sourceNotes: gymNotes("full-body"),
    days: [
      { key: "full-a", title: "Full body A", focus: ["quadriceps", "chest", "back"], slots: [
        slot("quadriceps", 3, [5, 8], 180, { mechanic: "compound", preferred: SQUAT, nameIncludes: ["squat"], nameExcludes: NOT_MAIN_SQUAT, label: "Squat" }),
        slot("chest", 3, [5, 8], 150, { mechanic: "compound", preferred: PRESS_FLAT, nameIncludes: ["bench press"], nameExcludes: NOT_MAIN_PRESS, label: "Bench press" }),
        slot("back", 3, [6, 10], 120, { mechanic: "compound", primary: ["middle_back"], preferred: ROW, nameIncludes: ["row"], label: "Row" }),
        slot("glutes", 2, [8, 12], 90, { mechanic: "compound", preferred: GLUTES, nameIncludes: ["hip thrust", "bridge"], optional: true, label: "Glutes" }),
        core(),
      ] },
      { key: "full-b", title: "Full body B", focus: ["hamstrings", "shoulders", "back"], slots: [
        slot("hamstrings", 3, [5, 8], 180, { mechanic: "compound", preferred: HINGE, nameIncludes: ["deadlift"], label: "Hinge" }),
        slot("shoulders", 3, [6, 10], 120, { mechanic: "compound", preferred: PRESS_OVERHEAD, nameIncludes: ["press"], nameExcludes: ["behind", "bradford"], label: "Overhead press" }),
        slot("back", 3, [6, 10], 120, { mechanic: "compound", primary: ["lats"], preferred: VERTICAL_PULL, nameIncludes: ["pull", "chin"], label: "Vertical pull" }),
        slot("quadriceps", 2, [8, 12], 90, { mechanic: "compound", preferred: UNILATERAL, nameIncludes: ["lunge", "split squat"], optional: true, label: "Lunge" }),
        core(),
      ] },
      { key: "full-c", title: "Full body C", focus: ["quadriceps", "chest", "back"], slots: [
        slot("quadriceps", 3, [8, 10], 150, { mechanic: "compound", preferred: SQUAT_SECONDARY, nameIncludes: ["leg press", "squat", "lunge"], nameExcludes: NOT_MAIN_SQUAT, label: "Leg press or squat" }),
        slot("chest", 3, [8, 10], 120, { mechanic: "compound", preferred: PRESS_INCLINE, nameIncludes: ["incline"], label: "Incline press" }),
        slot("back", 3, [8, 12], 90, { mechanic: "compound", primary: ["middle_back", "lats"], preferred: ["seated_cable_row", "one_arm_dumbbell_row", "lat_pulldown"], nameIncludes: ["row", "pulldown"], label: "Pull" }),
        slot("shoulders", 2, [12, 15], 60, { mechanic: "isolation", preferred: LATERAL_RAISE, nameIncludes: ["lateral raise"], optional: true, label: "Side delts" }),
        core(),
      ] },
    ],
  },
  {
    id: "home-bodyweight-3", title: "Home bodyweight · 3 days", summary: "Full-body sessions that need no equipment. A pull-up bar, step or chair adds more options if you have one.",
    context: "home", split: "home_bodyweight", level: "beginner", daysPerWeek: 3, defaultWeekdays: [1, 3, 5], sessionMinutes: 40,
    builtAround: [], isPremium: false,
    sourceNotes: "Follows common bodyweight full-body routines: a squat, a push, a pull, a hinge or bridge and core work each session. Exercises are chosen from what you have at home. Built by FITX from public training guidance; not yet reviewed by a FITX coach.",
    days: [
      { key: "home-a", title: "Home A", focus: ["quadriceps", "chest", "back", "core"], slots: [
        slot("quadriceps", 3, [12, 20], 60, { mechanic: "compound", preferred: ["bodyweight_squat", "split_squat", "walking_lunge"], nameIncludes: ["squat"], label: "Squat" }),
        slot("chest", 3, [8, 15], 60, { mechanic: "compound", preferred: ["push_up", "free-exercise-db-Incline_Push-Up"], nameIncludes: ["push-up", "pushup"], label: "Push-up" }),
        slot("back", 3, [8, 12], 60, { mechanic: "compound", preferred: ["pull_up", "free-exercise-db-Inverted_Row", "band_row", "free-exercise-db-Superman"], label: "Pull" }),
        slot("glutes", 3, [12, 15], 45, { preferred: ["glute_bridge", "free-exercise-db-Single_Leg_Glute_Bridge"], nameIncludes: ["bridge"], label: "Glute bridge" }),
        core(false),
      ] },
      { key: "home-b", title: "Home B", focus: ["quadriceps", "chest", "back", "core"], slots: [
        slot("quadriceps", 3, [10, 12], 60, { mechanic: "compound", preferred: UNILATERAL, nameIncludes: ["lunge", "split squat", "step"], label: "Lunge" }),
        slot("chest", 3, [8, 12], 60, { mechanic: "compound", preferred: ["free-exercise-db-Decline_Push-Up", "free-exercise-db-Incline_Push-Up", "push_up"], nameIncludes: ["push-up"], label: "Push-up variation" }),
        slot("back", 3, [10, 15], 60, { preferred: ["free-exercise-db-Superman", "band_row", "free-exercise-db-Inverted_Row", "pull_up"], label: "Back" }),
        slot("hamstrings", 3, [10, 15], 45, { preferred: ["free-exercise-db-Single_Leg_Glute_Bridge", ...HINGE], label: "Hamstrings" }),
        slot("core", 3, [10, 15], 45, { mechanic: "isolation", preferred: ["dead_bug", "free-exercise-db-Side_Bridge", "plank"], seconds: 30, label: "Core" }),
      ] },
      { key: "home-c", title: "Home C", focus: ["quadriceps", "triceps", "shoulders", "core"], slots: [
        slot("quadriceps", 3, [12, 15], 60, { mechanic: "compound", preferred: ["step_up", "bodyweight_squat", "split_squat"], nameIncludes: ["step", "squat"], label: "Step-up or squat" }),
        slot("triceps", 3, [8, 12], 60, { preferred: ["free-exercise-db-Bench_Dips", "free-exercise-db-Close-Grip_Push-Up_off_of_a_Dumbbell", "free-exercise-db-Dips_-_Triceps_Version"], label: "Triceps" }),
        slot("shoulders", 3, [6, 10], 60, { mechanic: "compound", preferred: ["free-exercise-db-Handstand_Push-Ups", "band_lateral_raise"], label: "Shoulders" }),
        slot("calves", 3, [15, 20], 45, { preferred: CALVES, nameIncludes: ["calf raise"], label: "Calves" }),
        core(false),
        slot("full_body", 2, [20, 30], 60, { category: "cardio", preferred: ["jumping_jack"], seconds: 60, optional: true, label: "Conditioning" }),
      ] },
    ],
  },
  {
    id: "home-dumbbell-4", title: "Home dumbbells · 4 days", summary: "Upper and lower days built around a pair of dumbbells. A bench helps but is not required.",
    context: "home", split: "home_dumbbell", level: "beginner", daysPerWeek: 4, defaultWeekdays: [1, 2, 4, 5], sessionMinutes: 45,
    builtAround: ["dumbbell"], isPremium: false,
    sourceNotes: "Follows the upper/lower structure with dumbbell variations of the main lifts. Exercises are chosen from what you have at home. Built by FITX from public training guidance; not yet reviewed by a FITX coach.",
    days: [
      { key: "db-upper-a", title: "Upper A", focus: ["chest", "back", "shoulders"], slots: [
        slot("chest", 3, [8, 12], 90, { mechanic: "compound", preferred: ["dumbbell_bench_press", "push_up"], nameIncludes: ["press", "push-up"], nameExcludes: ["decline"], label: "Press" }),
        slot("back", 3, [8, 12], 90, { mechanic: "compound", primary: ["middle_back"], preferred: ["one_arm_dumbbell_row", "free-exercise-db-Bent_Over_Two-Dumbbell_Row"], nameIncludes: ["row"], label: "Row" }),
        slot("shoulders", 3, [8, 12], 90, { mechanic: "compound", preferred: ["dumbbell_shoulder_press", "free-exercise-db-Arnold_Dumbbell_Press"], nameIncludes: ["press"], label: "Shoulder press" }),
        slot("shoulders", 3, [12, 15], 60, { mechanic: "isolation", preferred: LATERAL_RAISE, nameIncludes: ["lateral raise"], label: "Side delts" }),
        slot("biceps", 2, [10, 12], 60, { mechanic: "isolation", preferred: ["biceps_curl", ...HAMMER], optional: true, label: "Biceps" }),
        slot("triceps", 2, [10, 12], 60, { mechanic: "isolation", preferred: ["triceps_extension"], optional: true, label: "Triceps" }),
      ] },
      { key: "db-lower-a", title: "Lower A", focus: ["quadriceps", "hamstrings", "glutes"], slots: [
        slot("quadriceps", 4, [8, 12], 90, { mechanic: "compound", preferred: ["goblet_squat", "bodyweight_squat"], nameIncludes: ["squat"], nameExcludes: NOT_MAIN_SQUAT, label: "Goblet squat" }),
        slot("hamstrings", 3, [8, 12], 90, { mechanic: "compound", preferred: ["dumbbell_rdl", "free-exercise-db-Stiff-Legged_Dumbbell_Deadlift"], nameIncludes: ["deadlift"], label: "Dumbbell RDL" }),
        slot("quadriceps", 3, [8, 12], 90, { mechanic: "compound", preferred: ["free-exercise-db-Split_Squat_with_Dumbbells", "split_squat", "free-exercise-db-Dumbbell_Lunges"], nameIncludes: ["split squat", "lunge"], label: "Split squat" }),
        slot("glutes", 3, [10, 15], 60, { preferred: GLUTES, nameIncludes: ["bridge", "hip thrust"], label: "Glute bridge" }),
        slot("calves", 3, [12, 20], 45, { preferred: ["free-exercise-db-Calf_Raise_On_A_Dumbbell", "calf_raise"], nameIncludes: ["calf raise"], label: "Calves" }),
      ] },
      { key: "db-upper-b", title: "Upper B", focus: ["chest", "back", "shoulders", "biceps", "triceps"], slots: [
        slot("chest", 3, [8, 12], 90, { mechanic: "compound", preferred: ["incline_dumbbell_press", "free-exercise-db-Decline_Push-Up", "push_up"], nameIncludes: ["incline", "push-up"], label: "Incline press" }),
        slot("back", 3, [8, 12], 90, { mechanic: "compound", preferred: ["free-exercise-db-Bent_Over_Two-Dumbbell_Row", "one_arm_dumbbell_row", "pull_up"], nameIncludes: ["row"], label: "Row" }),
        slot("shoulders", 3, [12, 15], 60, { mechanic: "isolation", preferred: REAR_DELT, nameIncludes: ["rear", "reverse fl"], label: "Rear delts" }),
        slot("biceps", 2, [10, 12], 60, { mechanic: "isolation", preferred: HAMMER, nameIncludes: ["hammer"], label: "Hammer curl" }),
        slot("chest", 2, [10, 15], 60, { mechanic: "isolation", preferred: ["free-exercise-db-Dumbbell_Flyes"], nameIncludes: ["fly", "flye"], optional: true, label: "Chest fly" }),
        slot("triceps", 2, [10, 12], 60, { preferred: ["free-exercise-db-Bench_Dips", "triceps_extension"], optional: true, label: "Triceps" }),
      ] },
      { key: "db-lower-b", title: "Lower B", focus: ["quadriceps", "hamstrings", "glutes", "calves"], slots: [
        slot("quadriceps", 3, [10, 12], 90, { mechanic: "compound", preferred: ["free-exercise-db-Dumbbell_Lunges", "walking_lunge", "step_up"], nameIncludes: ["lunge", "step"], label: "Lunge or step-up" }),
        slot("hamstrings", 3, [10, 12], 90, { mechanic: "compound", preferred: ["free-exercise-db-Stiff-Legged_Dumbbell_Deadlift", "dumbbell_rdl", "free-exercise-db-Kettlebell_One-Legged_Deadlift"], nameIncludes: ["deadlift"], label: "Stiff-leg deadlift" }),
        slot("glutes", 3, [10, 15], 60, { preferred: ["free-exercise-db-Single_Leg_Glute_Bridge", "glute_bridge", "hip_thrust"], nameIncludes: ["bridge", "hip thrust"], label: "Single-leg bridge" }),
        slot("calves", 3, [12, 20], 45, { preferred: CALVES, nameIncludes: ["calf raise"], label: "Calves" }),
        core(false),
      ] },
    ],
  },
];

export function programmeById(id: string | null | undefined): Programme | undefined {
  return PROGRAMMES.find((programme) => programme.id === id);
}
