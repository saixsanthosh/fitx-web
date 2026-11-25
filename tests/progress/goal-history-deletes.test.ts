// Review round, bug 28: Progress history's Delete. Two presses before the first deletion was saved (a double
// click, or two quick Deletes) ran two deletions against the total on screen when the buttons were pressed: one
// entry was taken off twice (and a later, valid deletion refused with the wrong reason), a deleted entry came back
// in the list, and two plus entries could each pass the check and take the server's sum below zero. Deletions now
// go one at a time (goalEntryDeleter), each checked against the total the last one left, and the list is worked
// out from the last change (afterEntryRemoved). Delete goal and Log had the same gap or kept it with a disabled
// button (which drops keyboard focus): all three now say aria-disabled while saving and ignore a second press.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { goalEntryDeleter, type GoalEntry } from "@/lib/data/goals";
import { DataError } from "@/lib/data/missing-schema";
import { afterEntryRemoved, goalWithoutEntry, parseGoalRow, type GoalView } from "@/lib/domain/goals";

const swim = (current: number | null, extra: Partial<GoalView> = {}): GoalView => ({
  id: "g-swim", title: "Swim 20 lengths", category: "fitness", metric: "manual", period: "long_term", direction: "increase",
  targetValue: 20, baselineValue: null, unit: "lengths", startsOn: "2026-11-01", dueOn: null, status: "active", notes: null,
  createdAt: "2026-11-01T00:00:00Z", updatedAt: null, completedAt: null, periodStart: null, periodEnd: null,
  currentValue: current, valueAsOf: null, startValue: null, linkedTodos: 0, linkedTodosDone: 0, missingEntries: null, ...extra,
});
const entry = (id: string, amount: number, loggedAt = "2026-11-20T06:00:00Z"): GoalEntry => ({ id, amount, note: null, loggedAt });
const BELOW_ZERO = "Deleting this would take the total below zero. Delete the minus entries first.";

/** Lets queued promise callbacks run (the deleter's session lookup, then its request). */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * A stand-in for the database: the goal's entries (the server's total is their sum), the requests made, and, with
 * hold(true), requests that wait for release() as on a slow connection.
 */
function server(entries: GoalEntry[]) {
  const rows = new Map(entries.map((item) => [item.id, item.amount]));
  const requests: string[] = [];
  const waiting: Array<() => void> = [];
  let holding = false;
  let failing = false;
  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    let action = "select";
    let payload: Record<string, unknown> | null = null;
    const builder: Record<string, unknown> = new Proxy({}, {
      get(_target, property) {
        if (property === "then") {
          return (resolve: (value: unknown) => unknown) => {
            requests.push(`${action} ${table} ${String(filters.id)}${payload && "current_value" in payload ? ` to ${String(payload.current_value)}` : ""}`);
            const answer = () => {
              if (failing) return resolve({ data: null, error: { message: "Failed to fetch" } });
              if (action === "delete" && table === "goal_progress_entries") rows.delete(String(filters.id));
              resolve({ data: null, error: null });
            };
            if (holding) waiting.push(answer);
            else answer();
          };
        }
        return (...args: unknown[]) => {
          if (property === "delete" || property === "update") action = property;
          if (property === "update") payload = args[0] as Record<string, unknown>;
          if (property === "eq") filters[String(args[0])] = args[1];
          return builder;
        };
      },
    });
    return builder;
  };
  return {
    session: async () => ({ db: { from } as unknown as SupabaseClient, userId: "u1" }),
    requests,
    sum: () => [...rows.values()].reduce((total, amount) => total + amount, 0),
    hold(value: boolean) { holding = value; },
    fail(value: boolean) { failing = value; },
    /** Answers the oldest waiting request, once it has been sent. */
    async release() {
      await settle();
      waiting.shift()?.();
      await settle();
    },
  };
}

const totalOf = (outcome: unknown) => (outcome as { goal?: GoalView }).goal?.currentValue;

