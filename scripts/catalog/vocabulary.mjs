// The training vocabulary, read from the app's own taxonomy so the catalogue can never use a key the
// app does not know. taxonomy.ts has no imports; Node strips its types.
import {
  EQUIPMENT, EQUIPMENT_COVERS, EXERCISE_CATEGORIES, MECHANICS, MUSCLE_TO_GROUP, PRESCRIPTION_TYPES,
} from "../../src/lib/training/taxonomy.ts";

export { EQUIPMENT, EQUIPMENT_COVERS, EXERCISE_CATEGORIES, MECHANICS, MUSCLE_TO_GROUP, PRESCRIPTION_TYPES };

export const EQUIPMENT_KEYS = new Set(EQUIPMENT.map((item) => item.key));
export const HOME_FRIENDLY_KEYS = new Set(EQUIPMENT.filter((item) => item.homeFriendly).map((item) => item.key));
const ORDER = new Map(EQUIPMENT.map((item, index) => [item.key, index]));

/**
 * Equipment keys de-duplicated and in the taxonomy's display order, without items another listed
 * item already covers (a bench also serves as the box or chair; see EQUIPMENT_COVERS).
 */
export function normalizeEquipment(keys) {
  const unique = [...new Set(keys)];
  for (const key of unique) {
    if (!EQUIPMENT_KEYS.has(key)) throw new Error(`Unknown equipment key "${key}"`);
  }
  const covered = new Set(unique.flatMap((key) => EQUIPMENT_COVERS[key] ?? []));
  return unique.filter((key) => !covered.has(key)).sort((a, b) => ORDER.get(a) - ORDER.get(b));
}

/** Always the gym; home as well when every required item is commonly found at home (none counts). */
export function locationsFor(requiredEquipment) {
  return requiredEquipment.every((key) => HOME_FRIENDLY_KEYS.has(key)) ? ["gym", "home"] : ["gym"];
}

export function muscleGroupFor(primaryMuscle) {
  const group = MUSCLE_TO_GROUP[String(primaryMuscle).trim().toLowerCase()];
  if (!group) throw new Error(`No muscle group for primary muscle "${primaryMuscle}"`);
  return group;
}
