/**
 * Body weight in the member's own unit (user_preferences.weight_unit) for Home and Progress. Weights are stored
 * in kilograms everywhere; this only converts what is shown and what is typed, so a pound value never reaches
 * the database.
 */
import { DEFAULT_WEIGHT_UNIT, kgToLb, lbToKg, type WeightUnit } from "./profile-options";

/** The weigh-in range the database and the forms accept, in kilograms. */
export const WEIGHT_RANGE_KG = { min: 30, max: 500 } as const;

export function weightUnitOf(value: unknown): WeightUnit {
  return value === "lb" ? "lb" : DEFAULT_WEIGHT_UNIT;
}

/** A weight (or a change in weight) in the unit, one decimal. */
export function weightIn(kg: number, unit: WeightUnit): number {
  return unit === "lb" ? kgToLb(kg) : Math.round(kg * 10) / 10;
}

/** "78.4" in the unit, always one decimal. */
export function weightText(kg: number, unit: WeightUnit): string {
  return weightIn(kg, unit).toFixed(1);
}

/** What was typed, in the unit, as kilograms (one decimal). */
export function weightToKg(value: number, unit: WeightUnit): number {
  return unit === "lb" ? lbToKg(value) : Math.round(value * 10) / 10;
}

/** "between 30 and 500 kg" / "between 66 and 1102 lb", for messages. */
export function weightRangeText(unit: WeightUnit): string {
  return unit === "lb"
    ? `between ${Math.ceil(kgToLb(WEIGHT_RANGE_KG.min))} and ${Math.floor(kgToLb(WEIGHT_RANGE_KG.max))} lb`
    : `between ${WEIGHT_RANGE_KG.min} and ${WEIGHT_RANGE_KG.max} kg`;
}

/** "kilograms" or "pounds", for field labels. */
export function weightUnitName(unit: WeightUnit): string {
  return unit === "lb" ? "pounds" : "kilograms";
}
