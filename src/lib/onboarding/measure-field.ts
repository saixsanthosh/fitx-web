/**
 * What a height or weight field shows and what it means, for setup's dials (MeasureDial) and Profile's fields
 * (HeightField, WeightField): the text for a stored value, the stored value for what is typed, and the value in the
 * unit shown. Values are stored in centimetres and kilograms; the field works in the member's unit (cm or feet and
 * inches, kg or lb) to 0.1, so what is typed is what is shown again and what is checked (see profile-options.ts).
 * No React here, so it runs under `node --test`.
 */
import {
  cmToFeetInches,
  heightFromUnit,
  heightInUnit,
  parseDecimal,
  weightFromUnit,
  weightInUnit,
  type HeightUnit,
  type WeightUnit,
} from "@/lib/domain/profile-options";

export type MeasureKind = "height" | "weight";
/** A field's text: `main` holds centimetres, feet, kilograms or pounds; `inches` is used only for feet and inches. */
export type MeasureText = { main: string; inches: string };

const heightUnit = (unit: string): HeightUnit => (unit === "ft_in" ? "ft_in" : "cm");
const weightUnit = (unit: string): WeightUnit => (unit === "lb" ? "lb" : "kg");

/** A stored value in the unit shown (inches in all for feet and inches), or null when empty or not a number. */
export function measureShown(kind: MeasureKind, unit: string, value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return kind === "height" ? heightInUnit(value, heightUnit(unit)) : weightInUnit(value, weightUnit(unit));
}

/** The stored value (cm or kg) for a value in the unit shown, as the slider and the steppers give it. */
export function measureFromShown(kind: MeasureKind, unit: string, shown: number): number {
  return kind === "height" ? heightFromUnit(shown, heightUnit(unit)) : weightFromUnit(shown, weightUnit(unit));
}

/** The text a field shows for a stored value: "175.5", "150", or feet and inches ("5" and "8.9"); empty when unset. */
export function measureText(kind: MeasureKind, unit: string, value: number | null): MeasureText {
  if (value === null || !Number.isFinite(value)) return { main: "", inches: "" };
  if (kind === "height" && heightUnit(unit) === "ft_in") {
    const { feet, inches } = cmToFeetInches(value);
    return { main: String(feet), inches: String(inches) };
  }
  return { main: String(measureShown(kind, unit, value)), inches: "" };
}

/** The stored value (cm or kg) for a field's text: null when it is empty, NaN when it is not a number. */
export function measureValue(kind: MeasureKind, unit: string, text: MeasureText): number | null {
  if (kind === "height" && heightUnit(unit) === "ft_in") {
    const feet = parseDecimal(text.main);
    const inches = parseDecimal(text.inches);
    if (feet === null && inches === null) return null;
    if (Number.isNaN(feet) || Number.isNaN(inches)) return Number.NaN;
    return heightFromUnit((feet ?? 0) * 12 + (inches ?? 0), "ft_in");
  }
  const typed = parseDecimal(text.main);
  return typed === null || Number.isNaN(typed) ? typed : measureFromShown(kind, unit, typed);
}
