/**
 * The fixed training vocabularies shared by the exercise catalogue, programmes,
 * the generator, substitutions and the Home/Gym equipment lists.
 *
 * Keys are stable identifiers stored in the database:
 *   exercise_library.muscle_group / category / mechanic / prescription_type / required_equipment,
 *   user_equipment_profiles.equipment_keys and training programme slots.
 * Labels are for display and can change freely. Add keys; never rename or reuse one.
 *
 * This file has no imports so scripts (scripts/catalog) can load it with plain `node`.
 */

// ---------------------------------------------------------------- muscles

/** Training-level muscle groups used by programme slots and filters. */
export const MUSCLE_GROUPS = [
  "chest", "back", "shoulders", "biceps", "triceps", "forearms", "core",
  "quadriceps", "hamstrings", "glutes", "calves", "hips", "neck", "full_body",
] as const;
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export const MUSCLE_GROUP_LABELS: Record<MuscleGroup, string> = {
  chest: "Chest", back: "Back", shoulders: "Shoulders", biceps: "Biceps", triceps: "Triceps", forearms: "Forearms",
  core: "Core", quadriceps: "Quads", hamstrings: "Hamstrings", glutes: "Glutes", calves: "Calves",
  hips: "Hips and adductors", neck: "Neck", full_body: "Full body",
};

/** The catalogue's finer `primary_muscle` values and the group each belongs to. */
export const MUSCLE_TO_GROUP: Readonly<Record<string, MuscleGroup>> = {
  chest: "chest",
  lats: "back", middle_back: "back", back: "back", traps: "back", lower_back: "back",
  shoulders: "shoulders",
  biceps: "biceps", triceps: "triceps", forearms: "forearms",
  abdominals: "core", core: "core",
  quadriceps: "quadriceps", hamstrings: "hamstrings", glutes: "glutes", calves: "calves",
  adductors: "hips", abductors: "hips",
  neck: "neck",
  cardio: "full_body",
};

export function muscleGroupOf(primaryMuscle: string): MuscleGroup | null {
  return MUSCLE_TO_GROUP[primaryMuscle.trim().toLowerCase()] ?? null;
}

/** Which split days a muscle group belongs to. */
export const BODY_REGIONS = ["upper_push", "upper_pull", "lower", "core", "conditioning"] as const;
export type BodyRegion = (typeof BODY_REGIONS)[number];
export const MUSCLE_GROUP_REGION: Record<MuscleGroup, BodyRegion> = {
  chest: "upper_push", shoulders: "upper_push", triceps: "upper_push",
  back: "upper_pull", biceps: "upper_pull", forearms: "upper_pull", neck: "upper_pull",
  quadriceps: "lower", hamstrings: "lower", glutes: "lower", calves: "lower", hips: "lower",
  core: "core", full_body: "conditioning",
};

// ---------------------------------------------------------------- exercise kinds

export const EXERCISE_CATEGORIES = ["strength", "stretching", "cardio", "plyometrics", "olympic", "strongman"] as const;
export type ExerciseCategory = (typeof EXERCISE_CATEGORIES)[number];
export const CATEGORY_LABELS: Record<ExerciseCategory, string> = {
  strength: "Strength", stretching: "Stretching and mobility", cardio: "Cardio", plyometrics: "Plyometrics",
  olympic: "Olympic lifts", strongman: "Strongman",
};

export const MECHANICS = ["compound", "isolation"] as const;
export type Mechanic = (typeof MECHANICS)[number];

/** How a movement is prescribed and logged: repetitions, or a time (holds, stretches, cardio). */
export const PRESCRIPTION_TYPES = ["reps", "time"] as const;
export type PrescriptionType = (typeof PRESCRIPTION_TYPES)[number];

export const LEVELS = ["beginner", "intermediate", "advanced"] as const;
export type Level = (typeof LEVELS)[number];
export function levelRank(level: string | null | undefined): number {
  const index = LEVELS.indexOf((level ?? "beginner") as Level);
  return index < 0 ? 0 : index;
}

/** Where a workout happens. Programmes and equipment lists use the two contexts. */
export const TRAINING_CONTEXTS = ["home", "gym"] as const;
export type TrainingContext = (typeof TRAINING_CONTEXTS)[number];

// ---------------------------------------------------------------- equipment

export type EquipmentKind = "free_weight" | "station" | "machine" | "accessory" | "household" | "specialty";

export type EquipmentDefinition = {
  key: string;
  label: string;
  kind: EquipmentKind;
  /** Commonly found at home; decides an exercise's derived "home" location. */
  homeFriendly: boolean;
  /** Lower-case words people and older FITX data use for it; matched after normalising. */
  synonyms: readonly string[];
};

/**
 * Equipment keys. An exercise lists the keys it needs in `required_equipment`; an
 * empty list means no equipment (floor, wall and body weight only).
 */