test("a double click on Delete deletes the entry once and takes it off the total once", async () => {
  const db = server([entry("a", 5), entry("b", 5)]);
  const deleter = goalEntryDeleter(swim(10), "v2", db.session);
  db.hold(true);
  const first = deleter.remove(entry("a", 5));
  assert.deepEqual(await deleter.remove(entry("a", 5)), { status: "ignored" }, "the second click, while the first is being saved");
  assert.equal(deleter.saving, true);
  await db.release();
  const done = await first;
  assert.equal(done.status, "deleted");
  assert.equal(totalOf(done), 5, "10 - 5, not 10 - 5 - 5");
  assert.equal(deleter.saving, false);
  // Its button can still be pressed before the list redraws: nothing happens.
  assert.deepEqual(await deleter.remove(entry("a", 5)), { status: "ignored" });
  // The other +5 can be deleted (the old sheet, at 0, refused it: "Delete the minus entries first", with none).
  db.hold(false);
  const other = await deleter.remove(entry("b", 5));
  assert.equal(other.status, "deleted");
  assert.equal(totalOf(other), 0);
  assert.deepEqual(db.requests, ["delete goal_progress_entries a", "delete goal_progress_entries b"]);
  assert.equal(db.sum(), 0);
});

test("two quick Deletes of plus entries can't take the total below zero between them", async () => {
  // +5, +5 and -5: a total of 5. Each +5 on its own may go; both may not.
  const db = server([entry("a", 5), entry("b", 5), entry("m", -5)]);
  const deleter = goalEntryDeleter(swim(5), "v2", db.session);
  db.hold(true);
  const first = deleter.remove(entry("a", 5));
  assert.deepEqual(await deleter.remove(entry("b", 5)), { status: "ignored" }, "pressed before the first was saved");
  await db.release();
  assert.equal(totalOf(await first), 0);
  db.hold(false);
  // Pressed again now, it is checked against the 0 the first deletion left, and refused for the true reason.
  assert.deepEqual(await deleter.remove(entry("b", 5)), { status: "refused", message: BELOW_ZERO });
  assert.equal(db.sum(), 0, "the server's sum never went below zero");
  // Minus entry first, then the +5 goes too.
  assert.equal(totalOf(await deleter.remove(entry("m", -5))), 5);
  assert.equal(totalOf(await deleter.remove(entry("b", 5))), 0);
  assert.deepEqual(db.requests, ["delete goal_progress_entries a", "delete goal_progress_entries m", "delete goal_progress_entries b"]);
  assert.equal(db.sum(), 0);
});

test("the list after a deletion comes from the last change, so a deleted entry never comes back; focus moves on", () => {
  const listed = [entry("a", 5), entry("b", 3), entry("c", 2)];
  const first = afterEntryRemoved(listed, "a");
  assert.deepEqual([first.rest.map((item) => item.id), first.focus], [["b", "c"], "b"], "the next entry's Delete button");
  // The second deletion starts from what the first left, not from the list on screen when it was pressed.
  const second = afterEntryRemoved(first.rest, "b");
  assert.deepEqual([second.rest.map((item) => item.id), second.focus], [["c"], "c"]);
  assert.deepEqual(afterEntryRemoved(second.rest, "c"), { rest: [], focus: "empty" }, "the empty message");
  assert.equal(afterEntryRemoved([entry("x", 1), entry("y", 1)], "y").focus, "x", "the last entry: the one before it");
  assert.deepEqual(afterEntryRemoved(first.rest, "a"), { rest: first.rest, focus: null }, "an entry no longer listed changes nothing");
});

test("a deletion that fails changes nothing and can be tried again", async () => {
  const db = server([entry("a", 5)]);
  const deleter = goalEntryDeleter(swim(5), "v2", db.session);
  db.fail(true);
  await assert.rejects(deleter.remove(entry("a", 5)), (error: unknown) => error instanceof DataError && error.message === "That entry could not be deleted.");
  assert.equal(deleter.saving, false);
  db.fail(false);
  assert.equal(totalOf(await deleter.remove(entry("a", 5))), 0, "the total it checks is still 5");
  assert.equal(db.sum(), 0);
});

