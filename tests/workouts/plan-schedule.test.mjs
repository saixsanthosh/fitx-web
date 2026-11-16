import test from "node:test";
import assert from "node:assert/strict";
import { plannerEventToComplete, plannerScheduleChange } from "../../src/app/(dashboard)/workouts/_lib/plan-schedule.ts";

const today = "2026-11-16";
const nextWeek = "2026-11-23";

test("a plan with no linked events schedules its date", () => {
  assert.equal(plannerScheduleChange([], today), "insert");
});

test("a plan without a date and without events changes nothing", () => {
  assert.equal(plannerScheduleChange([], ""), "none");
});

test("rescheduling moves the plan's upcoming event", () => {
  assert.equal(plannerScheduleChange([{ status: "scheduled", dateKey: today }], nextWeek), "update-scheduled");
});

test("clearing the date cancels only the upcoming event", () => {
  assert.equal(plannerScheduleChange([{ status: "scheduled", dateKey: today }, { status: "completed", dateKey: "2026-11-09" }], ""), "cancel-scheduled");
  assert.equal(plannerScheduleChange([{ status: "completed", dateKey: "2026-11-09" }], ""), "none", "history is not cancelled");
});

test("a plan finished today and saved again for today is not scheduled twice", () => {
  assert.equal(plannerScheduleChange([{ status: "completed", dateKey: today }], today), "none");
});

test("a reused plan scheduled for a new day gets a new event and keeps its history", () => {
  assert.equal(plannerScheduleChange([{ status: "completed", dateKey: today }], nextWeek), "insert");
  assert.equal(plannerScheduleChange([{ status: "completed", dateKey: "2026-11-02" }, { status: "completed", dateKey: "2026-11-09" }], today), "insert");
});

test("an overdue scheduled event is moved rather than duplicated", () => {
  assert.equal(plannerScheduleChange([{ status: "scheduled", dateKey: "2026-11-12" }, { status: "completed", dateKey: "2026-11-09" }], nextWeek), "update-scheduled");
});

test("a day that is already done is left alone even if an older event is still scheduled", () => {
  assert.equal(plannerScheduleChange([{ status: "scheduled", dateKey: "2026-11-12" }, { status: "completed", dateKey: today }], today), "none");
});

// plannerEventToComplete works on epoch milliseconds; the session's local day is passed in.
const hour = 3600000;
const dayStart = Date.UTC(2026, 10, 16);
const day = { start: dayStart, end: dayStart + 24 * hour };
const at = (hoursFromDayStart) => dayStart + hoursFromDayStart * hour;
const event = (id, hoursFromDayStart, status = "scheduled") => ({ id, status, startsAt: at(hoursFromDayStart) });

test("finishing completes the plan's event on the session day before any overdue one", () => {
  assert.equal(plannerEventToComplete([event("yesterday", -6), event("today", 18)], day, at(17.5)), "today");
});

test("with several events that day, the one nearest the session start is completed", () => {
  const events = [event("morning", 7), event("evening", 18)];
  assert.equal(plannerEventToComplete(events, day, at(17.75)), "evening");
  assert.equal(plannerEventToComplete(events, day, at(7.25)), "morning");
});

test("a workout done a day late completes the most recent overdue event", () => {
  assert.equal(plannerEventToComplete([event("last-week", -6 * 24), event("yesterday", -6)], day, at(9)), "yesterday");
});

test("an event on a later day is never completed, even when it is the only one", () => {
  assert.equal(plannerEventToComplete([event("tomorrow", 24 + 18)], day, at(9)), null);
  assert.equal(plannerEventToComplete([event("tomorrow", 24 + 18), event("yesterday", -6)], day, at(9)), "yesterday");
  assert.equal(plannerEventToComplete([event("midnight", 24)], day, at(23)), null, "the next midnight belongs to the next day");
  assert.equal(plannerEventToComplete([event("first-minute", 0)], day, at(23)), "first-minute");
});

test("only scheduled events with a valid time are considered", () => {
  assert.equal(plannerEventToComplete([event("done", 18, "completed"), event("dropped", -6, "cancelled")], day, at(18)), null);
  assert.equal(plannerEventToComplete([{ id: "broken", status: "scheduled", startsAt: Number.NaN }], day, at(18)), null);
  assert.equal(plannerEventToComplete([], day, at(18)), null);
});
