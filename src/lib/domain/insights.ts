/**
 * "What should I improve next?": observations from the member's own logs, each with the numbers behind it and a
 * link to act on it. Pure; Home ("Focus next") and Progress show the same list.
 *
 * Every rule fires only above a data threshold and says only what the logs show (no medical or diet advice):
 *  - consistency  nothing logged this week so far, while by this weekday something was logged in at least 3 of
 *                 the 4 weeks before (finished workouts and recorded activities; not said when activities
 *                 could not be read);
 *  - muscle_gap   a muscle with at least 4 direct sets spread over at least 2 of the 4 weeks before the last 7
 *                 days, and no set at all (direct or assisting) in the last 7 days, while the member did train in
 *                 those 7 days (otherwise it is a break, which `consistency` covers);
 *  - protein      on most of the last 7 complete days with food logged (at least 3 judged), the day's protein
 *                 stayed under the protein target; a day whose total is incomplete (foods without a protein
 *                 value) and under the target is not judged, and the note says so;
 *  - push_pull    in the last 4 weeks, at least 12 direct sets of push (chest, triceps) and pull (lats, middle
 *                 back, biceps) muscles together, one side at least twice the other and 6 sets ahead; shoulder
 *                 work counts on neither side because shoulder exercises push and pull.
 * Muscles follow the one counting rule (muscle-history.ts, contract C3). Days are the browser's calendar days.
 */
import { addDays, daysBetween, mondayOf, weekdayIndex } from "./day-keys";
import { localDateKey } from "./dates";
import type { MealTotals } from "./meal-totals";
import type { DailyTarget } from "./today";
import { BODY_REGIONS, REGIONS, exerciseRegions, type RegionKey } from "@/lib/training/anatomy";
import { isCountedSet, isCountedSession, summariseMuscles, type LoggedSession, type PeriodRange } from "@/lib/training/muscle-history";

/** The days of history the rules read (loaders cover at least this much, today included). */
export const INSIGHT_WINDOW_DAYS = 35;

export type InsightKind = "consistency" | "muscle_gap" | "protein" | "push_pull";

export type Insight = {
  /** Stable per observation (a list key). */
  id: string;
  kind: InsightKind;
  title: string;
  /** The numbers behind it. */
  detail: string;
  /** What it was worked out from. */
  basis: string;
  href: string;
  action: string;
};

export type InsightsStatus = "ready" | "nothing_to_flag" | "not_enough_data";
export type InsightsResult = { status: InsightsStatus; insights: Insight[] };

export type ProteinTarget = {
  grams: number;
  /** The target is FITX's estimate from the profile, not one the member set. */
  estimate: boolean;
  /** How to name it in a sentence: "your daily goal", "the target you set". */
  label: string;
};

/** The protein target Home measures against (todayTargets), named for a sentence; null when there is none. */
export function proteinTargetFrom(target: DailyTarget | null | undefined): ProteinTarget | null {
  if (!target || !target.target || target.target <= 0 || !target.source) return null;
  const label = target.source === "goal" ? "your daily goal" : target.source === "target" ? "the target you set" : target.source === "preference" ? "your setting" : "your estimated target";
  return { grams: target.target, estimate: target.source === "estimate", label };
}

export type InsightInput = {
  /** The member's local day (YYYY-MM-DD). */
  today: string;
  /** Completed sessions with their sets, covering at least the last INSIGHT_WINDOW_DAYS days. */
  sessions: readonly LoggedSession[];
  /** Start times of recorded activities in that window; null when this database has no activities or they could not be read. */
  activityStarts: readonly string[] | null;
  /**
   * The activities request failed (not merely unavailable on this database). Activities may then have been logged
   * this week, so "nothing logged yet" is not said: unknown is not none.
   */
  activitiesFailed: boolean;
  /** Food totals per logged day, covering at least the 7 days before today. */
  foodDays: ReadonlyMap<string, MealTotals>;
  proteinTarget: ProteinTarget | null;
};

/** At most this many observations are returned (Home shows the first three). */
export const MAX_INSIGHTS = 4;

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Tue 10 Nov", independent of the runtime locale. */
export function shortDay(key: string): string {
  const [, month, day] = key.split("-").map(Number);
  return `${WEEKDAYS[weekdayIndex(key)].slice(0, 3)} ${day} ${MONTHS[month - 1]}`;
}

