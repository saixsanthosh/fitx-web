"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, CalendarPlus, Flag, LogOut, Pause, Play } from "lucide-react";
import { programmeLengthLabel, programmeMeta } from "@/data/programmes/meta";
import { topUpWindow, type Enrolment, type ProgrammePlan } from "@/lib/training/enrolment";
import { readableDate } from "@/lib/domain/dates";
import { programmeCalendar, programmeStatus, stripRange, targetSessions, type CalendarDay, type ProgrammeStatus } from "@/lib/training/programme-calendar";
import type { Programme } from "@/lib/training/programmes";
import { ActionsMenu, type ActionsMenuItem } from "./ActionsMenu";
import { sessionsRing } from "./gym-compact";
import { ProgrammeDayDetails } from "./ProgrammeDayDetails";
import { ProgrammeDayStrip } from "./ProgrammeDayStrip";
import styles from "./ProgrammeCard.module.css";

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

/** The sessions-done ring: completed workouts only, drawn with a stroke offset (no layout motion). */
function SessionsRingMark({ done, target }: { done: number; target: number | null }) {
  const ring = sessionsRing(done, target);
  const radius = 24;
  const length = 2 * Math.PI * radius;
  return (
    <div role="img" aria-label={ring.label} title="Completed workouts only" className={styles.ring}>
      <svg viewBox="0 0 56 56" aria-hidden="true" className={styles.ringArt}>
        <circle cx="28" cy="28" r={radius} className={styles.ringTrack} />
        {ring.fraction > 0 && <circle cx="28" cy="28" r={radius} className={styles.ringFill} strokeDasharray={length} strokeDashoffset={length * (1 - ring.fraction)} />}
      </svg>
      <span className={styles.ringText} aria-hidden="true"><span className={styles.ringValue}>{ring.value}</span>{ring.total && <span className={styles.ringTotal}>{ring.total}</span>}</span>
    </div>
  );
}

/**
 * The programme the member follows, compact (phase 7.4): a ring of sessions done (completed workouts only) beside its
 * name and length, one line on where they are and this week, then a strip of days from a week back to a week ahead
 * (rest days shown as planned recovery). Choosing a day shows it in one row; its workout opens in the plan preview.
 * One visible action besides the journey link (Pause or Resume); planning ahead and leaving sit in a "more" menu.
 */
