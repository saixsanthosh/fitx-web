"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { Sheet } from "@/components/tasks/Sheet";
import { getSession, messageFor } from "@/components/tasks/session";
import { useGoalsData, useTodaySummary } from "@/components/widgets/useHomeData";
import { WidgetError } from "@/components/widgets/WidgetCard";
import { addGoalEntry, deleteGoal, deleteGoalEntry, listGoalEntries, setGoalStatus, type GoalEntry } from "@/lib/data/goals";
import { estimatedTargets } from "@/lib/domain/today";
import { formatGoalValue, sortGoals, type GoalContext, type GoalTemplateKey, type GoalView } from "@/lib/domain/goals";
import { GoalCard } from "./GoalCard";
import { GoalEditor } from "./GoalEditor";
import styles from "./Goals.module.css";

type Editor = { mode: "add"; template: GoalTemplateKey | null } | { mode: "edit"; goal: GoalView };

/** Goals: create from templates, see progress, log manual progress, edit, pause, complete, reopen, delete. */
export function GoalsTab({ today, newTemplate }: { today: string; newTemplate: GoalTemplateKey | null }) {
  const goals = useGoalsData(today);
  const summary = useTodaySummary(today);
  const [editor, setEditor] = useState<Editor | null>(newTemplate ? { mode: "add", template: newTemplate } : null);
  const [removing, setRemoving] = useState<GoalView | null>(null);
  const [history, setHistory] = useState<GoalView | null>(null);

  // A template link (/goals?tab=goals&new=…) opens the editor once; drop it from the address.
  useEffect(() => { if (newTemplate) window.history.replaceState(null, "", "/goals?tab=goals"); }, [newTemplate]);

  const schema = goals.data?.schema ?? "v2";
  const list = sortGoals(goals.data?.goals ?? []);
  const active = list.filter((goal) => goal.status === "active");
  const paused = list.filter((goal) => goal.status === "paused");
  const completed = list.filter((goal) => goal.status === "completed");

  const today_ = summary.data?.summary ?? null;
  const context: GoalContext = {
    today,
    estimate: today_ ? estimatedTargets(today_) : null,
    workoutsPerWeek: today_?.preferences?.workoutsPerWeek ?? null,
    waterGoalMl: today_?.preferences?.dailyWaterGoalMl ?? null,
    latestWeight: today_?.weight?.kg ?? today_?.profile.weight ?? null,
    targetWeight: today_?.profile.targetWeight ?? null,
  };

  async function changeStatus(goal: GoalView, status: "active" | "paused" | "completed") {
    try {
      const { db, userId } = await getSession();
      await setGoalStatus(db, userId, goal.id, status, schema);
      goals.reload();
      const previous = goal.status === "paused" ? "paused" : goal.status === "completed" ? "completed" : "active";
      const undo = { label: "Undo", onClick: () => void changeStatus({ ...goal, status: status }, previous) };
      toast(status === "completed" ? `“${goal.title}” marked complete.` : status === "paused" ? `“${goal.title}” paused.` : `“${goal.title}” is active again.`, { action: undo, duration: 7000 });
    } catch (failure) {
      toast.error(messageFor(failure, "That goal could not be updated."));
    }
  }

  async function log(goal: GoalView, amount: number) {
    try {
      const { db, userId } = await getSession();
      await addGoalEntry(db, userId, goal, amount, null, schema);
      goals.reload();
      toast.success(`Logged ${formatGoalValue(amount, goal.metric, goal.unit)} for “${goal.title}”.`);
      return true;
    } catch (failure) {
      toast.error(messageFor(failure, "That progress could not be saved."));
      return false;
    }
  }

  async function remove(goal: GoalView) {
    try {
      const { db, userId } = await getSession();
      await deleteGoal(db, userId, goal.id);
      setRemoving(null);
      goals.reload();
      toast(`Deleted “${goal.title}”.`);
    } catch (failure) {
      toast.error(messageFor(failure, "That goal could not be deleted."));
    }
  }

  const card = (goal: GoalView) => (
    <GoalCard
      key={goal.id}
      goal={goal}
      today={today}
      schema={schema}
      actions={{
        onEdit: () => setEditor({ mode: "edit", goal }),
        onStatus: (status) => void changeStatus(goal, status),
        onDelete: () => setRemoving(goal),
        onHistory: () => setHistory(goal),
        onLog: (amount) => log(goal, amount),
      }}
    />
  );

  return (
    <div className={styles.goalsTab}>
      <div className={styles.goalsBar}>
        <p className={styles.counts} aria-live="polite">{goals.data ? <><strong>{active.length}</strong> active{paused.length ? <> · <strong>{paused.length}</strong> paused</> : null}{completed.length ? <> · <strong>{completed.length}</strong> completed</> : null}</> : "Loading your goals…"}</p>
        <button type="button" className="fitx-button" onClick={() => setEditor({ mode: "add", template: null })} disabled={!goals.data}><Plus size={16} aria-hidden="true" />New goal</button>
      </div>
      {schema === "v1" && goals.data && <p className="fitx-alert">Daily, weekly and automatic goals arrive with the next FITX update. Your goals and manual progress work as before.</p>}

      {!goals.data ? (
        goals.status === "error" ? <WidgetError message={goals.error} onRetry={goals.reload} /> : <div className={styles.cardSkeletons} aria-busy="true" aria-label="Loading your goals"><span /><span /></div>
      ) : list.length === 0 ? (
        <EmptyState
          title="No goals yet"
          description="Pick a goal like daily protein or workouts per week. Progress fills in from the food, water, workouts and weigh-ins you already log."
          action={<button type="button" className="fitx-button" onClick={() => setEditor({ mode: "add", template: null })}><Plus size={16} aria-hidden="true" />Create your first goal</button>}
        />
      ) : (
        <>
          {active.length > 0 && <div className={styles.goalGrid}>{active.map(card)}</div>}
          {paused.length > 0 && (
            <section aria-labelledby="paused-goals">
              <h2 id="paused-goals" className={styles.groupHeading}>Paused</h2>
              <div className={styles.goalGrid}>{paused.map(card)}</div>
            </section>
          )}
          {completed.length > 0 && (
            <details className={styles.completedGroup}>
              <summary>Completed ({completed.length})</summary>
              <div className={styles.goalGrid}>{completed.map(card)}</div>
            </details>
          )}
        </>
      )}

      {/* The form prefills from the user's numbers and the database's goal support, so it waits for both. */}
      {editor && goals.data && (summary.data || summary.status === "error") && (
        <GoalEditor
          mode={editor.mode}
          schema={schema}
          context={context}
          initialTemplate={editor.mode === "add" ? editor.template : null}
          goal={editor.mode === "edit" ? editor.goal : undefined}
          onClose={() => setEditor(null)}
          onSaved={(message) => { setEditor(null); goals.reload(); toast.success(message); }}
        />
      )}

      {removing && (
        <Sheet
          open
          onClose={() => setRemoving(null)}
          title={`Delete “${removing.title}”?`}
          description="The goal and its progress history are deleted. This can't be undone. To keep the history, mark it complete or pause it instead."
          footer={<>
            <button type="button" className="fitx-button fitx-button-secondary" onClick={() => setRemoving(null)}>Cancel</button>
            <button type="button" className="fitx-button fitx-button-danger" onClick={() => void remove(removing)}><Trash2 size={15} aria-hidden="true" />Delete goal</button>
          </>}
        >
          <p className={styles.confirmText}>Linked To-Dos stay on your list; they just stop counting toward this goal.</p>
        </Sheet>
      )}

      {history && <HistorySheet goal={history} schema={schema} onClose={() => setHistory(null)} onChanged={goals.reload} />}
    </div>
  );
}

