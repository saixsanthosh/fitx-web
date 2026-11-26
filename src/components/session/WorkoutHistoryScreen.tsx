"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ChevronRight, Dumbbell, Play } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { HISTORY_PAGE_SIZE, groupByMonth, loadHistoryPage, loadInProgressSession, recordHref, statusBadge, type HistoryRow } from "@/app/(dashboard)/workouts/history/_lib/session-record";
import { createClient } from "@/lib/supabase/client";
import { regionLabel } from "@/lib/training/anatomy";
import { formatClock } from "@/lib/training/session-stats";
import { useRetryFocus } from "@/lib/workouts/retry-focus";
import { addedIds, focusAfterShowMore } from "@/lib/workouts/show-more";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; userId: string; rows: HistoryRow[]; nextOffset: number | null; inProgress: { id: string; name: string; started_at: string } | null; completed: number | null };

/** The page's h1, and History unavailable's Try again. */
const HISTORY_FOCUS = { heading: "workout-history-title", retry: "workout-history-retry" };

const monthName = (key: string) => {
  const [year, month] = key.split("-").map(Number);
  if (!year || !month) return "Earlier";
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
};
const when = (startedAt: string) => {
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) return "";
  return `${new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" }).format(date)} · ${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date)}`;
};

/** One line of a row's numbers, leaving out anything unknown (never shown as 0). */
function statLine(row: HistoryRow): string {
  const { stats } = row;
  return [
    stats.activeSeconds !== null ? `${formatClock(stats.activeSeconds)} training` : null,
    stats.volumeKg !== null ? `${Math.round(stats.volumeKg).toLocaleString()} kg` : null,
    `${stats.completedSets.toLocaleString()} ${stats.completedSets === 1 ? "set" : "sets"}`,
    stats.timedSets ? `${formatClock(stats.timedSeconds)} timed` : null,
  ].filter(Boolean).join(" · ");
}

/**
 * Every workout the member finished or abandoned, newest first, 20 at a time (/workouts/history). Each row opens
 * the workout's record. Abandoned workouts are listed and marked as not counted; the workout in progress is offered
 * at the top to resume.
 */
