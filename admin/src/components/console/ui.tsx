import type { ReactNode } from "react";
import Link from "next/link";
import { CountUp } from "@/components/motion/count-up";
import { barLayout, percent, shares, sparkPath } from "./chart-math";
import styles from "./console.module.css";

export { styles as consoleStyles };

/** The top of a console page: a short eyebrow, a one-to-three-word title (the page's h1), one meta line. */
export function PageHead({ eyebrow, title, meta, actions }: { eyebrow?: string; title: string; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <header className={`${styles.head} ${styles.rise}`}>
      <div className={styles.headText}>
        {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
        <h1 className={styles.title}>{title}</h1>
        {meta && <p className={styles.meta}>{meta}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}

/** A panel with an h2 and an optional action on the right. */
export function Panel({ title, hint, action, children, flush = false, className = "", id, label }: {
  title?: string; hint?: ReactNode; action?: ReactNode; children: ReactNode; flush?: boolean; className?: string; id?: string; label?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section className={`${styles.panel} ${className}`} id={id} aria-labelledby={title ? headingId : undefined} aria-label={title ? undefined : label}>
      {(title || action) && (
        <div className={styles.panelHead}>
          <div>{title && <h2 className={styles.panelTitle} id={headingId}>{title}</h2>}{hint && <p className={styles.panelHint}>{hint}</p>}</div>
          {action}
        </div>
      )}
      <div className={flush ? styles.panelFlush : styles.panelBody}>{children}</div>
    </section>
  );
}

/** One count with its label. null shows an en dash ("Not known"), never 0. */
export function Kpi({ label, value, hint, unit, href, trend, accent = false }: {
  label: string; value: number | null; hint?: string; unit?: string; href?: string; trend?: readonly number[]; accent?: boolean;
}) {
  const body = (
    <>
      <p className={styles.kpiLabel}>{label}</p>
      <p className={styles.kpiValue}><CountUp value={value} />{unit && value !== null && <span className={styles.kpiUnit}>{unit}</span>}</p>
      {hint && <p className={styles.kpiHint}>{hint}</p>}
      {trend && trend.length > 1 && <Sparkline values={trend} />}
    </>
  );
  const className = `${styles.kpi}${accent ? ` ${styles.kpiAccent}` : ""}`;
  return href ? <Link className={className} href={href}>{body}</Link> : <article className={className}>{body}</article>;
}

export function Sparkline({ values }: { values: readonly number[] }) {
  return (
    <svg className={styles.spark} viewBox="0 0 120 32" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path className={styles.sparkLine} d={sparkPath(values, 120, 32)} pathLength={1} />
    </svg>
  );
}

export type BarPoint = { label: string; value: number };

/**
 * Daily counts as bars that grow in. Each bar names its day and count on hover (SVG title), and screen
 * readers get the whole series as a list.
 */
export function BarChart({ title, points, tone = "coral", unit = "" }: { title: string; points: readonly BarPoint[]; tone?: "coral" | "green" | "slate"; unit?: string }) {
  const width = 600;
  const height = 180;
  const { bars, max } = barLayout(points.map((point) => point.value), { width, height, gap: points.length > 40 ? 2 : 6 });
  const total = points.reduce((sum, point) => sum + point.value, 0);
  const toneClass = tone === "green" ? styles["tone-green"] : tone === "slate" ? styles["tone-slate"] : "";
  const mid = Math.floor((points.length - 1) / 2);
  return (
    <figure className={`${styles.chart} ${toneClass}`}>
      <div className={styles.chartTop} aria-hidden="true"><span>{max.toLocaleString("en-IN")}</span><span>{max > 1 ? (max / 2).toLocaleString("en-IN") : ""}</span></div>
      <div className={styles.chartPlot}>
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${title}: ${total.toLocaleString("en-IN")}${unit} over ${points.length} days`}>
          <g className={styles.grow}>
            {bars.map((bar, index) => (
              <rect key={points[index].label + index} className={`${styles.barRect}${index === bars.length - 1 ? ` ${styles.barLast}` : ""}`} x={bar.x} y={bar.y} width={bar.width} height={bar.height} rx={Math.min(3, bar.width / 2)}>
                <title>{`${points[index].label}: ${points[index].value.toLocaleString("en-IN")}${unit}`}</title>
              </rect>
            ))}
          </g>
        </svg>
      </div>
      {points.length > 0 && (
        <div className={styles.chartAxis} aria-hidden="true">
          <span>{points[0].label}</span>{points.length > 4 && <span>{points[mid].label}</span>}<span>{points[points.length - 1].label}</span>
        </div>
      )}
      <ul className="sr-only">{points.map((point, index) => <li key={point.label + index}>{point.label}: {point.value.toLocaleString("en-IN")}{unit}</li>)}</ul>
    </figure>
  );
}

/** Parts of a whole as one bar plus a legend with counts and shares. Nothing is drawn for a zero total. */
export function SplitBar({ label, segments, empty = "None yet" }: { label: string; segments: ReadonlyArray<{ key: string; label: string; value: number }>; empty?: string }) {
  const { total, parts } = shares(segments);
  const classes = [styles.seg0, styles.seg1, styles.seg2, styles.seg3, styles.seg4];
  if (!total) return <p className={styles.kpiHint}>{empty}</p>;
  return (
    <div className={styles.split}>
      <svg className={styles.splitBar} viewBox="0 0 100 12" preserveAspectRatio="none" role="img" aria-label={`${label}: ${parts.map((part) => `${part.label} ${part.value}`).join(", ")}`}>
        <g className={styles.wipe}>
          {parts.map((part, index) => <rect key={part.key} className={classes[Math.min(index, 4)]} x={part.offset * 100} y={0} width={Math.max(part.share * 100, 0.6)} height={12} />)}
        </g>
      </svg>
      <ul className={styles.legend}>
        {parts.map((part, index) => (
          <li key={part.key}>
            <svg viewBox="0 0 10 10" aria-hidden="true"><rect className={classes[Math.min(index, 4)]} width={10} height={10} rx={3} /></svg>
            <span>{part.label}</span>
            <strong>{part.value.toLocaleString("en-IN")}</strong>
            <em>{percent(part.share)}</em>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A timeline of short entries (recent admin activity, sign-ins). */
export function Feed({ items }: { items: ReadonlyArray<{ id: string | number; title: string; detail: string }> }) {
  return (
    <ol className={styles.feed}>
      {items.map((item) => (
        <li key={item.id}><span className={styles.feedDot} aria-hidden="true" /><span className={styles.feedText}><strong>{item.title}</strong><span>{item.detail}</span></span></li>
      ))}
    </ol>
  );
}

/** A success or error line after an action, announced to screen readers. */
export function Notice({ tone, children }: { tone: "success" | "error"; children: ReactNode }) {
  return <p className={`inline-notice ${tone === "success" ? "notice-success" : "notice-error"}`} role="status">{children}</p>;
}