test("a weekly goal: deleting last week's entry leaves this week's total as it is", async () => {
  const weekly = swim(3, { period: "weekly", periodStart: "2026-11-23", periodEnd: "2026-11-29" });
  const db = server([entry("old", 5, "2026-11-18T06:00:00Z"), entry("now", 3, "2026-11-24T06:00:00Z")]);
  const deleter = goalEntryDeleter(weekly, "v2", db.session);
  assert.equal(totalOf(await deleter.remove(entry("old", 5, "2026-11-18T06:00:00Z"))), 3);
  assert.equal(totalOf(await deleter.remove(entry("now", 3, "2026-11-24T06:00:00Z"))), 0);
});

test("a goal older corrections took below zero (shown as 0) counts on from its real total", async () => {
  // The hunt's "Swim 20 lengths": +5, -30 and -10, so fitx_goal_progress says -35 and the goal shows 0.
  const goal = parseGoalRow({ id: "g-swim", title: "Swim 20 lengths", metric: "manual", period: "long_term", direction: "increase", target_value: 20, unit: "lengths", current_value: -35, starts_on: "2026-11-01", status: "active", created_at: "2026-11-01T00:00:00Z" });
  const db = server([entry("p", 5), entry("m30", -30), entry("m10", -10)]);
  const deleter = goalEntryDeleter(goal, "v2", db.session);
  assert.deepEqual(await deleter.remove(entry("p", 5)), { status: "refused", message: BELOW_ZERO });
  const after30 = await deleter.remove(entry("m30", -30));
  assert.deepEqual([totalOf(after30), (after30 as { goal: GoalView }).goal.negativeTotal], [0, -5], "-35 + 30 is still below zero");
  // Counting from 0 would have said 30 and let the +5 go, taking the server to -10.
  assert.deepEqual(await deleter.remove(entry("p", 5)), { status: "refused", message: BELOW_ZERO });
  const after10 = await deleter.remove(entry("m10", -10));
  assert.deepEqual([totalOf(after10), (after10 as { goal: GoalView }).goal.negativeTotal], [5, undefined]);
  assert.equal(totalOf(await deleter.remove(entry("p", 5))), 0);
  assert.equal(db.sum(), 0);
  assert.equal(goalWithoutEntry(swim(2), entry("p", 5)).currentValue, 0, "a view never shows a total below zero");
});

test("the goal sheets' buttons stay focusable while they save, and a press meanwhile does nothing (D5)", () => {
  const panel = readFileSync("src/components/home/GoalsPanel.tsx", "utf8");
  // A disabled button drops keyboard focus in Chrome; aria-disabled keeps it where it is.
  assert.doesNotMatch(panel, /(?<!aria-)disabled=\{(saving|deletingGoal)\b/);
  assert.match(panel, /onClick=\{\(\) => void remove\(entry\)\}\s*aria-disabled=\{saving \|\| undefined\}/, "Progress history's Delete");
  assert.match(panel, /aria-disabled=\{deletingGoal \|\| undefined\} onClick=\{\(\) => void remove\(removing\)\}/, "Delete goal");
  assert.match(panel, /form="goal-log-form"[^>]*aria-disabled=\{saving \|\| undefined\}/, "Log");
  assert.match(panel, /if \(deleter\.saving\) return;/);
  assert.match(panel, /if \(goalDeletion\.current\) return;/);
  assert.match(panel, /if \(savingNow\.current\) return;/);
});

test("without goals v2 the browser keeps the total: each deletion writes what the last one left", async () => {
  const db = server([entry("a", 5), entry("b", 5)]);
  const deleter = goalEntryDeleter(swim(10), "v1", db.session);
  db.hold(true);
  const first = deleter.remove(entry("a", 5));
  assert.deepEqual(await deleter.remove(entry("b", 5)), { status: "ignored" });
  await db.release();
  await db.release();
  await first;
  db.hold(false);
  await deleter.remove(entry("b", 5));
  assert.deepEqual(db.requests, [
    "delete goal_progress_entries a", "update goals g-swim to 5",
    "delete goal_progress_entries b", "update goals g-swim to 0",
  ], "10 → 5 → 0, not 5 twice");
});
