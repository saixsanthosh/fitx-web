"use client";

import { useId, useState, type KeyboardEvent, type PointerEvent } from "react";
import { m } from "framer-motion";
import { DURATION, EASE, useReducedMotionSafe } from "@/components/motion";
import { daysBetween, keyToLocalDate } from "@/lib/domain/day-keys";
import type { WeightPoint } from "./period";
import styles from "./Progress.module.css";

const W = 320;
const H = 120;
const PAD = 10;
const dayLabel = (key: string) => keyToLocalDate(key).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/**
 * The period's weigh-ins as a line placed by date (not evenly spaced), with a soft area under it. A new period
 * draws in by fading and settling (opacity and transform only). Arrow keys or a pointer read each weigh-in.
 */
export function WeightLine({ points, from, to, format, label }: {
  points: readonly WeightPoint[];
  from: string;
  to: string;
  format: (kg: number) => string;
  label: string;
}) {
  const id = useId();
  const reduced = useReducedMotionSafe();
  const [picked, setPicked] = useState<number | null>(null);
  const span = Math.max(1, daysBetween(from, to));
  const values = points.map((point) => point.kg);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = Math.max(0.5, (high - low) * 0.25);
  const min = low - pad;
  const max = high + pad;
  const x = (key: string) => PAD + (Math.max(0, Math.min(span, daysBetween(from, key))) / span) * (W - PAD * 2);
  const y = (kg: number) => PAD + (1 - (kg - min) / (max - min)) * (H - PAD * 2);
  const coords = points.map((point) => [x(point.date), y(point.kg)] as const);
  const line = coords.map(([cx, cy], index) => `${index ? "L" : "M"}${cx.toFixed(1)},${cy.toFixed(1)}`).join(" ");
  const area = coords.length > 1 ? `${line} L${coords.at(-1)![0].toFixed(1)},${H} L${coords[0][0].toFixed(1)},${H} Z` : "";
  const current = picked !== null && picked < points.length ? picked : points.length - 1;
  const shown = points[current];

  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight") setPicked(Math.min(points.length - 1, current + 1));
    else if (event.key === "ArrowLeft") setPicked(Math.max(0, current - 1));
    else return;
    event.preventDefault();
  }

  function onPointer(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const at = ((event.clientX - box.left) / box.width) * W;
    let best = 0;
    coords.forEach(([cx], index) => { if (Math.abs(cx - at) < Math.abs(coords[best][0] - at)) best = index; });
    setPicked(best);
  }

  return (
    <figure className={styles.weightChart}>
      <p className={styles.readout} aria-live="polite" id={`${id}-readout`}>
        {shown ? <><span>{dayLabel(shown.date)}</span><strong>{format(shown.kg)}</strong></> : null}
      </p>
      <div
        className={styles.weightPlot}
        role="group"
        tabIndex={0}
        aria-label={`${label}. Use the arrow keys to read each weigh-in.`}
        aria-describedby={`${id}-readout`}
        onKeyDown={onKey}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={() => setPicked(null)}
      >
        <m.svg
          key={`${from}-${points.length}`}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DURATION.slow, ease: EASE.out }}
        >
          <defs>
            <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--fitx-primary)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--fitx-primary)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {area ? <path d={area} fill={`url(#${id}-fill)`} /> : null}
          {coords.length > 1 ? <path d={line} className={styles.weightPath} vectorEffect="non-scaling-stroke" /> : null}
        </m.svg>
        {coords.map(([cx, cy], index) => (
          <span
            key={points[index].date}
            className={styles.weightDot}
            data-picked={index === current ? "" : undefined}
            style={{ left: `${(cx / W) * 100}%`, top: `${(cy / H) * 100}%` }}
            aria-hidden="true"
          />
        ))}
      </div>
      <div className={styles.weightAxis} aria-hidden="true"><span>{dayLabel(from)}</span><span>{dayLabel(to)}</span></div>
      <figcaption className="sr-only">{points.map((point) => `${dayLabel(point.date)}: ${format(point.kg)}`).join("; ")}</figcaption>
    </figure>
  );
}
