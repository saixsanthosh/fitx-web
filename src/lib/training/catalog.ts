import { equipmentKeyFor, sortEquipmentKeys } from "./equipment";
import {
  EQUIPMENT,
  EXERCISE_CATEGORIES,
  LEVELS,
  MECHANICS,
  muscleGroupOf,
  type ExerciseCategory,
  type Level,
  type Mechanic,
  type MuscleGroup,
  type PrescriptionType,
} from "./taxonomy";

/** One catalogue exercise as the training code uses it. */
export type CatalogExercise = {
  id: string;
  name: string;
  primary_muscle: string;
  secondary_muscles: string[];
  muscle_group: MuscleGroup;
  category: ExerciseCategory;
  mechanic: Mechanic | null;
  /** Equipment keys needed; empty means no equipment. */
  required_equipment: string[];
  /** "home" and/or "gym", derived from the equipment. */
  locations: string[];
  difficulty: Level;
  movement_pattern: string;
  prescription_type: PrescriptionType;
  recommended_sets: number;
  reps_min: number;
  reps_max: number;
  rest_seconds: number;
  default_duration_seconds: number | null;
  alternatives: string[];
  source_ref: string | null;
  /** False when the values above were estimated from the older columns (clean-up not applied yet). */
  curated: boolean;
};

/** Columns that exist before and after the Workouts v2 migrations. */
export const CATALOG_BASE_COLUMNS = [
  "id", "name", "primary_muscle", "secondary_muscles", "equipment", "locations", "difficulty", "movement_pattern",
  "recommended_sets", "reps_min", "reps_max", "rest_seconds", "alternatives",
] as const;

/** Added by supabase/migrations/20261118130000_fitx_training_catalog_schema.sql. */
export const CATALOG_V2_COLUMNS = [
  "category", "mechanic", "muscle_group", "required_equipment", "prescription_type", "default_duration_seconds", "source_ref", "catalog_version",
] as const;

/** A catalogue row as PostgREST returns it, with or without the v2 columns. */
export type CatalogRow = {
  id: string;
  name: string;
  primary_muscle: string;
  secondary_muscles?: string[] | null;
  equipment?: string[] | null;
  locations?: string[] | null;
  difficulty?: string | null;
  movement_pattern?: string | null;
  recommended_sets?: number | null;
  reps_min?: number | null;
  reps_max?: number | null;
  rest_seconds?: number | null;
  alternatives?: string[] | null;
  category?: string | null;
  mechanic?: string | null;
  muscle_group?: string | null;
  required_equipment?: string[] | null;
  prescription_type?: string | null;
  default_duration_seconds?: number | null;
  source_ref?: string | null;
  catalog_version?: number | null;
};

const HOME_FRIENDLY = new Set(EQUIPMENT.filter((item) => item.homeFriendly).map((item) => item.key));

/** "home" when every required item is commonly found at home (or nothing is needed); always "gym". */
export function locationsForEquipment(required: readonly string[]): string[] {
  return required.every((key) => HOME_FRIENDLY.has(key)) ? ["gym", "home"] : ["gym"];
}

const STRETCH_NAME = /\bstretch|\bsmr\b|foam roll|\bcircles?\b|mobility/i;
const CARDIO_NAME = /bicycling|cycling|elliptical|treadmill|stairmaster|step ?mill|rowing, stationary|jogging|running|rope jumping|jump rope|recumbent bike|skating/i;
const HOLD_PATTERNS = new Set(["static", "anti_extension"]);

function legacyCategory(row: CatalogRow): ExerciseCategory {
  const name = row.name;
  const pattern = (row.movement_pattern ?? "").toLowerCase();
  if (STRETCH_NAME.test(name) || pattern === "stretching" || (row.equipment ?? []).includes("foam_roller")) return "stretching";
  if (CARDIO_NAME.test(name) || pattern === "cardio" || row.primary_muscle === "cardio") return "cardio";
  if (/\b(clean|snatch|jerk)\b/i.test(name)) return "olympic";
  if (/atlas stone|\byoke\b|log lift|tire flip|\bkeg\b/i.test(name) || pattern === "strongman") return "strongman";
  if (pattern === "plyometrics") return "plyometrics";
  return "strength";
}

