"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, BicepsFlexed, ChevronRight, History, Trophy } from "lucide-react";
import { BodyMap } from "@/components/anatomy/BodyMap";
import { EmptyState } from "@/components/app/EmptyState";
import { getSession, messageFor } from "@/components/tasks/session";
import { shareLabel } from "@/components/widgets/MusclesWidget";
import type { AllTimeTotals, RecentWorkout } from "@/lib/data/progress";
import { BODY_REGIONS, type RegionKey } from "@/lib/training/anatomy";
import { formatDurationWords } from "@/lib/activity/format";
import type { MuscleSummary } from "@/lib/training/muscle-history";
import styles from "./Progress.module.css";

const number = (value: number, digits = 0) => value.toLocaleString(undefined, { maximumFractionDigits: digits });
const dateLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
const minutesLabel = (seconds: number) => formatDurationWords(seconds);

/** This week's muscle map on Progress, linking to the full analytics page. */
export function MuscleCard({ summary }: { summary: MuscleSummary }) {
  const levels = Object.fromEntries(BODY_REGIONS.map((region) => [region, summary.regions[region].level])) as Record<RegionKey, number>;
  return (
    <section className={`fitx-panel ${styles.panel}`} aria-labelledby="muscles-title">
      <div className={styles.panelHead}>
        <div>
          <h2 id="muscles-title" className={styles.panelTitle}><BicepsFlexed size={16} aria-hidden="true" />Muscles this week</h2>
          <p className={styles.panelNote}>From the sets you ticked in finished workouts</p>
        </div>
      </div>
      <div className={styles.muscleCard}>
        <div className={styles.muscleCardMap}>
          <BodyMap title={summary.sets ? "Muscles trained this week, from your logged sets" : "Muscles trained this week: none yet"} levels={levels} size="sm" legend={summary.sets > 0} />
        </div>
        <div className={styles.muscleCardSide}>
          {summary.sets ? (
            <ol className={styles.muscleTop}>
              {summary.ranked.slice(0, 4).map((region) => (
                <li key={region.region}>
                  <span>{region.label}</span>
                  <strong>{shareLabel(region.share)}</strong>
                </li>
              ))}
            </ol>
          ) : <p className={styles.panelNote}>No sets logged this week yet.</p>}
          <Link href="/progress/muscles?period=week" className={styles.textLink}>Open muscle analytics<ArrowRight size={14} aria-hidden="true" /></Link>
        </div>
      </div>
    </section>
  );
}

/** Exact all-time numbers (never capped at a page of rows without saying so). */
export function AllTimeCard({ totals, error, onRetry }: { totals: AllTimeTotals | null; error: string; onRetry: () => void }) {
  return (
    <section className={`fitx-panel ${styles.panel}`} aria-labelledby="alltime-title">
      <h2 id="alltime-title" className={styles.panelTitle}>All time</h2>
      {error ? (
        <p role="alert" className="fitx-alert fitx-alert-danger">{error} <button type="button" className="fitx-alert-action" onClick={onRetry}>Try again</button></p>
      ) : !totals ? (
        <div className={styles.loadingBlock} aria-busy="true" aria-label="Loading your totals" />
      ) : (
        <>
          <dl className={styles.totals}>
            <div><dt>Completed workouts</dt><dd>{number(totals.workouts)}</dd></div>
            <div><dt>Lifted in total</dt><dd>{totals.volumeKg === null ? <span title="No weighted sets yet">—</span> : `${number(totals.volumeKg)} kg`}</dd></div>
            <div><dt>Average training time</dt><dd>{totals.averageTrainingSeconds === null ? "—" : minutesLabel(totals.averageTrainingSeconds)}</dd></div>
          </dl>
          <p className={styles.panelNote}>
            {totals.workouts === 0
              ? "No workouts yet. Finish one and your totals start here."
              : `Training time leaves pauses out. Lifted counts weight × reps of weighted lift sets.${totals.capped ? ` Lifted and average are from your latest ${number(totals.measured)} workouts.` : ""}`}
          </p>
        </>
      )}
    </section>
  );
}

