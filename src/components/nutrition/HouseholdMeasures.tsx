"use client";

import { useEffect, useRef, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { DEFAULT_HOUSEHOLD_ML, HOUSEHOLD_ML_RANGE, type HouseholdMl, type Vessel } from "@/lib/domain/food-query";
import styles from "./FoodUi.module.css";

const VESSELS: Array<{ key: Vessel; label: string }> = [
  { key: "katori", label: "Katori (ml)" },
  { key: "bowl", label: "Bowl (ml)" },
  { key: "glass", label: "Glass (ml)" },
];

/**
 * Where the member sets how big their katori, bowl and glass are. FITX has no standard size for them (they vary from
 * home to home), so it starts from a working size, says so, and uses what is entered here instead. A modal Sheet
 * (native dialog): focus starts on the first box, stays inside, Escape cancels, and the page behind is inert.
 */
export function HouseholdMeasures({ sizes, onSave, onCancel }: { sizes: HouseholdMl; onSave: (sizes: HouseholdMl) => void; onCancel: () => void }) {
  const [form, setForm] = useState<Record<Vessel, string>>(() => ({ katori: String(sizes.katori ?? ""), bowl: String(sizes.bowl ?? ""), glass: String(sizes.glass ?? "") }));
  const [problem, setProblem] = useState("");
  const first = useRef<HTMLInputElement>(null);

  // The dialog is open by now (Sheet opens it in a layout effect).
  useEffect(() => { first.current?.focus(); }, []);

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
    <Sheet open onClose={onCancel} side="center" title="My katori and bowl sizes"
      description="Sizes differ from home to home, so FITX has no standard one. Measure yours with water and enter it here. Leave a box empty to use FITX's working size, shown in the box.">
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
    </Sheet>
  );
}
