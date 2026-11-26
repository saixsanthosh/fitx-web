"use client";

import { useEffect, useRef, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { describePortion, formatAmount, portionName } from "@/lib/domain/food-query";
import type { FoodPortion } from "@/lib/domain/food-query";
import { scaleMacros } from "@/lib/domain/nutrition";
import { entryPer100g, type MealEntry, type MealSnapshot } from "@/lib/food/client-data";
import styles from "./FoodUi.module.css";

export interface EntryChange {
  grams: number;
  servingSize: string;
  portion: MealSnapshot["portion"] | null;
  meal: string;
  date: string;
}

/**
 * Edits a logged entry: amount (grams or the portion it was logged with), meal and date. A modal Sheet (native
 * dialog): focus starts on the amount, stays inside, Escape closes, and focus goes back to the entry's pencil.
 */
export function EntryEditor({ entry, busy, sections, onCancel, onSave }: {
  entry: MealEntry;
  busy: boolean;
  sections: readonly string[];
  onCancel: () => void;
  /** Resolves to why the change was refused, shown here in the dialog, or null. */
  onSave: (change: EntryChange) => Promise<string | null>;
}) {
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
  const mealField = useRef<HTMLSelectElement>(null);
  const per100 = entryPer100g(entry);
  const count = Number(amount);
  const grams = Number.isFinite(count) ? Math.round(count * (unit === "portion" && portion ? portion.grams : 1) * 10) / 10 : Number.NaN;
  const macros = per100 && grams > 0 ? scaleMacros(per100, grams) : null;

  // The dialog is open by now (Sheet opens it in a layout effect): start on the first field that can change.
  useEffect(() => { (first.current?.disabled ? mealField.current : first.current)?.focus(); }, []);

  function changeUnit(next: "g" | "portion") {
    if (next === unit) return;
    if (portion && grams > 0) setAmount(formatAmount(next === "portion" ? grams / portion.grams : grams));
    setUnit(next);
  }

  async function save() {
    // Saving: a second press does nothing, and the button keeps the focus (it is never disabled under it).
    if (busy) return;
    // Older entries without per-100 g values keep their amount; only the meal and date change.
    const amountGrams = per100 ? grams : startGrams;
    if (!Number.isFinite(amountGrams) || amountGrams < 1 || amountGrams > 5000) { setProblem("Enter an amount that comes to between 1 and 5,000 grams."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setProblem("Choose a date."); return; }
    const usesPortion = per100 !== null && unit === "portion" && portion !== null;
    const refused = await onSave(!per100
      ? { grams: amountGrams, servingSize: entry.serving_size ?? `${formatAmount(amountGrams)} g`, portion: logged ?? null, meal, date }
      : {
        grams: amountGrams,
        servingSize: usesPortion && portion ? describePortion(count, portion, amountGrams) : `${formatAmount(amountGrams)} g`,
        portion: usesPortion && logged ? { ...logged, count } : null,
        meal,
        date,
      });
    // Refused: said here, inside the dialog, next to Save.
    if (refused) setProblem(refused);
  }

  return (
    <Sheet open onClose={onCancel} side="center" title="Edit entry" description={`${entry.food_name}${entry.brand ? ` · ${entry.brand}` : ""}`}>
      <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label>Amount<input ref={first} className="fitx-field" type="number" inputMode="decimal" min="0" step="any" value={amount} disabled={!per100} onChange={(event) => { setAmount(event.target.value); setProblem(""); }}/></label>
        <label>Unit<select className="fitx-field" value={unit} disabled={!per100 || !portion} onChange={(event) => changeUnit(event.target.value === "portion" ? "portion" : "g")}>
          <option value="g">grams (g)</option>
          {portion && <option value="portion">{portionName(portion)} · {formatAmount(portion.grams)} g</option>}
        </select></label>
        <label>Meal<select ref={mealField} className="fitx-field" value={meal} onChange={(event) => setMeal(event.target.value)}>{(sections.includes(entry.meal) ? sections : [...sections, entry.meal]).map((slot) => <option key={slot}>{slot}</option>)}</select></label>
        <label>Date<input className="fitx-field" type="date" value={date} onChange={(event) => setDate(event.target.value)}/></label>
        <p className={`${styles.hint} ${styles.wide}`}>
          {macros ? `= ${formatAmount(grams)} g · ${Math.round(macros.calories)} kcal · ${(["protein", "carbs", "fat"] as const).map((key) => `${key[0].toUpperCase()} ${per100?.missing.includes(key) ? "unknown" : `${macros[key]} g`}`).join(" · ")}` : per100 ? "Enter an amount." : "Only the meal and date of this older entry can change."}
        </p>
        {problem && <p role="alert" className={`${styles.warning} ${styles.wide}`}>{problem}</p>}
        <div className={`${styles.dialogActions} ${styles.wide}`}>
          <button type="button" onClick={onCancel} className="fitx-button fitx-button-secondary">Cancel</button>
          <button type="submit" aria-disabled={busy || undefined} className="fitx-button">{busy ? "Saving…" : "Save changes"}</button>
        </div>
      </form>
    </Sheet>
  );
}