/** The newest finished workouts, each opening its record. */
export function RecentWorkouts({ workouts, error, onRetry }: { workouts: RecentWorkout[] | null; error: string; onRetry: () => void }) {
  return (
    <section className={`fitx-panel ${styles.panel}`} aria-labelledby="recent-title">
      <h2 id="recent-title" className={styles.panelTitle}><History size={16} aria-hidden="true" />Recent workouts</h2>
      {error ? (
        <p role="alert" className="fitx-alert fitx-alert-danger">{error} <button type="button" className="fitx-alert-action" onClick={onRetry}>Try again</button></p>
      ) : !workouts ? (
        <div className={styles.loadingBlock} aria-busy="true" aria-label="Loading your recent workouts" />
      ) : workouts.length ? (
        <>
          <ul className={styles.recentList}>
            {workouts.map((workout) => (
              <li key={workout.id}>
                <Link href={`/workouts/history/${workout.id}`} className={styles.recentRow}>
                  <span className={styles.recentText}>
                    <strong>{workout.name}</strong>
                    <span>{dateLabel(workout.startedAt)}{workout.trainingSeconds !== null ? ` · ${minutesLabel(workout.trainingSeconds)} training` : ""}</span>
                  </span>
                  <span className={styles.recentVolume}>{workout.volumeKg === null ? "—" : `${number(workout.volumeKg)} kg`}</span>
                  <ChevronRight size={16} aria-hidden="true" className={styles.recentChevron} />
                </Link>
              </li>
            ))}
          </ul>
          <Link href="/workouts/history" className={styles.textLink}>All workouts<ArrowRight size={14} aria-hidden="true" /></Link>
        </>
      ) : <EmptyState title="No completed workouts" description="Your finished workouts will appear here, each with its sets and muscles." />}
    </section>
  );
}

type RecordRow = { id: string; exercise_name: string; best_weight_kg: number; best_reps: number; estimated_one_rep_max: number; achieved_at: string };

/** Best sets from completed workouts, with the estimated one-rep max labelled as an estimate. */
export function RecordsSection() {
  const [records, setRecords] = useState<RecordRow[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const { db, userId } = await getSession();
      const result = await db.from("personal_records").select("id,exercise_name,best_weight_kg,best_reps,estimated_one_rep_max,achieved_at")
        .eq("user_id", userId).order("estimated_one_rep_max", { ascending: false }).limit(100);
      if (result.error) throw result.error;
      setRecords((result.data ?? []) as RecordRow[]);
      setError("");
    } catch (failure) {
      setError(messageFor(failure, "Your personal records could not be loaded."));
    }
  }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  return (
    <section className={`fitx-panel ${styles.panel} ${styles.recordsPanel}`} aria-labelledby="records-title">
      <div className={styles.panelHead}>
        <div>
          <h2 id="records-title" className={styles.panelTitle}><Trophy size={16} aria-hidden="true" />Personal records</h2>
          <p className={styles.panelNote}>Best sets recorded from completed workouts</p>
        </div>
      </div>
      {error ? <p role="alert" className="fitx-alert fitx-alert-danger">{error}</p>
        : records === null ? <div className={styles.loadingBlock} aria-busy="true" aria-label="Loading your personal records" />
          : records.length ? (
            <ul className={styles.recordGrid}>
              {records.map((record) => (
                <li key={record.id}>
                  <strong>{record.exercise_name}</strong>
                  <span>{Number(record.best_weight_kg)} kg × {record.best_reps} reps · estimated 1RM {Number(record.estimated_one_rep_max)} kg</span>
                  <small>{new Date(record.achieved_at).toLocaleDateString()}</small>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="No personal records yet" description="Complete a workout with logged weights and reps to begin building your records." />}
    </section>
  );
}
