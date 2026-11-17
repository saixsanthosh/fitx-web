/** Geometry and text for the chart components. Pure, so node tests can cover it. */

export type Point = { x: number; y: number };
export type SeriesStats = { count: number; first: number; last: number; min: number; max: number };

/** The numbers in a series that are real (finite); null, undefined and NaN are unknown, never 0. */
export function knownValues(values: ReadonlyArray<number | null | undefined>): number[] {
  return values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

export function seriesStats(values: ReadonlyArray<number | null | undefined>): SeriesStats | null {
  const known = knownValues(values);
  if (!known.length) return null;
  return { count: known.length, first: known[0], last: known[known.length - 1], min: Math.min(...known), max: Math.max(...known) };
}

/**
 * Line geometry in a box of `width` x `height` with `pad` all round. Unknown values break the line
 * into segments instead of being drawn as 0. A flat series sits in the middle.
 */
export function linePoints(
  values: ReadonlyArray<number | null | undefined>,
  width: number,
  height: number,
  pad = 4,
): { segments: Point[][]; points: Array<Point | null> } {
  const stats = seriesStats(values);
  const points: Array<Point | null> = [];
  const segments: Point[][] = [];
  if (!stats) return { segments, points: values.map(() => null) };
  const span = stats.max - stats.min;
  const innerWidth = Math.max(0, width - pad * 2);
  const innerHeight = Math.max(0, height - pad * 2);
  const last = Math.max(1, values.length - 1);
  let current: Point[] = [];
  values.forEach((value, index) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      points.push(null);
      if (current.length) segments.push(current);
      current = [];
      return;
    }
    const x = values.length === 1 ? width / 2 : pad + (innerWidth * index) / last;
    const y = span === 0 ? height / 2 : pad + innerHeight * (1 - (value - stats.min) / span);
    const point = { x: round(x), y: round(y) };
    points.push(point);
    current.push(point);
  });
  if (current.length) segments.push(current);
  return { segments, points };
}

const round = (value: number) => Math.round(value * 100) / 100;

/** An SVG path for one segment ("M x y L x y ..."). A single point yields a zero-length stroke. */
export function pathFor(segment: readonly Point[]): string {
  return segment.map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`).join(" ");
}

/** Bar heights as 0..1 of the tallest bar; unknown values are null. Negative values are treated as unknown. */
export function barFractions(values: ReadonlyArray<number | null | undefined>): Array<number | null> {
  const known = knownValues(values).filter((value) => value >= 0);
  const max = known.length ? Math.max(...known) : 0;
  return values.map((value) => (typeof value !== "number" || !Number.isFinite(value) || value < 0 ? null : max === 0 ? 0 : value / max));
}

/**
 * Which label indexes to print so they do not collide: always the first and last (only the last when
 * maxLabels < 2), evenly thinned between, never more than maxLabels and never two closer than an even spread
 * of maxLabels would put them.
 */
export function labelIndexes(count: number, maxLabels: number): number[] {
  if (count <= 0) return [];
  if (count <= maxLabels || maxLabels < 2) return count <= maxLabels ? Array.from({ length: count }, (_, i) => i) : [count - 1];
  const last = count - 1;
  const spacing = last / (maxLabels - 1);
  const step = Math.ceil(spacing);
  const picked: number[] = [];
  for (let index = 0; index <= last; index += step) picked.push(index);
  const end = picked[picked.length - 1];
  if (end !== last) {
    // The last label is always shown; the stepped label before it stays only when it is far enough away.
    if (last - end < spacing) picked.pop();
    picked.push(last);
  }
  return picked;
}

/** A plain-text summary for screen readers. `format` renders one value (with its unit). */
export function summarizeSeries(
  values: ReadonlyArray<number | null | undefined>,
  format: (value: number) => string,
  noun = "values",
): string {
  const stats = seriesStats(values);
  if (!stats) return "No data yet.";
  const unknown = values.length - stats.count;
  const gaps = unknown > 0 ? ` ${unknown} ${unknown === 1 ? "entry is" : "entries are"} unknown and left out.` : "";
  if (stats.count === 1) return `One of ${values.length} ${noun} is known: ${format(stats.last)}.${gaps}`;
  return `${stats.count} ${noun}, from ${format(stats.first)} to ${format(stats.last)}. Lowest ${format(stats.min)}, highest ${format(stats.max)}.${gaps}`;
}
