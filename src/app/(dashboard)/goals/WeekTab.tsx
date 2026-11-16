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
import styles from "./Week.module.css";

function KindIcon({ kind }: { kind: TodoItem["kind"] }) {
  if (kind === "workout") return <Dumbbell size={12} aria-hidden="true" />;
  if (kind === "meal") return <Utensils size={12} aria-hidden="true" />;
  if (kind === "rest") return <Moon size={12} aria-hidden="true" />;
  if (kind === "goal") return <Target size={12} aria-hidden="true" />;
  return null;
}

/** The week at a glance (the former Planner): every To-Do and scheduled item, Monday to Sunday. */
export function WeekTab({ today }: { today: string }) {
  const [monday, setMonday] = useState(() => mondayOf(today));
  const [selected, setSelected] = useState(today);
  const days = weekKeys(monday);
  const todos = useTodos({ from: days[0], to: days[6] });
  const [editor, setEditor] = useState<{ mode: "add" | "edit"; draft: TodoDraft; item?: TodoItem; key: number } | null>(null);
  const groups = groupByDay(todos.items, days);
  const progress = todoProgress(todos.items);
  // The picked day when it is in the shown week, else today when it is, else Monday.
  const selectedDay = days.includes(selected) ? selected : days.includes(today) ? today : days[0];

  // From the latest week, so taps in quick succession each move one week.
  function shift(weeks: number) {
    setMonday((current) => addDays(current, weeks * 7));
  }

  const range = `${keyToLocalDate(days[0]).toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${keyToLocalDate(days[6]).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;

  const dayColumn = (day: string, mobile = false) => {
    const items = groups.get(day) ?? [];
    const date = keyToLocalDate(day);
    return (
      <section key={day} className={`${styles.day} ${day === today ? styles.today : ""} ${mobile ? styles.mobileDay : ""}`} aria-label={date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}>
        <header className={styles.dayHeader}>
          <span>{date.toLocaleDateString(undefined, { weekday: "short" })}</span>
          <strong>{date.getDate()}</strong>
          {day === today && <em>Today</em>}
        </header>
        <ul className={styles.items}>
          {items.map((item) => {
            const done = item.status === "completed";
            const time = clockTime(item.startsAt);
            return (
              <li key={item.id} className={`${styles.item} ${done ? styles.done : ""}`}>
                <label className={styles.check}>
                  <input type="checkbox" checked={done} onChange={() => void todos.toggle(item.id)} disabled={item.id.startsWith("temp-")} aria-label={`${item.title}: ${done ? "done" : "not done"}`} />
                  <span aria-hidden="true"><Check size={11} strokeWidth={3} /></span>
                </label>
                <button type="button" className={styles.itemText} onClick={() => setEditor({ mode: "edit", draft: draftFromTodo(item), item, key: Date.now() })} aria-label={`Edit ${item.title}`}>
                  <span className={styles.itemTitle}>{item.title}</span>
                  {(time || item.kind !== "task") && <span className={styles.itemMeta}><KindIcon kind={item.kind} />{time ?? (item.kind === "workout" ? "Workout" : item.kind === "meal" ? "Meal" : item.kind === "rest" ? "Rest day" : "")}</span>}
                </button>
                {item.kind === "workout" && item.workoutPlanId && !done && day === today && (
                  <Link href={`/workouts?plan=${item.workoutPlanId}`} className={styles.start} aria-label={`Start ${item.title}`}>Start</Link>
                )}
              </li>
            );
          })}
        </ul>
        <button type="button" className={styles.add} onClick={() => setEditor({ mode: "add", draft: emptyTodoDraft(day), key: Date.now() })} aria-label={`Add to ${date.toLocaleDateString(undefined, { weekday: "long" })}`}>
          <Plus size={14} aria-hidden="true" />Add
        </button>
      </section>
    );
  };

  return (
    <section className={styles.week} aria-label="Your week">
      <div className={styles.bar}>
        <button type="button" className={styles.nav} onClick={() => shift(-1)} aria-label="Previous week"><ChevronLeft size={18} aria-hidden="true" /></button>
        <div className={styles.title}>
          <h2>{range}</h2>
          <p>{todos.status === "ready" ? `${progress.done} of ${progress.total} done` : " "}{mondayOf(today) !== monday && <> · <button type="button" className={styles.thisWeek} onClick={() => { setMonday(mondayOf(today)); setSelected(today); }}>This week</button></>}</p>
        </div>
        <button type="button" className={styles.nav} onClick={() => shift(1)} aria-label="Next week"><ChevronRight size={18} aria-hidden="true" /></button>
      </div>
      {todos.schema === "legacy" && <p className={styles.note}>Your schedule works as before. Untimed To-Dos arrive with the next FITX update.</p>}

      {todos.status === "error" ? (
        <WidgetError message={todos.error} onRetry={() => void todos.reload()} />
      ) : todos.status === "loading" ? (
        <div className={styles.loading} aria-busy="true" aria-label="Loading your week" />
      ) : (
        <>
          <div className={styles.grid}>{days.map((day) => dayColumn(day))}</div>
          <div className={styles.mobile}>
            <div className={styles.picker} role="group" aria-label="Choose a day">
              {days.map((day) => {
                const date = keyToLocalDate(day);
                const count = (groups.get(day) ?? []).length;
                return (
                  <button key={day} type="button" aria-pressed={day === selectedDay} className={`${styles.pick} ${day === today ? styles.pickToday : ""}`} onClick={() => setSelected(day)} aria-label={`${date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}${count ? `, ${count} ${count === 1 ? "item" : "items"}` : ""}`}>
                    <span>{date.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2)}</span>
                    <strong>{date.getDate()}</strong>
                    <i aria-hidden="true" className={count ? styles.pickDot : undefined} />
                  </button>
                );
              })}
            </div>
            {dayColumn(selectedDay, true)}
          </div>
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
