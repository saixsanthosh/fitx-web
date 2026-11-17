import { test } from "node:test";
import assert from "node:assert/strict";
import {
  draftFromTodo,
  emptyTodoDraft,
  groupByDay,
  moveTodo,
  nextSortOrder,
  parseTodoRow,
  reorderTodos,
  sortTodos,
  startsAtFor,
  timedItemDay,
  timeOf,
  todoProgress,
  validateTodoDraft,
  type TodoItem,
} from "@/lib/domain/todo";

const DAY = "2026-11-18";
const dayOf = (iso: string) => iso.slice(0, 10);

function item(id: string, overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    id, kind: "task", title: id, description: null, localDate: DAY, startsAt: null, endsAt: null, status: "scheduled",
    completedAt: null, sortOrder: 0, goalId: null, workoutPlanId: null, createdAt: `2026-11-18T00:00:0${id.length}Z`, ...overrides,
  };
}

test("rows parse from both database shapes", () => {
  const v2 = parseTodoRow({ id: "a", event_type: "task", title: "Stretch", local_date: DAY, starts_at: null, status: "completed", completed_at: "2026-11-18T05:00:00Z", sort_order: 2, goal_id: "g" }, dayOf);
  assert.deepEqual([v2.kind, v2.localDate, v2.status, v2.sortOrder, v2.goalId], ["task", DAY, "completed", 2, "g"]);
  const legacy = parseTodoRow({ id: "b", event_type: "workout", title: "Push", starts_at: "2026-11-19T12:30:00Z", status: "scheduled", workout_plan_id: "p" }, dayOf);
  assert.deepEqual([legacy.localDate, legacy.sortOrder, legacy.workoutPlanId], ["2026-11-19", 0, "p"], "no local_date column: the day comes from the start time");
  const odd = parseTodoRow({ id: "c", event_type: "party", status: "?", title: "x", local_date: "nope", starts_at: null }, dayOf);
  assert.deepEqual([odd.kind, odd.status, odd.localDate], ["other", "scheduled", ""]);
});

test("items keep the user's order; older rows at 0 fall back to untimed first, then by time", () => {
  const sorted = sortTodos([
    item("late", { startsAt: "2026-11-18T15:00:00Z" }),
    item("early", { startsAt: "2026-11-18T03:00:00Z" }),
    item("untimed"),
    item("first", { sortOrder: -1 }),
    item("last", { sortOrder: 5 }),
  ]);
  assert.deepEqual(sorted.map((entry) => entry.id), ["first", "untimed", "early", "late", "last"]);
});

test("new items go after everything on the day", () => {
  assert.equal(nextSortOrder([]), 0);
  assert.equal(nextSortOrder([item("a", { sortOrder: 0 }), item("b", { sortOrder: 4 })]), 5);
});

test("move up and down renumbers the day and stops at the ends", () => {
  const day = [item("a", { sortOrder: 0 }), item("b", { sortOrder: 1 }), item("c", { sortOrder: 2 })];
  const moved = moveTodo(day, "c", -1);
  assert.deepEqual(moved.map((entry) => [entry.id, entry.sortOrder]), [["a", 0], ["c", 1], ["b", 2]]);
  assert.deepEqual(moveTodo(day, "a", -1).map((entry) => entry.id), ["a", "b", "c"]);
  assert.deepEqual(moveTodo(day, "a", 10).map((entry) => entry.id), ["b", "c", "a"]);
  assert.deepEqual(moveTodo(day, "missing", 1).map((entry) => entry.id), ["a", "b", "c"]);
});

test("a drag's order is applied, and items it left out stay at the end", () => {
  const day = [item("a", { sortOrder: 0 }), item("b", { sortOrder: 1 }), item("c", { sortOrder: 2 })];
  assert.deepEqual(reorderTodos(day, ["c", "a"]).map((entry) => [entry.id, entry.sortOrder]), [["c", 0], ["a", 1], ["b", 2]]);
  assert.deepEqual(reorderTodos(day, ["b", "b", "x"]).map((entry) => entry.id), ["b", "a", "c"]);
});

test("progress leaves out cancelled items", () => {
  assert.deepEqual(todoProgress([item("a", { status: "completed" }), item("b"), item("c", { status: "cancelled" })]), { done: 1, total: 2 });
  assert.deepEqual(todoProgress([]), { done: 0, total: 0 });
});

