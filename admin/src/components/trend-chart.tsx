"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import motion from "@/components/motion/motion.module.css";

export type TrendPoint = { day: string; label: string; value: number };

const HEIGHT = 196;
const MARGIN = { top: 18, right: 44, bottom: 26, left: 40 };
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom;
const TIP_W = 132;
const TIP_H = 40;

/** The smallest "nice" number (1, 2, 5 × 10^n) at or above the value, so axis ticks stay round. */
function niceCeiling(value: number) {
  if (value <= 1) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const scaled = value / power;
  const nice = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return nice * power;
}

/**
 * One measure per day as a line with a light area wash. Hover or focus (arrow keys) moves a
 * crosshair that snaps to the nearest day; the readout is drawn inside the SVG so the strict
 * Content-Security-Policy needs no inline styles. Every value is also in the table view.
 */
export function TrendChart({ title, points, initialWidth = 640 }: { title: string; points: TrendPoint[]; initialWidth?: number }) {
  const [active, setActive] = useState<number | null>(null);
  // Drawn at the width it is shown at, so axis text stays readable on a phone instead of shrinking.
  const [width, setWidth] = useState(initialWidth);
  const svgRef = useRef<SVGSVGElement>(null);
  const gradientId = useId();

  useEffect(() => {
    const element = svgRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const measured = Math.round(entry.contentRect.width);
      if (measured > 0) setWidth(Math.min(Math.max(measured, 280), 1200));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  if (!points.length) return null;

  const WIDTH = width;
  const PLOT_W = WIDTH - MARGIN.left - MARGIN.right;

  const max = niceCeiling(Math.max(...points.map((point) => point.value)));
  const x = (index: number) => MARGIN.left + (points.length === 1 ? PLOT_W / 2 : (index / (points.length - 1)) * PLOT_W);
  const y = (value: number) => MARGIN.top + PLOT_H - (value / max) * PLOT_H;
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  const last = points.length - 1;
  const ticks = [0, max / 2, max].filter((tick, index, all) => Number.isInteger(tick) && all.indexOf(tick) === index);
  const xLabels = [...new Set(WIDTH < 420 ? [0, last] : [0, Math.floor(last / 2), last])];

  function pick(event: PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const viewX = ((event.clientX - box.left) / box.width) * WIDTH;
    const ratio = (viewX - MARGIN.left) / PLOT_W;
    setActive(Math.min(last, Math.max(0, Math.round(ratio * last))));
  }

  function step(event: KeyboardEvent<SVGSVGElement>) {
    const moves: Record<string, (index: number) => number> = {
      ArrowLeft: (index) => Math.max(0, index - 1),
      ArrowRight: (index) => Math.min(last, index + 1),
      Home: () => 0,
      End: () => last,
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    setActive((current) => move(current ?? last));
  }

  const shown = active === null ? null : points[active];
  const tipX = active === null ? 0 : Math.min(Math.max(x(active) - TIP_W / 2, MARGIN.left), WIDTH - MARGIN.right - TIP_W + 30);

  return (
    <>
    <svg
      ref={svgRef}
      aria-label={`${title}, daily. Use the left and right arrow keys to read each day.`}
      className="trend-chart"
      onBlur={() => setActive(null)}
      onFocus={() => setActive(last)}
      onKeyDown={step}
      onPointerLeave={() => setActive(null)}
      onPointerMove={pick}
      role="group"
      tabIndex={0}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop className="chart-area-stop" offset="0%" />
          <stop className="chart-area-stop chart-area-stop-end" offset="100%" />
        </linearGradient>
      </defs>
      {ticks.map((tick) => (
        <g key={tick}>
          <line className="chart-gridline" x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y(tick)} y2={y(tick)} />
          <text className="chart-axis" textAnchor="end" x={MARGIN.left - 8} y={y(tick) + 4}>{tick.toLocaleString("en-IN")}</text>
        </g>
      ))}
      {xLabels.map((index) => (
        <text key={index} className="chart-axis" textAnchor={index === 0 ? "start" : index === last ? "end" : "middle"} x={x(index)} y={HEIGHT - 6}>{points[index].label}</text>
      ))}
      <path className={`chart-area ${motion.fadeArea}`} d={area} fill={`url(#${gradientId})`} />
      <path className={`chart-line ${motion.drawLine}`} d={line} pathLength={1} />
      <circle className="chart-end-dot" cx={x(last)} cy={y(points[last].value)} r={4} />
      <text className="chart-end-label" x={x(last) + 9} y={y(points[last].value) + 4}>{points[last].value.toLocaleString("en-IN")}</text>
      {shown && active !== null && (
        <g aria-hidden="true">
          <line className="chart-crosshair" x1={x(active)} x2={x(active)} y1={MARGIN.top} y2={MARGIN.top + PLOT_H} />
          <circle className="chart-end-dot" cx={x(active)} cy={y(shown.value)} r={4} />
          <g transform={`translate(${tipX.toFixed(1)},${MARGIN.top - 14})`}>
            <rect className="chart-tip" height={TIP_H} rx={6} width={TIP_W} />
            <text className="chart-tip-value" x={10} y={17}>{shown.value.toLocaleString("en-IN")}</text>
            <text className="chart-tip-label" x={10} y={32}>{shown.label}</text>
          </g>
        </g>
      )}
    </svg>
    {/* The drawn readout is hidden from screen readers; this says the same day and value aloud. */}
    <p aria-live="polite" className="sr-only">{shown ? `${shown.label}: ${shown.value.toLocaleString("en-IN")}` : ""}</p>
    </>
  );
}
