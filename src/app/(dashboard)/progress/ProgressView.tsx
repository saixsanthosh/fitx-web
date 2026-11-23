"use client";

import Link from "next/link";
import { BicepsFlexed } from "lucide-react";
import { ProgressAnalytics } from "@/components/progress/ProgressAnalytics";
import styles from "@/components/progress/Progress.module.css";
import { PageHeader } from "@/components/ui/PageHeader";
import { useToday } from "@/components/widgets/useHomeData";

/**
 * Progress: how a week, a month or a year went, from the member's own logs only (ProgressAnalytics), with goals,
 * weight, records and the link to the muscle map.
 */
export function ProgressView() {
  const today = useToday();
  return (
    <div className={styles.shell}>
      <PageHeader
        title="Progress"
        actions={<Link href="/progress/muscles" className={styles.headerLink}><BicepsFlexed size={16} aria-hidden="true" />Muscle map</Link>}
      />
      {today ? <ProgressAnalytics today={today} /> : <div className={`${styles.loading} ${styles.loadingTall}`} aria-busy="true" aria-label="Loading your progress" />}
    </div>
  );
}
