"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { deleteTodo, insertTodo, loadTodos, restoreTodo, saveTodoOrder, setTodoDone, updateTodo, type TodoSchema } from "@/lib/data/todo";
import { createRequestGate } from "@/lib/domain/request-gate";
import { moveTodo, nextSortOrder, reorderTodos, sameOrder, sortTodos, type TodoInput, type TodoItem } from "@/lib/domain/todo";
import { dayName } from "./format";
import { getSession, messageFor } from "./session";

export type TodosState = {
  status: "loading" | "ready" | "error";
  items: TodoItem[];
  schema: TodoSchema | null;
  error: string;
};

/**
 * The To-Dos and scheduled items from `from` to `to` (day keys), with optimistic changes: a tick,
 * a move or a delete shows at once and is rolled back with a message if the database refuses it.
 * Deleting offers Undo. `onChanged` runs after every saved change (Home refreshes its numbers).
 */
export function useTodos({ from, to, onChanged }: { from: string; to: string; onChanged?: () => void }) {
  const [state, setState] = useState<TodosState>({ status: "loading", items: [], schema: null, error: "" });
  const itemsRef = useRef<TodoItem[]>([]);
  const changed = useRef(onChanged);
  useEffect(() => { changed.current = onChanged; }, [onChanged]);

  const setItems = useCallback((update: (items: TodoItem[]) => TodoItem[]) => {
    setState((current) => {
      const items = sortTodos(update(current.items));
      itemsRef.current = items;
      return { ...current, items };
    });
  }, []);

  // Moving between weeks quickly can leave an older load running: only the newest one is applied.
  const gate = useRef(createRequestGate());
  const load = useCallback(async () => {
    const ticket = gate.current.begin();
    try {
      const { db, userId } = await getSession();
      const result = await loadTodos(db, userId, from, to);
      if (!gate.current.isCurrent(ticket)) return;
      itemsRef.current = result.items;
      setState({ status: "ready", items: result.items, schema: result.schema, error: "" });
    } catch (error) {
      if (!gate.current.isCurrent(ticket)) return;
      setState((current) => ({ ...current, status: "error", error: messageFor(error, "Your To-Do list could not be loaded.") }));
    }
  }, [from, to]);

  useEffect(() => {
    setState((current) => (current.status === "loading" ? current : { ...current, status: "loading" }));
    void Promise.resolve().then(load);
  }, [load]);

  /** Adds an item at the end of its day. Resolves to false (with a message) when it was not saved. */
  const add = useCallback(async (input: TodoInput): Promise<boolean> => {
    const schema = state.schema ?? "v2";
    const order = nextSortOrder(itemsRef.current.filter((item) => item.localDate === input.local_date));
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const inRange = input.local_date >= from && input.local_date <= to;
    if (inRange) {
      setItems((items) => [...items, {
        id: tempId, kind: input.event_type, title: input.title, description: input.description, localDate: input.local_date,
        startsAt: input.starts_at, endsAt: input.ends_at, status: "scheduled", completedAt: null, sortOrder: order,
        goalId: input.goal_id, workoutPlanId: input.workout_plan_id, createdAt: new Date().toISOString(),
      }]);
    }
    try {
      const { db, userId } = await getSession();
      const saved = await insertTodo(db, userId, input, order, schema);
      setItems((items) => (inRange ? items.map((item) => (item.id === tempId ? saved : item)) : items));
      changed.current?.();
      if (!inRange) toast.success(`Added to ${dayName(input.local_date)}.`);
      return true;
    } catch (error) {
      setItems((items) => items.filter((item) => item.id !== tempId));
      toast.error(messageFor(error, "That item could not be saved."));
      return false;
    }
  }, [from, to, setItems, state.schema]);

  const update = useCallback(async (id: string, input: TodoInput): Promise<boolean> => {
    try {
      const { db, userId } = await getSession();
      const saved = await updateTodo(db, userId, id, input, state.schema ?? "v2");
      setItems((items) => (saved.localDate >= from && saved.localDate <= to
        ? items.map((item) => (item.id === id ? saved : item))
        : items.filter((item) => item.id !== id)));
      changed.current?.();
      return true;
    } catch (error) {
      toast.error(messageFor(error, "That item could not be updated."));
      return false;
    }
  }, [from, to, setItems, state.schema]);

  const toggle = useCallback(async (id: string) => {
    const item = itemsRef.current.find((entry) => entry.id === id);
    if (!item || id.startsWith("temp-")) return;
    const done = item.status !== "completed";
    setItems((items) => items.map((entry) => (entry.id === id ? { ...entry, status: done ? "completed" : "scheduled", completedAt: done ? new Date().toISOString() : null } : entry)));
    try {
      const { db, userId } = await getSession();
      await setTodoDone(db, userId, id, done);
      changed.current?.();
    } catch (error) {
      setItems((items) => items.map((entry) => (entry.id === id ? item : entry)));
      toast.error(messageFor(error, done ? "That item could not be marked done." : "That item could not be reopened."));
    }
  }, [setItems]);

  const remove = useCallback(async (id: string) => {
    const item = itemsRef.current.find((entry) => entry.id === id);
    if (!item || id.startsWith("temp-")) return;
    setItems((items) => items.filter((entry) => entry.id !== id));
    try {
      const { db, userId } = await getSession();
      await deleteTodo(db, userId, id);
      changed.current?.();
      toast(`Deleted “${item.title}”`, {
        duration: 7000,
        action: {
          label: "Undo",
          onClick: () => {
            void (async () => {
              try {
                await restoreTodo(db, userId, item, state.schema ?? "v2");
                if (item.localDate >= from && item.localDate <= to) setItems((items) => [...items.filter((entry) => entry.id !== item.id), item]);
                changed.current?.();
              } catch (error) {
                toast.error(messageFor(error, "That item could not be restored."));
              }
            })();
          },
        },
      });
    } catch (error) {
      setItems((items) => [...items, item]);
      toast.error(messageFor(error, "That item could not be deleted."));
    }
  }, [from, to, setItems, state.schema]);

  const saveDay = useCallback(async (day: string, ordered: TodoItem[], previous: TodoItem[]) => {
    try {
      const { db } = await getSession();
      await saveTodoOrder(db, day, ordered.filter((item) => !item.id.startsWith("temp-")).map((item) => item.id));
    } catch (error) {
      setItems((items) => [...items.filter((item) => item.localDate !== day), ...previous]);
      toast.error(messageFor(error, "The new order could not be saved."));
    }
  }, [setItems]);

  /** Moves an item up (negative) or down (positive) within its day and saves the order. */
  const move = useCallback(async (id: string, delta: number) => {
    const item = itemsRef.current.find((entry) => entry.id === id);
    if (!item) return;
    const previous = itemsRef.current.filter((entry) => entry.localDate === item.localDate);
    const ordered = moveTodo(previous, id, delta);
    if (sameOrder(sortTodos(previous), ordered)) return;
    setItems((items) => [...items.filter((entry) => entry.localDate !== item.localDate), ...ordered]);
    await saveDay(item.localDate, ordered, previous);
  }, [saveDay, setItems]);

  /** Applies a dragged order for one day and saves it. */
  const reorder = useCallback(async (day: string, ids: string[]) => {
    const previous = itemsRef.current.filter((entry) => entry.localDate === day);
    const ordered = reorderTodos(previous, ids);
    if (sameOrder(sortTodos(previous), ordered)) return;
    setItems((items) => [...items.filter((entry) => entry.localDate !== day), ...ordered]);
    await saveDay(day, ordered, previous);
  }, [saveDay, setItems]);

  return { ...state, reload: load, add, update, toggle, remove, move, reorder };
}
