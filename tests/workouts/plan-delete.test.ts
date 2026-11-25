// Bug 48, Also seen: after a plan was deleted, its "Today 6:00 PM" entry stayed under Your plans > Scheduled, because
// planner_events.workout_plan_id is ON DELETE SET NULL. Deleting a plan now cancels the item FITX scheduled for it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ownProgrammeItems } from "@/lib/training/enrolment";

test("the plan's own item is the timed one on its date; a To-Do the member linked on another day, or untimed, is theirs", () => {
  const plan = { id: "plan-1", planned_for: "2026-11-26" };
  const items = [
    { id: "own", workout_plan_id: "plan-1", starts_at: "2026-11-26T12:30:00.000Z", local_date: "2026-11-26" },
    { id: "todo-other-day", workout_plan_id: "plan-1", starts_at: "2026-11-28T12:30:00.000Z", local_date: "2026-11-28" },
    { id: "todo-untimed", workout_plan_id: "plan-1", starts_at: null, local_date: "2026-11-26" },
  ];
  assert.deepEqual(ownProgrammeItems(items, [plan]), ["own"]);
});

test("deletePlan cancels that item before deleting the plan", () => {
  const page = readFileSync("src/app/(dashboard)/workouts/page.tsx", "utf8");
  const remove = page.slice(page.indexOf("async function deletePlan("), page.indexOf("async function savePlan("));
  assert.match(remove, /ownProgrammeItems\([\s\S]*?\[\{ id: plan\.id, planned_for: plan\.planned_for \}\]\)/);
  assert.ok(remove.indexOf('update({ status: "cancelled" })') < remove.indexOf('from("workout_plans").delete()'), "cancelled first");
});
