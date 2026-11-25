// Bug 30 (workouts-4): with "Hunt Home A" in progress, the Push card's button said "Continue workout" and opened Hunt
// Home A. The card now says which workout is in progress and that it comes first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { todayStart } from "@/app/(dashboard)/workouts/_lib/today-start";

const push = { id: "plan-push", title: "Push · Push, Pull, Legs" };

test("nothing in progress: Start workout", () => {
  assert.deepEqual(todayStart(push, null), { kind: "start", label: "Start workout", note: null });
});

test("this card's own workout in progress: Continue workout", () => {
  assert.deepEqual(todayStart(push, { id: "s1", name: "Push · Push, Pull, Legs", planId: "plan-push" }), { kind: "continue", label: "Continue workout", note: null });
});

test("another workout in progress: Continue current workout, naming it and saying it comes first", () => {
  const start = todayStart(push, { id: "s2", name: "Hunt Home A", planId: "plan-home" });
  assert.equal(start.kind, "other");
  assert.equal(start.label, "Continue current workout");
  assert.equal(start.note, "You have a workout in progress (Hunt Home A). Finish it before you start Push · Push, Pull, Legs.");
  // A session started without a plan (an older start, AI Form Check) is never this card's.
  assert.equal(todayStart(push, { id: "s3", name: "Form check", planId: null }).kind, "other");
});

test("the page tells the card which plan the workout in progress belongs to", () => {
  const page = readFileSync("src/app/(dashboard)/workouts/page.tsx", "utf8");
  assert.match(page, /select\("id,name,started_at,duration_seconds,total_volume,status,plan_id"\)\.eq\("user_id", uid\)\.eq\("status", "in_progress"\)/);
  assert.match(page, /active=\{activeSession \? \{ id: activeSession\.id, name: activeSession\.name, planId: activeSession\.plan_id \?\? null \} : null\}/);
  const card = readFileSync("src/components/workouts/TodayWorkout.tsx", "utf8");
  assert.match(card, /\{starting \? "Starting…" : start\.label\}/);
  assert.match(card, /aria-describedby=\{start\.note \? "today-workout-start-note" : undefined\}/);
});
