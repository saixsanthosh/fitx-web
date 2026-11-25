import Image from "next/image";
import { X } from "lucide-react";
import type { FoodPortion } from "@/lib/domain/food-query";
import type { FoodMacros } from "@/lib/domain/nutrition";
import type { FoodResult } from "@/lib/food/types";
import { BasisBadge, DietBadge, StateTag } from "./FoodBadges";
import { NutrientList } from "./NutrientList";
import { PortionPicker, type AmountPrompt } from "./PortionPicker";
import { missingSentence, ProductSummary } from "./ProductSummary";
import styles from "./FoodUi.module.css";

export const ADD_MEAL_VALUE = "__add-meal";

export interface FoodDetailProps {
  food: FoodResult;
  amount: string;
  unitKey: string;
  options: FoodPortion[];
  chosen: FoodPortion | null;
  grams: number;
  macros: FoodMacros | null;
  prompt: AmountPrompt | null;
  onAmount: (value: string) => void;
  onUnit: (key: string) => void;
  onMeasures?: () => void;
  /** Meal sections to pick from, and the chosen one. */
  sections: readonly string[];
  meal: string;
  onMeal: (meal: string) => void;
  onAddSection: () => void;
  /** "select" is the compact dropdown of the log panel; "chips" the one-tap chips of the product sheet. */
  mealControl: "select" | "chips";
  onClear?: () => void;
  idPrefix: string;
  /** Why the amount can't be logged, shown next to it while it is wrong. */
  amountProblem?: string | null;
}

/** Where the values came from, in plain words, with a link to the record when there is one. */
function sourceLine(food: FoodResult) {
  if (food.kind === "custom") return "Data source: your own food";
  if (food.source === "Open Food Facts") return "Data source: Open Food Facts (community-entered from the package label)";
  if (food.source === "FITX recipe estimate") return "Data source: FITX recipe estimate from USDA ingredients";
  return `Data source: ${food.source}${food.dataType ? ` · ${food.dataType}` : ""}`;
}

/**
 * Everything about the chosen food in one block, in the order a member logs it: name and badges; the amount (pieces or
 * grams where the food can be counted) and the meal; then the calorie ring with the macro split, every other nutrient
 * the product has, the label's serving and where the values come from.
 */
export function FoodDetail(props: FoodDetailProps) {
  const { food, grams, sections, meal, onMeal, onAddSection, mealControl } = props;
  const serving = food.portions.find((portion) => portion.unit === "serving" && portion.estimate === false);
  const pack = food.portions.find((portion) => portion.unit === "piece" && portion.estimate === false && /pack/i.test(portion.label));
  const facts = [
    food.servingLabel ? `Serving size on the label: ${food.servingLabel}` : serving ? `Serving: ${serving.label.replace(/^1 serving \((.*)\)$/, "$1")}` : null,
    pack ? `Pack: ${pack.label.replace(/^1 pack \((.*)\)$/, "$1")}` : null,
  ].filter(Boolean).join(" · ");
  const problem = missingSentence(food, food.source === "Open Food Facts" ? "label" : "source");
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        {food.image && <Image src={food.image} alt={`${food.name} package`} width={72} height={72} unoptimized className={styles.productImage}/>}
        <div className="min-w-0 flex-1">
          <p className="text-[17px] font-semibold leading-snug tracking-[-.01em]">{food.name}</p>
          <p className="mt-1 text-xs text-fitx-text-secondary">{food.brand ? `${food.brand} · ` : ""}{food.basis}</p>
          <p className="mt-1.5 flex flex-wrap gap-1"><BasisBadge basis={food.valueBasis} source={food.source}/><StateTag state={food.state}/><DietBadge diet={food.dietType}/></p>
        </div>
        {props.onClear && <button type="button" onClick={props.onClear} aria-label="Clear selected food" className={styles.iconButton}><X size={16}/></button>}
      </div>
      <PortionPicker food={food} amount={props.amount} unitKey={props.unitKey} options={props.options} chosen={props.chosen} grams={grams} macros={props.macros}
        prompt={props.prompt} onAmount={props.onAmount} onUnit={props.onUnit} onMeasures={props.onMeasures} idPrefix={props.idPrefix} amountProblem={props.amountProblem}/>
      {mealControl === "select"
        ? <label className="mt-3 block text-xs text-fitx-text-secondary">Meal<select id={`${props.idPrefix}-meal`} className="fitx-field mt-1.5" value={meal} onChange={(event) => (event.target.value === ADD_MEAL_VALUE ? onAddSection() : onMeal(event.target.value))}>
          {sections.map((name) => <option key={name}>{name}</option>)}
          <option value={ADD_MEAL_VALUE}>Add a meal…</option>
        </select></label>
        : <div role="group" aria-label="Meal" className="mt-3">
          <span className={styles.fieldLabel}>Meal</span>
          <div className={styles.chips}>
            {sections.map((name) => <button key={name} type="button" className={styles.chip} aria-pressed={meal === name} onClick={() => onMeal(name)}>{name}</button>)}
            <button type="button" className={styles.chip} onClick={onAddSection}>+ Add a meal</button>
          </div>
        </div>}
      <ProductSummary food={food} grams={grams}/>
      {problem && <p role="status" className={styles.callout}>{problem}</p>}
      <NutrientList food={food} grams={grams} source={food.source === "Open Food Facts" ? "this label" : "this source"}/>
      {facts && <p className={styles.factLine}>{facts}</p>}
      {food.servingNote && <p className={styles.factLine}>{food.servingNote}</p>}
      {food.recipeNote && <p className={styles.recipeNote}>{food.recipeNote}</p>}
      <p className={`${styles.credit} mt-3`}>
        {sourceLine(food)}
        {food.imageCredit && <> · {food.imageCredit}</>}
        {food.sourceUrl && <> · <a href={food.sourceUrl} target="_blank" rel="noopener noreferrer">product page</a></>}
      </p>
    </>
  );
}