export function WorkoutHistoryScreen() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState("");
  // Once the last page is shown "Show 20 more" goes: the first workout it brought takes focus (D5).
  const [rowFocus, setRowFocus] = useState<{ id: string; seq: number } | null>(null);
  useEffect(() => {
    if (rowFocus) document.querySelector<HTMLElement>(`[data-history-row="${rowFocus.id}"]`)?.focus();
  }, [rowFocus]);

  const load = useCallback(async () => {
    const supabase = createClient();
    if (!supabase) { setState({ status: "error", message: "FITX is not connected to its database in this environment." }); return; }
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setState({ status: "error", message: "Sign in to see your workout history." }); return; }
    const userId = auth.user.id;
    const [page, inProgress, completed] = await Promise.all([
      loadHistoryPage(supabase, userId),
      loadInProgressSession(supabase, userId),
      supabase.from("workout_sessions").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "completed"),
    ]);
    if (page.error) { setState({ status: "error", message: "Your workout history couldn’t be loaded. Check your connection and try again." }); return; }
    setState({ status: "ready", userId, rows: page.page.rows, nextOffset: page.page.nextOffset, inProgress, completed: completed.error ? null : completed.count ?? null });
  }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  // Try again swaps History unavailable for loading, taking the button with it: once the list has loaded, the page's h1
  // takes focus, or the new Try again when it failed again (D5). The page was replaced, so it is shown from its h1.
  const retrying = useRetryFocus(state.status === "error" ? "failed" : state.status, HISTORY_FOCUS);

  async function loadMore() {
    if (state.status !== "ready" || state.nextOffset === null || loadingMore) return;
    const supabase = createClient();
    if (!supabase) return;
    setLoadingMore(true);
    setMoreError("");
    const page = await loadHistoryPage(supabase, state.userId, { offset: state.nextOffset });
    setLoadingMore(false);
    if (page.error) { setMoreError("More workouts couldn’t be loaded. Try again."); return; }
    setState((current) => {
      if (current.status !== "ready") return current;
      const seen = new Set(current.rows.map((row) => row.id));
      return { ...current, rows: [...current.rows, ...page.page.rows.filter((row) => !seen.has(row.id))], nextOffset: page.page.nextOffset };
    });
    // The button keeps focus while there are more (it is never disabled while loading); once it goes, focus moves on.
    const shown = state.rows.map((row) => row.id);
    const target = focusAfterShowMore({ more: page.page.nextOffset !== null, shown, added: addedIds(shown, page.page.rows.map((row) => row.id)) });
    if (target && target !== "button") setRowFocus((current) => ({ id: target, seq: (current?.seq ?? 0) + 1 }));
  }

  const heading = (
    <>
      <Link href="/workouts" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-fitx-text-secondary hover:text-fitx-text"><ArrowLeft size={15} aria-hidden="true" />Workouts</Link>
      <PageHeader title="Workout history" meta="Every workout you’ve finished or stopped, newest first. Open one to see its sets and the muscles it trained." titleId={HISTORY_FOCUS.heading} />
    </>
  );

  if (state.status === "loading") return <div className="mx-auto max-w-4xl space-y-3">{heading}<div role="status" className="fitx-panel animate-pulse p-8 text-sm text-fitx-text-secondary">Loading your workouts…</div></div>;
  if (state.status === "error") return <div className="mx-auto max-w-4xl space-y-3">{heading}<EmptyState headingLevel={2} title="History unavailable" description={state.message} descriptionId="workout-history-problem" action={<button id={HISTORY_FOCUS.retry} type="button" aria-describedby="workout-history-problem" onClick={() => { retrying(); setState({ status: "loading" }); void load(); }} className="fitx-button">Try again</button>} /></div>;

  const groups = groupByMonth(state.rows);
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {heading}
      {state.inProgress && (
        <section aria-label="Workout in progress" className="flex flex-col gap-3 rounded-xl border border-fitx-primary/40 bg-fitx-primary/[.06] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0"><p className="m-0 text-sm font-semibold">In progress: {state.inProgress.name}</p><p className="m-0 mt-1 text-xs text-fitx-text-secondary">Started {when(state.inProgress.started_at)}. It joins your history when you finish it.</p></div>
          <Link href={`/workouts/active?session=${encodeURIComponent(state.inProgress.id)}`} className="fitx-button min-h-11 shrink-0"><Play size={15} aria-hidden="true" />Resume</Link>
        </section>
      )}
      {state.completed !== null && state.rows.length > 0 && <p className="m-0 text-sm text-fitx-text-secondary"><span className="font-semibold text-fitx-text">{state.completed.toLocaleString()}</span> {state.completed === 1 ? "workout" : "workouts"} completed. Stopped workouts are listed too but aren’t counted.</p>}
      {!state.rows.length ? (
        <EmptyState headingLevel={2} title="No workouts yet" description="Workouts you finish or stop appear here, with their sets and the muscles they trained." action={<Link href="/workouts" className="fitx-button"><Dumbbell size={15} aria-hidden="true" />Go to workouts</Link>} />
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.key} aria-labelledby={`history-${group.key}`}>
              <h2 id={`history-${group.key}`} className="mb-2 text-sm font-semibold text-fitx-text-secondary">{monthName(group.key)}</h2>
              <ul className="m-0 list-none space-y-2 p-0">
                {group.rows.map((row) => {
                  const badge = statusBadge(row.status);
                  return (
                    <li key={row.id}>
                      <Link href={recordHref(row.id)} data-history-row={row.id} className="fitx-panel group flex items-center gap-3 p-4 transition-colors hover:border-fitx-primary/40 sm:px-5">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="truncate font-semibold text-fitx-text">{row.name}</span>
                            {badge && <span className="rounded-full border border-fitx-border bg-fitx-surface-variant px-2 py-0.5 text-[11px] font-semibold text-fitx-text">{badge}</span>}
                          </div>
                          <p className="m-0 mt-1 text-xs text-fitx-text-secondary">{when(row.started_at)}</p>
                          <p className="m-0 mt-1.5 text-sm tabular-nums text-fitx-text">{statLine(row)}</p>
                          {row.regions.length > 0 && <ul aria-label="Muscles trained most" className="m-0 mt-2 flex list-none flex-wrap gap-1.5 p-0">{row.regions.map((region) => <li key={region} className="rounded-full bg-fitx-surface-variant px-2.5 py-1 text-[11px] font-semibold text-fitx-text-secondary">{regionLabel(region)}</li>)}</ul>}
                        </div>
                        <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-fitx-text-secondary transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {state.nextOffset !== null && (
            <div className="flex flex-col items-center gap-2">
              <button type="button" onClick={() => void loadMore()} aria-disabled={loadingMore || undefined} className="fitx-button fitx-button-secondary min-h-11 px-5 aria-disabled:opacity-60">{loadingMore ? "Loading…" : `Show ${HISTORY_PAGE_SIZE} more`}</button>
              {moreError && <p role="alert" className="m-0 text-sm text-fitx-danger">{moreError}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