function startOf(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** The local-calendar window from `from` to `to`, inclusive. */
export function dayWindow(from: string, to: string): PeriodRange {
  return { start: startOf(from), end: startOf(addDays(to, 1)) };
}

function dayOf(iso: string | null | undefined): string | null {
  if (typeof iso !== "string" || !iso) return null;
  const time = Date.parse(iso);
  return Number.isFinite(time) ? localDateKey(new Date(time)) : null;
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const andList = (items: readonly string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);
const grams = (value: number) => `${Math.round(value)} g`;

// ---------------------------------------------------------------- rules

function consistency(input: InsightInput): Insight | null {
  if (input.activitiesFailed) return null;
  const monday = mondayOf(input.today);
  const span = daysBetween(monday, input.today);
  const days = [
    ...input.sessions.filter(isCountedSession).map((session) => dayOf(session.started_at)),
    ...(input.activityStarts ?? []).map(dayOf),
  ].filter((day): day is string => day !== null);
  const countIn = (from: string, to: string) => days.filter((day) => day >= from && day <= to).length;
  if (countIn(monday, input.today) > 0) return null;
  // Oldest first: the 4th, 3rd, 2nd and last week before this one, Monday to the same weekday.
  const before = [4, 3, 2, 1].map((weeks) => countIn(addDays(monday, -7 * weeks), addDays(monday, -7 * weeks + span)));
  if (before.filter((count) => count > 0).length < 3) return null;
  const noun = input.activityStarts ? "workouts or activities" : "workouts";
  const weekday = WEEKDAYS[weekdayIndex(input.today)];
  return {
    id: "consistency",
    kind: "consistency",
    title: "Nothing logged yet this week",
    detail: `By ${weekday} in the last 4 weeks you had logged ${andList(before.map(String))} ${noun}. This week: none so far.`,
    basis: input.activityStarts
      ? "Finished workouts and recorded activities, Monday to today, against the same days of the 4 weeks before."
      : "Finished workouts, Monday to today, against the same days of the 4 weeks before.",
    href: "/workouts",
    action: "Plan a workout",
  };
}

function muscleGaps(input: InsightInput): Insight[] {
  const { today, sessions } = input;
  const recent = summariseMuscles(sessions, dayWindow(addDays(today, -6), today));
  if (recent.sessions === 0) return [];
  const before = summariseMuscles(sessions, dayWindow(addDays(today, -34), addDays(today, -7)));
  const blocks = [0, 1, 2, 3].map((index) => summariseMuscles(sessions, dayWindow(addDays(today, -34 + 7 * index), addDays(today, -28 + 7 * index))));
  const order = new Map(BODY_REGIONS.map((region, index) => [region, index]));
  const found: Array<{ region: RegionKey; sets: number; weeks: number; last: string | null }> = [];
  for (const region of BODY_REGIONS) {
    const now = recent.regions[region];
    if (now.primarySets + now.secondarySets > 0) continue;
    const weeks = blocks.filter((block) => block.regions[region].primarySets > 0).length;
    const sets = before.regions[region].primarySets;
    if (sets < 4 || weeks < 2) continue;
    found.push({ region, sets, weeks, last: before.regions[region].lastTrainedOn });
  }
  found.sort((a, b) => b.sets - a.sets || b.weeks - a.weeks || (order.get(a.region) ?? 0) - (order.get(b.region) ?? 0));
  return found.slice(0, 2).map(({ region, sets, weeks, last }) => {
    const label = REGIONS[region].label;
    return {
      id: `muscle_gap:${region}`,
      kind: "muscle_gap" as const,
      title: `${label}: no sets in the last 7 days`,
      detail: `${plural(sets, "direct set")} in ${weeks} of the 4 weeks before${last ? `, the last on ${shortDay(last)}` : ""}. Nothing since, though you trained in the last 7 days.`,
      basis: "Completed sets of finished workouts, by each exercise's listed muscles.",
      href: `/exercises?muscle=${region}`,
      action: `Find ${label.toLowerCase()} exercises`,
    };
  });
}

const PUSH_REGIONS: ReadonlySet<RegionKey> = new Set<RegionKey>(["chest", "triceps"]);
const PULL_REGIONS: ReadonlySet<RegionKey> = new Set<RegionKey>(["lats", "middle_back", "biceps"]);

/** Direct sets of push and pull muscles in a window (an exercise counts on the side of its main muscle). */
export function pushPullSets(sessions: readonly LoggedSession[], from: string, to: string): { push: number; pull: number } {
  const range = dayWindow(from, to);
  const start = range.start!.getTime();
  const end = range.end!.getTime();
  let push = 0;
  let pull = 0;
  for (const session of sessions) {
    if (!isCountedSession(session)) continue;
    for (const exercise of session.exercises ?? []) {
      if (!exercise.library) continue;
      const { primary } = exerciseRegions(exercise.library.primary_muscle, exercise.library.secondary_muscles);
      const isPush = primary.some((region) => PUSH_REGIONS.has(region));
      const isPull = primary.some((region) => PULL_REGIONS.has(region));
      if (isPush === isPull) continue;
      const sets = (exercise.sets ?? []).filter((set) => {
        if (!isCountedSet(set)) return false;
        const time = Date.parse(set.completed_at ?? "");
        return time >= start && time < end;
      }).length;
      if (isPush) push += sets;
      else pull += sets;
    }
  }
  return { push, pull };
}

function pushPull(input: InsightInput): Insight | null {
  const { push, pull } = pushPullSets(input.sessions, addDays(input.today, -27), input.today);
  const more = Math.max(push, pull);
  const less = Math.min(push, pull);
  if (push + pull < 12 || more < 2 * less || more - less < 6) return null;
  const pushing = push > pull;
  return {
    id: "push_pull",
    kind: "push_pull",
    title: pushing ? "More pushing than pulling" : "More pulling than pushing",
    detail: `In the last 4 weeks: ${plural(push, "push set")} (chest and triceps) and ${plural(pull, "pull set")} (back and biceps).`,
    basis: "Direct sets of finished workouts, by each exercise's main muscle. Shoulder work counts on neither side.",
    href: pushing ? "/exercises?muscle=back" : "/exercises?muscle=chest",
    action: pushing ? "Find back exercises" : "Find chest exercises",
  };
}

export type ProteinDays = { logged: number; met: number; under: number; unclear: number; average: number | null };

/** The last 7 complete days (yesterday and the 6 before) judged against a protein target. */
export function proteinDays(foodDays: ReadonlyMap<string, MealTotals>, today: string, target: number): ProteinDays {
  let logged = 0;
  let met = 0;
  let under = 0;
  let unclear = 0;
  const judged: number[] = [];
  for (let offset = 7; offset >= 1; offset -= 1) {
    const totals = foodDays.get(addDays(today, -offset));
    if (!totals || totals.entries === 0) continue;
    logged += 1;
    if (totals.protein.known === 0) { unclear += 1; continue; }
    const value = totals.protein.sum;
    if (value >= target) { met += 1; judged.push(value); continue; }
    // Under the target, but some foods have no protein value: the real total is not known.
    if (totals.protein.missing > 0) { unclear += 1; continue; }
    under += 1;
    judged.push(value);
  }
  return { logged, met, under, unclear, average: judged.length ? judged.reduce((sum, value) => sum + value, 0) / judged.length : null };
}

function protein(input: InsightInput): Insight | null {
  const target = input.proteinTarget;
  if (!target || !Number.isFinite(target.grams) || target.grams <= 0) return null;
  const days = proteinDays(input.foodDays, input.today, target.grams);
  const judged = days.met + days.under;
  if (judged < 3 || days.under * 2 <= judged) return null;
  const unclear = days.unclear
    ? ` ${plural(days.unclear, "more day")} had foods without a protein value, so ${days.unclear === 1 ? "it isn't" : "they aren't"} counted.`
    : "";
  return {
    id: "protein",
    kind: "protein",
    title: "Protein under your target on most days",
    detail: `Under ${grams(target.grams)} on ${days.under} of the ${judged} days you logged food in the last 7 days. Those days averaged ${grams(days.average ?? 0)}.${unclear}`,
    basis: target.estimate
      ? `Measured against your estimated target of ${grams(target.grams)}, worked out from your profile and latest weigh-in.`
      : `Measured against ${target.label} of ${grams(target.grams)}. Foods without a protein value are left out.`,
    href: "/nutrition",
    action: "Open Nutrition",
  };
}

// ---------------------------------------------------------------- all together

/** Whether the window holds enough logging for any rule to say something. */
function enoughData(input: InsightInput): boolean {
  const from = addDays(input.today, -(INSIGHT_WINDOW_DAYS - 1));
  const range = dayWindow(from, input.today);
  const start = range.start!.getTime();
  const trained = input.sessions.filter((session) => isCountedSession(session) && session.exercises.some((exercise) => exercise.sets.some((set) => {
    if (!isCountedSet(set)) return false;
    const time = Date.parse(set.completed_at ?? "");
    return time >= start;
  }))).length;
  const activities = (input.activityStarts ?? []).filter((iso) => {
    const day = dayOf(iso);
    return day !== null && day >= from && day <= input.today;
  }).length;
  let foodDays = 0;
  for (let offset = 7; offset >= 1; offset -= 1) if ((input.foodDays.get(addDays(input.today, -offset))?.entries ?? 0) > 0) foodDays += 1;
  return trained >= 2 || activities >= 2 || foodDays >= 3;
}

/** The observations, most useful first, at most MAX_INSIGHTS. */
export function improveNext(input: InsightInput): InsightsResult {
  const gaps = muscleGaps(input);
  const insights = [consistency(input), gaps[0] ?? null, protein(input), pushPull(input), gaps[1] ?? null]
    .filter((insight): insight is Insight => insight !== null)
    .slice(0, MAX_INSIGHTS);
  if (insights.length) return { status: "ready", insights };
  return { status: enoughData(input) ? "nothing_to_flag" : "not_enough_data", insights: [] };
}
