/**
 * The compact Gym tab (phase 7.4, wave 2): the pure parts, so `node --test` can cover them.
 *  - `menuKeyIndex`: keyboard movement in an actions menu (ActionsMenu.tsx).
 *  - `sessionsRing`: the programme card's progress ring (ProgrammeCard.tsx). Completed workouts only; with no
 *    planned length the ring has no total and shows only the count.
 *  - `dayMessage`: one short line for a programme day (ProgrammeDayDetails.tsx, here and on the journey page).
 *  - `TODAY_ROWS_SHOWN`: how many exercises the Today card lists before "and N more" (the plan preview lists all).
 *
 * Type-only imports, so this file loads in node without a bundler.
 */
import type { CalendarDay } from "@/lib/training/programme-calendar";

export const TODAY_ROWS_SHOWN = 4;

/**
 * The item a key moves to in a vertical menu of `count` items, or null for any other key. Arrows wrap; Home and End
 * jump to the ends. From no item (-1), Down goes to the first and Up to the last.
 */
export function menuKeyIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowDown") return current < 0 ? 0 : (current + 1) % count;
  if (key === "ArrowUp") return current < 0 ? count - 1 : (current - 1 + count) % count;
  return null;
}

export type SessionsRing = {
  /** 0..1 of the ring drawn; 0 when there is no total. */
  fraction: number;
  /** The number in the middle. */
  value: string;
  /** "of 24", or null for a programme without a length. */
  total: string | null;
  /** The ring's accessible name. */
  label: string;
};

/** The programme card's ring: sessions done (completed workouts only) of the sessions the plan holds. */
export function sessionsRing(done: number, target: number | null | undefined): SessionsRing {
  const count = Number.isFinite(done) && done > 0 ? Math.floor(done) : 0;
  const total = target && Number.isFinite(target) && target > 0 ? Math.floor(target) : null;
  const words = `${count.toLocaleString("en-GB")} workout${count === 1 ? "" : "s"}`;
  if (total === null) return { fraction: 0, value: count.toLocaleString("en-GB"), total: null, label: `Sessions done: ${words}, completed workouts only` };
  return {
    fraction: Math.min(1, count / total),
    value: count.toLocaleString("en-GB"),
    total: `of ${total.toLocaleString("en-GB")}`,
    label: `Sessions done: ${count.toLocaleString("en-GB")} of ${total.toLocaleString("en-GB")}, completed workouts only`,
  };
}

/**
 * One short line for a programme day. `nextLine` ("Next: Thursday, Nov 26 · Pull.") follows a rest day. A missed day
 * is never written as a failure.
 */
export function dayMessage(day: Pick<CalendarDay, "state" | "date" | "doneOn">, nextLine = ""): string {
  switch (day.state) {
    case "done": return day.doneOn && day.doneOn !== day.date ? "Done on another day. It still counts." : "Done.";
    case "today": return "Planned for today.";
    case "planned": return "Planned. Doing it early still counts.";
    case "missed": return "Not done yet. You can still do it.";
    case "projected": return "Not planned yet. FITX plans about a week ahead.";
    case "unplanned": return "No workout planned.";
    case "paused": return "Paused. Resume to plan this day.";
    case "rest": return `Recovery is part of your plan. ${nextLine}`.trim();
    case "before_start": return "Before you started.";
    case "after_end": return "After the plan ends.";
  }
}
