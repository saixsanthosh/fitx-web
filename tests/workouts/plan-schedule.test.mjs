import test from "node:test";
import assert from "node:assert/strict";
import { plannerScheduleChange } from "../../src/app/(dashboard)/workouts/_lib/plan-schedule.ts";

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
