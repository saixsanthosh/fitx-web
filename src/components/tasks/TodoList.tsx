"use client";

import Link from "next/link";
import { useState, type FormEvent, type KeyboardEvent, type PointerEvent } from "react";
import { Reorder, useDragControls, useReducedMotion } from "framer-motion";
import { ArrowDown, ArrowUp, Check, Dumbbell, GripVertical, Moon, Pencil, Plus, Target, Trash2, Utensils } from "lucide-react";
import { emptyTodoDraft, draftFromTodo, sortTodos, todoProgress, type TodoDraft, type TodoItem } from "@/lib/domain/todo";
import type { TodoSchema } from "@/lib/data/todo";
import { TodoEditor } from "./TodoEditor";
import { RowMenu } from "./RowMenu";
import { clockTime, longDay } from "./format";
import { useTodos } from "./useTodos";
import styles from "./Todo.module.css";

const KIND_LABEL: Record<TodoItem["kind"], string> = { task: "To-Do", workout: "Workout", meal: "Meal", rest: "Rest day", goal: "Goal", other: "Other" };

function KindIcon({ kind }: { kind: TodoItem["kind"] }) {
  if (kind === "workout") return <Dumbbell size={13} aria-hidden="true" />;
  if (kind === "meal") return <Utensils size={13} aria-hidden="true" />;
  if (kind === "rest") return <Moon size={13} aria-hidden="true" />;
  if (kind === "goal") return <Target size={13} aria-hidden="true" />;
  return null;
}

/**
 * One day's To-Do list, shared by the Home widget and the Goals "Today" tab: add, tick, edit,
 * delete with Undo, and reorder by dragging the handle or with Move up / Move down (keyboard:
 * arrow keys on the handle).
 */
export function TodoList({ date, variant = "page", limit, onChanged, goalTitles }: {
  date: string;
  variant?: "page" | "widget";
  /** Widget: how many items to show before "Show all". */
  limit?: number;
  onChanged?: () => void;
  /** Goal names by id, to label linked items. */
  goalTitles?: Record<string, string>;
}) {
  const todos = useTodos({ from: date, to: date, onChanged });
  const [quick, setQuick] = useState("");
  const [editor, setEditor] = useState<{ mode: "add" | "edit"; draft: TodoDraft; item?: TodoItem; key: number } | null>(null);
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const reduceMotion = useReducedMotion();

  const items = sortTodos(todos.items);
  const progress = todoProgress(items);
  const shown = limit && variant === "widget" ? items.slice(0, limit) : items;
  const hiddenCount = items.length - shown.length;
  const canReorder = todos.schema === "v2" && hiddenCount === 0;
  const legacy = todos.schema === "legacy";
  const order = dragOrder ?? shown.map((item) => item.id);
  const byId = new Map(items.map((item) => [item.id, item]));

  async function quickAdd(event: FormEvent) {
    event.preventDefault();
    const title = quick.trim();
    if (!title) return;
    if (legacy) {
      setEditor({ mode: "add", draft: { ...emptyTodoDraft(date), title, kind: "other" }, key: Date.now() });
      return;
    }
    setQuick("");
    const saved = await todos.add({ event_type: "task", title: title.slice(0, 120), description: null, local_date: date, starts_at: null, ends_at: null, goal_id: null, workout_plan_id: null });
    if (saved) setAnnouncement(`Added ${title}`);
    else setQuick(title);
  }

  async function moveBy(item: TodoItem, delta: number) {
    const index = items.findIndex((entry) => entry.id === item.id);
    await todos.move(item.id, delta);
    setAnnouncement(`${item.title}, position ${Math.max(1, Math.min(items.length, index + 1 + delta))} of ${items.length}`);
  }

  if (todos.status === "loading") {
    return <div className={styles.skeleton} aria-busy="true" aria-label="Loading your To-Do list"><span /><span /><span /></div>;
  }
  if (todos.status === "error") {
    return (
      <div className={styles.problem} role="alert">
        <p>{todos.error}</p>
        <button type="button" className="fitx-button fitx-button-secondary" onClick={() => void todos.reload()}>Try again</button>
      </div>
    );
  }

  return (
    <div className={`${styles.list} ${variant === "widget" ? styles.compact : ""}`}>
      <div className={styles.summary}>
        <p><strong>{progress.done}</strong> of {progress.total} done</p>
        <div className="fitx-progress-track h-1.5 flex-1" role="progressbar" aria-label="To-Dos done" aria-valuemin={0} aria-valuemax={Math.max(progress.total, 1)} aria-valuenow={progress.done}>
          <div className="fitx-progress-fill" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
        </div>
      </div>

      <form className={styles.quickAdd} onSubmit={(event) => void quickAdd(event)}>
        <label className="sr-only" htmlFor={`quick-${variant}-${date}`}>Add a To-Do for {longDay(date)}</label>
        <input id={`quick-${variant}-${date}`} className="fitx-field" value={quick} maxLength={120} onChange={(event) => setQuick(event.target.value)} placeholder={legacy ? "Schedule something…" : "Add a To-Do…"} enterKeyHint="done" autoComplete="off" />
        <button type="submit" className={styles.addButton} aria-label="Add" disabled={!quick.trim()}><Plus size={18} aria-hidden="true" /></button>
        <button type="button" className={styles.moreButton} onClick={() => setEditor({ mode: "add", draft: { ...emptyTodoDraft(date), title: quick.trim() }, key: Date.now() })}>More options</button>
      </form>
      {legacy && <p className={styles.note}>Untimed To-Dos and reordering arrive with the next FITX update. Timed items work now.</p>}

      {items.length === 0 ? (
        <p className={styles.empty}>Nothing on your list yet. Add a task, a workout or something personal.</p>
      ) : (
        <Reorder.Group
          as="ul"
          axis="y"
          values={order}
          onReorder={(next: string[]) => setDragOrder(next)}
          className={styles.rows}
          aria-label={`To-Do for ${longDay(date)}`}
        >
          {order.map((id, index) => {
            const item = byId.get(id);
            if (!item) return null;
            return (
              <TodoRow
                key={id}
                item={item}
                index={index}
                count={order.length}
                canReorder={canReorder}
                reduceMotion={Boolean(reduceMotion)}
                goalTitle={item.goalId ? goalTitles?.[item.goalId] : undefined}
                schema={todos.schema}
                onToggle={() => {
                  void todos.toggle(item.id);
                  setAnnouncement(item.status === "completed" ? `${item.title} reopened` : `${item.title} done`);
                }}
                onEdit={() => setEditor({ mode: "edit", draft: draftFromTodo(item), item, key: Date.now() })}
                onDelete={() => void todos.remove(item.id)}
                onMove={(delta) => void moveBy(item, delta)}
                onDragEnd={() => {
                  const next = dragOrder;
                  setDragOrder(null);
                  if (next) {
                    void todos.reorder(date, next);
                    setAnnouncement(`${item.title}, position ${next.indexOf(item.id) + 1} of ${next.length}`);
                  }
                }}
              />
            );
          })}
        </Reorder.Group>
      )}
      {hiddenCount > 0 && <Link href="/goals?tab=today" className={styles.showAll}>Show all {items.length}</Link>}
      <p className="sr-only" aria-live="polite">{announcement}</p>

      {editor && (
        <TodoEditor
          key={editor.key}
          open
          mode={editor.mode}
          initial={editor.draft}
          schema={todos.schema}
          onClose={() => setEditor(null)}
          onSubmit={(input) => (editor.mode === "edit" && editor.item ? todos.update(editor.item.id, input) : todos.add(input))}
          onDelete={editor.item ? () => { const id = editor.item!.id; setEditor(null); void todos.remove(id); } : undefined}
        />
      )}
    </div>
  );
}

