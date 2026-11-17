import type { ReactNode } from "react";
import styles from "./Rings.module.css";

export type RingTone = "carbs" | "protein" | "fat" | "energy" | "over";

export interface RingSegment {
  /** Share of the full circle, 0 to 100. */
  percent: number;
  tone: RingTone;
}

/**
 * A ring drawn from one or more arcs over a track: the macro split of a food (three arcs) or a day's progress (one).
 * Arcs grow once when the ring first appears (not under reduced motion). The ring itself is decoration; whoever uses
 * it gives it a text alternative, so it is aria-hidden here.
 */
export function SegmentRing({ segments, size = "md", children }: { segments: readonly RingSegment[]; size?: "md" | "lg"; children?: ReactNode }) {
  // Each arc starts where the one before it ends.
  const arcs = segments.reduce<Array<RingSegment & { start: number; length: number }>>((list, segment) => {
    const start = list.length ? list[list.length - 1].start + list[list.length - 1].length : 0;
    return [...list, { ...segment, start, length: Math.max(0, Math.min(100 - start, segment.percent)) }];
  }, []);
  return (
    <div className={`${styles.ring} ${size === "lg" ? styles.ringLg : ""}`}>
      <svg viewBox="0 0 120 120" aria-hidden="true" focusable="false">
        <circle className={styles.track} cx="60" cy="60" r="50" pathLength="100" />
        {arcs.filter((arc) => arc.length > 0).map((arc, index) => (
          <circle key={`${arc.tone}-${index}`} className={`${styles.arc} ${styles[arc.tone]}`} cx="60" cy="60" r="50" pathLength="100"
            style={{ strokeDasharray: `${arc.length} ${100 - arc.length}`, strokeDashoffset: -arc.start }} />
        ))}
      </svg>
      <div className={styles.center}>{children}</div>
    </div>
  );
}
