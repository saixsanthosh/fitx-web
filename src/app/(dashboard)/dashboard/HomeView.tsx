"use client";

import { DailyHome } from "@/components/home/DailyHome";
import { useToday } from "@/components/widgets/useHomeData";
import styles from "./Dashboard.module.css";

/** The member's day is only known in the browser; until then the stage shows without words. */
export function HomeView() {
  const today = useToday();
  if (!today) return <div className={styles.placeholder} aria-busy="true" aria-label="Loading your Home" />;
  return <DailyHome key={today} today={today} />;
}
