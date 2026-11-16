import test from "node:test";
import assert from "node:assert/strict";
import { plannerEventsForPlan, plannerEventToComplete, plannerScheduleChange } from "../../src/app/(dashboard)/workouts/_lib/plan-schedule.ts";

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

// To-Do workouts can link to a plan on any day, timed or not. Saving the plan moves only its own event.
test("moving a plan moves its own event and leaves linked To-Do workouts on their days", () => {
  const events = [
    { id: "own", status: "scheduled", dateKey: today },
    { id: "todo-thursday", status: "scheduled", dateKey: "2026-11-19" },
    { id: "todo-untimed", status: "scheduled", dateKey: null },
    { id: "done", status: "completed", dateKey: "2026-11-09" },
  ];
  const planEvents = plannerEventsForPlan(events, today);
  assert.deepEqual(planEvents.map((event) => event.id), ["own", "done"]);
  assert.equal(plannerScheduleChange(planEvents, nextWeek), "update-scheduled");
  assert.equal(plannerScheduleChange(planEvents, ""), "cancel-scheduled", "clearing the date cancels only the plan's own event");
});

test("a plan whose only scheduled links are To-Dos gets its own event, and clearing its date leaves them", () => {
  const todos = [{ id: "todo", status: "scheduled", dateKey: "2026-11-19" }, { id: "untimed", status: "scheduled", dateKey: null }];
  assert.deepEqual(plannerEventsForPlan(todos, null), []);
  assert.equal(plannerScheduleChange(plannerEventsForPlan(todos, null), today), "insert");
  assert.equal(plannerScheduleChange(plannerEventsForPlan(todos, today), today), "insert", "an untimed To-Do on the plan's day is not its event");
  assert.equal(plannerScheduleChange(plannerEventsForPlan(todos, null), ""), "none");
});

test("a linked To-Do already done that day still stops the day being scheduled again", () => {
  assert.equal(plannerScheduleChange(plannerEventsForPlan([{ id: "todo", status: "completed", dateKey: today }], null), today), "none");
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
