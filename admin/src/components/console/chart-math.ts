// Geometry for the console's SVG charts. No imports, so tests can load it. Inputs are counts; a null
// (unknown) value is never drawn as zero: callers leave it out or show an en dash.

/** The smallest "nice" number (1, 2, 5 × 10^n) at or above the value, so axis ticks stay round. */
export function niceCeiling(value: number): number {
  if (!Number.isFinite(value) || value <= 1) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const scaled = value / power;
  const nice = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return nice * power;
}

export type Bar = { x: number; y: number; width: number; height: number };

/** Bars across `width`, growing up from the bottom of `height`; a zero still shows a 2-unit stub. */
export function barLayout(values: readonly number[], { width, height, gap = 4 }: { width: number; height: number; gap?: number }): { bars: Bar[]; max: number } {
  const max = niceCeiling(Math.max(0, ...values));
  if (!values.length) return { bars: [], max };
  const slot = width / values.length;
  const barWidth = Math.max(1, slot - gap);
  const bars = values.map((value, index) => {
    const h = Math.max(2, (Math.max(0, value) / max) * height);
    return { x: index * slot + (slot - barWidth) / 2, y: height - h, width: barWidth, height: h };
  });
  return { bars, max };
}

/** A smooth-enough polyline for a sparkline, inset by the stroke so it never clips. */
export function sparkPath(values: readonly number[], width: number, height: number, inset = 2): string {
  if (!values.length) return "";
  const max = Math.max(1, ...values);
  const step = values.length === 1 ? 0 : (width - inset * 2) / (values.length - 1);
  return values
    .map((value, index) => {
      const x = values.length === 1 ? width / 2 : inset + index * step;
      const y = inset + (height - inset * 2) * (1 - Math.max(0, value) / max);
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

export type Share = { key: string; label: string; value: number; share: number; offset: number };

/** Each segment's share of the total and where it starts (0 to 1); nothing when the total is 0. */
export function shares(segments: ReadonlyArray<{ key: string; label: string; value: number }>): { total: number; parts: Share[] } {
  const clean = segments.filter((segment) => Number.isFinite(segment.value) && segment.value > 0);
  const total = clean.reduce((sum, segment) => sum + segment.value, 0);
  if (!total) return { total: 0, parts: [] };
  let offset = 0;
  const parts = clean.map((segment) => {
    const share = segment.value / total;
    const part = { ...segment, share, offset };
    offset += share;
    return part;
  });
  return { total, parts };
}

export type TotalShare = { key: string; label: string; value: number; share: number | null };

/**
 * Each part as a share of a whole the parts may overlap, such as accounts per sign-in method (an account with email and
 * Google counts in both): value / total, at most 1, largest first. The share is null when the total is unknown or 0.
 * Use shares() instead for parts that split a whole.
 */
export function sharesOfTotal(segments: ReadonlyArray<{ key: string; label: string; value: number }>, total: number | null): TotalShare[] {
  return segments
    .filter((segment) => Number.isFinite(segment.value) && segment.value > 0)
    .sort((a, b) => b.value - a.value)
    .map((segment) => ({ ...segment, share: total !== null && Number.isFinite(total) && total > 0 ? Math.min(1, segment.value / total) : null }));
}

/** "12%" for a share; under 1% but above 0 reads "<1%". */
export function percent(share: number): string {
  if (!Number.isFinite(share) || share <= 0) return "0%";
  if (share < 0.01) return "<1%";
  return `${Math.round(share * 100)}%`;
}

/** The change between the two halves of a series (newer half minus older half), or null when too short. */
export function halfChange(values: readonly number[]): number | null {
  if (values.length < 4) return null;
  const half = Math.floor(values.length / 2);
  const older = values.slice(0, half).reduce((sum, value) => sum + value, 0);
  const newer = values.slice(values.length - half).reduce((sum, value) => sum + value, 0);
  return newer - older;
}

/**
 * The average per day of each half of a daily series (newer and older), or null when too short. Use this for
 * daily counts of distinct accounts: summing them counts account-days, which is not comparable to a headline
 * count of distinct accounts.
 */
export function halfAverages(values: readonly number[]): { newer: number; older: number } | null {
  if (values.length < 4) return null;
  const half = Math.floor(values.length / 2);
  const mean = (part: readonly number[]) => part.reduce((sum, value) => sum + value, 0) / part.length;
  return { newer: mean(values.slice(values.length - half)), older: mean(values.slice(0, half)) };
}

/** "Avg 7.3 a day, 6.1 the 15 days before", from a daily series; undefined when too short. */
export function dailyAverageHint(values: readonly number[]): string | undefined {
  const averages = halfAverages(values);
  if (!averages) return undefined;
  const half = Math.floor(values.length / 2);
  const format = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 1 });
  return `Avg ${format(averages.newer)} a day, ${format(averages.older)} the ${half} days before`;
}
