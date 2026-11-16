import type { ReactNode } from "react";

export type RingSpec = {
  /** What has been done. */
  value: number;
  /** What it is measured against; null or 0 draws an empty track. */
  target: number | null;
  /** A CSS colour, normally a theme token such as var(--fitx-primary). */
  color: string;
};

const fraction = (ring: RingSpec) => (ring.target && ring.target > 0 ? Math.max(0, Math.min(1, ring.value / ring.target)) : 0);

/**
 * Concentric progress rings drawn in SVG (outermost first), with optional content in the middle.
 * Tracks follow the theme (--fitx-track). `label` is what screen readers hear for the whole graphic.
 */
export function ProgressRings({ rings, size = 148, thickness = 12, gap = 5, label, children }: {
  rings: RingSpec[];
  size?: number;
  thickness?: number;
  gap?: number;
  label: string;
  children?: ReactNode;
}) {
  const center = size / 2;
  return (
    <div role="img" aria-label={label} className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="-rotate-90">
        {rings.map((ring, index) => {
          const radius = (size - thickness) / 2 - index * (thickness + gap);
          if (radius <= thickness / 2) return null;
          const circumference = 2 * Math.PI * radius;
          const done = fraction(ring);
          return (
            <g key={index}>
              <circle cx={center} cy={center} r={radius} fill="none" stroke="var(--fitx-track)" strokeWidth={thickness} />
              {done > 0 && (
                <circle
                  cx={center}
                  cy={center}
                  r={radius}
                  fill="none"
                  stroke={ring.color}
                  strokeWidth={thickness}
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={circumference * (1 - done)}
                  className="transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none"
                />
              )}
            </g>
          );
        })}
      </svg>
      {children && <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>}
    </div>
  );
}

/** A single progress ring with the percentage in the middle. The fill defaults to the brand colour. */
export function ProgressRing({ value, target, label, color = "var(--fitx-primary)", size = 124, description }: { value: number; target: number; label: string; color?: string; size?: number; description?: string }) {
  const percent = target > 0 ? Math.min(100, Math.max(0, (value / target) * 100)) : 0;
  const summary = description ?? (target > 0 ? `${label}: ${Math.round(value)} of ${Math.round(target)}` : `${label}: ${Math.round(value)}`);
  return (
    <ProgressRings rings={[{ value, target, color }]} size={size} thickness={Math.max(6, Math.round(size / 14))} label={summary}>
      <span className="text-xl font-semibold tabular-nums text-fitx-text">{target > 0 ? `${Math.round(percent)}%` : "N/A"}</span>
      <span className="mt-0.5 text-[11px] text-fitx-text-secondary">{label}</span>
    </ProgressRings>
  );
}