export function ProgrammeCard({ programme, enrolment, plans, plansFailed = false, todayKey, busy, planning = false, activeSession = false, note = null, onPreview, onPlanAhead, onLeave, onPause, onResume, onFinish }: {
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
  /**
   * A line beside the card's buttons (D6): days re-planned for a changed equipment list (bug 17), what Pause or "Plan
   * the next 7 days" did, or why a programme action did not work (`tone: "error"`).
   */
  note?: { tone: "info" | "error"; text: string } | null;
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
  const waitNoteId = useId();
  // Pause and Resume replace each other: once the programme is paused (or running again), the other button takes
  // focus, so keyboard focus never drops to the page (bug 84's rule, here for the programme).
  const pauseRef = useRef<HTMLButtonElement>(null);
  const resumeRef = useRef<HTMLButtonElement>(null);
  const handoff = useRef<"pause" | "resume" | null>(null);
  useEffect(() => {
    const target = handoff.current === "resume" && paused ? resumeRef.current : handoff.current === "pause" && !paused ? pauseRef.current : null;
    if (!target) return;
    handoff.current = null;
    target.focus();
  }, [paused]);
  const pauseBlocked = busy || planning || activeSession;
  const trainingDays = new Set(enrolment.weekdays).size;
  const canPlan = !paused && !plansFailed && !planning && !status.complete
    && topUpWindow({ enrolment, plans, todayKey, target, dayCount: programme.days.length }) !== null;
  // The next workout the member will see: today's if it is still to do, else the next planned or projected day.
  const upNext = days.find((day) => day.date >= todayKey && (day.state === "today" || day.state === "planned" || day.state === "projected")) ?? null;
  const weekLine = paused ? "Your place is kept" : `This week ${status.week.done} of ${status.week.training} done`;
  const more: ActionsMenuItem[] = [
    ...(canPlan ? [{ label: busy ? "Planning…" : "Plan the next 7 days", icon: CalendarPlus, onSelect: onPlanAhead, disabled: busy }] : []),
    { label: "Leave programme", icon: LogOut, onSelect: onLeave, disabled: busy || planning, tone: "danger" as const },
  ];

  return (
    <section aria-label="Your programme" className={styles.card}>
      <div className={styles.head}>
        <SessionsRingMark done={status.sessionsCompleted} target={target || null} />
        <div className="min-w-0 flex-1">
          <p className={styles.eyebrow}>Your programme{paused && <span className={styles.paused}>Paused</span>}</p>
          <h3 className={styles.title}>{programme.title}</h3>
          <p className={styles.meta}>{programmeLengthLabel(meta?.lengthDays)} · {trainingDays} training day{trainingDays === 1 ? "" : "s"} and {7 - trainingDays} rest day{7 - trainingDays === 1 ? "" : "s"} a week</p>
        </div>
        <ActionsMenu label="More programme actions" items={more} className={styles.more} />
      </div>
      <p className={styles.where}><span className="font-semibold text-fitx-text">{whereYouAre(status, upNext, paused)}</span><span aria-hidden="true"> · </span><span className="sr-only">. </span><span className="whitespace-nowrap">{weekLine}</span></p>
      <p role="status" className={note?.tone === "info" ? "mt-2 rounded-lg bg-fitx-surface-variant px-3 py-2 text-xs text-fitx-text-secondary" : "sr-only"}>{note?.tone === "info" ? note.text : ""}</p>
      {note?.tone === "error" && <p role="alert" className="fitx-alert fitx-alert-danger mt-2 px-3 py-2 text-sm">{note.text}</p>}

      {status.complete && !paused && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-fitx-success-border bg-fitx-success-bg p-3 text-sm">
          <p className="min-w-0 flex-1 font-semibold text-fitx-success">All {target} sessions done. Finish to choose your next programme.</p>
          <button type="button" onClick={() => { if (!busy && !planning) onFinish(); }} aria-disabled={busy || planning || undefined} className="fitx-button min-h-11 text-sm aria-disabled:opacity-60"><Flag size={15} aria-hidden="true" />Finish programme</button>
        </div>
      )}

      <div className="mt-3">
        {plansFailed
          ? <p className="text-sm text-fitx-text-secondary">This week’s programme days couldn’t be loaded.</p>
          : <ProgrammeDayStrip days={days} selected={selected} onSelect={setSelected} label={`${programme.title}: days`}
              renderPanel={(day) => <ProgrammeDayDetails day={day} next={day.state === "rest" || day.isToday ? status.nextTraining : null} busy={busy} onPreview={onPreview} />} />}
        {planning && <p role="status" className="mt-2 text-xs text-fitx-text-secondary">Planning your next days…</p>}
      </div>

      <div className={styles.actions}>
        <Link href="/workouts/programme" className={styles.journey}>See the whole programme<ArrowRight size={15} aria-hidden="true" /></Link>
        {/* Busy or waiting, never disabled (a disabled button drops focus and leaves the Tab order): a press then is ignored. */}
        {paused
          ? <button ref={resumeRef} type="button" onClick={() => { if (busy) return; handoff.current = "pause"; onResume(); }} aria-disabled={busy || undefined} className="fitx-button min-h-11 px-4 text-sm aria-disabled:opacity-60"><Play size={15} aria-hidden="true" />Resume programme</button>
          : !status.complete && <button ref={pauseRef} type="button" onClick={() => { if (pauseBlocked) return; handoff.current = "resume"; onPause(); }} aria-disabled={pauseBlocked || undefined} aria-describedby={activeSession ? waitNoteId : undefined} className="fitx-button fitx-button-quiet min-h-11 px-4 text-sm aria-disabled:opacity-60"><Pause size={15} aria-hidden="true" />Pause</button>}
      </div>
      {activeSession && !paused && <p id={waitNoteId} className="mt-2 text-xs text-fitx-text-secondary">Pausing waits until your workout in progress is finished.</p>}
    </section>
  );
}
