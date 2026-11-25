"use client";

import { useEffect, useRef, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import type { FoodMacros } from "@/lib/domain/nutrition";
import { targetProblem, type ManualTargets } from "@/lib/food/client-data";
import styles from "./FoodUi.module.css";

interface TargetsEditorProps {
  /** The estimate from the profile (Mifflin-St Jeor and activity), when the profile has enough to make one. */
  estimated: FoodMacros | null;
  manual: ManualTargets | null;
  /** Saving targets needs the nutrition v2 database update. */
  ready: boolean;
  busy: boolean;
  onSave: (targets: ManualTargets) => void;
  onReset: () => void;
  onClose: () => void;
}

/**
 * Set daily calorie and macro targets by hand, or go back to the estimate from your profile. A modal Sheet (native
 * dialog): focus starts on calories, stays inside, Escape closes, and focus goes back to the targets button.
 */
export function TargetsEditor({ estimated, manual, ready, busy, onSave, onReset, onClose }: TargetsEditorProps) {
  const start = manual ?? estimated;
  const [form, setForm] = useState({
    calories: start ? String(Math.round(start.calories)) : "",
    protein: start ? String(Math.round(start.protein)) : "",
    carbs: start ? String(Math.round(start.carbs)) : "",
    fat: start ? String(Math.round(start.fat)) : "",
  });
  /** Save was pressed with a box empty: say so, instead of a button that does nothing. */
  const [tried, setTried] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const values: ManualTargets = { calories: Number(form.calories), protein: Number(form.protein), carbs: Number(form.carbs), fat: Number(form.fat) };
  const blank = Object.values(form).some((value) => value.trim() === "");
  const check = blank ? { error: tried ? "Enter a number for each target." : null, warning: null } : targetProblem(values);
  const blocked = busy || blank || Boolean(check.error);

  // The dialog is open by now (Sheet opens it in a layout effect).
  useEffect(() => { first.current?.focus(); }, []);

  const field = (key: keyof typeof form, label: string, unit: string) => (
    <label>{label} ({unit})<input ref={key === "calories" ? first : undefined} className="fitx-field" type="number" inputMode="numeric" min="0" step="1" required disabled={!ready}
      value={form[key]} onChange={(event) => setForm((old) => ({ ...old, [key]: event.target.value }))}/></label>
  );

  const description = manual ? "You set these by hand."
    : estimated ? "Now using an estimate from your profile: weight, height, age, activity and goal."
    : "No daily target yet. Add your age, height and weight to your profile for an estimate, or set your own below.";

  return (
    <Sheet open onClose={onClose} side="center" title="Daily targets" description={description}>
      {!ready ? <div className={styles.callout}><p>Setting your own targets needs a database update that hasn&apos;t been applied yet. {estimated ? "Until then FITX uses the estimate from your profile." : "Until then, adding your age, height and weight to your profile gives you an estimated target."}</p></div> : (
        // Buttons are marked unavailable rather than disabled, so the one pressed keeps the focus while saving.
        <form className={styles.form} noValidate onSubmit={(event) => { event.preventDefault(); setTried(true); if (!blocked) onSave(values); }}>
          {field("calories", "Calories", "kcal")}
          {field("protein", "Protein", "g")}
          {field("carbs", "Carbs", "g")}
          {field("fat", "Fat", "g")}
          {estimated && <p className={`${styles.hint} ${styles.wide}`}>Estimate from your profile: {Math.round(estimated.calories).toLocaleString()} kcal · protein {estimated.protein} g · carbs {estimated.carbs} g · fat {estimated.fat} g.</p>}
          {check.error && <p role="alert" className={`${styles.warning} ${styles.wide}`}>{check.error}</p>}
          {!check.error && check.warning && <p className={`${styles.warning} ${styles.wide}`}>{check.warning}</p>}
          <div className={`${styles.dialogActions} ${styles.wide}`}>
            {manual && <button type="button" onClick={() => { if (!busy) onReset(); }} aria-disabled={busy || undefined} className="fitx-button fitx-button-secondary">Use the estimate</button>}
            <button type="submit" aria-disabled={blocked || undefined} className="fitx-button">{busy ? "Saving…" : "Save targets"}</button>
          </div>
        </form>
      )}
    </Sheet>
  );
}
