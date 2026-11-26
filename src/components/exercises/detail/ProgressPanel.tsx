"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { BarSeries } from "@/components/charts/BarSeries";
import { Sparkline } from "@/components/charts/Sparkline";
import { progressSeries, type ProgressPoint, type ProgressSeries } from "@/lib/training/exercise-history";
import { VOLUME_BARS, bestSetText, formatDuration, formatKg, historyBasis, latestPoints, overallBest, volumeSeries } from "@/lib/training/exercise-progress";
import { useRetryFocus } from "@/lib/workouts/retry-focus";
import { addToWorkoutHref } from "./detail-text";
import { HistoryLoading, HistoryProblem, historyPhase, sessionDay } from "./HistoryPanel";
import { TextLink } from "./TextLink";
import type { ExerciseHistoryView } from "./useExerciseHistory";

type ProgressPanelProps = { history: ExerciseHistoryView; exerciseId: string; exerciseName: string };

/** The tab's heading ("Your progress", or "No progress yet"), and Try again when the history couldn't be loaded. */
const PROGRESS_FOCUS = { heading: "exercise-progress-heading", retry: "exercise-progress-retry" };

function shortDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function Stat({ label, value, detail, estimate = false }: { label: string; value: string; detail?: string; estimate?: boolean }) {
  return (
    <div className="fitx-panel p-4">
      <p className="m-0 flex items-center gap-2 text-xs font-medium text-fitx-text-secondary">
        {label}
        {estimate && <span className="rounded-full bg-fitx-surface-variant px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[.08em] text-fitx-primary-text">Estimate</span>}
      </p>
      <p className="m-0 mt-1 text-xl font-bold tabular-nums tracking-tight text-fitx-text">{value}</p>
      {detail && <p className="m-0 mt-0.5 text-xs text-fitx-text-secondary">{detail}</p>}
    </div>
  );
}

const TREND_TEXT: Record<ProgressSeries["metric"], { title: string; chart: string; about: string; format: (value: number) => string }> = {
  one_rep_max: {
    title: "Estimated one-rep max",
    chart: "Estimated one-rep max per session, in kilograms",
    about: "Each point is the highest estimate from one session’s sets: weight × (1 + reps ÷ 30), counting at most 12 reps (the Epley formula). An estimate, not a tested max.",
    format: formatKg,
  },
  reps: {
    title: "Most reps in one set",
    chart: "Most reps in one set per session",
    about: "Your body-weight sets: the most reps in one set of each session.",
    format: (value) => `${value} ${value === 1 ? "rep" : "reps"}`,
  },
  duration: {
    title: "Longest set",
    chart: "Longest timed set per session",
    about: "Your timed sets: the longest one of each session.",
    format: formatDuration,
  },
};

function TrendCard({ series }: { series: ProgressSeries }) {
  const text = TREND_TEXT[series.metric];
  const points = series.points;
  const first = points[0];
  const last = points[points.length - 1];
  const values = points.map((point) => point.value);
  return (
    <section aria-labelledby="exercise-trend-heading" className="fitx-panel p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="exercise-trend-heading" className="m-0 flex items-center gap-2 text-sm font-semibold text-fitx-text">
          {text.title}
          {series.estimate && <span className="rounded-full bg-fitx-surface-variant px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[.08em] text-fitx-primary-text">Estimate</span>}
        </h3>
        <p className="m-0 text-xs text-fitx-text-secondary">
          Latest <span className="font-semibold tabular-nums text-fitx-text">{text.format(last.value)}</span>
          {points.length > 1 && <> · first <span className="tabular-nums">{text.format(first.value)}</span></>}
        </p>
      </div>
      <Sparkline
        className="mt-3"
        values={values}
        label={text.chart}
        format={text.format}
        startLabel={points.length > 1 ? shortDay(first.startedAt) : undefined}
        endLabel={shortDay(last.startedAt)}
        showRange={points.length > 1}
        height={64}
        summary={points.length > 1
          ? `${text.chart}: ${points.length} sessions, from ${text.format(first.value)} on ${sessionDay(first.startedAt)} to ${text.format(last.value)} on ${sessionDay(last.startedAt)}.`
          : `${text.chart}: one session so far, ${text.format(last.value)} on ${sessionDay(last.startedAt)}.`}
      />
      <p className="m-0 mt-2 text-xs leading-5 text-fitx-text-secondary">{text.about}</p>
      {points.length === 1 && <p className="m-0 mt-1 text-xs leading-5 text-fitx-text-secondary">One more session with this exercise starts the trend.</p>}
    </section>
  );
}