test("the week groups items under their days, ignoring days outside it", () => {
  const groups = groupByDay([item("a", { localDate: "2026-11-16" }), item("b", { localDate: DAY, sortOrder: 1 }), item("c", { localDate: DAY }), item("z", { localDate: "2026-12-01" })], ["2026-11-16", "2026-11-17", DAY]);
  assert.deepEqual([...groups.keys()], ["2026-11-16", "2026-11-17", DAY]);
  assert.deepEqual(groups.get(DAY)?.map((entry) => entry.id), ["c", "b"]);
  assert.deepEqual(groups.get("2026-11-17"), []);
});

test("a time on a day becomes a start time in the browser's zone, and back", () => {
  const iso = startsAtFor(DAY, "18:00");
  assert.ok(iso);
  assert.equal(timeOf(iso), "18:00");
  const local = new Date(iso!);
  assert.deepEqual([local.getFullYear(), local.getMonth(), local.getDate(), local.getHours()], [2026, 10, 18, 18]);
  assert.equal(startsAtFor(DAY, ""), null);
  assert.equal(startsAtFor(DAY, "7pm"), null);
  assert.equal(startsAtFor("2026-02-30", "10:00"), null);
  assert.equal(timeOf(null), "");
});

test("validation: an untimed To-Do, a timed workout with a plan, and the errors", () => {
  const plain = validateTodoDraft({ ...emptyTodoDraft(DAY), title: "  Buy oats  " });
  assert.deepEqual(plain, { ok: true, value: { event_type: "task", title: "Buy oats", description: null, local_date: DAY, starts_at: null, ends_at: null, goal_id: null, workout_plan_id: null } });
  const workout = validateTodoDraft({ ...emptyTodoDraft(DAY), title: "Push day", kind: "workout", time: "18:00", workoutPlanId: "p1", goalId: "g1" });
  assert.equal(workout.ok, true);
  if (workout.ok) {
    assert.equal(workout.value.workout_plan_id, "p1");
    assert.equal(workout.value.goal_id, "g1");
    assert.equal(new Date(workout.value.ends_at!).getTime() - new Date(workout.value.starts_at!).getTime(), 3_600_000, "a one-hour slot, as the planner always made");
  }
  const taskWithPlan = validateTodoDraft({ ...emptyTodoDraft(DAY), title: "x", kind: "task", workoutPlanId: "p1" });
  assert.equal(taskWithPlan.ok && taskWithPlan.value.workout_plan_id, null, "only workouts link to a plan");
  assert.deepEqual(validateTodoDraft({ ...emptyTodoDraft(DAY), title: " " }), { ok: false, error: "Write what you want to do." });
  assert.deepEqual(validateTodoDraft({ ...emptyTodoDraft("someday"), title: "x" }), { ok: false, error: "Choose a day." });
  assert.deepEqual(validateTodoDraft({ ...emptyTodoDraft(DAY), title: "x".repeat(121) }), { ok: false, error: "Keep it under 120 characters." });
});

test("an edit form round-trips an item", () => {
  const existing = item("a", { kind: "workout", title: "Legs", startsAt: startsAtFor(DAY, "07:30"), workoutPlanId: "p", goalId: "g", description: "Heavy" });
  const draft = draftFromTodo(existing);
  assert.deepEqual([draft.kind, draft.time, draft.workoutPlanId, draft.goalId, draft.description], ["workout", "07:30", "p", "g", "Heavy"]);
  const value = validateTodoDraft(draft);
  assert.equal(value.ok && value.value.starts_at, existing.startsAt);
});

test("a timed item's day is its local_date, else its start's day; an untimed item has none", () => {
  const dayOf = (iso: string) => `browser:${iso.slice(0, 10)}`;
  assert.equal(timedItemDay({ starts_at: "2026-11-17T23:30:00.000Z", local_date: "2026-11-18" }, dayOf), "2026-11-18");
  assert.equal(timedItemDay({ starts_at: "2026-11-17T23:30:00.000Z" }, dayOf), "browser:2026-11-17", "a database without local_date");
  assert.equal(timedItemDay({ starts_at: "2026-11-17T23:30:00.000Z", local_date: "not a day" }, dayOf), "browser:2026-11-17");
  assert.equal(timedItemDay({ starts_at: null, local_date: "2026-11-18" }, dayOf), null, "an untimed To-Do is never a plan's own event");
});
