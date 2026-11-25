// Bug 28: a correction (a minus amount) can take a goal's total down to zero, never below ("You can take off at
// most 5 lengths."), and no total is ever shown below zero, even one that older corrections took there.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addGoalEntry, deleteGoalEntry } from "@/lib/data/goals";
import { DataError } from "@/lib/data/missing-schema";
import {
  checkProgressAmount, correctionProblem, entryCounts, entryRemovalProblem, evaluateView, parseGoalRow, progressSummary, remainingLabel, type GoalView,
} from "@/lib/domain/goals";

const swim = (current: number | null, extra: Partial<GoalView> = {}): GoalView => ({
  id: "g-swim", title: "Swim 20 lengths", category: "fitness", metric: "manual", period: "long_term", direction: "increase",
  targetValue: 20, baselineValue: null, unit: "lengths", startsOn: "2026-11-01", dueOn: null, status: "active", notes: null,
  createdAt: "2026-11-01T00:00:00Z", updatedAt: null, completedAt: null, periodStart: null, periodEnd: null,
  currentValue: current, valueAsOf: null, startValue: null, linkedTodos: 0, linkedTodosDone: 0, missingEntries: null, ...extra,
});

test("logging -30 or −10 (typographic minus) on 5 of 20 lengths is refused, with how much can come off", () => {
  const goal = swim(5);
  assert.deepEqual(checkProgressAmount("-30", goal, "v2"), { ok: false, error: "You can take off at most 5 lengths." });
  assert.deepEqual(checkProgressAmount("−10", goal, "v2"), { ok: false, error: "You can take off at most 5 lengths." });
  assert.deepEqual(checkProgressAmount("-5", goal, "v2"), { ok: true, amount: -5 }, "down to zero is fine");
  assert.deepEqual(checkProgressAmount("-1.5", swim(1.5), "v2"), { ok: true, amount: -1.5 });
  assert.deepEqual(checkProgressAmount("12", goal, "v2"), { ok: true, amount: 12 });
});

test("with nothing logged there is nothing to take off; v1 and non-numbers keep their own messages", () => {
  assert.deepEqual(checkProgressAmount("-1", swim(0), "v2"), { ok: false, error: "There’s nothing logged to take off yet." });
  assert.deepEqual(checkProgressAmount("-1", swim(null), "v2"), { ok: false, error: "There’s nothing logged to take off yet." });
  assert.deepEqual(checkProgressAmount("-1", swim(5), "v1"), { ok: false, error: "To take progress off, delete the entry in Progress history." });
  assert.deepEqual(checkProgressAmount("two", swim(5), "v2"), { ok: false, error: "Enter a number, for example 2 or 1.5." });
  assert.deepEqual(checkProgressAmount("0", swim(5), "v2"), { ok: false, error: "Enter a number, for example 2 or 1.5." });
  assert.equal(correctionProblem(swim(5), 3), null, "adding is never a correction problem");
  assert.equal(correctionProblem({ currentValue: 1250, metric: "water_ml", unit: "ml" }, -2000), "You can take off at most 1.25 L.", "in the goal's own unit");
});

test("a total that older corrections took below zero reads 0 of 20, never -35 of 20 with 55 to go, and says why", () => {
  const goal = parseGoalRow({ id: "g", title: "Swim 20 lengths", metric: "manual", period: "long_term", direction: "increase", target_value: 20, unit: "lengths", current_value: -35, starts_on: "2026-11-01", status: "active", created_at: "2026-11-01T00:00:00Z" });
  assert.equal(goal.currentValue, 0);
  assert.equal(goal.belowZero, true);
  assert.equal(progressSummary(goal), "0 of 20 lengths");
  assert.equal(remainingLabel(goal, evaluateView(goal)), "20 lengths to go");
  const fine = parseGoalRow({ id: "h", title: "Read", metric: "manual", period: "long_term", target_value: 12, unit: "books", current_value: 3 });
  assert.deepEqual([fine.currentValue, fine.belowZero], [3, undefined]);
  assert.equal(parseGoalRow({ id: "w", title: "Weight", metric: "body_weight_kg", period: "long_term", target_value: 72, current_value: null }).currentValue, null, "unknown stays unknown");
});

test("deleting an entry that the total still needs is refused; corrections and other weeks' entries are not", () => {
  const plus = { amount: 5, loggedAt: "2026-11-20T06:00:00Z" };
  assert.equal(entryRemovalProblem(swim(2), plus), "Deleting this would take the total below zero. Delete the minus entries first.");
  assert.equal(entryRemovalProblem(swim(5), plus), null);
  assert.equal(entryRemovalProblem(swim(2), { amount: -3, loggedAt: plus.loggedAt }), null, "a minus entry only adds back");
  // A weekly goal counts only this week's entries: last week's entry is not in the total.
  const weekly = swim(1, { period: "weekly", periodStart: "2026-11-23", periodEnd: "2026-11-29" });
  assert.equal(entryCounts(weekly, "2026-11-18T06:00:00Z"), false);
  assert.equal(entryRemovalProblem(weekly, { amount: 5, loggedAt: "2026-11-18T06:00:00Z" }), null);
  assert.equal(entryCounts(weekly, "2026-11-24T06:00:00Z"), true);
  assert.notEqual(entryRemovalProblem(weekly, { amount: 5, loggedAt: "2026-11-24T06:00:00Z" }), null);
});

/** Records every table the data layer touches; every request succeeds. */
function recordingDb() {
  const touched: string[] = [];
  const from = (name: string) => {
    touched.push(name);
    const builder: Record<string, unknown> = new Proxy({}, {
      get(_target, property) {
        if (property === "then") return (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve);
        return () => builder;
      },
    });
    return builder;
  };
  return { db: { from } as unknown as SupabaseClient, touched };
}

test("the data layer refuses the same corrections, before anything is written", async () => {
  const { db, touched } = recordingDb();
  await assert.rejects(addGoalEntry(db, "u1", swim(5), -30, null, "v2"), (error: unknown) => error instanceof DataError && error.message === "You can take off at most 5 lengths.");
  await assert.rejects(deleteGoalEntry(db, "u1", swim(2), { id: "e1", amount: 5, note: null, loggedAt: "2026-11-20T06:00:00Z" }, "v2"), DataError);
  assert.deepEqual(touched, []);
  await addGoalEntry(db, "u1", swim(5), -5, null, "v2");
  assert.deepEqual(touched, ["goal_progress_entries"]);
  // v1 keeps its own total in the browser (it stops at zero), so deleting stays possible there.
  await deleteGoalEntry(db, "u1", swim(2), { id: "e1", amount: 5, note: null, loggedAt: "2026-11-20T06:00:00Z" }, "v1");
  assert.deepEqual(touched, ["goal_progress_entries", "goal_progress_entries", "goals"]);
});
