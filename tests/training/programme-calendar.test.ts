import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays, continuationStart, daysBetween, groupByWeek, mondayOf, planningWindow, programmeCalendar, programmeStatus, sessionsLeftToPlan,
  stripRange, targetSessions, upcomingPlans, weekdayOf, type CalendarDay, type CalendarEnrolment, type CalendarPlan,
} from "@/lib/training/programme-calendar";
import { nextScheduleStart } from "@/lib/training/enrolment";

// 2026-11-16 is a Monday. The member trains Monday, Wednesday and Friday.
const PPL = { days: [{ key: "push", title: "Push", focus: ["chest"] }, { key: "pull", title: "Pull", focus: ["back"] }, { key: "legs", title: "Legs", focus: ["quadriceps"] }] };
const enrolment = (overrides: Partial<CalendarEnrolment> = {}): CalendarEnrolment => ({
  weekdays: [1, 3, 5], started_on: "2026-11-09", next_day_index: 1, sessions_completed: 3, status: "active", ...overrides,
});
const plan = (id: string, planned_for: string, programme_day_index: number, last_done_key: string | null = null): CalendarPlan =>
  ({ id, title: `${id} plan`, planned_for, programme_day_index, last_done_key });

// Two weeks in: Monday and Wednesday of week 1 done, its Friday missed, this Monday done, today (Wednesday) and Friday planned.
const PLANS = [
  plan("w1-mon", "2026-11-09", 0, "2026-11-09"), plan("w1-wed", "2026-11-11", 1, "2026-11-11"), plan("w1-fri", "2026-11-13", 2),
  plan("w2-mon", "2026-11-16", 0, "2026-11-16"), plan("w2-wed", "2026-11-18", 1), plan("w2-fri", "2026-11-20", 2),
];
const TODAY = "2026-11-18";
const byDate = (days: readonly CalendarDay[]) => Object.fromEntries(days.map((day) => [day.date, day]));

test("date keys: weekdays, Mondays, adding days and spans, across month ends", () => {
  assert.equal(weekdayOf("2026-11-16"), 1);
  assert.equal(weekdayOf("2026-11-22"), 0);
  assert.equal(mondayOf("2026-11-22"), "2026-11-16");
  assert.equal(mondayOf("2026-11-16"), "2026-11-16");
  assert.equal(addDays("2026-11-30", 1), "2026-12-01");
  assert.equal(addDays("2027-01-01", -1), "2026-12-31");
  assert.equal(daysBetween("2026-11-16", "2026-12-16"), 30);
  assert.equal(daysBetween("2026-12-16", "2026-11-16"), -30);
});

test("the days of a programme: done, missed, today, planned, rest days and what comes next", () => {
  const days = byDate(programmeCalendar({ enrolment: enrolment(), programme: PPL, plans: PLANS, todayKey: TODAY, fromKey: "2026-11-12", toKey: "2026-11-25" }));
  assert.equal(days["2026-11-12"].state, "rest");
  assert.equal(days["2026-11-13"].state, "missed");
  assert.equal(days["2026-11-13"].title, "Legs");
  assert.equal(days["2026-11-13"].planId, "w1-fri");
  assert.equal(days["2026-11-14"].state, "rest");
  assert.equal(days["2026-11-15"].kind, "rest");
  assert.equal(days["2026-11-16"].state, "done");
  assert.equal(days["2026-11-18"].state, "today");
  assert.equal(days["2026-11-18"].isToday, true);
  assert.equal(days["2026-11-20"].state, "planned");
  // After the last planned day the cycle continues where planning would: Push after Friday's Legs.
  assert.deepEqual([days["2026-11-23"].state, days["2026-11-23"].title, days["2026-11-23"].dayIndex, days["2026-11-23"].planId], ["projected", "Push", 0, null]);
  assert.deepEqual([days["2026-11-25"].state, days["2026-11-25"].title], ["projected", "Pull"]);
  assert.equal(days["2026-11-24"].state, "rest");
  // A rest day is never "missed"; only a planned day that was not done is.
  const all = Object.values(days);
  assert.ok(all.filter((day) => day.kind === "rest").every((day) => day.state === "rest"));
  assert.deepEqual(all.filter((day) => day.state === "missed").map((day) => day.date), ["2026-11-13"]);
});

