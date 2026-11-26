"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { sessionVolumeKg, type ExerciseSession } from "@/lib/training/exercise-history";
import { HISTORY_PAGE_SIZE, formatKg, historyBasis, pagesAfterLoadMore, setResult, topSetOf } from "@/lib/training/exercise-progress";
import { useRetryFocus, type ReloadPhase } from "@/lib/workouts/retry-focus";
import { addedIds, focusAfterShowMore } from "@/lib/workouts/show-more";
import { addToWorkoutHref, workoutRecordHref } from "./detail-text";
import { TextLink } from "./TextLink";
import type { ExerciseHistoryView } from "./useExerciseHistory";

type HistoryPanelProps = { history: ExerciseHistoryView; exerciseId: string; exerciseName: string };

/** The tab's heading ("Your sessions", or "No sessions yet"), and Try again when the history couldn't be loaded. */
const HISTORY_FOCUS = { heading: "exercise-history-heading", retry: "exercise-history-retry" };

/** Where the member's history stands, for focus after Try again (useRetryFocus): not yet asked for counts as loading. */
export function historyPhase(history: ExerciseHistoryView): ReloadPhase {
  if (history.status === "idle" || history.status === "loading") return "loading";
  return history.status === "error" ? "failed" : "ready";
}

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

/**
 * Why the history isn't shown: signed out, or it couldn't be loaded. Try again calls `onRetry` (useRetryFocus's mark)
 * before it reloads, and carries the message for screen readers once focus comes back to it.
 */
export function HistoryProblem({ history, retryId, onRetry }: { history: ExerciseHistoryView; retryId: string; onRetry: () => void }) {
  if (history.status === "signed-out") {
    return <EmptyState title="Sign in to see your history" description="Your logged sets for this exercise show here when you are signed in." action={<Link href="/signin" className="fitx-button fitx-button-secondary">Sign in</Link>} />;
  }
  if (history.status === "error") {
    return (
      <div className="rounded-xl border border-fitx-border p-4 text-sm text-fitx-text-secondary">
        <p id={`${retryId}-problem`} className="m-0">Your history couldn’t be loaded. Check your connection and try again.</p>
        <button id={retryId} type="button" aria-describedby={`${retryId}-problem`} onClick={() => { onRetry(); history.retry(); }} className="mt-1 inline-flex min-h-11 items-center rounded-md px-1 font-semibold text-fitx-primary-text hover:underline">Try again</button>
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
    <li className="fitx-panel p-4" data-history-session={session.sessionId}>
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
  const ready = history.status === "ready" ? history : null;
  const sessions = ready?.sessions ?? [];
  const shownCount = Math.min(sessions.length, pages * HISTORY_PAGE_SIZE);
  const moreHere = shownCount < sessions.length;
  // One "Show older sessions" button, for the sessions loaded and for those still to read (D5): it is never disabled
  // while it loads, keeps focus while there are more, and once it goes the first session it brought takes focus.
  const canShowMore = moreHere || Boolean(ready?.loadMore);
  const shownIds = sessions.slice(0, shownCount).map((session) => session.sessionId).join(",");
  const pressed = useRef<{ shown: string[] } | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const loadingMore = Boolean(ready?.loadingMore);
  useEffect(() => {
    const press = pressed.current;
    if (!press || loadingMore) return;
    const added = addedIds(press.shown, shownIds ? shownIds.split(",") : []);
    // Still waiting for what the press brings (the button stays, and keeps focus).
    if (canShowMore && !added.length) return;
    pressed.current = null;
    const target = focusAfterShowMore({ more: canShowMore, shown: press.shown, added });
    if (target && target !== "button") list.current?.querySelector<HTMLElement>(`[data-history-session="${target}"] a`)?.focus();
  }, [shownIds, canShowMore, loadingMore]);
  // Try again swaps the message for loading, taking the button with it: once the history has loaded, this tab's heading
  // takes focus, or the new Try again when it failed again (D5). The page stays where it is for touch.
  const retryingHistory = useRetryFocus(historyPhase(history), HISTORY_FOCUS, { keepScroll: true });

  if (history.status === "idle" || history.status === "loading") return <HistoryLoading label="Loading your history" />;
  if (history.status !== "ready") return <HistoryProblem history={history} retryId={HISTORY_FOCUS.retry} onRetry={retryingHistory} />;
  if (!sessions.length) {
    return (
      <EmptyState
        title="No sessions yet"
        headingId={HISTORY_FOCUS.heading}
        description={`Complete a workout with ${exerciseName} and every set you tick off shows here.`}
        action={<Link href={addToWorkoutHref(exerciseId)} className="fitx-button fitx-button-secondary">Add to a workout</Link>}
      />
    );
  }
  const basis = historyBasis(sessions.length, history.limit, history.truncated);
  function showOlder() {
    if (history.status !== "ready" || history.loadingMore) return;
    pressed.current = { shown: sessions.slice(0, shownCount).map((session) => session.sessionId) };
    if (moreHere) { setPages((value) => value + 1); return; }
    const retrying = history.moreFailed;
    history.loadMore?.();
    setPages((value) => pagesAfterLoadMore(value, retrying));
  }
  return (
    <section aria-labelledby={HISTORY_FOCUS.heading}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={HISTORY_FOCUS.heading} className="text-base font-semibold text-fitx-text">Your sessions</h2>
        <p className="m-0 text-xs text-fitx-text-secondary">Completed workouts only. Showing {shownCount} of {basis.capped ? "your latest " : ""}{sessions.length}.</p>
      </div>
      <ol ref={list} className="m-0 mt-3 grid list-none grid-cols-1 gap-3 p-0 lg:grid-cols-2">
        {sessions.slice(0, shownCount).map((session) => <SessionCard key={session.sessionId} session={session} />)}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {canShowMore && (
          <button type="button" onClick={showOlder} aria-disabled={history.loadingMore || undefined} className="fitx-button fitx-button-secondary aria-disabled:opacity-60">
            {history.loadingMore && <LoaderCircle size={15} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}
            {history.loadingMore ? "Loading older sessions…" : !moreHere && history.moreFailed ? "Try loading older sessions again" : "Show older sessions"}
          </button>
        )}
        {history.moreFailed && <p role="alert" className="m-0 text-xs text-fitx-danger">Older sessions couldn’t be loaded.</p>}
        {!moreHere && !history.loadMore && basis.capped && <p className="m-0 text-xs text-fitx-text-secondary">These are your latest {sessions.length} sessions with this exercise; older ones aren’t shown here.</p>}
      </div>
    </section>
  );
}
