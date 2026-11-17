"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, CalendarPlus, Flag, Pause, Play } from "lucide-react";
import { programmeLengthLabel, programmeMeta } from "@/data/programmes/meta";
import { topUpWindow, type Enrolment, type ProgrammePlan } from "@/lib/training/enrolment";
import { readableDate } from "@/lib/domain/dates";
import { programmeCalendar, programmeStatus, stripRange, targetSessions, type CalendarDay, type ProgrammeStatus } from "@/lib/training/programme-calendar";
import type { Programme } from "@/lib/training/programmes";
import { ProgrammeDayDetails } from "./ProgrammeDayDetails";
import { ProgrammeDayStrip } from "./ProgrammeDayStrip";

/** The cycle position in words: the next workout (with its day of the cycle), where a paused programme resumes, or done. */
export function whereYouAre(status: ProgrammeStatus, upNext: CalendarDay | null, paused: boolean): string {
  const of = (index: number) => `day ${index + 1} of ${status.cycleLength}`;
  if (status.complete) return "Every session done";
  if (paused) return `Resumes at ${of(status.nextDayIndex)}${status.nextTitle ? ` · ${status.nextTitle}` : ""}`;
  if (upNext) {
    const when = upNext.isToday ? "Today" : readableDate(new Date(`${upNext.date}T12:00:00`), { weekday: "short", month: "short", day: "numeric" });
    return `Next: ${when}${upNext.title ? ` · ${upNext.title}` : ""}${upNext.dayIndex !== null ? ` (${of(upNext.dayIndex)})` : ""}`;
  }
  return `${of(status.nextDayIndex).replace(/^d/, "D")}${status.nextTitle ? ` · ${status.nextTitle}` : ""} is next`;
}

/**
 * The programme the member follows, as a journey: what it is for and how long it runs, sessions done (completed
 * workouts only), where they are in its cycle, this week, and a strip of days from a week back to a week ahead with
 * rest days shown as planned recovery. Choosing a day shows it; its workout opens in the plan preview.
 */
