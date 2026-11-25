"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, ChevronRight, ListChecks } from "lucide-react";
import { ExerciseThumb } from "@/components/exercises/ExerciseThumb";
import { todayStart, type ActiveWorkout } from "@/app/(dashboard)/workouts/_lib/today-start";
import type { CatalogExercise } from "@/lib/training/catalog";
import { survivingExerciseId } from "@/lib/training/exercise-merges";
import { planSummary, rowPrescription } from "@/lib/training/plan-summary";
import type { PlanExerciseRow } from "@/lib/training/plans";
import { TODAY_ROWS_SHOWN } from "./gym-compact";
import styles from "./TodayWorkout.module.css";

/** How many exercises the card lists before "and N more" (the plan preview lists them all). */
const SHOWN = TODAY_ROWS_SHOWN;

export type TodayWorkoutPlan = {
  id: string;
  title: string;
  /** "Today", "Thu 21 Nov". */
  when: string;
  /** "Day 2 of 6 · Push, Pull, Legs" for a programme day; null for the member's own plan. */
  programme: string | null;
};

/**
 * The workout the page leads with, laid out like a gym log: the plan's name and size, each exercise as a row with
 * its photo and sets × reps, and one Start button. A row opens the exercise's details. `rows` is null while loading.
 */
export function TodayWorkout({ plan, rows, failed, catalog, starting, startError, active, gap = null, onStart, onDetails, onInfo, onRetry }: {
  plan: TodayWorkoutPlan;
  rows: readonly PlanExerciseRow[] | null;
  failed: boolean;
  catalog: ReadonlyMap<string, CatalogExercise>;
  starting: boolean;
  startError: string;
  /** The workout in progress, if any: Start opens it instead, and the card says which one it is (bug 30). */
  active: ActiveWorkout | null;
  /**
   * Exercises the member's list does not allow (bug 17): what to say, and for a programme day a way to re-plan it with
   * the planner's rules (`note`: how that went). Null when every exercise fits.
   */
  gap?: { message: string; onReplan: (() => void) | null; replanning: boolean; note: string } | null;
  /* `message` is "" once a re-plan has fixed the day: only its note is left. */
  onStart: () => void;
  onDetails: () => void;
  onInfo: (exercise: CatalogExercise) => void;
  onRetry: () => void;
}) {
  const summary = rows ? planSummary(rows) : null;
  const start = todayStart(plan, active);
  const shown = rows?.slice(0, SHOWN) ?? [];
  const more = rows ? rows.length - shown.length : 0;
  return (
    <article className={styles.card} aria-labelledby="today-workout-title">
      <header className={`fitx-inverse ${styles.head}`}>
        <p className={styles.eyebrow}><span className={styles.when}>{plan.when}</span>{plan.programme && <span className={styles.programme}>{plan.programme}</span>}</p>
        <h3 id="today-workout-title" className={styles.title}>{plan.title}</h3>
        {summary && summary.exercises > 0 && (
          <p className={styles.meta}>
            <span>{summary.exercises} exercise{summary.exercises === 1 ? "" : "s"}</span>
            <span>{summary.totalSets} sets</span>
            {summary.estimateMinutes !== null && <span><span aria-hidden="true">≈ </span><span className="sr-only">About </span>{summary.estimateMinutes} min <span className={styles.estimate}>Estimate</span></span>}
          </p>
        )}
      </header>

      {failed ? (
        <p role="alert" className="fitx-alert mx-4 mb-4 sm:mx-5">This workout’s exercises couldn’t be loaded.<button type="button" className="fitx-alert-action" onClick={onRetry}>Try again</button></p>
      ) : rows === null ? (
        <ul className={styles.list} aria-label="Loading exercises">{[0, 1, 2].map((key) => <li key={key} className={styles.skeleton} />)}</ul>
      ) : rows.length === 0 ? (
        <p className={styles.empty}>No exercises yet.</p>
      ) : (
        <ol className={styles.list} aria-label={`Exercises in ${plan.title}`}>
          {shown.map((row, index) => {
            const exercise = row.exercise_id ? catalog.get(survivingExerciseId(row.exercise_id)) ?? null : null;
            const body: ReactNode = (
              <>
                <ExerciseThumb exerciseId={exercise?.id ?? row.exercise_id ?? row.id} name={exercise?.name ?? row.exercise_name} sourceRef={exercise?.source_ref ?? null} equipment={exercise?.required_equipment ?? []} size="md" className={styles.thumb} />
                <span className={styles.rowText}>
                  <span className={styles.rowName}>{exercise?.name ?? row.exercise_name}</span>
                  <span className={styles.rowWork}>{rowPrescription(row)}</span>
                </span>
                <span className={styles.rowIndex} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              </>
            );
            return (
              <li key={row.id}>
                {exercise
                  ? <button type="button" className={styles.row} onClick={() => onInfo(exercise)}>{body}<ChevronRight size={16} aria-hidden="true" className={styles.chevron} /></button>
                  : <div className={styles.row}>{body}</div>}
              </li>
            );
          })}
        </ol>
      )}
      {more > 0 && <p className={styles.more}>and {more} more</p>}
      {gap && (
        <div className="mx-4 mt-3 rounded-lg border border-fitx-warning/50 bg-fitx-surface px-3 py-2.5 text-sm sm:mx-5">
          {gap.message && <p className="m-0 text-fitx-text">{gap.message}{gap.onReplan ? "" : " Open Details to swap them."}</p>}
          {gap.onReplan && (
            <button type="button" onClick={() => { if (!gap.replanning) gap.onReplan?.(); }} aria-disabled={gap.replanning || undefined}
              className="fitx-button fitx-button-secondary mt-2 min-h-11 px-3 text-sm aria-disabled:opacity-60">{gap.replanning ? "Re-planning…" : "Re-plan this day"}</button>
          )}
          <p role="status" className={gap.note ? "m-0 mt-1 text-xs text-fitx-text-secondary" : "sr-only"}>{gap.note}</p>
        </div>
      )}

      <footer className={styles.foot}>
        {startError && <p role="alert" className="fitx-alert fitx-alert-danger w-full">{startError}</p>}
        {start.note && <p id="today-workout-start-note" className="w-full text-xs text-fitx-text-secondary">{start.note}</p>}
        <button type="button" onClick={() => { if (!starting) onStart(); }} disabled={start.kind === "start" && !rows?.length} aria-disabled={starting || undefined} aria-describedby={start.note ? "today-workout-start-note" : undefined} className={`fitx-button aria-disabled:opacity-60 ${styles.start}`}>
          {starting ? "Starting…" : start.label}<ArrowRight size={17} aria-hidden="true" />
        </button>
        <button type="button" aria-haspopup="dialog" onClick={onDetails} className={`fitx-button fitx-button-secondary ${styles.details}`}><ListChecks size={16} aria-hidden="true" />Details</button>
      </footer>
    </article>
  );
}

/** The card when nothing is planned: one line and the ways to make a workout. */
export function TodayEmpty({ title, children, record }: { title: string; children: ReactNode; record?: { id: string; name: string } | null }) {
  return (
    <div className={`${styles.card} ${styles.emptyCard}`}>
      <p className={styles.emptyTitle}>{title}</p>
      {record && <Link href={`/workouts/history/${record.id}`} className={styles.recordLink}>{record.name}<ArrowRight size={14} aria-hidden="true" /></Link>}
      <div className={styles.emptyActions}>{children}</div>
    </div>
  );
}
