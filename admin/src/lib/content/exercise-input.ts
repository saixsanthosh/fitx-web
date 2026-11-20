// Reads and checks the exercise form. Pure; the same rules run again in fitx_admin_op_save_exercise.
import { checked, lines, oneOf, text, texts, wholeNumber, type FieldErrors, type FormLike } from "./form";
import {
  EQUIPMENT,
  EQUIPMENT_KEYS,
  EXERCISE_CATEGORIES,
  LEVELS,
  LOCATIONS,
  MECHANICS,
  MUSCLE_TO_GROUP,
  PRESCRIPTION_TYPES,
  muscleGroupOf,
} from "./vocabulary";

export const EXERCISE_ID = /^[A-Za-z0-9_-]{1,120}$/;

export type ExercisePayload = {
  name: string;
  description: string;
  primary_muscle: string;
  muscle_group: string;
  secondary_muscles: string[];
  category: string | null;
  mechanic: string | null;
  difficulty: string;
  movement_pattern: string;
  required_equipment: string[];
  equipment: string[];
  locations: string[];
  instructions: string[];
  recommended_sets: number;
  reps_min: number;
  reps_max: number;
  rest_seconds: number;
  prescription_type: string;
  default_duration_seconds: number | null;
  attribution: string;
  is_active?: boolean;
};

export type ExerciseParse = { ok: true; value: ExercisePayload } | { ok: false; errors: FieldErrors };

/**
 * Where the exercise can be done follows from its equipment, as in the catalogue: home and gym when everything
 * it needs is commonly found at home (or it needs nothing), else gym only. Outdoor is kept when chosen.
 */
export function deriveLocations(required: readonly string[], outdoor: boolean): string[] {
  const homeOk = required.every((key) => EQUIPMENT.find((item) => item.key === key)?.homeFriendly);
  return [...(homeOk ? ["gym", "home"] : ["gym"]), ...(outdoor ? ["outdoor"] : [])];
}

export function parseExerciseForm(form: FormLike, { creating }: { creating: boolean }): ExerciseParse {
  const errors: FieldErrors = {};
  const name = text(form, "name", 200);
  if (name.length < 2 || name.length > 120) errors.name = "Use 2 to 120 characters.";
  const description = text(form, "description", 2100);
  if (description.length > 2000) errors.description = "Keep it under 2,000 characters.";

  const primary = text(form, "primary_muscle", 40);
  const group = muscleGroupOf(primary);
  if (!Object.hasOwn(MUSCLE_TO_GROUP, primary) || !group) errors.primary_muscle = "Choose the main muscle.";
  const secondary = [...new Set(texts(form, "secondary_muscles", 40).filter((muscle) => Object.hasOwn(MUSCLE_TO_GROUP, muscle) && muscle !== primary))];
  if (secondary.length > 12) errors.secondary_muscles = "Choose at most 12.";

  const categoryText = text(form, "category", 40);
  const category = categoryText ? oneOf(categoryText, EXERCISE_CATEGORIES) : null;
  if (categoryText && !category) errors.category = "Choose a category.";
  const mechanicText = text(form, "mechanic", 40);
  const mechanic = mechanicText ? oneOf(mechanicText, MECHANICS) : null;
  if (mechanicText && !mechanic) errors.mechanic = "Choose compound or isolation.";
  const difficulty = oneOf(text(form, "difficulty", 40), LEVELS);
  if (!difficulty) errors.difficulty = "Choose a level.";
  const pattern = text(form, "movement_pattern", 40);
  if (!/^[a-z][a-z_]{1,39}$/.test(pattern)) errors.movement_pattern = "Choose a movement pattern.";

  const required = [...new Set(texts(form, "required_equipment", 40))];
  if (required.some((key) => !EQUIPMENT_KEYS.includes(key))) errors.required_equipment = "Choose from the list.";
  if (required.length > 12) errors.required_equipment = "Choose at most 12.";

  const instructions = lines(form, "instructions", 21, 501);
  if (instructions.length > 20) errors.instructions = "Use at most 20 steps.";
  if (instructions.some((step) => step.length > 500)) errors.instructions = "Keep each step under 500 characters.";

  const prescription = oneOf(text(form, "prescription_type", 10) || "reps", PRESCRIPTION_TYPES);
  if (!prescription) errors.prescription_type = "Choose reps or time.";
  const sets = wholeNumber(form, "recommended_sets");
  if (sets === null || !Number.isInteger(sets) || sets < 1 || sets > 10) errors.recommended_sets = "1 to 10.";
  const repsMin = wholeNumber(form, "reps_min");
  const repsMax = wholeNumber(form, "reps_max");
  if (repsMin === null || !Number.isInteger(repsMin) || repsMin < 1 || repsMin > 100) errors.reps_min = "1 to 100.";
  if (repsMax === null || !Number.isInteger(repsMax) || repsMax < 1 || repsMax > 100) errors.reps_max = "1 to 100.";
  else if (repsMin !== null && Number.isInteger(repsMin) && repsMax < repsMin) errors.reps_max = "At least the lowest.";
  const rest = wholeNumber(form, "rest_seconds");
  if (rest === null || !Number.isInteger(rest) || rest < 15 || rest > 600) errors.rest_seconds = "15 to 600 seconds.";
  const duration = wholeNumber(form, "default_duration_seconds");
  if (duration !== null && (!Number.isInteger(duration) || duration < 5 || duration > 7200)) errors.default_duration_seconds = "5 to 7,200 seconds.";
  if (prescription === "time" && duration === null) errors.default_duration_seconds = "A timed exercise needs a duration.";

  const attribution = text(form, "attribution", 250) || "FITX";
  if (attribution.length > 200) errors.attribution = "Keep it under 200 characters.";

  if (Object.keys(errors).length || !group || !difficulty || !prescription) return { ok: false, errors };
  const locations = deriveLocations(required, checked(form, "outdoor"));
  if (!locations.every((place) => (LOCATIONS as readonly string[]).includes(place))) return { ok: false, errors: { locations: "Choose where it can be done." } };
  return {
    ok: true,
    value: {
      name,
      description,
      primary_muscle: primary,
      muscle_group: group,
      secondary_muscles: secondary,
      category,
      mechanic,
      difficulty,
      movement_pattern: pattern,
      required_equipment: required,
      // The older free-text column: the same keys, or "bodyweight" for none, as the catalogue clean-up wrote it.
      equipment: required.length ? required : ["bodyweight"],
      locations,
      instructions,
      recommended_sets: sets as number,
      reps_min: repsMin as number,
      reps_max: repsMax as number,
      rest_seconds: rest as number,
      prescription_type: prescription,
      default_duration_seconds: duration,
      attribution,
      ...(creating ? { is_active: checked(form, "is_active") } : {}),
    },
  };
}