function HistorySheet({ goal, schema, onClose, onChanged }: { goal: GoalView; schema: "v1" | "v2"; onClose: () => void; onChanged: () => void }) {
  const [entries, setEntries] = useState<GoalEntry[] | null>(null);
  const [error, setError] = useState("");
  const [current, setCurrent] = useState(goal);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { db, userId } = await getSession();
        const list = await listGoalEntries(db, userId, goal.id);
        if (active) setEntries(list);
      } catch (failure) {
        if (active) setError(messageFor(failure, "Progress history could not be loaded."));
      }
    })();
    return () => { active = false; };
  }, [goal.id]);

  async function remove(entry: GoalEntry) {
    try {
      const { db, userId } = await getSession();
      await deleteGoalEntry(db, userId, current, entry, schema);
      setEntries((list) => (list ?? []).filter((item) => item.id !== entry.id));
      setCurrent((value) => ({ ...value, currentValue: Math.max(0, (value.currentValue ?? 0) - entry.amount) }));
      onChanged();
    } catch (failure) {
      toast.error(messageFor(failure, "That entry could not be deleted."));
    }
  }

  return (
    <Sheet open onClose={onClose} title="Progress history" description={goal.title}>
      {error ? <p role="alert" className="fitx-alert fitx-alert-danger">{error}</p>
        : entries === null ? <div className={styles.cardSkeletons} aria-busy="true" aria-label="Loading history"><span /></div>
          : entries.length === 0 ? <p className={styles.confirmText}>Nothing logged yet.</p>
            : (
              <ul className={styles.history}>
                {entries.map((entry) => (
                  <li key={entry.id}>
                    <div>
                      <strong>{entry.amount > 0 ? "+" : "−"}{formatGoalValue(Math.abs(entry.amount), goal.metric, goal.unit)}</strong>
                      <span>{new Date(entry.loggedAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}{entry.note ? ` · ${entry.note}` : ""}</span>
                    </div>
                    <button type="button" className={styles.iconNav} onClick={() => void remove(entry)} aria-label={`Delete the entry of ${formatGoalValue(entry.amount, goal.metric, goal.unit)}`}><Trash2 size={16} aria-hidden="true" /></button>
                  </li>
                ))}
              </ul>
            )}
    </Sheet>
  );
}
