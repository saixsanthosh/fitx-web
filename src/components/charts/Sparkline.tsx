import { linePoints, pathFor, seriesStats, summarizeSeries } from "./chart-math";
import styles from "./charts.module.css";

type SparklineProps = {
  /** Values in time order. null / undefined are unknown: the line breaks there, they are never read as 0. */
  values: ReadonlyArray<number | null | undefined>;
  /** What the chart shows, e.g. "Estimated one-rep max". It is the accessible name. */
  label: string;
  /** Renders one value for the text summary and the range labels, e.g. (v) => `${v} kg`. */
  format?: (value: number) => string;
  /** Replaces the generated text summary. */
  summary?: string;
  /** Text under the left and right ends, e.g. dates. */
  startLabel?: string;
  endLabel?: string;
  /** Print the lowest and highest value at the right edge. */
  showRange?: boolean;
  /** Shown when there is no known value. */
  emptyText?: string;
  height?: number;
  className?: string;
};

const WIDTH = 160;

/**
 * A small line chart in an SVG that scales to its container's width. Draws in the primary token,
 * carries an accessible name plus a visually hidden text summary, and animates its line only when the
 * visitor has not asked for reduced motion.
 */
export function Sparkline({ values, label, format = (value) => String(Math.round(value * 100) / 100), summary, startLabel, endLabel, showRange = false, emptyText = "No data yet", height = 48, className = "" }: SparklineProps) {
  const stats = seriesStats(values);
  const text = summary ?? summarizeSeries(values, format, "points");
  if (!stats) {
    return (
      <div className={`flex items-center justify-center rounded-lg border border-dashed border-fitx-border px-3 text-xs text-fitx-text-secondary ${className}`} style={{ minHeight: height }} role="img" aria-label={`${label}. ${emptyText}.`}>
        {emptyText}
      </div>
    );
  }
  const { segments, points } = linePoints(values, WIDTH, height);
  const single = stats.count === 1;
  const lastKnown = [...points].reverse().find((point): point is NonNullable<typeof point> => point !== null);
  const firstSegment = segments[0] ?? [];
  const area = !single && segments.length === 1 ? `${pathFor(firstSegment)} L${firstSegment[firstSegment.length - 1].x} ${height} L${firstSegment[0].x} ${height} Z` : null;
  return (
    <figure className={`m-0 ${className}`}>
      <div className="flex items-stretch gap-2">
        <svg viewBox={`0 0 ${WIDTH} ${height}`} preserveAspectRatio="none" role="img" aria-label={label} className="block min-w-0 flex-1" style={{ height }} focusable="false">
          <title>{label}</title>
          <line x1="0" x2={WIDTH} y1={height - 0.5} y2={height - 0.5} className={styles.baseline} />
          {area ? <path d={area} className={styles.area} /> : null}
          {segments.map((segment, index) => (segment.length > 1 ? <path key={index} d={pathFor(segment)} pathLength={1} data-draw="true" className={styles.line} /> : null))}
          {lastKnown ? <path d={`M${lastKnown.x} ${lastKnown.y}h0`} className={styles.dot} /> : null}
          {segments.filter((segment) => segment.length === 1).map((segment, index) => <path key={`s${index}`} d={`M${segment[0].x} ${segment[0].y}h0`} className={styles.dot} />)}
        </svg>
        {showRange ? (
          <span aria-hidden="true" style={{ height }} className="pointer-events-none flex shrink-0 flex-col justify-between text-[10px] font-semibold tabular-nums text-fitx-text-secondary">
            <span>{format(stats.max)}</span>
            <span>{format(stats.min)}</span>
          </span>
        ) : null}
      </div>
      {startLabel || endLabel ? (
        <div aria-hidden="true" className="mt-1 flex justify-between text-[11px] text-fitx-text-secondary">
          <span>{startLabel}</span>
          <span>{endLabel}</span>
        </div>
      ) : null}
      <figcaption className="sr-only">{text}</figcaption>
    </figure>
  );
}
