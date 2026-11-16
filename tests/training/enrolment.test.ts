import { test } from "node:test";
import assert from "node:assert/strict";
import { programmeDayDone, upcomingProgrammeDays, type ProgrammePlan } from "@/lib/training/enrolment";

const TODAY = "2026-11-18";
const day = (id: string, planned_for: string | null, last_done_key: string | null = null): ProgrammePlan => ({ id, title: id, planned_for, programme_day_index: 0, last_done_key });

test("a programme day is done once any session of it is finished, also one done before its date", () => {
  assert.equal(programmeDayDone(day("wed", "2026-11-18", "2026-11-17")), true, "Wednesday's Pull done on Tuesday");
  assert.equal(programmeDayDone(day("wed", "2026-11-18", "2026-11-18")), true);
  assert.equal(programmeDayDone(day("wed", "2026-11-18")), false);
});

test("upcoming days are today's and later ones not yet done; one done early is not upcoming", () => {
  const plans = [day("mon", "2026-11-16"), day("wed", "2026-11-18"), day("fri", "2026-11-20", "2026-11-17"), day("sun", "2026-11-22"), day("undated", null)];
  assert.deepEqual(upcomingProgrammeDays(plans, TODAY).map((plan) => plan.id), ["wed", "sun"]);
  assert.deepEqual(upcomingProgrammeDays([day("fri", "2026-11-20", "2026-11-17")], TODAY), [], "with the last day done early, the next week can be planned");
});
