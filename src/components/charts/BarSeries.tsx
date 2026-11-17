import { barFractions, labelIndexes, summarizeSeries } from "./chart-math";
import styles from "./charts.module.css";

export type BarDatum = {
  /** The axis label (a day, a week, a muscle). */
  label: string;
  /** null = unknown: drawn as a dashed outline, never as an empty or zero bar. */
  value: number | null | undefined;
  /** A fuller label for the text summary, e.g. "Monday 3 November". */
  longLabel?: string;
  /** Draw this bar in the muted tone (e.g. a period still in progress). */
  muted?: boolean;
};

type BarSeriesProps = {
  data: readonly BarDatum[];
  /** What the chart shows. It is the accessible name. */
  label: string;
  /** Renders one value, e.g. (v) => `${v} sets`. */
  format?: (value: number) => string;
  /** Replaces the generated text summary. */
  summary?: string;
  /** Print the value above each bar (use for up to about 8 bars). */
  showValues?: boolean;
  /** Most axis labels to print before thinning them out. */
  maxLabels?: number;
  emptyText?: string;
  height?: number;
  className?: string;
};

const BAR_BOX = 100;
/** Bar height in the 0..100 drawing box: a visible stub for tiny values, none for zero. */
const barHeightFor = (fraction: number) => (fraction === 0 ? 0 : Math.max(2, fraction * (BAR_BOX - 6)));

/**
 * A column chart: SVG bars from a zero baseline, HTML axis labels below, an accessible name plus a
 * visually hidden list of every value. Unknown values are shown as such. Bars grow only when motion is allowed.
 */
export function BarSeries({ data, label, format = (value) => String(Math.round(value * 100) / 100), summary, showValues = false, maxLabels = 7, emptyText = "No data yet", height = 120, className = "" }: BarSeriesProps) {
  const values = data.map((item) => item.value);
  const fractions = barFractions(values);
  const anyKnown = fractions.some((fraction) => fraction !== null);
  if (!data.length || !anyKnown) {
    return (
      <div className={`flex items-center justify-center rounded-lg border border-dashed border-fitx-border px-3 text-sm text-fitx-text-secondary ${className}`} style={{ minHeight: height }} role="img" aria-label={`${label}. ${emptyText}.`}>
        {emptyText}
      </div>
    );
  }
  const shown = new Set(labelIndexes(data.length, maxLabels));
  const list = data.map((item) => `${item.longLabel ?? item.label}: ${typeof item.value === "number" && Number.isFinite(item.value) ? format(item.value) : "unknown"}`).join("; ");
  const text = summary ?? `${summarizeSeries(values, format, "bars")} ${list}.`;
  const step = BAR_BOX / data.length;
  const barWidth = step * 0.62;
  return (
    <figure className={`m-0 ${className}`}>
      <div role="img" aria-label={label}>
        <div className="relative" style={{ height, marginTop: showValues ? 16 : 0 }}>
          <svg viewBox={`0 0 ${BAR_BOX} ${BAR_BOX}`} preserveAspectRatio="none" className="block h-full w-full" focusable="false" aria-hidden="true">
            <line x1="0" x2={BAR_BOX} y1={BAR_BOX - 0.5} y2={BAR_BOX - 0.5} className={styles.baseline} />
            {fractions.map((fraction, index) => {
              const x = step * index + (step - barWidth) / 2;
              if (fraction === null) return <rect key={index} x={x} y={BAR_BOX - 16} width={barWidth} height={16} rx={1.5} className={styles.unknown} />;
              const barHeight = barHeightFor(fraction);
              return <rect key={index} x={x} y={BAR_BOX - barHeight} width={barWidth} height={barHeight} rx={1.5} data-muted={data[index].muted ? "true" : undefined} className={styles.bar} style={{ animationDelay: `${Math.min(index, 20) * 25}ms` }} />;
            })}
          </svg>
          {showValues ? (
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }}>
              {data.map((item, index) => {
                const fraction = fractions[index];
                return (
                  <span key={index} className="relative min-w-0 text-center text-[10px] font-semibold tabular-nums text-fitx-text-secondary">
                    <span className="absolute inset-x-0" style={{ bottom: `${fraction === null ? 16 : barHeightFor(fraction)}%`, paddingBottom: 2 }}>
                      {typeof item.value === "number" && Number.isFinite(item.value) ? format(item.value) : "—"}
                    </span>
                  </span>
                );
              })}
            </div>
          ) : null}
        </div>
        <div aria-hidden="true" className="mt-1 grid" style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }}>
          {data.map((item, index) => (
            <span key={index} className="min-w-0 truncate text-center text-[11px] text-fitx-text-secondary" style={{ visibility: shown.has(index) ? "visible" : "hidden" }}>{item.label}</span>
          ))}
        </div>
      </div>
      <figcaption className="sr-only">{text}</figcaption>
    </figure>
  );
}
