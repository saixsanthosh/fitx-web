"use client";

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Check, CircleDashed, Dumbbell, Minus, Moon, Pause } from "lucide-react";
import { nextTabIndex } from "@/components/ui/tabs-keys";
import { stateWord, type CalendarDay } from "@/lib/training/programme-calendar";
import styles from "./ProgrammeDayStrip.module.css";

const LONG_DATE: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" };

function dateOf(key: string) {
  return new Date(`${key}T12:00:00`);
}

/** "Wednesday 18 November, Push, done", for a day's accessible name. */
export function dayAccessibleName(day: CalendarDay): string {
  const date = new Intl.DateTimeFormat(undefined, LONG_DATE).format(dateOf(day.date));
  const parts = [day.isToday ? `Today, ${date}` : date];
  if (day.title && day.kind === "training") parts.push(day.title);
  parts.push(stateWord(day.state));
  return parts.join(", ");
}

/** The mark inside a day chip: a check when done, a moon on rest days, a dashed circle when not planned yet. */
export function DayMark({ day }: { day: CalendarDay }) {
  const props = { size: 14, strokeWidth: 2.5, "aria-hidden": true } as const;
  if (day.state === "done") return <Check {...props} />;
  if (day.state === "rest") return <Moon {...props} />;
  if (day.state === "projected") return <CircleDashed {...props} />;
  if (day.state === "paused") return <Pause {...props} />;
  if (day.state === "today" || day.state === "planned") return <Dumbbell {...props} />;
  return <Minus {...props} />;
}

/**
 * A programme's days as a horizontal strip of dated chips (a tab list): done, today, planned, not planned yet,
 * missed and rest days, each with its own mark. Choosing a day shows `renderPanel(day)` under the strip. Arrow keys,
 * Home and End move between days; today is scrolled into view when the strip appears.
 */
export function ProgrammeDayStrip({ days, selected, onSelect, label, renderPanel }: {
  days: readonly CalendarDay[];
  /** The date whose details are shown. */
  selected: string;
  onSelect: (date: string) => void;
  /** The accessible name of the strip. */
  label: string;
  renderPanel: (day: CalendarDay) => ReactNode;
}) {
  const base = useId();
  const scroller = useRef<HTMLDivElement>(null);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const current = days.find((day) => day.date === selected) ?? days.find((day) => day.isToday) ?? days[0];
  const currentIndex = current ? days.indexOf(current) : -1;
  const todayIndex = days.findIndex((day) => day.isToday);

  // Bring today (else the chosen day) into the middle of the strip once, without moving the page; later
  // selections scroll with focus.
  const centred = useRef(false);
  useEffect(() => {
    const box = scroller.current;
    const chip = buttons.current[todayIndex >= 0 ? todayIndex : currentIndex];
    if (centred.current || !box || !chip) return;
    centred.current = true;
    box.scrollLeft = Math.max(0, chip.offsetLeft - (box.clientWidth - chip.offsetWidth) / 2);
  }, [todayIndex, currentIndex]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const rtl = typeof document !== "undefined" && document.dir === "rtl";
    const next = nextTabIndex(event.key, index, days.length, { rtl });
    if (next === null) return;
    event.preventDefault();
    buttons.current[next]?.focus();
    onSelect(days[next].date);
  };

  if (!current) return null;
  return (
    <div>
      <div ref={scroller} className={styles.scroller}>
        <div role="tablist" aria-label={label} aria-orientation="horizontal" className={styles.strip}>
          {days.map((day, index) => {
            const active = index === currentIndex;
            const date = dateOf(day.date);
            return (
              <button
                key={day.date}
                ref={(node) => { buttons.current[index] = node; }}
                type="button"
                role="tab"
                id={`${base}-tab-${day.date}`}
                aria-selected={active}
                aria-controls={`${base}-panel`}
                aria-label={dayAccessibleName(day)}
                tabIndex={active ? 0 : -1}
                data-state={day.state}
                data-today={day.isToday}
                onClick={() => onSelect(day.date)}
                onKeyDown={(event) => onKeyDown(event, index)}
                className={styles.chip}
              >
                <span className={styles.weekday} aria-hidden="true">{day.isToday ? "Today" : new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date)}</span>
                <span className={styles.date} aria-hidden="true">{date.getDate()}</span>
                <span className={styles.mark}><DayMark day={day} /></span>
              </button>
            );
          })}
        </div>
      </div>
      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${current.date}`} className="mt-3">
        {renderPanel(current)}
      </div>
    </div>
  );
}
