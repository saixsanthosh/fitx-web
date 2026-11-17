"use client";

import { useState, type FormEvent } from "react";
import { Check, CheckCircle2, History, Pause, Pencil, Play, RotateCcw, Trash2 } from "lucide-react";
import { RowMenu } from "@/components/tasks/RowMenu";
import { keyToLocalDate } from "@/lib/domain/day-keys";
import type { GoalsSchema } from "@/lib/data/goals";
import { CATEGORY_LABELS, GOAL_METRICS, PERIOD_LABELS, evaluateView, parseProgressAmount, periodLabel, progressSummary, remainingLabel, type GoalView } from "@/lib/domain/goals";
import styles from "./Goals.module.css";

const shortDate = (key: string | null) => (key ? keyToLocalDate(key).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "");

export type GoalCardActions = {
  onEdit: () => void;
  onStatus: (status: "active" | "paused" | "completed") => void;
  onDelete: () => void;
  onHistory: () => void;
  onLog: (amount: number) => Promise<boolean>;
};

/** One goal: progress for its current period, where the numbers come from, and its actions. */
export function GoalCard({ goal, today, schema, actions }: { goal: GoalView; today: string; schema: GoalsSchema; actions: GoalCardActions }) {
  const [amount, setAmount] = useState("");
  const [logging, setLogging] = useState(false);
  const [error, setError] = useState("");
  const evaluation = evaluateView(goal);
  const over = evaluation.state === "over_limit";
  const manual = goal.metric === "manual";
  const active = goal.status === "active";
  const completed = goal.status === "completed";
  const reachedLongTerm = active && goal.period === "long_term" && evaluation.achieved;

  async function log(event: FormEvent) {
    event.preventDefault();
    const value = parseProgressAmount(amount);
    if (value === null) { setError("Enter a number, for example 2 or 1.5."); return; }
    if (value < 0 && schema === "v1") { setError("To take progress off, delete the entry in Progress history."); return; }
    setError("");
    setLogging(true);
    if (await actions.onLog(value)) setAmount("");
    setLogging(false);
  }


  return (
    <article className={`fitx-panel ${styles.goalCard} ${!active ? styles.goalInactive : ""}`} aria-labelledby={`goal-${goal.id}`}>
      <header className={styles.goalHeader}>
        <div className="min-w-0">
          <p className={styles.goalEyebrow}>{CATEGORY_LABELS[goal.category]} · {PERIOD_LABELS[goal.period]}</p>
          <h3 id={`goal-${goal.id}`} className={styles.goalName}>{goal.title}</h3>
        </div>
        <div className={styles.goalCorner}>
          {goal.status === "paused" && <span className={styles.statusChip}>Paused</span>}
          {completed && <span className={`${styles.statusChip} ${styles.statusDone}`}><Check size={12} aria-hidden="true" />Completed</span>}
          <RowMenu
            label={`Actions for ${goal.title}`}
            actions={[
              { label: "Edit", icon: <Pencil size={15} aria-hidden="true" />, onSelect: actions.onEdit },
              ...(manual ? [{ label: "Progress history", icon: <History size={15} aria-hidden="true" />, onSelect: actions.onHistory }] : []),
              ...(completed
                ? [{ label: "Reopen", icon: <RotateCcw size={15} aria-hidden="true" />, onSelect: () => actions.onStatus("active") }]
                : [
                  goal.status === "paused"
                    ? { label: "Resume", icon: <Play size={15} aria-hidden="true" />, onSelect: () => actions.onStatus("active") }
                    : { label: "Pause", icon: <Pause size={15} aria-hidden="true" />, onSelect: () => actions.onStatus("paused") },
                  { label: "Mark complete", icon: <CheckCircle2 size={15} aria-hidden="true" />, onSelect: () => actions.onStatus("completed") },
                ]),
              { label: "Delete", icon: <Trash2 size={15} aria-hidden="true" />, onSelect: actions.onDelete, danger: true },
            ]}
          />
        </div>
      </header>

      <div className={styles.goalProgress}>
        <p className={styles.goalNumbers}><strong>{progressSummary(goal)}</strong>{goal.currentValue !== null && <span>{evaluation.percent}%</span>}</p>
        <div className="fitx-progress-track h-2" role="progressbar" aria-label={`Progress for ${goal.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={evaluation.percent} aria-valuetext={`${progressSummary(goal)}, ${remainingLabel(goal, evaluation) || `${evaluation.percent}%`}`}>
          <div className="fitx-progress-fill" style={{ width: `${evaluation.percent}%`, background: over ? "var(--fitx-warning)" : evaluation.achieved ? "var(--fitx-success)" : undefined }} />
        </div>
        <p className={styles.goalMetaLine}>
          <span className={over ? styles.overText : evaluation.achieved ? styles.doneText : undefined}>{remainingLabel(goal, evaluation)}</span>
          <span>{completed && goal.completedAt ? `Completed ${new Date(goal.completedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : periodLabel(goal, today)}</span>
        </p>
      </div>

      <p className={styles.goalSource}>
        {GOAL_METRICS[goal.metric].source}
        {goal.metric === "body_weight_kg" && goal.valueAsOf && ` · latest ${shortDate(goal.valueAsOf)}`}
        {goal.metric === "body_weight_kg" && goal.startValue !== null && ` · started at ${goal.startValue.toFixed(1)} kg`}
        {goal.linkedTodos > 0 && ` · ${goal.linkedTodosDone} of ${goal.linkedTodos} linked To-Dos done`}
      </p>
      {goal.notes && <p className={styles.goalNotes}>{goal.notes}</p>}

      {reachedLongTerm && (
        <button type="button" className={`fitx-button ${styles.completeButton}`} onClick={() => actions.onStatus("completed")}><CheckCircle2 size={16} aria-hidden="true" />Mark complete</button>
      )}
      {manual && active && !reachedLongTerm && (
        <form className={styles.logForm} onSubmit={(event) => void log(event)}>
          <label className="sr-only" htmlFor={`log-${goal.id}`}>Progress to add to {goal.title}</label>
          <input id={`log-${goal.id}`} className="fitx-field" inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); setError(""); }} placeholder={`Add ${goal.unit || "progress"}`} aria-invalid={error ? true : undefined} aria-describedby={error ? `log-error-${goal.id}` : undefined} />
          <button type="submit" className="fitx-button fitx-button-secondary" disabled={logging || !amount.trim()}>{logging ? "Saving…" : "Log"}</button>
          {error
            ? <small id={`log-error-${goal.id}`} role="alert" className={styles.logError}>{error}</small>
            : <small>Logged too much? <button type="button" className={styles.inlineButton} onClick={actions.onHistory}>Remove an entry</button> in Progress history.</small>}
        </form>
      )}
    </article>
  );
}