function VolumeCard({ points }: { points: readonly ProgressPoint[] }) {
  return (
    <section aria-labelledby="exercise-volume-heading" className="fitx-panel p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="exercise-volume-heading" className="m-0 text-sm font-semibold text-fitx-text">Volume per session</h3>
        <p className="m-0 text-xs text-fitx-text-secondary">Latest <span className="font-semibold tabular-nums text-fitx-text">{formatKg(points[points.length - 1].value)}</span></p>
      </div>
      <BarSeries
        className="mt-3"
        data={points.map((point) => ({ label: shortDay(point.startedAt), longLabel: sessionDay(point.startedAt), value: point.value }))}
        label="Volume lifted per session, in kilograms"
        format={formatKg}
        showValues={points.length <= 6}
        height={120}
      />
      <p className="m-0 mt-2 text-xs leading-5 text-fitx-text-secondary">
        Weight × reps over every completed set with a weight{points.length >= VOLUME_BARS ? `, for your latest ${VOLUME_BARS} sessions with one` : ""}. Body-weight and timed sets add no kilograms, so sessions with only those aren’t shown.
      </p>
    </section>
  );
}

/** Best set, the trend that fits the exercise (estimated one-rep max, reps or time) and volume, from logged sets only. */
export function ProgressPanel({ history, exerciseId, exerciseName }: ProgressPanelProps) {
  // As in History (both tabs share the history, and each keeps its own Try again): once a reload Try again started has
  // ended, this tab's heading takes focus, or the new Try again when it failed again (D5).
  const retryingHistory = useRetryFocus(historyPhase(history), PROGRESS_FOCUS, { keepScroll: true });
  if (history.status === "idle" || history.status === "loading") return <HistoryLoading label="Loading your progress" />;
  if (history.status !== "ready") return <HistoryProblem history={history} retryId={PROGRESS_FOCUS.retry} onRetry={retryingHistory} />;
  const { sessions } = history;
  const best = overallBest(sessions);
  if (!sessions.length || !best) {
    return (
      <EmptyState
        title="No progress yet"
        headingId={PROGRESS_FOCUS.heading}
        description={`Complete a workout with ${exerciseName} and your best set and trends show here.`}
        action={<Link href={addToWorkoutHref(exerciseId)} className="fitx-button fitx-button-secondary">Add to a workout</Link>}
      />
    );
  }
  const series = progressSeries(sessions);
  const topEstimate = series?.metric === "one_rep_max" ? Math.max(...series.points.map((point) => point.value)) : null;
  const volume = latestPoints(volumeSeries(sessions), VOLUME_BARS);
  const basis = historyBasis(sessions.length, history.limit, history.truncated);
  const latest = sessions[0];
  return (
    <section aria-labelledby={PROGRESS_FOCUS.heading} className="space-y-4">
      <div>
        <h2 id={PROGRESS_FOCUS.heading} className="text-base font-semibold text-fitx-text">Your progress</h2>
        <p className="m-0 mt-1 text-xs text-fitx-text-secondary">{basis.text}</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Best set" value={bestSetText(best.best)} detail={sessionDay(best.session.startedAt)} />
        {topEstimate !== null && <Stat label="Best estimated one-rep max" value={formatKg(topEstimate)} detail="From your logged sets, not a tested max" estimate />}
        <Stat label="Completed sessions" value={basis.capped ? `${sessions.length}+` : String(sessions.length)} detail={`Latest ${sessionDay(latest.startedAt)}`} />
      </div>
      {series && <TrendCard series={series} />}
      {volume.length > 0 && <VolumeCard points={volume} />}
      <TextLink href="/progress">All your records on Progress<ArrowRight size={15} aria-hidden="true" /></TextLink>
    </section>
  );
}
