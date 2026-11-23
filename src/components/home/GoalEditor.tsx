"use client";

import { useState, type FormEvent } from "react";
import { CalendarCheck, Droplets, Dumbbell, Flame, Footprints, ListChecks, PenLine, Scale, Timer, Utensils } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { getSession, messageFor } from "@/components/tasks/session";
import { createGoal, updateGoal, type GoalsSchema } from "@/lib/data/goals";
import {
  CATEGORY_LABELS, GOAL_CATEGORIES, GOAL_METRICS, GOAL_TEMPLATES, PERIOD_LABELS,
  draftFromGoal, goalDraft, templateTitle, validateGoalDraft, weightDirection,
  type GoalContext, type GoalDraft, type GoalTemplateKey, type GoalView,
} from "@/lib/domain/goals";
import styles from "./Goals.module.css";

const TEMPLATE_ICONS: Record<GoalTemplateKey, typeof Dumbbell> = {
  workouts_week: Dumbbell, distance_week: Footprints, active_week: Timer, protein_day: Utensils, calories_day: Flame, water_day: Droplets,
  weight: Scale, checklist: ListChecks, custom: PenLine,
};

/** A placeholder per kind of target: an example of the format, not a recommendation. */
const PLACEHOLDERS: Partial<Record<GoalDraft["metric"], string>> = { water_ml: "3000", activity_distance_km: "15", active_minutes: "150" };

