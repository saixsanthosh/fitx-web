import { formatAmount } from "@/lib/domain/food-query";
import type { FoodPortion } from "@/lib/domain/food-query";
import type { FoodMacros } from "@/lib/domain/nutrition";
import type { FoodResult } from "@/lib/food/types";
import { PortionEstimateBadge } from "./FoodBadges";
import styles from "./FoodUi.module.css";

export interface AmountPrompt {
  message: string;
  actions: Array<{ label: string; run: () => void }>;
}

interface PortionPickerProps {
  food: FoodResult;
  amount: string;
  unitKey: string;
  options: FoodPortion[];
  /** A volume weight worked out from another USDA measure (1 teaspoon from the tablespoon). */
  derived: { portion: FoodPortion; from: FoodPortion } | null;
  chosen: FoodPortion | null;
  grams: number;
  macros: FoodMacros | null;
  prompt: AmountPrompt | null;
  onAmount: (value: string) => void;
  onUnit: (key: string) => void;
  idPrefix?: string;
}

/** Amount and unit with the live grams and nutrition, and an honest note when the grams are an estimate. */
export function PortionPicker({ food, amount, unitKey, options, derived, chosen, grams, macros, prompt, onAmount, onUnit, idPrefix = "portion" }: PortionPickerProps) {
  const noteId = `${idPrefix}-note`;
  return (
    <>
      <div className={styles.macroTiles} aria-label="Nutrition for this amount">
        <div>{macros ? Math.round(macros.calories) : "–"}<span>kcal</span></div>
        <div>{macros ? `${macros.protein} g` : "–"}<span>protein</span></div>
        <div>{macros ? `${macros.carbs} g` : "–"}<span>carbs</span></div>
        <div>{macros ? `${macros.fat} g` : "–"}<span>fat</span></div>
      </div>
      <div className={styles.amountRow}>
        <label>Amount<input className="fitx-field" inputMode="decimal" type="number" min="0" step="any" value={amount} onChange={(event) => onAmount(event.target.value)} aria-describedby={noteId}/></label>
        <label>Unit<select className="fitx-field" value={unitKey} onChange={(event) => onUnit(event.target.value)}>
          <option value="g">grams (g)</option>
          {options.map((portion, index) => <option key={`${portion.label}-${index}`} value={`portion:${index}`}>{portion.label} · {formatAmount(portion.grams)} g</option>)}
        </select></label>
      </div>
      <p id={noteId} className={styles.portionNote}>
        {grams > 0 ? <>
          <span>= <strong>{formatAmount(grams)} g</strong></span>
          {chosen && (chosen.estimate === false
            ? <span>{food.kind === "custom" ? "your saved serving" : "serving from the package label"}</span>
            : <PortionEstimateBadge/>)}
        </> : <span>Enter an amount</span>}
      </p>
      {chosen && chosen.estimate !== false && <p className={styles.portionSource}>
        {derived && chosen === derived.portion
          ? `Worked out from USDA's ${derived.from.label} = ${formatAmount(derived.from.grams)} g (US measures).`
          : `USDA average for ${chosen.label}: ${formatAmount(chosen.grams)} g.`} Real pieces and cups vary; weigh it for an exact log.
      </p>}
      {prompt && <div className={styles.prompt} role="status">
        <p>{prompt.message}</p>
        {prompt.actions.length > 0 && <div className={styles.promptActions}>
          {prompt.actions.map((action) => <button key={action.label} type="button" className="fitx-button fitx-button-secondary min-h-10 px-3 text-xs" onClick={action.run}>{action.label}</button>)}
        </div>}
      </div>}
    </>
  );
}
