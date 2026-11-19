"use client";

import { CalendarDays } from "lucide-react";
import { TodoList } from "@/components/tasks/TodoList";
import type { GoalsData, Resource } from "@/components/widgets/useHomeData";
import styles from "./Home.module.css";

/** Today's To-Do list on Home, with the week plan one tap away. */
export function TodoPanel({ date, goals, onChanged, onOpenWeek }: { date: string; goals: Resource<GoalsData>; onChanged: () => void; onOpenWeek: () => void }) {
  const goalTitles = Object.fromEntries((goals.data?.goals ?? []).map((goal) => [goal.id, goal.title]));
  return (
    <section id="home-todo" className={styles.panel} aria-labelledby="home-todo-title">
      <header className={styles.panelHead}>
        <h2 id="home-todo-title" className={styles.panelTitle} tabIndex={-1}>To-Do</h2>
        <button type="button" className={styles.panelButton} onClick={onOpenWeek} aria-haspopup="dialog">
          <CalendarDays size={16} aria-hidden="true" />Week
        </button>
      </header>
      <div className={styles.todoCard}>
        <TodoList date={date} onChanged={onChanged} goalTitles={goalTitles} />
      </div>
    </section>
  );
}
