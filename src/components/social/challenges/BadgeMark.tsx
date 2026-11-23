import type { ChallengeBadge } from "@/lib/social/challenges";
import styles from "./Challenges.module.css";

/** A challenge badge drawn in code (never an image): a medal on a ribbon with a tick (Completed) or a 3 (Top 3). */
export function BadgeMark({ kind, size = 44 }: { kind: ChallengeBadge; size?: number }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} className={`${styles.medal} ${kind === "top3" ? styles.medalTop3 : styles.medalCompleted}`} aria-hidden="true">
      <path className={styles.medalRibbon} d="M15 3h7l4 13h-7zM33 3h-7l-4 13h7z" />
      <circle className={styles.medalFace} cx="24" cy="29" r="15" />
      <circle className={styles.medalRim} cx="24" cy="29" r="11.5" />
      {kind === "completed"
        ? <path className={styles.medalMark} d="M18.5 29.5l4 4 7.5-8.5" />
        : <path className={styles.medalMark} d="M20.5 23.5h6.5l-4 4.5c3 0 4.5 1.4 4.5 3.4 0 2.2-1.9 3.6-4.2 3.6-1.6 0-2.8-.6-3.6-1.6" />}
    </svg>
  );
}
