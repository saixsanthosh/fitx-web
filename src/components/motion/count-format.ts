/** The mark shown for a value nobody has logged. Never 0: an unknown value is not a zero. */
export const UNKNOWN_MARK = "–";
export const UNKNOWN_LABEL = "Not known";

/** Whole numbers with thousands separators, British style ("1,240"). */
export function defaultCountFormat(value: number): string {
  return Math.round(value).toLocaleString("en-GB");
}

/** True for a value that can be shown: a finite number. null, undefined and NaN are unknown. */
export function isKnown(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** The text to show for a value, or the unknown mark. */
export function displayCount(value: number | null | undefined, format: (value: number) => string = defaultCountFormat): string {
  return isKnown(value) ? format(value) : UNKNOWN_MARK;
}

/** Where a count-up starts: from the value shown before, or from 0 when nothing was known yet. */
export function countStart(previous: number | null | undefined): number {
  return isKnown(previous) ? previous : 0;
}
