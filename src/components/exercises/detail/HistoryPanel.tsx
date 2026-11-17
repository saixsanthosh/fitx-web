"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { sessionVolumeKg, type ExerciseSession } from "@/lib/training/exercise-history";
import { HISTORY_PAGE_SIZE, formatKg, historyBasis, setResult, topSetOf } from "@/lib/training/exercise-progress";
import { addToWorkoutHref, workoutRecordHref } from "./detail-text";
import { TextLink } from "./TextLink";
import type { ExerciseHistoryView } from "./useExerciseHistory";

type HistoryPanelProps = { history: ExerciseHistoryView; exerciseId: string; exerciseName: string };

export function sessionDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "Date unknown" : date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

export function HistoryLoading({ label }: { label: string }) {
  return (
    <div role="status" className="space-y-3">
      {[0, 1, 2].map((index) => <div key={index} className="h-28 animate-pulse rounded-xl bg-fitx-surface-variant motion-reduce:animate-none" />)}
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function HistoryProblem({ history }: { history: ExerciseHistoryView }) {
  if (history.status === "signed-out") {
    return <EmptyState title="Sign in to see your history" description="Your logged sets for this exercise show here when you are signed in." action={<Link href="/signin" className="fitx-button fitx-button-secondary">Sign in</Link>} />;
  }
  if (history.status === "error") {
    return (
      <div className="rounded-xl border border-fitx-border p-4 text-sm text-fitx-text-secondary">
        <p className="m-0">Your history couldn’t be loaded. Check your connection and try again.</p>
        <button type="button" onClick={history.retry} className="mt-1 inline-flex min-h-11 items-center rounded-md px-1 font-semibold text-fitx-primary-text hover:underline">Try again</button>
      </div>
    );
  }
  return null;
}

/** One completed session: its date, the counted sets in order (the top set marked) and the volume lifted. */
function SessionCard({ session }: { session: ExerciseSession }) {
  const top = topSetOf(session);
  const volume = sessionVolumeKg(session);
  return (
    <li className="fitx-panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="m-0 text-sm font-semibold text-fitx-text">{sessionDay(session.startedAt)}</h3>
          <p className="m-0 mt-0.5 truncate text-xs text-fitx-text-secondary">{session.sessionName}</p>
        </div>
        <TextLink href={workoutRecordHref(session.sessionId)} size="text-xs" className="-mr-1">
          Open workout<ArrowRight size={13} aria-hidden="true" />
        </TextLink>
      </div>
      <ol className="m-0 mt-2 list-none divide-y divide-fitx-divider p-0" aria-label={`Sets on ${sessionDay(session.startedAt)}`}>
        {session.sets.map((set, index) => (
          <li key={index} className="flex items-center justify-between gap-3 py-1.5 text-sm">
            <span className="text-fitx-text-secondary">Set {index + 1}</span>
            <span className="flex items-center gap-2">
              {set === top && <span className="rounded-full bg-fitx-surface-variant px-2 py-0.5 text-[11px] font-semibold text-fitx-primary-text">Top set</span>}
              <span className="font-semibold tabular-nums text-fitx-text">{setResult(set, session.timed)}</span>
            </span>
          </li>
        ))}
      </ol>
      {volume > 0 && <p className="m-0 mt-1 border-t border-fitx-divider pt-2 text-xs text-fitx-text-secondary">Volume lifted: <span className="font-semibold tabular-nums text-fitx-text">{formatKg(volume)}</span> (weight × reps)</p>}
    </li>
  );
}

/** Completed sessions with this exercise, newest first, ten at a time. */
export function HistoryPanel({ history, exerciseId, exerciseName }: HistoryPanelProps) {
  const [pages, setPages] = useState(1);
  if (history.status === "idle" || history.status === "loading") return <HistoryLoading label="Loading your history" />;
  if (history.status !== "ready") return <HistoryProblem history={history} />;
  const { sessions } = history;
  if (!sessions.length) {
    return (
      <EmptyState
        title="No sessions yet"
        description={`Complete a workout with ${exerciseName} and every set you tick off shows here.`}
        action={<Link href={addToWorkoutHref(exerciseId)} className="fitx-button fitx-button-secondary">Add to a workout</Link>}
      />
    );
  }
  const shownCount = Math.min(sessions.length, pages * HISTORY_PAGE_SIZE);
  const moreHere = shownCount < sessions.length;
  const basis = historyBasis(sessions.length, history.limit);
  return (
    <section aria-labelledby="exercise-history-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="exercise-history-heading" className="text-base font-semibold text-fitx-text">Your sessions</h2>
        <p className="m-0 text-xs text-fitx-text-secondary">Completed workouts only. Showing {shownCount} of {basis.capped ? "your latest " : ""}{sessions.length}.</p>
      </div>
      <ol className="m-0 mt-3 grid list-none grid-cols-1 gap-3 p-0 lg:grid-cols-2">
        {sessions.slice(0, shownCount).map((session) => <SessionCard key={session.sessionId} session={session} />)}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {moreHere && (
          <button type="button" onClick={() => setPages((value) => value + 1)} className="fitx-button fitx-button-secondary">Show older sessions</button>
        )}
        {!moreHere && history.loadMore && (
          <button type="button" onClick={() => { history.loadMore?.(); setPages((value) => value + 1); }} disabled={history.loadingMore} className="fitx-button fitx-button-secondary">
            {history.loadingMore && <LoaderCircle size={15} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}
            {history.loadingMore ? "Loading older sessions…" : history.moreFailed ? "Try loading older sessions again" : "Show older sessions"}
          </button>
        )}
        {history.moreFailed && <p role="alert" className="m-0 text-xs text-fitx-danger">Older sessions couldn’t be loaded.</p>}
        {!moreHere && !history.loadMore && basis.capped && <p className="m-0 text-xs text-fitx-text-secondary">These are your latest {sessions.length} sessions with this exercise; older ones aren’t shown here.</p>}
      </div>
    </section>
  );
}
