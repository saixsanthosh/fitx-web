import Link from "next/link";
import { ArrowRight, CalendarClock, Scale, Target, Utensils } from "lucide-react";
import type { Insight, InsightKind, InsightsStatus } from "@/lib/domain/insights";
import styles from "./Widgets.module.css";

const ICONS: Record<InsightKind, typeof Target> = { consistency: CalendarClock, muscle_gap: Target, protein: Utensils, push_pull: Scale };

/**
 * "What should I improve next?": each observation with the numbers behind it, what it was worked out from and a
 * link to act on it. Shared by Home's Focus next widget and the Progress page.
 */
export function InsightList({ insights, status, headingLevel = 3 }: { insights: readonly Insight[]; status: InsightsStatus; headingLevel?: 3 | 4 }) {
  if (status === "not_enough_data") {
    return <p className={styles.insightEmpty}>Not enough logged yet. Once you have a few workouts, activities or days of food in FITX, this points out what to work on next, using only your own numbers.</p>;
  }
  if (!insights.length) {
    return <p className={styles.insightEmpty}>Nothing stands out in your last five weeks of logs. This updates as you log workouts, activities and food.</p>;
  }
  const Heading = headingLevel === 3 ? "h3" : "h4";
  return (
    <ul className={styles.insights}>
      {insights.map((insight) => {
        const Icon = ICONS[insight.kind];
        return (
          <li key={insight.id} className={styles.insight}>
            <span className={styles.insightIcon} aria-hidden="true"><Icon size={16} /></span>
            <div className={styles.insightText}>
              <Heading className={styles.insightTitle}>{insight.title}</Heading>
              <p className={styles.insightDetail}>{insight.detail}</p>
              <p className={styles.insightBasis}>{insight.basis}</p>
              <Link href={insight.href} className={styles.insightLink}>{insight.action}<ArrowRight size={14} aria-hidden="true" /></Link>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
