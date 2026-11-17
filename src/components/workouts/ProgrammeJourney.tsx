"use client";

import { useId, useRef, type KeyboardEvent } from "react";
import { readableDate } from "@/lib/domain/dates";
import { addDays, daysBetween, mondayOf, type CalendarDay, type CalendarWeek } from "@/lib/training/programme-calendar";
import { ProgrammeDayDetails } from "./ProgrammeDayDetails";
import { DayMark, dayAccessibleName } from "./ProgrammeDayStrip";
import styles from "./ProgrammeDayStrip.module.css";

const SHORT: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };

function weekRange(weekStart: string) {
  const start = new Date(`${weekStart}T12:00:00`);
  const end = new Date(`${addDays(weekStart, 6)}T12:00:00`);
  const format = new Intl.DateTimeFormat(undefined, SHORT);
  return `${format.format(start)} – ${format.format(end)}`;
}

/** Days moved by a key in the week grid: a day sideways, a week up or down; null for other keys. */
export function journeyKeyStep(key: string): number | null {
  return key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : key === "ArrowDown" ? 7 : key === "ArrowUp" ? -7 : null;
}

/**
 * A programme's whole journey, week by week (Monday to Sunday): every day a toggle showing what it was or will be
 * (done, planned, not planned yet, not done, rest). The chosen day's details open under its week. One tab stop for
 * the grid: arrow keys move a day sideways or a week up and down, and choose that day.
 */
export function ProgrammeJourney({ weeks, startedOn, selected, onSelect, busy, onPreview, nextTraining }: {
  weeks: readonly CalendarWeek[];
  startedOn: string;
  selected: string | null;
  onSelect: (date: string) => void;
  busy?: boolean;
  onPreview: (planId: string) => void;
  /** The next training day, mentioned on rest days. */
  nextTraining: CalendarDay | null;
}) {
  const base = useId();
  const firstWeek = mondayOf(startedOn);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  // The one day that takes Tab: the chosen day, else today, else the first.
  const days = weeks.flatMap((week) => week.days);
  const stop = days.find((day) => day.date === selected)?.date ?? days.find((day) => day.isToday)?.date ?? days[0]?.date;
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, date: string) => {
    const step = journeyKeyStep(event.key);
    if (step === null || event.altKey || event.ctrlKey || event.metaKey) return;
    const next = addDays(date, step);
    const target = buttons.current.get(next);
    if (!target) return;
    event.preventDefault();
    target.focus();
    onSelect(next);
  };
  return (
    <ol className="space-y-5">
      {weeks.map((week) => {
        const number = Math.floor(daysBetween(firstWeek, week.weekStart) / 7) + 1;
        const inside = week.days.filter((day) => day.kind !== "outside");
        const training = inside.filter((day) => day.kind === "training");
        const done = training.filter((day) => day.state === "done").length;
        const rest = inside.filter((day) => day.kind === "rest").length;
        const chosen = week.days.find((day) => day.date === selected) ?? null;
        const headingId = `${base}-week-${week.weekStart}`;
        const panelId = `${base}-panel-${week.weekStart}`;
        return (
          <li key={week.weekStart} aria-labelledby={headingId}>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id={headingId} className="text-sm font-semibold">{number >= 1 ? `Week ${number}` : "Before you started"} <span className="font-normal text-fitx-text-secondary">· {weekRange(week.weekStart)}</span></h2>
              {inside.length > 0 && <p className="text-xs text-fitx-text-secondary">{training.length ? `${done} of ${training.length} done` : "No training days"}{rest ? ` · ${rest} rest day${rest === 1 ? "" : "s"}` : ""}</p>}
            </div>
            <ul className={styles.week}>
              {week.days.map((day) => {
                const date = new Date(`${day.date}T12:00:00`);
                return (
                  <li key={day.date}>
                    <button type="button" aria-pressed={day.date === selected} aria-controls={panelId} aria-label={dayAccessibleName(day)}
                      ref={(node) => { if (node) buttons.current.set(day.date, node); else buttons.current.delete(day.date); }}
                      tabIndex={day.date === stop ? 0 : -1} onKeyDown={(event) => onKeyDown(event, day.date)}
                      data-state={day.state} data-today={day.isToday} onClick={() => onSelect(day.date)} className={styles.chip}>
                      <span className={styles.weekday} aria-hidden="true">{day.isToday ? "Today" : new Intl.DateTimeFormat(undefined, { weekday: "narrow" }).format(date)}</span>
                      <span className={styles.date} aria-hidden="true">{date.getDate()}</span>
                      <span className={styles.mark}><DayMark day={day} /></span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div id={panelId} aria-live="polite" className={chosen ? "mt-3" : undefined}>
              {chosen && <ProgrammeDayDetails day={chosen} next={chosen.state === "rest" ? nextTraining : null} busy={busy} onPreview={onPreview} />}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** A date heading for the started-on line: "Started Monday, Nov 3". */
export function startedLabel(startedOn: string): string {
  return `Started ${readableDate(new Date(`${startedOn}T12:00:00`), { weekday: "long", month: "short", day: "numeric" })}`;
}
