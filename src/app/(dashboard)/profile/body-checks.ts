/**
 * Profile > Body's height and weight messages (bugs 32 and 8 on Profile; the onboarding stream's edit H2).
 *
 * Setup and Profile check a height or weight the same way: in the unit it is shown in, against HEIGHT_LIMITS and
 * WEIGHT_LIMITS, so a message names exactly the limits that are accepted (2 ft 11 in is under 90 cm, so the feet and
 * inches message starts at 3 ft 0 in), and text that is not a number gets its own message in that unit
 * (profile-options.ts heightError / weightError). Profile's height may be left empty; its weight may not.
 *
 * No React here, so node tests cover it (tests/profile/body-units.test.ts); BodySection draws the messages.
 */
import { heightError, weightError, type HeightUnit, type WeightUnit } from "@/lib/domain/profile-options";
import type { MeasureKey } from "@/lib/onboarding/form";

/** The parts of Profile's Body draft the checks read: values in cm and kg (null when empty, NaN when not a number). */
export type BodyMeasures = {
  heightCm: number | null;
  heightUnit: HeightUnit;
  weightKg: number | null;
  weightUnit: WeightUnit;
  targetWeightKg: number | null;
};

export type MeasureProblems = Partial<Record<MeasureKey, string>>;

/** Why the height, weight or target weight can't be saved, each in the unit it is shown in; nothing when they can. */
export function bodyMeasureProblems(draft: BodyMeasures): MeasureProblems {
  const found: MeasureProblems = {};
  const height = heightError(draft.heightCm, draft.heightUnit, { optional: true });
  if (height) found.heightCm = height;
  const weight = draft.weightKg === null ? "Add your weight." : weightError(draft.weightKg, draft.weightUnit);
  if (weight) found.weightKg = weight;
  const target = weightError(draft.targetWeightKg, draft.weightUnit, { target: true });
  if (target) found.targetWeightKg = target;
  return found;
}
