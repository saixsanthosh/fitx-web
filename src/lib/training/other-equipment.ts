/**
 * "Other equipment" on the exercise page (spec 03 §7: alternative equipment, where suitable). Pure.
 *
 * Built only from catalogue data: among the ranked substitutes (substitutions.ts rankSubstitutes, which already
 * keeps the same category and muscle group), the exercises with the same primary muscle and the same mechanic
 * whose equipment differs from this one's. One per equipment set, the best-ranked, so the list reads as a choice
 * of equipment. They are similar movements for the same muscle, not the same movement: the page says so.
 */
import type { CatalogExercise } from "./catalog";
import { equipmentLabel } from "./equipment";
import type { Substitute } from "./substitutions";

export type EquipmentOption = {
  /** The equipment set, as a stable key: required keys joined with "+", or "none". */
  signature: string;
  /** The icon to draw: the first required key, or "none" for no equipment. */
  icon: string;
  /** "Dumbbells", "Cable machine + Weight bench", "No equipment". */
  label: string;
  exercise: CatalogExercise;
  /** Equipment the member would still need (empty when they have it all). */
  missing: string[];
};

export const OTHER_EQUIPMENT_LIMIT = 4;

/** Kit few members can choose to use (chains, sleds, strongman implements): offered after everything else. */
const SPECIALIST_EQUIPMENT: ReadonlySet<string> = new Set(["specialty", "strongman_implements", "sled"]);

/** The equipment an exercise needs, as one key ("none" for none); order-independent. */
export function equipmentSignature(keys: readonly string[]): string {
  return keys.length ? [...new Set(keys)].sort().join("+") : "none";
}

export function equipmentSetLabel(keys: readonly string[]): string {
  return keys.length ? keys.map(equipmentLabel).join(" + ") : "No equipment";
}

/**
 * One similar movement per other equipment set, at most `limit`: ones the member can do first (in rank order),
 * then the rest (in rank order), and those needing specialist kit (chains, sleds, strongman implements) last.
 * Nothing when the substitutes hold no such movement.
 */
export function otherEquipmentOptions(target: CatalogExercise, substitutes: readonly Substitute[], limit = OTHER_EQUIPMENT_LIMIT): EquipmentOption[] {
  const own = equipmentSignature(target.required_equipment);
  const bySignature = new Map<string, EquipmentOption>();
  for (const { exercise, missing } of substitutes) {
    if (exercise.id === target.id || exercise.primary_muscle !== target.primary_muscle || exercise.mechanic !== target.mechanic) continue;
    if (exercise.category !== target.category) continue;
    const signature = equipmentSignature(exercise.required_equipment);
    if (signature === own || bySignature.has(signature)) continue;
    // Everything this exercise needs plus more (a barbell lift with bands and a rack) is not other equipment.
    if (target.required_equipment.length && target.required_equipment.every((key) => exercise.required_equipment.includes(key))) continue;
    bySignature.set(signature, {
      signature,
      icon: exercise.required_equipment[0] ?? "none",
      label: equipmentSetLabel(exercise.required_equipment),
      exercise,
      missing: [...missing],
    });
  }
  const options = [...bySignature.values()];
  const specialist = (option: EquipmentOption) => option.exercise.required_equipment.some((key) => SPECIALIST_EQUIPMENT.has(key));
  return [
    ...options.filter((option) => !option.missing.length && !specialist(option)),
    ...options.filter((option) => option.missing.length > 0 && !specialist(option)),
    ...options.filter(specialist),
  ].slice(0, Math.max(0, limit));
}

/** The substitutes not already shown as other equipment, so no exercise is listed twice on the page. */
export function substitutesWithout(substitutes: readonly Substitute[], shown: readonly EquipmentOption[]): Substitute[] {
  const ids = new Set(shown.map((option) => option.exercise.id));
  return substitutes.filter((substitute) => !ids.has(substitute.exercise.id));
}
