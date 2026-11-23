"use client";

import { useId, useState, type KeyboardEvent } from "react";
import type { SeriesPoint } from "./period";
import styles from "./Progress.module.css";

type TrendBarsProps = {
  points: readonly SeriesPoint[];
  /** The chart's accessible name. */
  label: string;
  format: (value: number) => string;
  /** A target line (calories a day, workouts a week…); drawn only when known. */
  target?: number | null;
  targetLabel?: string;
  tone?: "primary" | "food" | "protein";
  emptyText: string;
  height?: number;
};

const LABEL_LIMIT = 12;

/**
 * Columns that grow from a zero line and glide to their new heights when the period changes (transform only;
 * still under reduced motion). Unknown buckets are a dashed outline, future ones are left blank, and a real
 * zero is a hairline. Arrow keys or a pointer pick a column; the readout above says its value.
 */
export function TrendBars({ points, label, format, target = null, targetLabel, tone = "primary", emptyText, height = 148 }: TrendBarsProps) {
  const id = useId();
  const [picked, setPicked] = useState<number | null>(null);
  const known = points.map((point) => point.value).filter((value): value is number => value !== null);
  const max = Math.max(...known, target ?? 0, 0);
  const anyValue = known.some((value) => value > 0);
  const current = picked !== null && picked < points.length ? picked : null;
  const latest = [...points].reverse().find((point) => !point.future) ?? null;
  const shown = current !== null ? points[current] : latest;
  const step = Math.max(1, Math.ceil(points.length / LABEL_LIMIT));

  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!points.length) return;
    const from = current ?? points.findLastIndex((point) => !point.future);
    if (event.key === "ArrowRight") setPicked(Math.min(points.length - 1, from + 1));
    else if (event.key === "ArrowLeft") setPicked(Math.max(0, from - 1));
    else if (event.key === "Home") setPicked(0);
    else if (event.key === "End") setPicked(points.length - 1);
    else if (event.key === "Escape") setPicked(null);
    else return;
    event.preventDefault();
  }

  if (!anyValue) {
    return <div className={styles.chartEmpty} style={{ minHeight: height }} role="img" aria-label={`${label}. ${emptyText}.`}>{emptyText}</div>;
  }

  const summary = points.filter((point) => !point.future).map((point) => `${point.longLabel}: ${point.value === null ? "not logged" : format(point.value)}`).join("; ");
  return (
    <figure className={styles.bars} data-tone={tone}>
      <p className={styles.readout} aria-live="polite" id={`${id}-readout`}>
        {shown ? <><span>{shown.longLabel}</span><strong>{shown.future ? "Ahead" : shown.value === null ? "Not logged" : format(shown.value)}</strong></> : null}
      </p>
      <div
        className={styles.barsPlot}
        style={{ height }}
        role="group"
        aria-label={`${label}. Use the arrow keys to read each value.`}
        aria-describedby={`${id}-readout`}
        tabIndex={0}
        onKeyDown={onKey}
        onPointerLeave={() => setPicked(null)}
        onBlur={() => setPicked(null)}
      >
        {target !== null && target > 0 && max > 0 ? (
          <div className={styles.targetLine} style={{ transform: `translateY(${-(target / max) * height}px)` }} aria-hidden="true">
            {targetLabel ? <span>{targetLabel}</span> : null}
          </div>
        ) : null}
        {points.map((point, index) => {
          const fraction = point.value !== null && max > 0 ? point.value / max : 0;
          const state = point.future ? "future" : point.value === null ? "unknown" : point.value === 0 ? "zero" : "value";
          return (
            <div
              key={index}
              className={styles.barSlot}
              data-state={state}
              data-picked={current === index ? "" : undefined}
              onPointerEnter={() => setPicked(index)}
              onPointerDown={() => setPicked(index)}
              aria-hidden="true"
            >
              <span className={styles.barFill} style={{ transform: `scaleY(${state === "value" ? Math.max(0.03, fraction) : 0})`, transitionDelay: `${Math.min(index, 30) * 12}ms` }} />
            </div>
          );
        })}
      </div>
      <div className={styles.barsAxis} aria-hidden="true">
        {points.map((point, index) => <span key={index}>{index % step === 0 || index === points.length - 1 ? point.label : ""}</span>)}
      </div>
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  );
}