test("days before the start are outside the programme; training weekdays with no plan say so", () => {
  const days = byDate(programmeCalendar({ enrolment: enrolment({ started_on: "2026-11-16" }), programme: PPL, plans: [plan("mon", "2026-11-16", 0, "2026-11-16")], todayKey: TODAY, fromKey: "2026-11-13", toKey: "2026-11-18" }));
  assert.equal(days["2026-11-13"].state, "before_start");
  assert.equal(days["2026-11-15"].kind, "outside");
  assert.equal(days["2026-11-16"].state, "done");
  // Nothing planned ahead: today is where the cycle continues (the enrolment's next day), not planned yet.
  assert.deepEqual([days["2026-11-18"].state, days["2026-11-18"].title], ["projected", "Pull"]);
});

test("a day done before its date counts as done and is not upcoming; a done plan wins over a duplicate on its date", () => {
  const early = [plan("fri", "2026-11-20", 2, "2026-11-17"), plan("fri-copy", "2026-11-20", 2)];
  const days = byDate(programmeCalendar({ enrolment: enrolment(), programme: PPL, plans: early, todayKey: TODAY, fromKey: "2026-11-20", toKey: "2026-11-20" }));
  assert.equal(days["2026-11-20"].state, "done");
  assert.equal(days["2026-11-20"].planId, "fri");
  assert.equal(days["2026-11-20"].doneOn, "2026-11-17");
  assert.deepEqual(upcomingPlans(early, TODAY).map((entry) => entry.id), ["fri-copy"]);
});

test("a paused programme plans nothing ahead: its training days say paused, earlier ones stay as they were", () => {
  const days = byDate(programmeCalendar({ enrolment: enrolment({ status: "paused" }), programme: PPL, plans: PLANS.slice(0, 4), todayKey: TODAY, fromKey: "2026-11-16", toKey: "2026-11-23" }));
  assert.equal(days["2026-11-16"].state, "done");
  assert.equal(days["2026-11-18"].state, "paused");
  assert.equal(days["2026-11-20"].state, "paused");
  assert.equal(days["2026-11-23"].state, "paused");
  assert.equal(days["2026-11-19"].state, "rest");
});

test("a plan's sessions are its training weekdays in its length; a 30-day plan on three days a week has 13", () => {
  assert.equal(targetSessions("2026-11-16", [1, 3, 5], 30), 13);
  assert.equal(targetSessions("2026-11-16", [1, 3, 5], 14), 6);
  assert.equal(targetSessions("2026-11-16", [0, 1, 2, 3, 4, 5, 6], 28), 28);
  assert.equal(targetSessions("2026-11-16", [1, 3, 5], null), null, "an ongoing programme has no target");
  assert.equal(targetSessions("2026-11-16", [], 30), null);
});

test("a plan with a length projects only the sessions left, and a missed day moves its end later", () => {
  const start = enrolment({ started_on: "2026-11-16", sessions_completed: 1 });
  const target = targetSessions("2026-11-16", [1, 3, 5], 14)!;
  const onTrack = [plan("mon", "2026-11-16", 0, "2026-11-16"), plan("wed", "2026-11-18", 1), plan("fri", "2026-11-20", 2)];
  assert.equal(sessionsLeftToPlan({ target, sessionsCompleted: 1, plans: onTrack, todayKey: TODAY }), 3);
  const days = programmeCalendar({ enrolment: start, programme: PPL, plans: onTrack, todayKey: TODAY, fromKey: "2026-11-16", toKey: "2026-12-06", target });
  assert.deepEqual(days.filter((day) => day.state === "projected").map((day) => day.date), ["2026-11-23", "2026-11-25", "2026-11-27"]);
  assert.ok(days.filter((day) => day.date > "2026-11-27").every((day) => day.state === "after_end"), "nothing after the last session");

  // Wednesday was missed and it is Friday now: one more session is needed after the nominal end.
  const missed = [plan("mon", "2026-11-16", 0, "2026-11-16"), plan("wed", "2026-11-18", 1), plan("fri", "2026-11-20", 2)];
  const later = programmeCalendar({ enrolment: start, programme: PPL, plans: missed, todayKey: "2026-11-20", fromKey: "2026-11-16", toKey: "2026-12-06", target });
  assert.equal(later.find((day) => day.date === "2026-11-18")?.state, "missed");
  assert.deepEqual(later.filter((day) => day.state === "projected").map((day) => day.date), ["2026-11-23", "2026-11-25", "2026-11-27", "2026-11-30"]);
});