function TodoRow({ item, index, count, canReorder, reduceMotion, goalTitle, schema, onToggle, onEdit, onDelete, onMove, onDragEnd }: {
  item: TodoItem;
  index: number;
  count: number;
  canReorder: boolean;
  reduceMotion: boolean;
  goalTitle?: string;
  schema: TodoSchema | null;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (delta: number) => void;
  onDragEnd: () => void;
}) {
  const controls = useDragControls();
  const done = item.status === "completed";
  const saving = item.id.startsWith("temp-");
  const time = clockTime(item.startsAt);
  const meta = [time, item.kind !== "task" ? KIND_LABEL[item.kind] : null, goalTitle ? `For ${goalTitle}` : null].filter(Boolean).join(" · ");

  function onHandleKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      onMove(event.key === "ArrowUp" ? -1 : 1);
    }
  }

  return (
    <Reorder.Item
      as="li"
      value={item.id}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onDragEnd}
      layout="position"
      transition={reduceMotion ? { duration: 0 } : undefined}
      className={`${styles.row} ${done ? styles.done : ""}`}
      aria-busy={saving || undefined}
    >
      {canReorder && (
        <button
          type="button"
          className={styles.handle}
          aria-label={`Reorder ${item.title}. Use the up and down arrow keys.`}
          onPointerDown={(event: PointerEvent<HTMLButtonElement>) => controls.start(event)}
          onKeyDown={onHandleKey}
        >
          <GripVertical size={16} aria-hidden="true" />
        </button>
      )}
      <label className={styles.check}>
        <input type="checkbox" checked={done} disabled={saving} onChange={onToggle} aria-label={`${item.title}: ${done ? "done" : "not done"}`} />
        <span aria-hidden="true"><Check size={14} strokeWidth={3} /></span>
      </label>
      <button type="button" className={styles.text} onClick={onEdit} disabled={saving} aria-label={`Edit ${item.title}`}>
        <span className={styles.title}>{item.title}</span>
        {meta && <span className={styles.meta}><KindIcon kind={item.kind} />{meta}</span>}
      </button>
      {item.kind === "workout" && item.workoutPlanId && !done && (
        <Link href={`/workouts?plan=${item.workoutPlanId}`} className={styles.start} aria-label={`Start ${item.title}`}>Start</Link>
      )}
      {!saving && (
        <RowMenu
          label={`Actions for ${item.title}`}
          actions={[
            { label: "Edit", icon: <Pencil size={15} aria-hidden="true" />, onSelect: onEdit },
            ...(schema === "v2" ? [
              { label: "Move up", icon: <ArrowUp size={15} aria-hidden="true" />, onSelect: () => onMove(-1), disabled: index === 0 || !canReorder },
              { label: "Move down", icon: <ArrowDown size={15} aria-hidden="true" />, onSelect: () => onMove(1), disabled: index === count - 1 || !canReorder },
            ] : []),
            { label: "Delete", icon: <Trash2 size={15} aria-hidden="true" />, onSelect: onDelete, danger: true },
          ]}
        />
      )}
    </Reorder.Item>
  );
}
