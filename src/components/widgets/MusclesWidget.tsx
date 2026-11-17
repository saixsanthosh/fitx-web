"use client";

import Link from "next/link";
import { BicepsFlexed, Dumbbell } from "lucide-react";
import { BodyMap } from "@/components/anatomy/BodyMap";
import { keyToLocalDate } from "@/lib/domain/day-keys";
import { BODY_REGIONS, type RegionKey } from "@/lib/training/anatomy";
import { musclePeriodRange, summariseMuscles } from "@/lib/training/muscle-history";
import type { Resource, TrainingHistory } from "./useHomeData";
import { WidgetCard, WidgetError, WidgetNote, WidgetSkeleton } from "./WidgetCard";
import styles from "./Widgets.module.css";

/** A share as people read it: "24%", and "<1%" for a sliver rather than a misleading 0%. */
export function shareLabel(share: number): string {
  if (!(share > 0)) return "0%";
  return share < 1 ? "<1%" : `${Math.round(share)}%`;
}

/** Home's "Muscles this week": the body map of this week's logged sets (contract C3) and the busiest muscles. */
export function MusclesWidget({ date, training }: { date: string; training: Resource<TrainingHistory> }) {
  return (
    <WidgetCard title="Muscles this week" icon={<BicepsFlexed size={16} />} href="/progress/muscles?period=week" hrefLabel="Open muscle analytics">
      {!training.data ? (
        training.status === "error" ? <WidgetError message={training.error} onRetry={training.reload} /> : <WidgetSkeleton label="Loading this week's muscles" />
      ) : (() => {
        const summary = summariseMuscles(training.data.sessions, musclePeriodRange("week", keyToLocalDate(date)));
        const levels = Object.fromEntries(BODY_REGIONS.map((region) => [region, summary.regions[region].level])) as Record<RegionKey, number>;
        if (!summary.sets) {
          return (
            <div className={styles.musclesEmpty}>
              <div className={styles.musclesMap}><BodyMap title="Muscles trained this week: none yet" size="sm" /></div>
              <div className={styles.musclesEmptyText}>
                <p>No sets logged this week yet. Finish a workout and the muscles it worked light up here.</p>
                <Link href="/workouts" className={styles.secondaryAction}><Dumbbell size={15} aria-hidden="true" />Open workouts</Link>
              </div>
            </div>
          );
        }
        const top = summary.ranked.slice(0, 4);
        return (
          <div className={styles.muscles}>
            <div className={styles.musclesMap}>
              <BodyMap title="Muscles trained this week, from your logged sets" levels={levels} size="sm" legend />
            </div>
            <div className={styles.musclesSide}>
              <ol className={styles.muscleList} aria-label="Most worked this week">
                {top.map((region) => (
                  <li key={region.region}>
                    <span className={styles.muscleName}>{region.label}</span>
                    <strong className={styles.muscleShare}>{shareLabel(region.share)}</strong>
                    <span className={styles.muscleSets}>{region.primarySets} direct · {region.secondarySets} assisting</span>
                  </li>
                ))}
              </ol>
              <p className={styles.subtle}>{summary.sets} {summary.sets === 1 ? "set" : "sets"} in {summary.sessions} {summary.sessions === 1 ? "workout" : "workouts"}</p>
            </div>
            {summary.unmapped.exercises.length > 0 && (
              <WidgetNote>{summary.unmapped.exercises.length === 1 ? "1 exercise isn't" : `${summary.unmapped.exercises.length} exercises aren't`} mapped to a muscle, so {summary.unmapped.exercises.length === 1 ? "its" : "their"} sets aren&apos;t shown.</WidgetNote>
            )}
          </div>
        );
      })()}
    </WidgetCard>
  );
}
