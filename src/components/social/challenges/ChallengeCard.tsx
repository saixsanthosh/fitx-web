"use client";

import Link from "next/link";
import { CalendarDays, Check, Dumbbell, Footprints, Timer, type LucideIcon } from "lucide-react";
import {
  challengePhase, formatValue, metricText, ordinal, progressShare, targetText, timeLeftText, type Challenge, type ChallengeMetric,
} from "@/lib/social/challenges";
import styles from "./Challenges.module.css";

export const METRIC_ICON: Record<ChallengeMetric, LucideIcon> = {
  workouts: Dumbbell, distance_km: Footprints, active_minutes: Timer, active_days: CalendarDays,
};

/** A challenge in a list: what counts, the goal, the time left, how many take part, and the member's own value. */
export function ChallengeCard({ challenge }: { challenge: Challenge }) {
  const Icon = METRIC_ICON[challenge.metric];
  const target = targetText(challenge);
  const share = progressShare(challenge.entry?.value, challenge.target);
  const phase = challengePhase(challenge);
  return (
    <Link href={`/explore/challenges/${challenge.id}`} className={styles.card}>
      <Icon size={150} strokeWidth={1.2} className={styles.cardGlyph} aria-hidden="true" />
      <span className={styles.cardTop}>
        <span className={styles.kind}>{challenge.kind === "weekly" ? "Weekly" : "Monthly"}</span>
        <span className={styles.left}>{timeLeftText(challenge)}</span>
      </span>
      <span className="flex flex-col gap-1">
        <span className={styles.title}>{challenge.title}</span>
        <span className={styles.sub}>
          {metricText(challenge.metric, challenge.sport)}{target ? ` · goal ${target}` : ""}
          {challenge.community ? ` · ${challenge.community.name}` : ""}
        </span>
      </span>
      {share !== null && (
        <span className={styles.bar} role="progressbar" aria-label="Your progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
          <span className={styles.barFill} style={{ transform: `scaleX(${share})` }} />
        </span>
      )}
      <span className={styles.cardFoot}>
        <span className={styles.sub}>{challenge.participants === 1 ? "1 taking part" : `${challenge.participants.toLocaleString("en-GB")} taking part`}</span>
        {challenge.entry ? (
          <span className="flex flex-col items-end gap-1">
            <span className={styles.joinedTag}><Check size={12} aria-hidden="true" />{phase === "closed" ? "Took part" : "Joined"}</span>
            <span className={styles.mine}>{formatValue(challenge.metric, challenge.entry.value)}{challenge.entry.rank ? ` · ${ordinal(challenge.entry.rank)}` : ""}</span>
          </span>
        ) : null}
      </span>
    </Link>
  );
}
