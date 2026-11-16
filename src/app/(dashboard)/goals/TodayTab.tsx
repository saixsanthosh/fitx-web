"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, CircleCheck } from "lucide-react";
import { TodoList } from "@/components/tasks/TodoList";
import { dayName, longDay } from "@/components/tasks/format";
import { useGoalsData } from "@/components/widgets/useHomeData";
import { WidgetError, WidgetSkeleton } from "@/components/widgets/WidgetCard";
import { addDays } from "@/lib/domain/day-keys";
import { appliesOn, evaluateView, progressSummary, remainingLabel, sortGoals } from "@/lib/domain/goals";
import styles from "./Goals.module.css";

/** One day: its To-Do list and the daily goals for that day, with arrows to move between days. */
export function TodayTab({ today }: { today: string }) {
  const [day, setDay] = useState(today);
  const goals = useGoalsData(day);
  const isToday = day === today;
  const label = isToday ? "Today" : dayName(day, today).replace(/^./, (letter) => letter.toUpperCase());
  const goalTitles = Object.fromEntries((goals.data?.goals ?? []).map((goal) => [goal.id, goal.title]));
  const daily = sortGoals((goals.data?.goals ?? []).filter((goal) => goal.period === "daily" && appliesOn(goal, day)));

  return (
    <div className={styles.todayLayout}>
      <section className={`fitx-panel ${styles.todoPanel}`} aria-labelledby="today-heading">
        <div className={styles.dayBar}>
          <button type="button" className={styles.iconNav} onClick={() => setDay(addDays(day, -1))} aria-label="Previous day"><ChevronLeft size={18} aria-hidden="true" /></button>
          <div className={styles.dayTitle}>
            <h2 id="today-heading">{label}</h2>
            <p>{longDay(day)}</p>
          </div>
          <button type="button" className={styles.iconNav} onClick={() => setDay(addDays(day, 1))} aria-label="Next day"><ChevronRight size={18} aria-hidden="true" /></button>
        </div>
        {!isToday && <button type="button" className={styles.backToToday} onClick={() => setDay(today)}>Back to today</button>}
        <TodoList key={day} date={day} onChanged={goals.reload} goalTitles={goalTitles} />
      </section>

      <aside className={`fitx-panel ${styles.dailyPanel}`} aria-labelledby="daily-goals-heading">
        <h2 id="daily-goals-heading" className={styles.sideHeading}>{isToday ? "Today's goals" : `Goals on ${longDay(day)}`}</h2>
        {!goals.data ? (
          goals.status === "error" ? <WidgetError message={goals.error} onRetry={goals.reload} /> : <WidgetSkeleton label="Loading your goals" />
        ) : daily.length ? (
          <ul className={styles.dailyList}>
            {daily.map((goal) => {
              const evaluation = evaluateView(goal);
              const over = evaluation.state === "over_limit";
              return (
                <li key={goal.id}>
                  <p className={styles.dailyTitle}>{evaluation.achieved && <CircleCheck size={15} aria-label="Done" className={styles.doneIcon} />}{goal.title}</p>
                  <div className="fitx-progress-track h-1.5" role="progressbar" aria-label={`${goal.title}: ${progressSummary(goal)}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={evaluation.percent}>
                    <div className="fitx-progress-fill" style={{ width: `${evaluation.percent}%`, background: over ? "var(--fitx-warning)" : evaluation.achieved ? "var(--fitx-success)" : undefined }} />
                  </div>
                  <p className={styles.dailyMeta}><span>{progressSummary(goal)}</span><span className={over ? styles.overText : undefined}>{remainingLabel(goal, evaluation)}</span></p>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={styles.sideEmpty}>
            {goals.data.schema === "v1" ? "Daily goals arrive with the next FITX update." : "No daily goals yet. Daily goals restart every morning and fill in from what you log."}
          </p>
        )}
      </aside>
    </div>
  );
}
