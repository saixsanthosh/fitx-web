import type { RegionKey } from "./anatomy";
import { FOCUS_AREAS, FOCUS_AREA_INFO, type FocusArea } from "./focus";
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

// ---------------------------------------------------------------- body areas (the focus vocabulary, focus.ts)

/** The focus area of each muscle group a slot names: the area whose groups include it (neck has none). */
const GROUP_AREA: ReadonlyMap<string, FocusArea> = new Map(
  FOCUS_AREAS.flatMap((area) => FOCUS_AREA_INFO[area].groups.map((group) => [group, area] as const)),
);
const UPPER_GROUPS: ReadonlySet<string> = new Set(["chest", "back", "shoulders", "biceps", "triceps"]);
const LOWER_GROUPS: ReadonlySet<string> = new Set(["quadriceps", "hamstrings", "glutes", "calves", "hips"]);

const slotGroup = (slot: Pick<SlotSpec, "muscle">): MuscleGroup => (Array.isArray(slot.muscle) ? slot.muscle[0] : slot.muscle) as MuscleGroup;

/** The focus area a muscle group belongs to, or null (neck). */
export function areaForGroup(group: string): FocusArea | null {
  return GROUP_AREA.get(group) ?? null;
}

export type ProgrammeAreaShare = {
  area: FocusArea;
  /** Working sets for the area in one full cycle of the programme's days (optional slots left out). */
  sets: number;
  /** Its share of all those sets, 0..1. */
  share: number;
};

/**
 * How a programme's work is spread over the body areas: the sets of every required slot in one cycle, counted for
 * the area of the slot's main muscle group, most first. Read from the authored slots only.
 */
export function programmeAreaShares(programme: Pick<Programme, "days">): ProgrammeAreaShare[] {
  const sets = new Map<FocusArea, number>();
  let total = 0;
  for (const day of programme.days) {
    for (const slot of day.slots) {
      if (slot.optional) continue;
      const area = areaForGroup(slotGroup(slot));
      if (!area) continue;
      sets.set(area, (sets.get(area) ?? 0) + slot.sets);
      total += slot.sets;
    }
  }
  return FOCUS_AREAS.filter((area) => sets.has(area))
    .map((area) => ({ area, sets: sets.get(area)!, share: total ? sets.get(area)! / total : 0 }))
    .sort((a, b) => b.sets - a.sets || FOCUS_AREAS.indexOf(a.area) - FOCUS_AREAS.indexOf(b.area));
}

/** A full-body programme: every day's required slots reach both the upper and the lower body. */
export function isFullBodyProgramme(programme: Pick<Programme, "days">): boolean {
  return programme.days.length > 0 && programme.days.every((day) => {
    const groups = day.slots.filter((slot) => !slot.optional).map(slotGroup);
    return groups.some((group) => UPPER_GROUPS.has(group)) && groups.some((group) => LOWER_GROUPS.has(group));
  });
}

/** The areas a programme trains: full body first when every day is full body, then the others, most work first. */
export function programmeAreas(programme: Pick<Programme, "days">): FocusArea[] {
  const shares = programmeAreaShares(programme).map((entry) => entry.area).filter((area) => area !== "full_body");
  return isFullBodyProgramme(programme) ? ["full_body", ...shares] : shares;
}

/** The programmes that train an area, the most work for it first (full body: the full-body programmes, in order). */
export function programmesForArea<T extends Pick<Programme, "days">>(programmes: readonly T[], area: FocusArea): T[] {
  if (area === "full_body") return programmes.filter(isFullBodyProgramme);
  const shareOf = (programme: T) => programmeAreaShares(programme).find((entry) => entry.area === area)?.share ?? 0;
  return programmes.map((programme, index) => ({ programme, index, share: shareOf(programme) }))
    .filter((entry) => entry.share > 0)
    .sort((a, b) => b.share - a.share || a.index - b.index)
    .map((entry) => entry.programme);
}

/** Body-map heat for a programme: each area's regions at its share of the work, relative to the busiest area. */
export function programmeRegionLevels(programme: Pick<Programme, "days">): Partial<Record<RegionKey, number>> {
  const shares = programmeAreaShares(programme).filter((entry) => entry.area !== "full_body");
  const top = Math.max(0, ...shares.map((entry) => entry.share));
  const levels: Partial<Record<RegionKey, number>> = {};
  if (!top) return levels;
  for (const entry of shares) {
    const level = Math.round((entry.share / top) * 1000) / 1000;
    for (const region of FOCUS_AREA_INFO[entry.area].regions) levels[region] = Math.max(levels[region] ?? 0, level);
  }
  return levels;
}

/** A slot's prescription as authored: "4 × 6–8", "3 × 12", "3 × 40 s". */
export function slotPrescription(slot: Pick<SlotSpec, "sets" | "reps" | "seconds">): string {
  if (slot.seconds) return `${slot.sets} × ${slot.seconds} s`;
  const [low, high] = slot.reps;
  return `${slot.sets} × ${low === high ? low : `${low}–${high}`}`;
}

/** Training and rest days in a week for the chosen weekdays. */
export function weeklyPattern(weekdays: readonly number[]): { training: number; rest: number } {
  const training = new Set(weekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)).size;
  return { training, rest: 7 - training };
}

/** The authored day that matches a profile's workout_split, for one-off "Auto plan" workouts. */
export function splitProgrammeId(split: string | null | undefined, context: TrainingContext, hasDumbbells: boolean): string {
  if (context === "home") return hasDumbbells ? "home-dumbbell-4" : "home-bodyweight-3";
  if (split === "push_pull_legs") return "ppl-3";
  if (split === "upper_lower") return "upper-lower-4";
  return "full-body-3";
}
