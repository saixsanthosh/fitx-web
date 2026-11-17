/**
 * To-Dos and scheduled items, one model for both. Every item sits on a calendar day (local_date);
 * a start time is optional. Items keep the order the user gives them (sort_order).
 *
 * No runtime imports beyond other pure domain files, so `node --test` can load it directly.
 */
import { isDateKey } from "./day-keys";

export type TodoKind = "task" | "workout" | "meal" | "rest" | "goal" | "other";
export type TodoStatus = "scheduled" | "completed" | "cancelled";

export const TODO_KINDS: ReadonlyArray<{ value: TodoKind; label: string }> = [
  { value: "task", label: "To-Do" },
  { value: "workout", label: "Workout" },
  { value: "meal", label: "Meal" },
  { value: "rest", label: "Rest day" },
  { value: "other", label: "Other" },
];

export type TodoItem = {
  id: string;
  kind: TodoKind;
  title: string;
  description: string | null;
  localDate: string;
  startsAt: string | null;
  endsAt: string | null;
  status: TodoStatus;
  completedAt: string | null;
  sortOrder: number;
  goalId: string | null;
  workoutPlanId: string | null;
  createdAt: string;
};

const KINDS: readonly TodoKind[] = ["task", "workout", "meal", "rest", "goal", "other"];
const STATUSES: readonly TodoStatus[] = ["scheduled", "completed", "cancelled"];
const str = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/**
 * A planner_events row. `dayOf` turns a start time into the browser's calendar day for rows read
 * from a database that does not have local_date yet.
 */
export function parseTodoRow(raw: Record<string, unknown>, dayOf: (iso: string) => string): TodoItem {
  const startsAt = str(raw.starts_at);
  const localDate = isDateKey(raw.local_date) ? raw.local_date : startsAt ? dayOf(startsAt) : "";
  const sort = Number(raw.sort_order);
  return {
    id: String(raw.id),
    kind: KINDS.includes(raw.event_type as TodoKind) ? (raw.event_type as TodoKind) : "other",
    title: String(raw.title ?? ""),
    description: str(raw.description),
    localDate,
    startsAt,
    endsAt: str(raw.ends_at),
    status: STATUSES.includes(raw.status as TodoStatus) ? (raw.status as TodoStatus) : "scheduled",
    completedAt: str(raw.completed_at),
    sortOrder: Number.isFinite(sort) ? sort : 0,
    goalId: str(raw.goal_id),
    workoutPlanId: str(raw.workout_plan_id),
    createdAt: str(raw.created_at) ?? "",
  };
}

/**
 * The calendar day of a timed planner item, or null for an untimed one: its local_date (the day it was
 * scheduled on, which stays put when the phone changes time zone), else, on a database without that
 * column, the day its start falls on in this browser (`dayOf`).
 */
export function timedItemDay(item: { starts_at: string | null; local_date?: unknown }, dayOf: (iso: string) => string): string | null {
  if (!item.starts_at) return null;
  return isDateKey(item.local_date) ? item.local_date : dayOf(item.starts_at);
}

/** The user's order; ties (older rows all at 0) fall back to start time, untimed first, then creation. */
export function sortTodos<T extends Pick<TodoItem, "sortOrder" | "startsAt" | "createdAt" | "id">>(items: readonly T[]): T[] {
  return [...items].sort((a, b) =>
    a.sortOrder - b.sortOrder
    || (a.startsAt === b.startsAt ? 0 : a.startsAt === null ? -1 : b.startsAt === null ? 1 : a.startsAt.localeCompare(b.startsAt))
    || a.createdAt.localeCompare(b.createdAt)
    || a.id.localeCompare(b.id));
}

/** Where a new item goes: after everything already on the day. */
export function nextSortOrder(items: readonly Pick<TodoItem, "sortOrder">[]): number {
  return items.reduce((max, item) => Math.max(max, item.sortOrder + 1), 0);
}

function renumber(items: TodoItem[]): TodoItem[] {
  return items.map((item, index) => (item.sortOrder === index ? item : { ...item, sortOrder: index }));
}

/** Moves one item up (negative) or down (positive) and renumbers the day 0…n-1. */
export function moveTodo(items: readonly TodoItem[], id: string, delta: number): TodoItem[] {
  const ordered = sortTodos(items);
  const from = ordered.findIndex((item) => item.id === id);
  if (from < 0) return ordered;
  const to = Math.max(0, Math.min(ordered.length - 1, from + Math.trunc(delta)));
  if (to === from) return ordered;
  const [item] = ordered.splice(from, 1);
  ordered.splice(to, 0, item);
  return renumber(ordered);
}

