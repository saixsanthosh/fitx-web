"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
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

/** Set daily calorie and macro targets by hand, or go back to the estimate from your profile. */
export function TargetsEditor({ estimated, manual, ready, busy, onSave, onReset, onClose }: TargetsEditorProps) {
  const start = manual ?? estimated;
  const [form, setForm] = useState({
    calories: start ? String(Math.round(start.calories)) : "",
    protein: start ? String(Math.round(start.protein)) : "",
    carbs: start ? String(Math.round(start.carbs)) : "",
    fat: start ? String(Math.round(start.fat)) : "",
  });
  const first = useRef<HTMLInputElement>(null);
  const values: ManualTargets = { calories: Number(form.calories), protein: Number(form.protein), carbs: Number(form.carbs), fat: Number(form.fat) };
  const blank = Object.values(form).some((value) => value.trim() === "");
  const check = blank ? { error: null, warning: null } : targetProblem(values);

  useEffect(() => {
    first.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const field = (key: keyof typeof form, label: string, unit: string) => (
    <label>{label} ({unit})<input ref={key === "calories" ? first : undefined} className="fitx-field" type="number" inputMode="numeric" min="0" step="1" required disabled={!ready}
      value={form[key]} onChange={(event) => setForm((old) => ({ ...old, [key]: event.target.value }))}/></label>
  );

  return (
    <div className={styles.dialogBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="targets-title">
        <div className={styles.dialogHeader}>
          <div>
            <h2 id="targets-title">Daily targets</h2>
            <p className={styles.muted}>{manual ? "You set these by hand." : "Now using an estimate from your profile: weight, height, age, activity and goal."}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.iconButton}><X size={16}/></button>
        </div>
        {!ready ? <div className={styles.callout}><p>Setting your own targets needs a database update that hasn&apos;t been applied yet. Until then FITX uses the estimate from your profile.</p></div> : (
          <form className={styles.form} onSubmit={(event) => { event.preventDefault(); if (!blank && !check.error) onSave(values); }}>
            {field("calories", "Calories", "kcal")}
            {field("protein", "Protein", "g")}
            {field("carbs", "Carbs", "g")}
            {field("fat", "Fat", "g")}
            {estimated && <p className={`${styles.hint} ${styles.wide}`}>Estimate from your profile: {Math.round(estimated.calories).toLocaleString()} kcal · protein {estimated.protein} g · carbs {estimated.carbs} g · fat {estimated.fat} g.</p>}
            {check.error && <p role="alert" className={`${styles.warning} ${styles.wide}`}>{check.error}</p>}
            {!check.error && check.warning && <p className={`${styles.warning} ${styles.wide}`}>{check.warning}</p>}
            <div className={`${styles.dialogActions} ${styles.wide}`}>
              {manual && <button type="button" onClick={onReset} disabled={busy} className="fitx-button fitx-button-secondary">Use the estimate</button>}
              <button type="submit" disabled={busy || blank || Boolean(check.error)} className="fitx-button">{busy ? "Saving…" : "Save targets"}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
