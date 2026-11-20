import { cn } from "@/lib/utils";
import styles from "./nav-icon.module.css";

/**
 * The Home workout menu icon: FITX's figure standing, then sitting into a squat, on a loop
 * (still and standing with reduced motion). Same props as the other menu icons.
 */
export function HomeWorkoutNavIcon({ size = 20, className, active }: { size?: number; className?: string; active?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 2.2 : 1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(styles.icon, className)}
      aria-hidden="true"
      focusable="false"
    >
      <g className={styles.up}>
        <circle cx="12" cy="3.6" r="1.7" fill="currentColor" stroke="none" />
        <path d="M12 6.6v6.4M12 13l-1.8 8.2M12 13l1.8 8.2M12 7.4l-2.8 4.8M12 7.4l2.8 4.8" />
      </g>
      <g className={styles.down}>
        <circle cx="13.6" cy="7.4" r="1.7" fill="currentColor" stroke="none" />
        <path d="M12.6 10.2 9.4 15.6M9.4 15.6l5 .6M14.4 16.2l-1.6 5M12.6 11.2l5.6.4" />
      </g>
      <path d="M5 21.6h14" strokeWidth={1.2} opacity={0.45} />
    </svg>
  );
}