const COMPOUND_NAME = /press|squat|deadlift|\brow\b|rows\b|pull-?ups?|pullups|chin-?up|\bdips?\b|lunge|step-?ups?|clean|snatch|jerk|push-?ups?|pushups|thrust|good morning|swing|burpee|pull-?down|carry|get-?up|thruster/i;
const ISOLATION_NAME = /curl|extension|raise|\bfly\b|flyes?|kickback|crunch|shrug|pec deck|butterfly|crossover|pushdown|twist/i;

function legacyMechanic(row: CatalogRow, category: ExerciseCategory): Mechanic | null {
  if (category === "stretching" || category === "cardio") return null;
  if (ISOLATION_NAME.test(row.name) && !COMPOUND_NAME.test(row.name)) return "isolation";
  if (COMPOUND_NAME.test(row.name)) return "compound";
  return (row.secondary_muscles ?? []).length >= 2 ? "compound" : "isolation";
}

function legacyRequiredEquipment(tags: readonly string[]): string[] {
  return sortEquipmentKeys(tags.map(equipmentKeyFor).filter((key): key is string => Boolean(key)));
}

function asCategory(value: string | null | undefined): ExerciseCategory | null {
  return value && (EXERCISE_CATEGORIES as readonly string[]).includes(value) ? (value as ExerciseCategory) : null;
}
function asMechanic(value: string | null | undefined): Mechanic | null {
  return value && (MECHANICS as readonly string[]).includes(value) ? (value as Mechanic) : null;
}
function asLevel(value: string | null | undefined): Level {
  return value && (LEVELS as readonly string[]).includes(value) ? (value as Level) : "beginner";
}

/**
 * Turns a catalogue row into a CatalogExercise. Rows from before the clean-up migration get
 * estimates from the older columns, so Home/Gym and equipment filters still work, less precisely.
 */
export function toCatalogExercise(row: CatalogRow): CatalogExercise {
  const curated = Number(row.catalog_version ?? 0) >= 1 && Boolean(asCategory(row.category));
  const category = (curated ? asCategory(row.category) : null) ?? legacyCategory(row);
  const required = curated ? sortEquipmentKeys(row.required_equipment ?? []) : legacyRequiredEquipment(row.equipment ?? []);
  const pattern = (row.movement_pattern ?? "").toLowerCase();
  const prescription: PrescriptionType = curated && row.prescription_type === "time" ? "time"
    : curated ? "reps"
    : category === "stretching" || category === "cardio" || HOLD_PATTERNS.has(pattern) ? "time" : "reps";
  const group = (curated && row.muscle_group ? (row.muscle_group as MuscleGroup) : null) ?? muscleGroupOf(row.primary_muscle) ?? "full_body";
  return {
    id: row.id,
    name: row.name,
    primary_muscle: row.primary_muscle,
    secondary_muscles: row.secondary_muscles ?? [],
    muscle_group: group,
    category,
    mechanic: curated ? asMechanic(row.mechanic) : legacyMechanic(row, category),
    required_equipment: required,
    locations: curated && row.locations?.length ? row.locations : locationsForEquipment(required),
    difficulty: asLevel(row.difficulty),
    movement_pattern: pattern,
    prescription_type: prescription,
    recommended_sets: clamp(Number(row.recommended_sets ?? 3), 1, 10),
    reps_min: clamp(Number(row.reps_min ?? 8), 1, 100),
    reps_max: clamp(Math.max(Number(row.reps_max ?? 12), Number(row.reps_min ?? 8)), 1, 100),
    rest_seconds: clamp(Number(row.rest_seconds ?? 90), 15, 600),
    default_duration_seconds: row.default_duration_seconds ?? (prescription === "time" ? (category === "cardio" ? 600 : 30) : null),
    alternatives: row.alternatives ?? [],
    source_ref: row.source_ref ?? (row.id.startsWith("free-exercise-db-") ? row.id.slice("free-exercise-db-".length) : null),
    curated,
  };
}

function clamp(value: number, min: number, max: number) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : min;
}
