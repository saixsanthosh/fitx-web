import type { ReactNode } from "react";
import styles from "./Progress.module.css";

export type RingTone = "train" | "food" | "plan";
export type Ring = { value: number; max: number; tone: RingTone };

/**
 * Concentric rings (outermost first) with a centre. Each arc glides to its new length when the period changes,
 * with the same easing as the rest of FITX; still under reduced motion (globals turn transitions off).
 */
export function ConcentricRings({ rings, label, children, size = 196 }: { rings: readonly Ring[]; label: string; children?: ReactNode; size?: number }) {
  const thickness = 13;
  const gap = 6;
  return (
    <div className={styles.heroRings} role="img" aria-label={label} style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        {rings.map((ring, index) => {
          const stroke = (thickness / size) * 100;
          const radius = 50 - stroke / 2 - index * ((thickness + gap) / size) * 100;
          if (radius <= stroke) return null;
          const fraction = ring.max > 0 ? Math.max(0, Math.min(1, ring.value / ring.max)) : 0;
          return (
            <g key={index} data-tone={ring.tone}>
              <circle className={styles.ringTrack} cx="50" cy="50" r={radius} strokeWidth={stroke} pathLength={100} />
              <circle
                className={styles.ringArc}
                cx="50"
                cy="50"
                r={radius}
                strokeWidth={stroke}
                pathLength={100}
                style={{ strokeDasharray: "100 100", strokeDashoffset: 100 - fraction * 100, opacity: fraction > 0 ? 1 : 0 }}
              />
            </g>
          );
        })}
      </svg>
      {children ? <div className={styles.ringCentre}>{children}</div> : null}
    </div>
  );
}

/** A calendar day: the outer ring fills when the member trained, the inner arc shows calories eaten against the target. */
export function DayRing({ active, foodPercent, foodLogged }: { active: boolean; foodPercent: number | null; foodLogged: boolean }) {
  const food = foodPercent === null ? (foodLogged ? 100 : 0) : Math.max(0, Math.min(100, foodPercent));
  return (
    <svg className={styles.dayRing} viewBox="0 0 36 36" aria-hidden="true" focusable="false">
      <circle className={styles.dayTrack} cx="18" cy="18" r="15" />
      <circle className={styles.dayTrain} cx="18" cy="18" r="15" pathLength={100} style={{ strokeDashoffset: active ? 0 : 100, opacity: active ? 1 : 0 }} />
      <circle className={styles.dayTrackInner} cx="18" cy="18" r="9.5" />
      <circle
        className={styles.dayFood}
        data-estimate={foodPercent === null && foodLogged ? "" : undefined}
        data-over={foodPercent !== null && foodPercent > 110 ? "" : undefined}
        cx="18"
        cy="18"
        r="9.5"
        pathLength={100}
        style={{ strokeDashoffset: 100 - food, opacity: food > 0 ? 1 : 0 }}
      />
    </svg>
  );
}