test("a finished plan with a length ends after its last session", () => {
  const done = [plan("a", "2026-11-16", 0, "2026-11-16"), plan("b", "2026-11-18", 1, "2026-11-18")];
  const days = programmeCalendar({ enrolment: enrolment({ started_on: "2026-11-16", sessions_completed: 2 }), programme: PPL, plans: done, todayKey: "2026-11-20", fromKey: "2026-11-16", toKey: "2026-11-25", target: 2 });
  assert.equal(days.find((day) => day.date === "2026-11-18")?.state, "done");
  assert.ok(days.filter((day) => day.date > "2026-11-18").every((day) => day.state === "after_end"));
  const status = programmeStatus({ enrolment: enrolment({ started_on: "2026-11-16", sessions_completed: 2 }), programme: PPL, days, todayKey: "2026-11-20", target: 2 });
  assert.equal(status.complete, true);
});

test("the next week is planned from after the last planned day, never twice, and not while paused", () => {
  const base = { enrolment: enrolment(), todayKey: TODAY, dayCount: 3 };
  assert.deepEqual(planningWindow({ ...base, plans: PLANS }), { fromKey: "2026-11-21", startDay: 0, horizonDays: 4, maxDays: null });
  // Planned through the end of the horizon: nothing to do.
  const covered = [...PLANS, plan("w3-mon", "2026-11-23", 0)];
  assert.equal(planningWindow({ ...base, plans: covered }), null);
  // Nothing ahead (a break): from today, at the day the member is on.
  assert.deepEqual(planningWindow({ ...base, plans: PLANS.slice(0, 3), todayKey: "2026-11-30" }), { fromKey: "2026-11-30", startDay: 1, horizonDays: 7, maxDays: null });
  assert.equal(planningWindow({ ...base, plans: PLANS, enrolment: enrolment({ status: "paused" }) }), null);
  assert.equal(planningWindow({ ...base, plans: PLANS, sessionsLeft: 0 }), null, "a plan with a length that is fully planned or done");
  assert.equal(planningWindow({ ...base, plans: PLANS, sessionsLeft: 2 })?.maxDays, 2);
  // Saturday, training on Mondays only, Monday already planned: no training day left in the week ahead.
  assert.equal(planningWindow({ ...base, enrolment: enrolment({ weekdays: [1] }), plans: [plan("mon", "2026-11-23", 0)], todayKey: "2026-11-21" }), null);
});

test("the scheduling start is shared with planning ahead", () => {
  for (const today of ["2026-11-17", "2026-11-23"]) {
    assert.deepEqual(continuationStart(PLANS, 1, today, 3), nextScheduleStart(PLANS.map((entry) => ({ ...entry, title: entry.title })), 1, today, 3));
  }
});

test("this week's summary counts training days, done days and rest days; rest never counts as missed", () => {
  const days = programmeCalendar({ enrolment: enrolment(), programme: PPL, plans: PLANS, todayKey: TODAY, fromKey: "2026-11-16", toKey: "2026-11-29" });
  const status = programmeStatus({ enrolment: enrolment(), programme: PPL, days, todayKey: TODAY });
  assert.deepEqual(status.week, { training: 3, done: 1, rest: 4 });
  assert.equal(status.cycleLength, 3);
  assert.equal(status.nextTitle, "Pull");
  assert.equal(status.today?.state, "today");
  assert.equal(status.nextTraining?.date, "2026-11-20");
  assert.equal(status.target, null);
  assert.equal(status.complete, false);
});

test("weeks run Monday to Sunday; the card's strip starts a week back but never before the start", () => {
  const days = programmeCalendar({ enrolment: enrolment(), programme: PPL, plans: PLANS, todayKey: TODAY, fromKey: "2026-11-12", toKey: "2026-11-23" });
  const weeks = groupByWeek(days);
  assert.deepEqual(weeks.map((week) => [week.weekStart, week.days.length]), [["2026-11-09", 4], ["2026-11-16", 7], ["2026-11-23", 1]]);
  assert.deepEqual(stripRange(TODAY, "2026-11-01"), { fromKey: "2026-11-12", toKey: "2026-11-25" });
  assert.deepEqual(stripRange(TODAY, "2026-11-16"), { fromKey: "2026-11-16", toKey: "2026-11-25" });
});