export function ProgrammeCard({ programme, enrolment, plans, plansFailed = false, todayKey, busy, planning = false, activeSession = false, onPreview, onPlanAhead, onLeave, onPause, onResume, onFinish }: {
  programme: Programme;
  enrolment: Enrolment;
  /** The enrolment's plans from a week back on. */
  plans: readonly ProgrammePlan[];
  /** The planned days could not be loaded: say so, and do not offer to plan (it could double a week). */
  plansFailed?: boolean;
  todayKey: string;
  busy: boolean;
  /** The next days are being planned now. */
  planning?: boolean;
  /** A workout is in progress (pausing waits for it). */
  activeSession?: boolean;
  onPreview: (planId: string) => void;
  onPlanAhead: () => void;
  onLeave: () => void;
  onPause: () => void;
  onResume: () => void;
  onFinish: () => void;
}) {
  const meta = programmeMeta(programme.id);
  const target = targetSessions(enrolment.started_on, enrolment.weekdays, meta?.lengthDays);
  const range = stripRange(todayKey, enrolment.started_on);
  const days = programmeCalendar({ enrolment, programme, plans, todayKey, fromKey: range.fromKey, toKey: range.toKey, target });
  const status = programmeStatus({ enrolment, programme, days, todayKey, target });
  const [selected, setSelected] = useState(todayKey);
  const paused = enrolment.status === "paused";
  const trainingDays = new Set(enrolment.weekdays).size;
  const canPlan = !paused && !plansFailed && !planning && !status.complete
    && topUpWindow({ enrolment, plans, todayKey, target, dayCount: programme.days.length }) !== null;
  const percent = target ? Math.min(100, Math.round((status.sessionsCompleted / target) * 100)) : 0;
  // The next workout the member will see: today's if it is still to do, else the next planned or projected day.
  const upNext = days.find((day) => day.date >= todayKey && (day.state === "today" || day.state === "planned" || day.state === "projected")) ?? null;

  return (
    <section aria-label="Your programme" className="rounded-xl border border-fitx-primary/30 bg-fitx-primary/[.05] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.14em] text-fitx-primary-text">Your programme{paused && <span className="rounded-sm bg-fitx-surface-variant px-1.5 py-0.5 text-[10px] tracking-[.08em] text-fitx-text-secondary">Paused</span>}</p>
          <h4 className="mt-1 font-semibold">{programme.title}</h4>
          <p className="mt-1 text-xs text-fitx-text-secondary">{programmeLengthLabel(meta?.lengthDays)} · {trainingDays} training day{trainingDays === 1 ? "" : "s"} and {7 - trainingDays} rest day{7 - trainingDays === 1 ? "" : "s"} a week</p>
          {meta?.objective && <p className="mt-1 text-sm text-fitx-text-secondary">{meta.objective}</p>}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-fitx-border bg-fitx-surface p-3">
          <p className="text-xs text-fitx-text-secondary">Sessions done</p>
          {target ? <>
            <p className="mt-1 text-sm font-semibold tabular-nums">{status.sessionsCompleted} of {target}</p>
            <div className="fitx-progress-track mt-2 h-1.5" aria-hidden="true"><div className="fitx-progress-fill" style={{ width: `${percent}%` }} /></div>
            <p className="mt-1.5 text-[11px] text-fitx-text-secondary">Completed workouts only. A missed day moves the end later; it never counts as done.</p>
          </> : <p className="mt-1 text-sm font-semibold tabular-nums">{status.sessionsCompleted} workout{status.sessionsCompleted === 1 ? "" : "s"}</p>}
        </div>
        <div className="rounded-lg border border-fitx-border bg-fitx-surface p-3">
          <p className="text-xs text-fitx-text-secondary">Where you are</p>
          <p className="mt-1 text-sm font-semibold">{whereYouAre(status, upNext, paused)}</p>
          <p className="mt-1.5 text-[11px] text-fitx-text-secondary">{paused ? "Paused: your place is kept for when you resume." : `This week: ${status.week.done} of ${status.week.training} workout${status.week.training === 1 ? "" : "s"} done · ${status.week.rest} rest day${status.week.rest === 1 ? "" : "s"}`}</p>
        </div>
      </div>

      {status.complete && !paused && (
        <div className="mt-4 rounded-lg border border-fitx-success-border bg-fitx-success-bg p-3 text-sm">
          <p className="font-semibold text-fitx-success">You’ve done all {target} sessions of this plan.</p>
          <p className="mt-1 text-fitx-text-secondary">Finish it to choose your next programme. Your workouts stay in your history.</p>
          <button type="button" onClick={onFinish} disabled={busy} className="fitx-button mt-3 min-h-11 text-sm"><Flag size={15} aria-hidden="true" />Finish programme</button>
        </div>
      )}

      <div className="mt-4">
        {plansFailed
          ? <p className="text-sm text-fitx-text-secondary">This week’s programme days couldn’t be loaded.</p>
          : <ProgrammeDayStrip days={days} selected={selected} onSelect={setSelected} label={`${programme.title}: days`}
              renderPanel={(day) => <ProgrammeDayDetails day={day} next={day.state === "rest" || day.isToday ? status.nextTraining : null} busy={busy} onPreview={onPreview} />} />}
        {planning && <p role="status" className="mt-2 text-xs text-fitx-text-secondary">Planning your next days…</p>}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link href="/workouts/programme" className="fitx-button fitx-button-secondary min-h-11 text-sm">See the whole programme<ArrowRight size={15} aria-hidden="true" /></Link>
        {canPlan && <button type="button" onClick={onPlanAhead} disabled={busy} className="fitx-button fitx-button-quiet min-h-11 text-sm"><CalendarPlus size={15} aria-hidden="true" />{busy ? "Planning…" : "Plan the next 7 days"}</button>}
        {paused
          ? <button type="button" onClick={onResume} disabled={busy} className="fitx-button min-h-11 text-sm"><Play size={15} aria-hidden="true" />Resume programme</button>
          : !status.complete && <button type="button" onClick={onPause} disabled={busy || activeSession} className="fitx-button fitx-button-quiet min-h-11 text-sm"><Pause size={15} aria-hidden="true" />Pause</button>}
        <button type="button" onClick={onLeave} disabled={busy} className="fitx-button fitx-button-quiet min-h-11 text-sm">Leave programme</button>
      </div>
      {activeSession && !paused && <p className="mt-2 text-xs text-fitx-text-secondary">Pausing waits until your workout in progress is finished.</p>}
    </section>
  );
}
