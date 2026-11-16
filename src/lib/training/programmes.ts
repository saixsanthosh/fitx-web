import type { SlotSpec } from "./generator";
import type { Level, MuscleGroup, TrainingContext } from "./taxonomy";

export type ProgrammeSplit = "push_pull_legs" | "bro_split" | "upper_lower" | "full_body" | "home_bodyweight" | "home_dumbbell";

export type ProgrammeDay = {
  /** Stable within the programme, e.g. "push-a". */
  key: string;
  title: string;
  focus: readonly MuscleGroup[];
  slots: readonly SlotSpec[];
};

/**
 * A training programme: a repeating sequence of days. Enrolling schedules the next week's days on
 * the user's chosen weekdays; finishing a programme workout moves the user to the following day.
 * Programmes describe slots, not fixed exercises, so each user gets exercises they can do.
 */
export type Programme = {
  id: string;
  title: string;
  summary: string;
  context: TrainingContext;
  split: ProgrammeSplit;
  level: Level;
  daysPerWeek: number;
  /** Default training weekdays, 0 = Sunday ... 6 = Saturday. */
  defaultWeekdays: readonly number[];
  sessionMinutes: number;
  /** Equipment the track is designed around; slots still match the user's own list. */
  builtAround: readonly string[];
  days: readonly ProgrammeDay[];
  /** Premium gating arrives with subscriptions (Phase 11); every authored programme is free. */
  isPremium: boolean;
  /** Where the structure comes from, shown to users. */
  sourceNotes: string;
};

/** The programme day after `dayIndex`, wrapping around. */
export function nextDayIndex(programme: Pick<Programme, "days">, dayIndex: number): number {
  const count = programme.days.length;
  return count ? (((dayIndex + 1) % count) + count) % count : 0;
}

/**
 * The next `count` training dates on the chosen weekdays from `from` (inclusive), as local
 * YYYY-MM-DD keys, each paired with the programme day it gets (in order from `startDay`).
 */
export function scheduleDays(options: { from: Date; weekdays: readonly number[]; horizonDays: number; startDay: number; dayCount: number }): Array<{ date: string; dayIndex: number }> {
  const weekdays = new Set(options.weekdays.filter((day) => day >= 0 && day <= 6));
  const result: Array<{ date: string; dayIndex: number }> = [];
  if (!weekdays.size || options.dayCount <= 0) return result;
  let dayIndex = ((options.startDay % options.dayCount) + options.dayCount) % options.dayCount;
  for (let offset = 0; offset < options.horizonDays; offset++) {
    const day = new Date(options.from.getFullYear(), options.from.getMonth(), options.from.getDate() + offset);
    if (!weekdays.has(day.getDay())) continue;
    result.push({ date: localKey(day), dayIndex });
    dayIndex = (dayIndex + 1) % options.dayCount;
  }
  return result;
}

function localKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** The authored day that matches a profile's workout_split, for one-off "Auto plan" workouts. */
export function splitProgrammeId(split: string | null | undefined, context: TrainingContext, hasDumbbells: boolean): string {
  if (context === "home") return hasDumbbells ? "home-dumbbell-4" : "home-bodyweight-3";
  if (split === "push_pull_legs") return "ppl-3";
  if (split === "upper_lower") return "upper-lower-4";
  return "full-body-3";
}
