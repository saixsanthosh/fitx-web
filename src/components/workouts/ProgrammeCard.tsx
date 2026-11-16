"use client";

import { ArrowRight, CalendarPlus, Check } from "lucide-react";
import { readableDate } from "@/lib/domain/dates";
import { programmeDayDone, upcomingProgrammeDays, type Enrolment, type ProgrammePlan } from "@/lib/training/enrolment";
import type { Programme } from "@/lib/training/programmes";

function dayLabel(key: string, todayKey: string) {
  if (key === todayKey) return "Today";
  return readableDate(new Date(`${key}T12:00:00`), { weekday: "short", month: "short", day: "numeric" });
}

/** The programme the user follows: this week's planned days, what is next, and planning ahead. */
export function ProgrammeCard({ programme, enrolment, plans, todayKey, busy, starting, onStart, onPlanAhead, onLeave }: {
  programme: Programme;
  enrolment: Enrolment;
  plans: readonly ProgrammePlan[];
  todayKey: string;
  busy: boolean;
  starting: string;
  onStart: (planId: string) => void;
  onPlanAhead: () => void;
  onLeave: () => void;
}) {
  const nextDay = programme.days[enrolment.next_day_index % Math.max(1, programme.days.length)];
  const upcoming = upcomingProgrammeDays(plans, todayKey);
  return (
    <section aria-label="Your programme" className="rounded-xl border border-fitx-primary/30 bg-fitx-primary/[.05] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-fitx-primary-text">Your programme</p>
          <h4 className="mt-1 font-semibold">{programme.title}</h4>
          <p className="mt-1 text-xs text-fitx-text-secondary">{enrolment.sessions_completed} workout{enrolment.sessions_completed === 1 ? "" : "s"} done · next up: {nextDay?.title ?? "day 1"}</p>
        </div>
        <button type="button" onClick={onLeave} disabled={busy} className="fitx-button fitx-button-quiet min-h-10 px-3 text-sm">Leave programme</button>
      </div>
      {plans.length > 0 ? (
        <ol className="mt-4 space-y-2">
          {plans.map((plan) => {
            // A programme day is single-use: a workout done before its date counts too.
            const done = programmeDayDone(plan);
            const past = Boolean(plan.planned_for && plan.planned_for < todayKey);
            return (
              <li key={plan.id} className="flex items-center gap-3 rounded-lg border border-fitx-border bg-fitx-surface p-3">
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-md ${done ? "bg-fitx-success-bg text-fitx-success" : "bg-fitx-surface-variant text-fitx-text-secondary"}`}>{done ? <Check size={16} aria-hidden="true" /> : <span className="text-xs tabular-nums">{(plan.programme_day_index ?? 0) + 1}</span>}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{plan.title}</span>
                  <span className="text-xs text-fitx-text-secondary">{plan.planned_for ? dayLabel(plan.planned_for, todayKey) : "No date"}{done ? " · Done" : past ? " · Not done" : ""}</span>
                </span>
                {!done && <button type="button" disabled={Boolean(starting)} onClick={() => onStart(plan.id)} className="fitx-button min-h-10 px-3 text-sm">{starting === plan.id ? "Starting…" : "Start"}<ArrowRight size={14} aria-hidden="true" /></button>}
              </li>
            );
          })}
        </ol>
      ) : <p className="mt-4 text-sm text-fitx-text-secondary">Nothing is planned for this week yet.</p>}
      {!upcoming.length && <button type="button" onClick={onPlanAhead} disabled={busy} className="fitx-button fitx-button-secondary mt-3 min-h-11"><CalendarPlus size={15} aria-hidden="true" />{busy ? "Planning…" : "Plan the next 7 days"}</button>}
    </section>
  );
}
