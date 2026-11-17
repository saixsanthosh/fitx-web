import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type SessionRingProps = {
  /** 0..1 of the ring filled; null draws the track only (a value with no progress to show). */
  fraction: number | null;
  /** "tick" for a countdown updated every second (the arc glides between ticks); "step" for counts. */
  motion?: "tick" | "step";
  /** The ring's stroke, in viewBox units of 100. */
  thickness?: number;
  /** Centre content. */
  children?: ReactNode;
  className?: string;
};

/**
 * One circular indicator of the live workout, drawn in SVG with theme tokens (track: --fitx-track, arc:
 * --fitx-primary). It scales to its box, so size it with width utilities. Decorative for assistive technology:
 * every value it shows is also given as text nearby. The arc's movement stops when the device asks for reduced
 * motion.
 */
export function SessionRing({ fraction, motion = "step", thickness = 8, children, className }: SessionRingProps) {
  const radius = 50 - thickness / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = fraction === null ? null : Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  return (
    <div className={cn("relative aspect-square shrink-0", className)}>
      <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false" className="absolute inset-0 h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--fitx-track)" strokeWidth={thickness} />
        {filled !== null && (
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke="var(--fitx-primary)"
            strokeWidth={thickness}
            strokeLinecap={filled > 0 ? "round" : "butt"}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - filled)}
            className={cn(
              "motion-reduce:transition-none",
              motion === "tick" ? "transition-[stroke-dashoffset] duration-1000 ease-linear" : "transition-[stroke-dashoffset] duration-500 ease-out",
            )}
          />
        )}
      </svg>
      {children ? <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div> : null}
    </div>
  );
}
