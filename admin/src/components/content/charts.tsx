// Server-drawn charts for the content screens. Shapes are SVG that stretches to its box (so a phone gets
// the full width); every word and number is HTML beside it, so text never shrinks with the chart. Each
// chart also has a table or list with the same numbers. Bars grow and lines fade in, and nothing moves
// with reduced motion (content.module.css). The picture is named for screen readers with its stretch of
// time; the scale and axis words beside it are for the eye only (the table reads the numbers).
import { chartName, chartTop } from "./chart-scale";
import styles from "./content.module.css";

export type BarPoint = { label: string; value: number };

/** `unit` "paise" for money: the top line is then whole rupees, and ₹0 when nothing was earned. */
export function BarChart({ points, tone = "ink", label, height = 140, unit = "count", format = (n: number) => n.toLocaleString("en-IN") }: { points: BarPoint[]; tone?: "ink" | "accent" | "good"; label: string; height?: number; unit?: "count" | "paise"; format?: (n: number) => string }) {
  if (!points.length) return null;
  const top = chartTop(Math.max(...points.map((point) => point.value), 0), unit);
  const width = points.length * 10;
  const barClass = tone === "accent" ? styles.barAccent : tone === "good" ? styles.barGood : styles.bar;
  return (
    <figure className={styles.section}>
      <div className={styles.sectionHead} aria-hidden="true">
        <span className={styles.sectionNote}>{format(top)}</span>
      </div>
      <svg className={styles.chart} viewBox={`0 0 ${width} 100`} preserveAspectRatio="none" height={height} role="img" aria-label={chartName(label, points[0].label, points[points.length - 1].label)}>
        <line className={styles.gridline} x1="0" x2={width} y1="0.5" y2="0.5" vectorEffect="non-scaling-stroke" />
        <line className={styles.gridline} x1="0" x2={width} y1="50" y2="50" vectorEffect="non-scaling-stroke" />
        <line className={styles.gridline} x1="0" x2={width} y1="99.5" y2="99.5" vectorEffect="non-scaling-stroke" />
        {points.map((point, index) => {
          const h = top ? (point.value / top) * 98 : 0;
          return (
            <rect key={`${point.label}-${index}`} className={`${barClass} ${styles.grow}`} x={index * 10 + 1.5} y={100 - h} width={7} height={Math.max(h, point.value > 0 ? 1 : 0)} rx="1">
              <title>{`${point.label}: ${format(point.value)}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className={styles.sectionHead} aria-hidden="true">
        <span className={styles.sectionNote}>{points[0].label}</span>
        <span className={styles.sectionNote}>{points[points.length - 1].label}</span>
      </div>
    </figure>
  );
}

export type LineSeries = { key: string; label: string; values: number[]; tone: 1 | 2 | 3 };

export function LineChart({ series, labels, label, height = 200 }: { series: LineSeries[]; labels: string[]; label: string; height?: number }) {
  const count = labels.length;
  if (count < 2 || !series.length) return null;
  const top = chartTop(Math.max(...series.flatMap((line) => line.values), 0));
  const width = 1000;
  const x = (index: number) => (index / (count - 1)) * width;
  const y = (value: number) => 100 - (top ? (value / top) * 96 : 0);
  const path = (values: number[]) => values.map((value, index) => `${index ? "L" : "M"}${x(index).toFixed(1)} ${y(value).toFixed(2)}`).join(" ");
  const lineClass = { 1: styles.line1, 2: styles.line2, 3: styles.line3 } as const;
  const swatch = { 1: styles.swatch1, 2: styles.swatch2, 3: styles.swatch3 } as const;
  const first = series[0];
  return (
    <figure className={styles.section}>
      <ul className={styles.chartLegend}>
        {series.map((line) => (
          <li key={line.key}>
            <i className={swatch[line.tone]} aria-hidden="true" />
            {line.label} <strong>{(line.values[line.values.length - 1] ?? 0).toLocaleString("en-IN")}</strong>
          </li>
        ))}
        <li>Scale to {top.toLocaleString("en-IN")}</li>
      </ul>
      <svg className={styles.chart} viewBox={`0 0 ${width} 100`} preserveAspectRatio="none" height={height} role="img" aria-label={chartName(label, labels[0], labels[count - 1])}>
        {[0.5, 50, 99.5].map((line) => (
          <line key={line} className={styles.gridline} x1="0" x2={width} y1={line} y2={line} vectorEffect="non-scaling-stroke" />
        ))}
        <path className={`${styles.area} ${styles.fade}`} d={`${path(first.values)} L${width} 100 L0 100 Z`} />
        {series.map((line) => (
          <path key={line.key} className={`${lineClass[line.tone]} ${styles.fade}`} d={path(line.values)} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className={styles.sectionHead} aria-hidden="true">
        <span className={styles.sectionNote}>{labels[0]}</span>
        <span className={styles.sectionNote}>{labels[count - 1]}</span>
      </div>
    </figure>
  );
}

/**
 * Shares of a total as labelled meters, largest first. `of` names the whole when the items overlap (a workout has
 * several exercises): "3% of completed workouts".
 */
export function Meters({ items, total, of, format = (n: number) => n.toLocaleString("en-IN") }: { items: Array<{ label: string; value: number }>; total: number; of?: string; format?: (n: number) => string }) {
  return (
    <ul className={styles.meters}>
      {items.map((item) => {
        const share = total > 0 ? item.value / total : 0;
        return (
          <li key={item.label} className={styles.meter}>
            <div className={styles.meterTop}>
              <span>{item.label}</span>
              <span>
                {format(item.value)}
                {total > 0 && ` · ${Math.round(share * 100)}%${of ? ` of ${of}` : ""}`}
              </span>
            </div>
            <svg className={styles.meterTrack} viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true" focusable="false">
              <rect className={styles.meterBg} x="0" y="0" width="100" height="6" rx="3" />
              <rect className={styles.meterFill} x="0" y="0" width={Math.max(share * 100, item.value > 0 ? 1.5 : 0)} height="6" rx="3" />
            </svg>
          </li>
        );
      })}
    </ul>
  );
}

/** Where a food's energy comes from, worked out from its macros (4, 4 and 9 kcal per g): an estimate. */
export function MacroBar({ protein, carbs, fat }: { protein: number; carbs: number; fat: number }) {
  const parts = [protein * 4, carbs * 4, fat * 9];
  const sum = parts.reduce((a, b) => a + b, 0);
  const shares = parts.map((part) => (sum > 0 ? (part / sum) * 100 : 0));
  let offset = 0;
  const classes = [styles.macroProtein, styles.macroCarbs, styles.macroFat];
  return (
    <div className={styles.section}>
      <svg className={styles.macroBar} viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <rect className={styles.macroRest} x="0" y="0" width="100" height="10" />
        {shares.map((share, index) => {
          const rect = <rect key={index} className={classes[index]} x={offset} y="0" width={share} height="10" />;
          offset += share;
          return rect;
        })}
      </svg>
      <ul className={styles.legend3}>
        <li><i className={`${styles.dot} ${styles.dotProtein}`} aria-hidden="true" />Protein {Math.round(shares[0])}%</li>
        <li><i className={`${styles.dot} ${styles.dotCarbs}`} aria-hidden="true" />Carbs {Math.round(shares[1])}%</li>
        <li><i className={`${styles.dot} ${styles.dotFat}`} aria-hidden="true" />Fat {Math.round(shares[2])}%</li>
        <li><i className={`${styles.dot} ${styles.dotMuted}`} aria-hidden="true" />Energy split, estimate</li>
      </ul>
    </div>
  );
}