/** Puts the items in the given id order (a drag); ids not listed keep their place at the end. */
export function reorderTodos(items: readonly TodoItem[], ids: readonly string[]): TodoItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered: TodoItem[] = [];
  for (const id of ids) {
    const item = byId.get(id);
    if (item && !ordered.includes(item)) ordered.push(item);
  }
  for (const item of sortTodos(items)) if (!ordered.includes(item)) ordered.push(item);
  return renumber(ordered);
}

export function sameOrder(a: readonly TodoItem[], b: readonly TodoItem[]): boolean {
  return a.length === b.length && a.every((item, index) => item.id === b[index].id);
}

/** Done and total, leaving out cancelled items. */
export function todoProgress(items: readonly Pick<TodoItem, "status">[]): { done: number; total: number } {
  const open = items.filter((item) => item.status !== "cancelled");
  return { done: open.filter((item) => item.status === "completed").length, total: open.length };
}

/** Items grouped under each of the given days, each day in the user's order. */
export function groupByDay(items: readonly TodoItem[], days: readonly string[]): Map<string, TodoItem[]> {
  const groups = new Map(days.map((day) => [day, [] as TodoItem[]]));
  for (const item of items) groups.get(item.localDate)?.push(item);
  for (const [day, list] of groups) groups.set(day, sortTodos(list));
  return groups;
}

/** An ISO start time from a day and a "HH:MM" time in the browser's zone, or null for an untimed item. */
export function startsAtFor(localDate: string, time: string | null | undefined): string | null {
  if (!time || !/^\d{2}:\d{2}$/.test(time) || !isDateKey(localDate)) return null;
  const [year, month, day] = localDate.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  const date = new Date(year, month - 1, day, hours, minutes);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** "HH:MM" in the browser's zone for a start time, for the edit form. */
export function timeOf(startsAt: string | null): string {
  if (!startsAt) return "";
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export type TodoDraft = {
  title: string;
  kind: TodoKind;
  localDate: string;
  /** "HH:MM" or "" for no time. */
  time: string;
  description: string;
  goalId: string;
  workoutPlanId: string;
};

export type TodoInput = {
  event_type: TodoKind;
  title: string;
  description: string | null;
  local_date: string;
  starts_at: string | null;
  ends_at: string | null;
  goal_id: string | null;
  workout_plan_id: string | null;
};

export function emptyTodoDraft(localDate: string): TodoDraft {
  return { title: "", kind: "task", localDate, time: "", description: "", goalId: "", workoutPlanId: "" };
}

export function draftFromTodo(item: TodoItem): TodoDraft {
  return {
    title: item.title,
    kind: item.kind,
    localDate: item.localDate,
    time: timeOf(item.startsAt),
    description: item.description ?? "",
    goalId: item.goalId ?? "",
    workoutPlanId: item.workoutPlanId ?? "",
  };
}

/** The row to write, or what to fix. A timed item gets a one-hour slot, as the planner always did. */
export function validateTodoDraft(draft: TodoDraft): { ok: true; value: TodoInput } | { ok: false; error: string } {
  const title = draft.title.trim();
  if (!title) return { ok: false, error: "Write what you want to do." };
  if (title.length > 120) return { ok: false, error: "Keep it under 120 characters." };
  if (!isDateKey(draft.localDate)) return { ok: false, error: "Choose a day." };
  if (draft.time && !/^\d{2}:\d{2}$/.test(draft.time)) return { ok: false, error: "Enter a valid time, or leave it empty." };
  const description = draft.description.trim();
  if (description.length > 1000) return { ok: false, error: "Keep notes under 1,000 characters." };
  const startsAt = startsAtFor(draft.localDate, draft.time);
  return {
    ok: true,
    value: {
      event_type: draft.kind,
      title,
      description: description || null,
      local_date: draft.localDate,
      starts_at: startsAt,
      ends_at: startsAt ? new Date(new Date(startsAt).getTime() + 3_600_000).toISOString() : null,
      goal_id: draft.goalId || null,
      workout_plan_id: draft.kind === "workout" && draft.workoutPlanId ? draft.workoutPlanId : null,
    },
  };
}
