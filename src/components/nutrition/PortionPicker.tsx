"use client";

import { Minus, Plus } from "lucide-react";
import { Segmented } from "@/components/ui/Segmented";
import { formatAmount, stepAmount, stepKindOf } from "@/lib/domain/food-query";
import type { FoodPortion, FoodUnit } from "@/lib/domain/food-query";
import type { FoodMacros, MacroKey } from "@/lib/domain/nutrition";
import { amountMode, countMode, pieceSizeLabel } from "@/lib/food/pieces";
import type { FoodResult } from "@/lib/food/types";
import { FITX_RECIPE_SOURCE } from "@/lib/food/value-basis";
import { PortionEstimateBadge } from "./FoodBadges";
import styles from "./FoodUi.module.css";

export interface AmountPrompt {
  message: string;
  actions: Array<{ label: string; run: () => void }>;
  /** What was typed ("2" small eggs), so picking a measure of that kind under Unit keeps the count. */
  typed?: { amount: number; unit: FoodUnit | null };
}

interface PortionPickerProps {
  food: FoodResult;
  amount: string;
  unitKey: string;
  /** The food's own portions, then the measures worked out for it (ml, cups, katori), then any worked out from typing. */
  options: FoodPortion[];
  chosen: FoodPortion | null;
  grams: number;
  macros: FoodMacros | null;
  prompt: AmountPrompt | null;
  onAmount: (value: string) => void;
  onUnit: (key: string) => void;
  /** Opens the dialog where the member sets the size of their katori and bowl. */
  onMeasures?: () => void;
  idPrefix?: string;
}

const MACRO_TILES: Array<[MacroKey, string]> = [["protein", "protein"], ["carbs", "carbs"], ["fat", "fat"]];

/** Amount (typed, or stepped up and down) and unit with the live grams and nutrition, and an honest note when the grams are an estimate. */
export function PortionPicker({ food, amount, unitKey, options, chosen, grams, macros, prompt, onAmount, onUnit, onMeasures, idPrefix = "portion" }: PortionPickerProps) {
  const noteId = `${idPrefix}-note`;
  const kind = stepKindOf(chosen?.unit ?? null);
  const step = (direction: 1 | -1) => onAmount(formatAmount(stepAmount(Number(amount), direction, kind)));
  const hasVolume = options.some((portion) => portion.unit === "ml" || portion.vessel);
  const hasVessel = options.some((portion) => portion.vessel);
  // Pieces only where the food's own data weighs one (USDA, the label, your saved serving); otherwise grams, and why.
  const counting = countMode(food, options);
  const entry = amountMode(unitKey, counting);
  const switchTo = (next: "pieces" | "grams" | "other") => {
    if (counting.kind !== "pieces" || next === entry) return;
    if (next === "grams") { onUnit("g"); return; }
    const piece = options[counting.preferred];
    onUnit(`portion:${counting.preferred}`);
    // From grams to pieces: a whole number of pieces, the nearest to what was there.
    const typedGrams = entry === "grams" ? Number(amount) : Number.NaN;
    onAmount(String(Number.isFinite(typedGrams) && typedGrams > 0 ? Math.max(1, Math.round(typedGrams / piece.grams)) : 1));
  };
  return (
    <>
      {counting.kind === "pieces" && <div className={styles.countBar}>
        <Segmented<"pieces" | "grams" | "other"> label="Count in" value={entry} onChange={switchTo} block
          options={[{ value: "pieces", label: "Pieces" }, { value: "grams", label: "Grams" }]}/>
        {entry === "pieces" && counting.indices.length > 1 && <div role="group" aria-label="Piece size" className={styles.chips}>
          {counting.indices.map((index) => (
            <button key={index} type="button" className={styles.chip} aria-pressed={unitKey === `portion:${index}`} onClick={() => onUnit(`portion:${index}`)}>{pieceSizeLabel(options[index])}</button>
          ))}
        </div>}
      </div>}
      {counting.kind === "grams-only" && <p className={styles.gramsOnly}>{counting.reason}</p>}
      <div className={styles.macroTiles} aria-label="Nutrition for this amount">
        <div>{macros ? Math.round(macros.calories) : "–"}<span>kcal</span></div>
        {MACRO_TILES.map(([key, label]) => (
          <div key={key}>{!macros ? "–" : food.missing?.includes(key) ? <span className={styles.unknownTile}>unknown</span> : `${macros[key]} g`}<span>{label}</span></div>
        ))}
      </div>
      <div className={styles.amountRow}>
        <div className={styles.amountField}>
          <label htmlFor={`${idPrefix}-amount`}>Amount</label>
          <div className={styles.stepper}>
            <button type="button" onClick={() => step(-1)} aria-label="Decrease amount" className={styles.stepButton}><Minus size={16}/></button>
            <input id={`${idPrefix}-amount`} className="fitx-field" inputMode="decimal" type="number" min="0" step="any" value={amount} onChange={(event) => onAmount(event.target.value)} aria-describedby={noteId}/>
            <button type="button" onClick={() => step(1)} aria-label="Increase amount" className={styles.stepButton}><Plus size={16}/></button>
          </div>
        </div>
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
        {chosen.vessel
          ? `A ${chosen.unit} is taken as ${formatAmount(chosen.vessel.ml)} ml (${chosen.vessel.custom ? "the size you set" : "FITX's working size, not a standard"}), weighed with this food's USDA ${chosen.derivedFrom?.label ?? "measure"} = ${formatAmount(chosen.derivedFrom?.grams ?? 0)} g.`
          : chosen.derivedFrom
            ? `Worked out from USDA's ${chosen.derivedFrom.label} = ${formatAmount(chosen.derivedFrom.grams)} g (US measures).`
            : food.source === FITX_RECIPE_SOURCE
              ? `One serving is FITX's whole recipe: ${formatAmount(chosen.grams)} g of ingredients.`
              : `USDA average for ${chosen.label}: ${formatAmount(chosen.grams)} g.`} Real pieces and cups vary; weigh it for an exact log.
      </p>}
      {!hasVolume && <p className={styles.portionSource}>No ml, cup or katori: the source has no volume measure for this food.</p>}
      {hasVessel && onMeasures && <button type="button" id={`${idPrefix}-measures`} className={styles.textButton} onClick={onMeasures}>Set my katori and bowl sizes</button>}
      {prompt && <div className={styles.prompt} role="status">
        <p>{prompt.message}</p>
        {prompt.actions.length > 0 && <div className={styles.promptActions}>
          {prompt.actions.map((action) => <button key={action.label} type="button" className="fitx-button fitx-button-secondary min-h-10 px-3 text-xs" onClick={action.run}>{action.label}</button>)}
        </div>}
      </div>}
    </>
  );
}
