import { HEIGHT_LIMITS, WEIGHT_LIMITS } from "@/lib/domain/profile-options";

/**
 * The slider ranges of setup's height and weight dials, in the unit shown. The slider covers where nearly
 * everyone is; typing still accepts the full ranges (HEIGHT_LIMITS, WEIGHT_LIMITS). `start` is where the
 * thumb rests while nothing is set (the value stays empty until the member moves it).
 */
export type DialKind = "height" | "weight";
export type DialScale = { min: number; max: number; step: number; start: number };

export function dialScale(kind: DialKind, unit: string): DialScale {
  if (kind === "height") return unit === "ft_in" ? { min: 48, max: 86, step: 1, start: 67 } : { min: 120, max: 220, step: 1, start: 170 };
  return unit === "lb" ? { min: 77, max: 440, step: 1, start: 155 } : { min: 35, max: 200, step: 0.5, start: 70 };
}

/** The limits FITX takes for a dial, in the unit shown (inches in all for feet and inches). */
export function dialLimits(kind: DialKind, unit: string): { min: number; max: number } {
  return kind === "height" ? HEIGHT_LIMITS[unit === "ft_in" ? "ft_in" : "cm"] : WEIGHT_LIMITS[unit === "lb" ? "lb" : "kg"];
}

/**
 * What a press of + (1) or − (-1) gives, from the value shown (in the unit shown, or null while nothing is set):
 * the next whole step above or below, as a number field's own stepper does, so 150 lb goes to 151 and 149.6 lb to
 * 150. It moves from the value itself, not from where the slider's thumb stops, and stays inside the limits FITX
 * takes. With nothing set it starts from the thumb's resting place.
 */
export function dialStep(kind: DialKind, unit: string, shown: number | null, direction: 1 | -1): number {
  const { step, start } = dialScale(kind, unit);
  const { min, max } = dialLimits(kind, unit);
  const from = shown === null || !Number.isFinite(shown) ? start : shown;
  // A hair of slack so 70.00000000001 kg counts as on the 0.5 kg grid.
  const slots = from / step;
  const next = (direction > 0 ? Math.floor(slots + 1e-9) + 1 : Math.ceil(slots - 1e-9) - 1) * step;
  return Math.min(max, Math.max(min, Math.round(next * 10) / 10));
}