export const EQUIPMENT: readonly EquipmentDefinition[] = [
  { key: "dumbbell", label: "Dumbbells", kind: "free_weight", homeFriendly: true, synonyms: ["dumbbell", "dumbbells", "db", "dbs", "adjustable dumbbells"] },
  { key: "kettlebell", label: "Kettlebell", kind: "free_weight", homeFriendly: true, synonyms: ["kettlebell", "kettlebells", "kb"] },
  { key: "barbell", label: "Barbell and plates", kind: "free_weight", homeFriendly: false, synonyms: ["barbell", "barbells", "olympic bar", "plates", "weight plates", "trap bar", "hex bar"] },
  { key: "ez_bar", label: "EZ curl bar", kind: "free_weight", homeFriendly: false, synonyms: ["ez bar", "ez-bar", "ez curl bar", "curl bar"] },
  { key: "resistance_band", label: "Resistance bands", kind: "accessory", homeFriendly: true, synonyms: ["band", "bands", "resistance band", "resistance bands", "loop band", "mini band", "tube band"] },
  { key: "pull_up_bar", label: "Pull-up bar", kind: "station", homeFriendly: true, synonyms: ["pull up bar", "pull-up bar", "pullup bar", "chin up bar", "chin-up bar", "doorway bar"] },
  { key: "bench", label: "Weight bench", kind: "station", homeFriendly: true, synonyms: ["bench", "flat bench", "incline bench", "adjustable bench", "weight bench"] },
  { key: "box", label: "Plyo box or sturdy step", kind: "station", homeFriendly: true, synonyms: ["box", "plyo box", "step", "step platform", "aerobic step", "stairs"] },
  { key: "dip_station", label: "Dip bars", kind: "station", homeFriendly: false, synonyms: ["dip bars", "dip bar", "dip station", "parallel bars", "dips"] },
  { key: "squat_rack", label: "Squat or power rack", kind: "station", homeFriendly: false, synonyms: ["rack", "squat rack", "power rack", "squat stand", "squat stands", "cage"] },
  { key: "cable_machine", label: "Cable machine", kind: "machine", homeFriendly: false, synonyms: ["cable", "cables", "cable machine", "cable station", "pulley", "functional trainer", "cable crossover"] },
  { key: "machine", label: "Weight machines", kind: "machine", homeFriendly: false, synonyms: ["machine", "machines", "weight machine", "weight machines", "leg press", "selectorized"] },
  { key: "smith_machine", label: "Smith machine", kind: "machine", homeFriendly: false, synonyms: ["smith", "smith machine"] },
  { key: "cardio_machine", label: "Cardio machines", kind: "machine", homeFriendly: false, synonyms: ["cardio machine", "cardio machines", "treadmill", "stationary bike", "exercise bike", "spin bike", "rower", "rowing machine", "elliptical", "stair climber", "stairmaster"] },
  { key: "medicine_ball", label: "Medicine ball", kind: "accessory", homeFriendly: true, synonyms: ["medicine ball", "med ball", "slam ball"] },
  { key: "stability_ball", label: "Exercise ball", kind: "accessory", homeFriendly: true, synonyms: ["exercise ball", "stability ball", "swiss ball", "physio ball", "gym ball"] },
  { key: "foam_roller", label: "Foam roller", kind: "accessory", homeFriendly: true, synonyms: ["foam roller", "roller"] },
  { key: "jump_rope", label: "Jump rope", kind: "accessory", homeFriendly: true, synonyms: ["jump rope", "skipping rope", "skip rope"] },
  { key: "suspension_trainer", label: "Suspension trainer or rings", kind: "accessory", homeFriendly: true, synonyms: ["suspension trainer", "trx", "rings", "gymnastic rings"] },
  { key: "chair", label: "Sturdy chair", kind: "household", homeFriendly: true, synonyms: ["chair", "sturdy chair"] },
  { key: "sled", label: "Sled", kind: "specialty", homeFriendly: false, synonyms: ["sled", "prowler"] },
  { key: "strongman_implements", label: "Strongman implements", kind: "specialty", homeFriendly: false, synonyms: ["strongman", "atlas stone", "yoke", "log", "tire", "tyre", "keg"] },
  { key: "specialty", label: "Other specialist gym equipment", kind: "specialty", homeFriendly: false, synonyms: ["other", "specialty"] },
];

export type EquipmentKey = string;
export const EQUIPMENT_KEYS: readonly string[] = EQUIPMENT.map((item) => item.key);

/** Owning one item also covers these requirements (a bench serves as a step or a chair). */
export const EQUIPMENT_COVERS: Readonly<Record<string, readonly string[]>> = {
  bench: ["chair", "box"],
};

/** A commercial gym, until the user edits their gym list. Specialist items are left for them to add. */
export const DEFAULT_GYM_EQUIPMENT: readonly string[] = EQUIPMENT
  .filter((item) => item.kind !== "specialty" && item.kind !== "household")
  .map((item) => item.key);

/** Words in older FITX data that mean "no equipment"; they map to nothing. */
export const NO_EQUIPMENT_WORDS: readonly string[] = ["bodyweight", "body weight", "body only", "none", "no equipment", "nothing"];
