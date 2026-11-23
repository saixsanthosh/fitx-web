/**
 * The slider ranges of setup's height and weight dials, in the unit shown. The slider covers where nearly
 * everyone is; typing still accepts the full ranges (HEIGHT_RANGE_CM, WEIGHT_RANGE_KG). `start` is where the
 * thumb rests while nothing is set (the value stays empty until the member moves it).
 */
export type DialKind = "height" | "weight";
export type DialScale = { min: number; max: number; step: number; start: number };

export function dialScale(kind: DialKind, unit: string): DialScale {
  if (kind === "height") return unit === "ft_in" ? { min: 48, max: 86, step: 1, start: 67 } : { min: 120, max: 220, step: 1, start: 170 };
  return unit === "lb" ? { min: 77, max: 440, step: 1, start: 155 } : { min: 35, max: 200, step: 0.5, start: 70 };
}
