/**
 * Body weight in the member's own unit (user_preferences.weight_unit) for Home and Progress. Weights are stored
 * in kilograms everywhere; this only converts what is shown and what is typed, so a pound value never reaches
 * the database. Pounds are kept to 0.01 kg, so a weigh-in typed in pounds shows again as typed (profile-options.ts).
 */
import { DEFAULT_WEIGHT_UNIT, WEIGHT_LIMITS, weightFromUnit, weightInUnit, type WeightUnit } from "./profile-options";

/** The weigh-in range the database and the forms accept, in kilograms. */
export const WEIGHT_RANGE_KG = { min: 30, max: 500 } as const;

export function weightUnitOf(value: unknown): WeightUnit {
  return value === "lb" ? "lb" : DEFAULT_WEIGHT_UNIT;
}

/** A weight (or a change in weight) in the unit, one decimal. */
export function weightIn(kg: number, unit: WeightUnit): number {
  return weightInUnit(kg, unit);
}

/** "78.4" in the unit, always one decimal. */
export function weightText(kg: number, unit: WeightUnit): string {
  return weightIn(kg, unit).toFixed(1);
}

/** What was typed, in the unit (read to 0.1), as kilograms: 0.1 kg typed in kilograms, 0.01 kg from pounds. */
export function weightToKg(value: number, unit: WeightUnit): number {
  return weightFromUnit(value, unit);
}

/** "between 30 and 500 kg" / "between 67 and 1102 lb" (the whole pounds inside the kilogram range), for messages. */
export function weightRangeText(unit: WeightUnit): string {
  const { min, max } = WEIGHT_LIMITS[unit];
  return `between ${min} and ${max} ${unit}`;
}

/** "kilograms" or "pounds", for field labels. */
export function weightUnitName(unit: WeightUnit): string {
  return unit === "lb" ? "pounds" : "kilograms";
}
