"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, ChevronLeft, ChevronRight, Dumbbell, Moon, Plus, Target, Utensils } from "lucide-react";
import { TodoEditor } from "@/components/tasks/TodoEditor";
import { clockTime } from "@/components/tasks/format";
import { useTodos } from "@/components/tasks/useTodos";
import { WidgetError } from "@/components/widgets/WidgetCard";
import { addDays, keyToLocalDate, mondayOf, weekKeys } from "@/lib/domain/day-keys";
import { draftFromTodo, emptyTodoDraft, groupByDay, todoProgress, type TodoDraft, type TodoItem } from "@/lib/domain/todo";
import { workoutStartHref } from "@/lib/training/start-link";
import styles from "./Week.module.css";

function KindIcon({ kind }: { kind: TodoItem["kind"] }) {
  if (kind === "workout") return <Dumbbell size={12} aria-hidden="true" />;
  if (kind === "meal") return <Utensils size={12} aria-hidden="true" />;
  if (kind === "rest") return <Moon size={12} aria-hidden="true" />;
  if (kind === "goal") return <Target size={12} aria-hidden="true" />;
  return null;
}

const KIND_NAME: Partial<Record<TodoItem["kind"], string>> = { workout: "Workout", meal: "Meal", rest: "Rest day" };

/**
 * The week plan (the former Planner and the Goals page's Week tab), shown in a sheet on Home: a day strip for
 * the week, then the chosen day's To-Dos and scheduled items, to tick, edit, start or add to.
 */
export function WeekPlanner({ today, onChanged }: { today: string; /** Runs after every saved change, so Home's own To-Do list and goals catch up. */ onChanged?: () => void }) {
  const [monday, setMonday] = useState(() => mondayOf(today));
  const [selected, setSelected] = useState(today);
  const days = weekKeys(monday);
  const todos = useTodos({ from: days[0], to: days[6], onChanged });
  const [editor, setEditor] = useState<{ mode: "add" | "edit"; draft: TodoDraft; item?: TodoItem; key: number } | null>(null);
  const groups = groupByDay(todos.items, days);
  const progress = todoProgress(todos.items);
  // The chosen day when it is in the shown week, else today when it is, else Monday.
  const day = days.includes(selected) ? selected : days.includes(today) ? today : days[0];
  const items = groups.get(day) ?? [];
  const date = keyToLocalDate(day);
  const range = `${keyToLocalDate(days[0]).toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${keyToLocalDate(days[6]).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;

  function shift(weeks: number) {
    setMonday((current) => addDays(current, weeks * 7));
  }

  return (
    <section className={styles.week} aria-label="Your week">
      <div className={styles.bar}>
        <button type="button" className={styles.nav} onClick={() => shift(-1)} aria-label="Previous week"><ChevronLeft size={18} aria-hidden="true" /></button>
        <div className={styles.title}>
          <p className={styles.range}>{range}</p>
          <p className={styles.progress}>
            {todos.status === "ready" ? `${progress.done} of ${progress.total} done` : " "}
            {mondayOf(today) !== monday && <> · <button type="button" className={styles.thisWeek} onClick={() => { setMonday(mondayOf(today)); setSelected(today); }}>This week</button></>}
          </p>
        </div>
        <button type="button" className={styles.nav} onClick={() => shift(1)} aria-label="Next week"><ChevronRight size={18} aria-hidden="true" /></button>
      </div>
      {todos.schema === "legacy" && <p className={styles.note}>Untimed To-Dos arrive with the next FITX update.</p>}

      {todos.status === "error" ? (
        <WidgetError message={todos.error} onRetry={() => void todos.reload()} />
      ) : todos.status === "loading" ? (
        <div className={styles.loading} aria-busy="true" aria-label="Loading your week" />
      ) : (
        <>
          <div className={styles.picker} role="group" aria-label="Choose a day">
            {days.map((key) => {
              const value = keyToLocalDate(key);
              const count = (groups.get(key) ?? []).length;
              return (
                <button key={key} type="button" aria-pressed={key === day} className={`${styles.pick} ${key === today ? styles.pickToday : ""}`} onClick={() => setSelected(key)} aria-label={`${value.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}${count ? `, ${count} ${count === 1 ? "item" : "items"}` : ""}`}>
                  <span>{value.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2)}</span>
                  <strong>{value.getDate()}</strong>
                  <i aria-hidden="true" className={count ? styles.pickDot : undefined} />
                </button>
              );
            })}
          </div>

          <section className={styles.day} aria-label={date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}>
            <header className={styles.dayHeader}>
              <strong>{date.toLocaleDateString(undefined, { weekday: "long" })}</strong>
              <span>{date.toLocaleDateString(undefined, { day: "numeric", month: "long" })}</span>
              {day === today && <em>Today</em>}
            </header>
            {items.length ? (
              <ul className={styles.items}>
                {items.map((item) => {
                  const done = item.status === "completed";
                  const time = clockTime(item.startsAt);
                  const kind = KIND_NAME[item.kind];
                  return (
                    <li key={item.id} className={`${styles.item} ${done ? styles.done : ""}`}>
                      <label className={styles.check}>
                        <input type="checkbox" checked={done} onChange={() => void todos.toggle(item.id)} disabled={item.id.startsWith("temp-")} aria-label={`${item.title}: ${done ? "done" : "not done"}`} />
                        <span aria-hidden="true"><Check size={12} strokeWidth={3} /></span>
                      </label>
                      <button type="button" className={styles.itemText} onClick={() => setEditor({ mode: "edit", draft: draftFromTodo(item), item, key: Date.now() })} aria-label={`Edit ${item.title}`}>
                        <span className={styles.itemTitle}>{item.title}</span>
                        {(time || kind) && <span className={styles.itemMeta}><KindIcon kind={item.kind} />{[time, kind].filter(Boolean).join(" · ")}</span>}
                      </button>
                      {item.kind === "workout" && item.workoutPlanId && !done && day === today && (
                        <Link href={workoutStartHref(item.workoutPlanId, item.id)} className={styles.start} aria-label={`Start ${item.title}`}>Start</Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : <p className={styles.empty}>Nothing planned</p>}
            <button type="button" className={styles.add} onClick={() => setEditor({ mode: "add", draft: emptyTodoDraft(day), key: Date.now() })} aria-label={`Add to ${date.toLocaleDateString(undefined, { weekday: "long" })}`}>
              <Plus size={15} aria-hidden="true" />Add
            </button>
          </section>
        </>
      )}

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
    </section>
  );
}

