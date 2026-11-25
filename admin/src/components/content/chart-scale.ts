// The top line of the content screens' bar and line charts (charts.tsx). No imports, so tests can load it.

/** The smallest 1, 2 or 5 × 10^n at or above `value` (value > 0). */
function niceAbove(value: number): number {
  const power = 10 ** Math.floor(Math.log10(value));
  const scaled = value / power;
  return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10) * power;
}

/**
 * The value the top line stands for. Counts: a round number, at least 5. Money in paise: a round number of whole
 * rupees at or above the largest value, and 0 when nothing was earned, so the label never shows a figure nobody
 * earned (it read "₹0.05", 5 paise, over months of ₹0).
 */
export function chartTop(max: number, unit: "count" | "paise" = "count"): number {
  const value = Number.isFinite(max) && max > 0 ? max : 0;
  if (unit === "paise") return value === 0 ? 0 : niceAbove(Math.ceil(value / 100)) * 100;
  return value <= 5 ? 5 : niceAbove(value);
}

/** What a chart's picture is called for screen readers: its name and the stretch of time it covers. */
export function chartName(label: string, first: string | undefined, last: string | undefined): string {
  if (!first || !last) return label;
  return first === last ? `${label}, ${first}` : `${label}, ${first} to ${last}`;
}
