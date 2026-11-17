"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { DEFAULT_HOUSEHOLD_ML, HOUSEHOLD_ML_RANGE, type HouseholdMl, type Vessel } from "@/lib/domain/food-query";
import styles from "./FoodUi.module.css";

const VESSELS: Array<{ key: Vessel; label: string }> = [
  { key: "katori", label: "Katori (ml)" },
  { key: "bowl", label: "Bowl (ml)" },
  { key: "glass", label: "Glass (ml)" },
];

/**
 * Where the member sets how big their katori, bowl and glass are. FITX has no standard size for them (they vary from
 * home to home), so it starts from a working size, says so, and uses what is entered here instead.
 */
export function HouseholdMeasures({ sizes, onSave, onCancel }: { sizes: HouseholdMl; onSave: (sizes: HouseholdMl) => void; onCancel: () => void }) {
  const [form, setForm] = useState<Record<Vessel, string>>(() => ({ katori: String(sizes.katori ?? ""), bowl: String(sizes.bowl ?? ""), glass: String(sizes.glass ?? "") }));
  const [problem, setProblem] = useState("");
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function submit() {
    const out: HouseholdMl = {};
    for (const { key, label } of VESSELS) {
      const text = form[key].trim();
      if (!text) continue;
      const value = Number(text);
      if (!Number.isFinite(value) || value < HOUSEHOLD_ML_RANGE.min || value > HOUSEHOLD_ML_RANGE.max) return setProblem(`${label.replace(" (ml)", "")} must be between ${HOUSEHOLD_ML_RANGE.min} and ${HOUSEHOLD_ML_RANGE.max} ml.`);
      out[key] = Math.round(value);
    }
    onSave(out);
  }

  return (
    <div className={styles.dialogBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="household-title">
        <div className={styles.dialogHeader}>
          <div>
            <h2 id="household-title">My katori and bowl sizes</h2>
            <p className={styles.muted}>Sizes differ from home to home, so FITX has no standard one. Measure yours with water and enter it here. Leave a box empty to use FITX&apos;s working size, shown in the box.</p>
          </div>
          <button type="button" onClick={onCancel} aria-label="Close" className={styles.iconButton}><X size={16}/></button>
        </div>
        <form className={styles.form} onSubmit={(event) => { event.preventDefault(); submit(); }}>
          {VESSELS.map(({ key, label }, index) => (
            <label key={key} className={styles.wide}>{label}
              <input ref={index === 0 ? first : undefined} className="fitx-field" type="number" inputMode="numeric" min={HOUSEHOLD_ML_RANGE.min} max={HOUSEHOLD_ML_RANGE.max} step="1"
                placeholder={`${DEFAULT_HOUSEHOLD_ML[key]} (FITX working size)`} value={form[key]} onChange={(event) => { setForm((old) => ({ ...old, [key]: event.target.value })); setProblem(""); }}/>
            </label>
          ))}
          <p className={`${styles.hint} ${styles.wide}`}>Grams are worked out from the food&apos;s own USDA cup weight, so a bowl of dal and a bowl of rice weigh differently. Saved on this device only.</p>
          {problem && <p role="alert" className={`${styles.warning} ${styles.wide}`}>{problem}</p>}
          <div className={`${styles.dialogActions} ${styles.wide}`}>
            <button type="button" onClick={onCancel} className="fitx-button fitx-button-secondary">Cancel</button>
            <button type="submit" className="fitx-button">Save sizes</button>
          </div>
        </form>
      </div>
    </div>
  );
}
