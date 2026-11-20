// The training and food vocabularies Admin edits with. No imports, so tests can load it.
// The keys mirror the FITX app's src/lib/training/taxonomy.ts and the database checks; Admin cannot add a
// key (members' equipment lists, programmes and the generator store them). admin/tests/content-vocabulary.test.mjs
// fails if this file and the app drift apart. New keys are added in taxonomy.ts and a migration.

export type Option<K extends string = string> = { value: K; label: string };

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

/** Catalogue muscle values and the group each belongs to (taxonomy.ts MUSCLE_TO_GROUP). */
export const MUSCLE_TO_GROUP: Readonly<Record<string, MuscleGroup>> = {
  chest: "chest", upper_chest: "chest",
  lats: "back", middle_back: "back", back: "back", traps: "back", lower_back: "back",
  shoulders: "shoulders", front_deltoids: "shoulders", rear_deltoids: "shoulders",
  biceps: "biceps", triceps: "triceps", forearms: "forearms",
  abdominals: "core", core: "core",
  quadriceps: "quadriceps", hip_flexors: "quadriceps", hamstrings: "hamstrings", glutes: "glutes", calves: "calves", ankles: "calves",
  adductors: "hips", abductors: "hips",
  neck: "neck",
  cardio: "full_body",
};

export function muscleGroupOf(muscle: string): MuscleGroup | null {
  const key = typeof muscle === "string" ? muscle.trim().toLowerCase() : "";
  return Object.hasOwn(MUSCLE_TO_GROUP, key) ? MUSCLE_TO_GROUP[key] : null;
}

/** "lower_back" → "Lower back". */
export function humanise(key: string): string {
  const text = key.replaceAll("_", " ").trim();
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

export const MUSCLES: readonly Option[] = Object.keys(MUSCLE_TO_GROUP)
  .sort()
  .map((value) => ({ value, label: humanise(value) }));

export const EXERCISE_CATEGORIES = ["strength", "stretching", "cardio", "plyometrics", "olympic", "strongman"] as const;
export type ExerciseCategory = (typeof EXERCISE_CATEGORIES)[number];
export const CATEGORY_LABELS: Record<ExerciseCategory, string> = {
  strength: "Strength", stretching: "Stretching and mobility", cardio: "Cardio", plyometrics: "Plyometrics",
  olympic: "Olympic lifts", strongman: "Strongman",
};

export const MECHANICS = ["compound", "isolation"] as const;
export const LEVELS = ["beginner", "intermediate", "advanced"] as const;
export const PRESCRIPTION_TYPES = ["reps", "time"] as const;
export const LOCATIONS = ["gym", "home", "outdoor"] as const;

/** Movement patterns already in the catalogue; an exercise keeps any other value it has. */
export const MOVEMENT_PATTERNS = [
  "push", "pull", "horizontal_push", "vertical_push", "horizontal_pull", "vertical_pull", "squat", "hinge", "lunge",
  "carry", "rotation", "static", "cardio", "plyometrics", "stretching", "strength", "strongman",
] as const;

export type EquipmentKind = "free_weight" | "station" | "machine" | "accessory" | "household" | "specialty";
export type EquipmentItem = { key: string; label: string; kind: EquipmentKind; homeFriendly: boolean };

/** taxonomy.ts EQUIPMENT, in the same order. */
export const EQUIPMENT: readonly EquipmentItem[] = [
  { key: "dumbbell", label: "Dumbbells", kind: "free_weight", homeFriendly: true },
  { key: "kettlebell", label: "Kettlebell", kind: "free_weight", homeFriendly: true },
  { key: "barbell", label: "Barbell and plates", kind: "free_weight", homeFriendly: false },
  { key: "ez_bar", label: "EZ curl bar", kind: "free_weight", homeFriendly: false },
  { key: "resistance_band", label: "Resistance bands", kind: "accessory", homeFriendly: true },
  { key: "pull_up_bar", label: "Pull-up bar", kind: "station", homeFriendly: true },
  { key: "bench", label: "Weight bench", kind: "station", homeFriendly: true },
  { key: "box", label: "Plyo box or sturdy step", kind: "station", homeFriendly: true },
  { key: "dip_station", label: "Dip bars", kind: "station", homeFriendly: false },
  { key: "squat_rack", label: "Squat or power rack", kind: "station", homeFriendly: false },
  { key: "cable_machine", label: "Cable machine", kind: "machine", homeFriendly: false },
  { key: "machine", label: "Weight machines", kind: "machine", homeFriendly: false },
  { key: "smith_machine", label: "Smith machine", kind: "machine", homeFriendly: false },
  { key: "cardio_machine", label: "Cardio machines", kind: "machine", homeFriendly: false },
  { key: "medicine_ball", label: "Medicine ball", kind: "accessory", homeFriendly: true },
  { key: "stability_ball", label: "Exercise ball", kind: "accessory", homeFriendly: true },
  { key: "foam_roller", label: "Foam roller", kind: "accessory", homeFriendly: true },
  { key: "jump_rope", label: "Jump rope", kind: "accessory", homeFriendly: true },
  { key: "suspension_trainer", label: "Suspension trainer or rings", kind: "accessory", homeFriendly: true },
  { key: "chair", label: "Sturdy chair", kind: "household", homeFriendly: true },
  { key: "sled", label: "Sled", kind: "specialty", homeFriendly: false },
  { key: "strongman_implements", label: "Strongman implements", kind: "specialty", homeFriendly: false },
  { key: "specialty", label: "Other specialist gym equipment", kind: "specialty", homeFriendly: false },
];

export const EQUIPMENT_KIND_LABELS: Record<EquipmentKind, string> = {
  free_weight: "Free weights", station: "Stations", machine: "Machines", accessory: "Accessories", household: "Household", specialty: "Specialist",
};

export const EQUIPMENT_KEYS: readonly string[] = EQUIPMENT.map((item) => item.key);

export function equipmentLabel(key: string): string {
  if (key === "none") return "No equipment";
  return EQUIPMENT.find((item) => item.key === key)?.label ?? humanise(key);
}

// Food --------------------------------------------------------------------------------------------

export const PORTION_UNITS = ["piece", "slice", "serving", "cup", "tbsp", "tsp", "ml", "l", "floz", "katori", "bowl", "plate", "glass"] as const;
export type PortionUnit = (typeof PORTION_UNITS)[number];
export const PORTION_UNIT_LABELS: Record<PortionUnit, string> = {
  piece: "Piece", slice: "Slice", serving: "Serving", cup: "Cup", tbsp: "Tablespoon", tsp: "Teaspoon", ml: "Millilitres",
  l: "Litres", floz: "Fluid ounces", katori: "Katori", bowl: "Bowl", plate: "Plate", glass: "Glass",
};

export const DIET_TYPES = ["vegan", "veg", "egg", "non_veg"] as const;
export const DIET_LABELS: Record<(typeof DIET_TYPES)[number], string> = { vegan: "Vegan", veg: "Vegetarian", egg: "Eggetarian", non_veg: "Non-vegetarian" };

export const VALUE_BASES = ["lab_analysed", "compiled", "recipe_calculated", "label", "estimated"] as const;
export type ValueBasis = (typeof VALUE_BASES)[number];
export const VALUE_BASIS_LABELS: Record<ValueBasis, string> = {
  lab_analysed: "Lab analysed",
  compiled: "Compiled reference values",
  recipe_calculated: "Calculated from a recipe",
  label: "Package label",
  estimated: "Estimate",
};
