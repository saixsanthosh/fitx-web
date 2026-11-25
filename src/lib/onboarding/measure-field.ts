/**
 * What a height or weight field shows and what it means, for setup's dials (MeasureDial) and Profile's fields
 * (HeightField, WeightField): the text for a stored value, the stored value for what is typed, and the value in the
 * unit shown. Values are stored in centimetres and kilograms; the field works in the member's unit (cm or feet and
 * inches, kg or lb) to 0.1, so what is typed is what is shown again and what is checked (see profile-options.ts).
 * A unit typed after the number is understood ("65kg", "70 kg"), and text that is not a number is never blanked: it
 * stays in the field (as NaN) until the member changes it. No React here, so it runs under `node --test`.
 */
import {
  cmToFeetInches,
  heightFromUnit,
  heightInUnit,
  readMeasureText,
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
const usable = (value: number | null): value is number => value !== null && !Number.isNaN(value);

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

function feetAndInches(feet: number | null, inches: number | null): number | null {
  if (feet === null && inches === null) return null;
  if (Number.isNaN(feet) || Number.isNaN(inches)) return Number.NaN;
  return heightFromUnit((feet ?? 0) * 12 + (inches ?? 0), "ft_in");
}

/**
 * What a field's text means: the stored value (cm or kg; null when empty, NaN when not a number) and the unit it is
 * in. The field's own unit may be typed after the number ("65kg" in kilograms is 65 kg). With `switchable` (the unit
 * can be changed and saved), the other unit may be typed too, and `unit` then names it so the field switches: "150 lb"
 * in kilograms is 150 lb, "175 cm" in the feet box is 175 cm, "5 ft" in centimetres is 5 ft 0 in. Without it, the
 * other unit is not a number here. Only the field's first box can switch; the inches box takes inches.
 */
export function measureRead(kind: MeasureKind, unit: string, text: MeasureText, switchable = true): { unit: HeightUnit | WeightUnit; value: number | null } {
  if (kind === "weight") {
    const own = weightUnit(unit);
    const other: WeightUnit = own === "kg" ? "lb" : "kg";
    const read = readMeasureText(text.main, switchable ? [own, other] : [own]);
    const named = read.unit === other ? other : own;
    return { unit: named, value: usable(read.value) ? weightFromUnit(read.value, named) : read.value };
  }
  if (heightUnit(unit) === "cm") {
    const read = readMeasureText(text.main, switchable ? ["cm", "ft"] : ["cm"]);
    if (read.unit === "ft") return { unit: "ft_in", value: feetAndInches(read.value, null) };
    return { unit: "cm", value: usable(read.value) ? heightFromUnit(read.value, "cm") : read.value };
  }
  const feet = readMeasureText(text.main, switchable ? ["ft", "cm"] : ["ft"]);
  if (feet.unit === "cm") return { unit: "cm", value: usable(feet.value) ? heightFromUnit(feet.value, "cm") : feet.value };
  return { unit: "ft_in", value: feetAndInches(feet.value, readMeasureText(text.inches, ["in"]).value) };
}

/** The stored value (cm or kg) for a field's text in its own unit: null when it is empty, NaN when it is not a number. */
export function measureValue(kind: MeasureKind, unit: string, text: MeasureText): number | null {
  return measureRead(kind, unit, text, false).value;
}

/**
 * The text to keep when the member leaves a field: none (the stored value's own text shows, "65kg" becoming "65") when
 * it reads as a number or is empty, else the text as typed, so nothing typed disappears and the field never looks
 * empty while what it holds is not a number.
 */
export function keptDraft(kind: MeasureKind, unit: string, draft: MeasureText | null): MeasureText | null {
  return draft && Number.isNaN(measureValue(kind, unit, draft)) ? draft : null;
}

/**
 * What a field holds once its unit is switched to `next`, from its draft and its stored `value` before the switch.
 * A draft (text kept because it is not a number, or still being typed) is read again in the new unit, the feet box
 * becoming the centimetre box, and stays as typed while it is still not a number. With no draft the stored value stays
 * as it is and is shown in the new unit. The caller passes the value on with the unit, not as a change of its own, so
 * a message already shown can be said again for it.
 */
export function measureSwitch(kind: MeasureKind, next: string, draft: MeasureText | null, value: number | null): { value: number | null; draft: MeasureText | null } {
  if (!draft) return { value, draft: null };
  const read = measureValue(kind, next, draft);
  return { value: read, draft: Number.isNaN(read) ? draft : null };
}