/** Create a goal from a template, or edit one. Prefilled from the member's own numbers where FITX has them. */
export function GoalEditor({ mode, schema, context, initialTemplate, goal, onClose, onSaved }: {
  mode: "add" | "edit";
  schema: GoalsSchema;
  context: GoalContext;
  initialTemplate?: GoalTemplateKey | null;
  goal?: GoalView;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [draft, setDraft] = useState<GoalDraft | null>(() => (goal ? draftFromGoal(goal) : initialTemplate ? goalDraft(initialTemplate, context) : null));
  const [titleTouched, setTitleTouched] = useState(mode === "edit");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const legacy = schema === "v1";

  function choose(template: GoalTemplateKey) {
    setDraft(goalDraft(template, context));
    setTitleTouched(false);
    setError("");
  }

  function change(patch: Partial<GoalDraft>) {
    setDraft((current) => {
      if (!current) return current;
      const next = { ...current, ...patch };
      if (next.template === "weight" && (patch.target !== undefined || patch.baseline !== undefined)) {
        const target = Number(next.target);
        if (Number.isFinite(target) && target > 0) next.direction = weightDirection(next.baseline ? Number(next.baseline) : null, target);
      }
      if (!titleTouched && next.template !== "custom" && patch.title === undefined) next.title = templateTitle(next);
      return next;
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const result = validateGoalDraft(draft);
    if (!result.ok) { setError(result.error); return; }
    setSaving(true);
    setError("");
    try {
      const { db, userId } = await getSession();
      if (mode === "edit" && goal) await updateGoal(db, userId, goal.id, result.value, schema);
      else await createGoal(db, userId, result.value, schema);
      onSaved(mode === "edit" ? "Goal updated." : "Goal created.");
    } catch (failure) {
      setError(messageFor(failure, mode === "edit" ? "That goal could not be updated." : "That goal could not be saved."));
      setSaving(false);
    }
  }

  const metric = draft ? GOAL_METRICS[draft.metric] : null;
  const periodChoices = metric ? metric.periods : [];
  const longTerm = draft?.period === "long_term";

  return (
    <Sheet
      open
      onClose={onClose}
      title={mode === "edit" ? "Edit goal" : draft ? "New goal" : "Choose a goal"}
      description={draft ? metric?.source : "Most goals fill in from what you log."}
      footer={draft ? <>
        {mode === "add" && !initialTemplate && <button type="button" className={`fitx-button fitx-button-quiet ${styles.footerStart}`} onClick={() => setDraft(null)}>Back</button>}
        <button type="button" className="fitx-button fitx-button-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" form="goal-editor-form" className="fitx-button" disabled={saving}>{saving ? "Saving…" : mode === "edit" ? "Save" : "Create goal"}</button>
      </> : undefined}
    >
      {!draft ? (
        <>
          {legacy && <p className="fitx-alert mb-4">Only custom goals work until the next FITX update.</p>}
          <ul className={styles.templates}>
            {GOAL_TEMPLATES.map((template) => {
              const Icon = TEMPLATE_ICONS[template.key];
              const disabled = legacy && template.key !== "custom";
              return (
                <li key={template.key}>
                  <button type="button" className={styles.template} onClick={() => choose(template.key)} disabled={disabled}>
                    <span className={styles.templateIcon} aria-hidden="true"><Icon size={18} /></span>
                    <span className={styles.templateText}><strong>{template.label}</strong><small>{template.hint}</small></span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <form id="goal-editor-form" className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
          {error && <p role="alert" className="fitx-alert fitx-alert-danger">{error}</p>}
          <label className={styles.field}>
            <span>Goal</span>
            <input className="fitx-field" value={draft.title} maxLength={120} onChange={(event) => { setTitleTouched(true); change({ title: event.target.value }); }} placeholder="Name your goal" />
          </label>

          {draft.metric === "calories_kcal" && (
            <fieldset className={styles.field}>
              <legend>Kind of target</legend>
              <div className={styles.choices}>
                {([["limit", "Stay under"], ["increase", "Reach at least"]] as const).map(([value, label]) => (
                  <label key={value} className={styles.choice}>
                    <input type="radio" name="goal-direction" checked={draft.direction === value} onChange={() => change({ direction: value })} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {draft.metric === "body_weight_kg" ? (
            <div className={styles.fieldRow}>
              <label className={styles.field}>
                <span>Starting weight <em>kg</em></span>
                <input className="fitx-field" inputMode="decimal" value={draft.baseline} onChange={(event) => change({ baseline: event.target.value })} placeholder="80.0" />
              </label>
              <label className={styles.field}>
                <span>Target weight <em>kg</em></span>
                <input className="fitx-field" inputMode="decimal" value={draft.target} onChange={(event) => change({ target: event.target.value })} placeholder="72.0" />
              </label>
            </div>
          ) : (
            <div className={styles.fieldRow}>
              <label className={styles.field}>
                <span>{draft.direction === "limit" ? "Limit" : "Target"} {draft.metric !== "manual" && <em>{draft.metric === "water_ml" ? "ml" : metric?.unit}</em>}</span>
                <input className="fitx-field" inputMode="decimal" value={draft.target} onChange={(event) => change({ target: event.target.value })} placeholder={PLACEHOLDERS[draft.metric] ?? "10"} />
                {draft.metric === "water_ml" && Number(draft.target) > 0 && <small>{(Number(draft.target) / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} litres</small>}
              </label>
              {draft.metric === "manual" ? (
                <label className={styles.field}>
                  <span>Unit <em>optional</em></span>
                  <input className="fitx-field" value={draft.unit} maxLength={24} onChange={(event) => change({ unit: event.target.value })} placeholder="books, km, minutes" />
                </label>
              ) : periodChoices.length > 1 ? (
                <label className={styles.field}>
                  <span>How often</span>
                  <select className="fitx-field" value={draft.period} onChange={(event) => change({ period: event.target.value as GoalDraft["period"] })}>
                    {periodChoices.map((period) => <option key={period} value={period}>{PERIOD_LABELS[period]}</option>)}
                  </select>
                </label>
              ) : null}
            </div>
          )}

          {draft.metric === "manual" && (
            <div className={styles.fieldRow}>
              <label className={styles.field}>
                <span>How often</span>
                <select className="fitx-field" value={draft.period} onChange={(event) => change({ period: event.target.value as GoalDraft["period"] })} disabled={legacy}>
                  {periodChoices.map((period) => <option key={period} value={period}>{PERIOD_LABELS[period]}</option>)}
                </select>
              </label>
              {longTerm && (
                <label className={styles.field}>
                  <span>Already done <em>optional</em></span>
                  <input className="fitx-field" inputMode="decimal" value={draft.baseline} onChange={(event) => change({ baseline: event.target.value })} placeholder="0" disabled={legacy} />
                </label>
              )}
            </div>
          )}

          <div className={styles.fieldRow}>
            <label className={styles.field}>
              <span>Starts</span>
              <input className="fitx-field" type="date" value={draft.startsOn} onChange={(event) => change({ startsOn: event.target.value })} />
            </label>
            <label className={styles.field}>
              <span>{longTerm ? "Due date" : "Ends on"} <em>optional</em></span>
              <input className="fitx-field" type="date" min={draft.startsOn} value={draft.dueOn} onChange={(event) => change({ dueOn: event.target.value })} />
            </label>
          </div>

          <label className={styles.field}>
            <span>Category</span>
            <select className="fitx-field" value={draft.category} onChange={(event) => change({ category: event.target.value as GoalDraft["category"] })}>
              {GOAL_CATEGORIES.map((category) => <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            <span>Notes <em>optional</em></span>
            <textarea className="fitx-field" maxLength={1000} value={draft.notes} onChange={(event) => change({ notes: event.target.value })} />
          </label>
          {draft.template === "checklist" && <p className={styles.hint}><CalendarCheck size={14} aria-hidden="true" />To-Dos are retired, so this goal keeps the count it reached.</p>}
          {draft.metric === "activity_distance_km" && <p className={styles.hint}><Footprints size={14} aria-hidden="true" />Walks, runs, rides and other activities you record, by the day each started.</p>}
          {draft.metric === "active_minutes" && <p className={styles.hint}><Timer size={14} aria-hidden="true" />Activity moving time plus workout training time, pauses left out.</p>}
        </form>
      )}
    </Sheet>
  );
}
