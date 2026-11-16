"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { describePortion, formatAmount } from "@/lib/domain/food-query";
import type { FoodPortion } from "@/lib/domain/food-query";
import { scaleMacros } from "@/lib/domain/nutrition";
import { entryPer100g, MEAL_SLOTS, type MealEntry, type MealSnapshot } from "@/lib/food/client-data";
import styles from "./FoodUi.module.css";

export interface EntryChange {
  grams: number;
  servingSize: string;
  portion: MealSnapshot["portion"] | null;
  meal: string;
  date: string;
}

/** Edits a logged entry: amount (grams or the portion it was logged with), meal and date. */
export function EntryEditor({ entry, busy, onCancel, onSave }: { entry: MealEntry; busy: boolean; onCancel: () => void; onSave: (change: EntryChange) => void }) {
  const logged = entry.nutrition_snapshot?.portion;
  const portion: FoodPortion | null = logged?.label && logged.unit && Number(logged.grams_each) > 0
    ? { label: logged.label, unit: logged.unit, grams: Number(logged.grams_each), estimate: logged.estimate !== false }
    : null;
  const startGrams = Number(entry.quantity_grams) > 0 ? Number(entry.quantity_grams) : Number(entry.servings) * 100;
  const [unit, setUnit] = useState<"g" | "portion">(portion && Number(logged?.count) > 0 ? "portion" : "g");
  const [amount, setAmount] = useState(() => (portion && Number(logged?.count) > 0 ? formatAmount(Number(logged?.count)) : formatAmount(startGrams)));
  const [meal, setMeal] = useState(entry.meal);
  const [date, setDate] = useState(entry.date);
  const [problem, setProblem] = useState("");
  const first = useRef<HTMLInputElement>(null);
  const per100 = entryPer100g(entry);
  const count = Number(amount);
  const grams = Number.isFinite(count) ? Math.round(count * (unit === "portion" && portion ? portion.grams : 1) * 10) / 10 : Number.NaN;
  const macros = per100 && grams > 0 ? scaleMacros(per100, grams) : null;

  useEffect(() => {
    first.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function changeUnit(next: "g" | "portion") {
    if (next === unit) return;
    if (portion && grams > 0) setAmount(formatAmount(next === "portion" ? grams / portion.grams : grams));
    setUnit(next);
  }

  function save() {
    // Older entries without per-100 g values keep their amount; only the meal and date change.
    const amountGrams = per100 ? grams : startGrams;
    if (!Number.isFinite(amountGrams) || amountGrams < 1 || amountGrams > 5000) { setProblem("Enter an amount that comes to between 1 and 5,000 grams."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setProblem("Choose a date."); return; }
    if (!per100) {
      onSave({ grams: amountGrams, servingSize: entry.serving_size ?? `${formatAmount(amountGrams)} g`, portion: logged ?? null, meal, date });
      return;
    }
    const usesPortion = unit === "portion" && portion !== null;
    onSave({
      grams: amountGrams,
      servingSize: usesPortion ? describePortion(count, portion, amountGrams) : `${formatAmount(amountGrams)} g`,
      portion: usesPortion && logged ? { ...logged, count } : null,
      meal,
      date,
    });
  }

  return (
    <div className={styles.dialogBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="entry-editor-title">
        <div className={styles.dialogHeader}>
          <div>
            <h2 id="entry-editor-title">Edit entry</h2>
            <p className={styles.muted}>{entry.food_name}{entry.brand ? ` · ${entry.brand}` : ""}</p>
          </div>
          <button type="button" onClick={onCancel} aria-label="Close" className={styles.iconButton}><X size={16}/></button>
        </div>
        <form className={styles.form} onSubmit={(event) => { event.preventDefault(); save(); }}>
          <label>Amount<input ref={first} className="fitx-field" type="number" inputMode="decimal" min="0" step="any" value={amount} disabled={!per100} onChange={(event) => { setAmount(event.target.value); setProblem(""); }}/></label>
          <label>Unit<select className="fitx-field" value={unit} disabled={!per100 || !portion} onChange={(event) => changeUnit(event.target.value === "portion" ? "portion" : "g")}>
            <option value="g">grams (g)</option>
            {portion && <option value="portion">{portion.label} · {formatAmount(portion.grams)} g</option>}
          </select></label>
          <label>Meal<select className="fitx-field" value={meal} onChange={(event) => setMeal(event.target.value)}>{MEAL_SLOTS.map((slot) => <option key={slot}>{slot}</option>)}</select></label>
          <label>Date<input className="fitx-field" type="date" value={date} onChange={(event) => setDate(event.target.value)}/></label>
          <p className={`${styles.hint} ${styles.wide}`}>
            {macros ? `= ${formatAmount(grams)} g · ${Math.round(macros.calories)} kcal · P ${macros.protein} g · C ${macros.carbs} g · F ${macros.fat} g` : per100 ? "Enter an amount." : "Only the meal and date of this older entry can change."}
          </p>
          {problem && <p role="alert" className={`${styles.warning} ${styles.wide}`}>{problem}</p>}
          <div className={`${styles.dialogActions} ${styles.wide}`}>
            <button type="button" onClick={onCancel} className="fitx-button fitx-button-secondary">Cancel</button>
            <button type="submit" disabled={busy} className="fitx-button">{busy ? "Saving…" : "Save changes"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
