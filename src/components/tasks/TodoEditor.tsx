"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";
import { loadGoalOptions, type GoalOption } from "@/lib/data/goals";
import { loadPlanOptions, type PlanOption, type TodoSchema } from "@/lib/data/todo";
import { TODO_KINDS, validateTodoDraft, type TodoDraft, type TodoInput } from "@/lib/domain/todo";
import { Sheet } from "./Sheet";
import { getSession } from "./session";
import styles from "./Todo.module.css";

/**
 * Add or edit one To-Do or scheduled item: what, which kind, the day, an optional time, a saved
 * workout to start from, a goal it counts toward, and notes.
 */
export function TodoEditor({ open, mode, initial, schema, onClose, onSubmit, onDelete }: {
  open: boolean;
  mode: "add" | "edit";
  initial: TodoDraft;
  schema: TodoSchema | null;
  onClose: () => void;
  onSubmit: (input: TodoInput) => Promise<boolean>;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [plans, setPlans] = useState<PlanOption[] | null>(null);
  const [goals, setGoals] = useState<GoalOption[] | null>(null);
  const id = useId();
  const legacy = schema === "legacy";

  useEffect(() => {
    if (!open) return;
    let active = true;
    void (async () => {
      try {
        const { db, userId } = await getSession();
        const [planList, goalList] = await Promise.all([
          loadPlanOptions(db, userId).catch(() => [] as PlanOption[]),
          legacy ? Promise.resolve([] as GoalOption[]) : loadGoalOptions(db, userId).catch(() => [] as GoalOption[]),
        ]);
        if (active) { setPlans(planList); setGoals(goalList); }
      } catch {
        if (active) { setPlans([]); setGoals([]); }
      }
    })();
    return () => { active = false; };
  }, [open, legacy]);

  const set = <K extends keyof TodoDraft>(key: K, value: TodoDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (legacy && (!draft.time || draft.kind === "task")) {
      setError("Untimed To-Dos arrive with the next FITX update. Choose a type other than To-Do and add a time to schedule it.");
      return;
    }
    const result = validateTodoDraft(draft);
    if (!result.ok) { setError(result.error); return; }
    setSaving(true);
    setError("");
    const saved = await onSubmit(result.value);
    setSaving(false);
    if (saved) onClose();
  }

  const kinds = legacy ? TODO_KINDS.filter((kind) => kind.value !== "task") : TODO_KINDS;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={mode === "add" ? "Add to your day" : "Edit item"}
      description={legacy ? "Your schedule works as before. Untimed To-Dos arrive with the next FITX update." : undefined}
      footer={<>
        {mode === "edit" && onDelete && <button type="button" className={`fitx-button fitx-button-danger ${styles.footerDelete}`} onClick={onDelete}><Trash2 size={15} aria-hidden="true" />Delete</button>}
        <button type="button" className="fitx-button fitx-button-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" form={`${id}-form`} className="fitx-button" disabled={saving}>{saving ? "Saving…" : mode === "add" ? "Add" : "Save"}</button>
      </>}
    >
      <form id={`${id}-form`} className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
        {error && <p role="alert" className="fitx-alert fitx-alert-danger">{error}</p>}
        <label className={styles.field}>
          <span>What</span>
          <input className="fitx-field" value={draft.title} maxLength={120} required autoFocus onChange={(event) => set("title", event.target.value)} placeholder="Stretch for 10 minutes" />
        </label>
        <fieldset className={styles.field}>
          <legend>Type</legend>
          <div className={styles.chips}>
            {kinds.map((kind) => (
              <label key={kind.value} className={styles.chip}>
                <input type="radio" name={`${id}-kind`} value={kind.value} checked={draft.kind === kind.value} onChange={() => set("kind", kind.value)} />
                <span>{kind.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {draft.kind === "workout" && (
          <label className={styles.field}>
            <span>Saved workout <em>optional</em></span>
            <select className="fitx-field" value={draft.workoutPlanId} onChange={(event) => set("workoutPlanId", event.target.value)}>
              <option value="">{plans === null ? "Loading your workouts…" : plans.length ? "None" : "No saved workouts yet"}</option>
              {(plans ?? []).map((plan) => <option key={plan.id} value={plan.id}>{plan.title}</option>)}
            </select>
            <small>Linked workouts get a Start button, and finishing the workout ticks this off.</small>
          </label>
        )}
        <div className={styles.fieldRow}>
          <label className={styles.field}>
            <span>Day</span>
            <input className="fitx-field" type="date" required value={draft.localDate} onChange={(event) => set("localDate", event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Time <em>{legacy ? "required for now" : "optional"}</em></span>
            <input className="fitx-field" type="time" value={draft.time} onChange={(event) => set("time", event.target.value)} />
          </label>
        </div>
        {!legacy && (
          <label className={styles.field}>
            <span>Counts toward <em>optional</em></span>
            <select className="fitx-field" value={draft.goalId} onChange={(event) => set("goalId", event.target.value)}>
              <option value="">{goals === null ? "Loading your goals…" : "No goal"}</option>
              {(goals ?? []).map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}
            </select>
          </label>
        )}
        <label className={styles.field}>
          <span>Notes <em>optional</em></span>
          <textarea className="fitx-field" maxLength={1000} value={draft.description} onChange={(event) => set("description", event.target.value)} />
        </label>
      </form>
    </Sheet>
  );
}
