import { formatAmount } from "@/lib/domain/food-query";
import { macroEnergySplit, MACRO_LABEL, scaleMacros, scaleNutrient, type MacroKey } from "@/lib/domain/nutrition";
import type { FoodResult } from "@/lib/food/types";
import { SegmentRing } from "./SegmentRing";
import styles from "./FoodUi.module.css";

const ORDER: MacroKey[] = ["carbs", "protein", "fat"];

/** The sentence that says which values the source lacks, or "" when it lists all three. */
export function missingSentence(food: Pick<FoodResult, "missing">, where = "label"): string {
  const missing = ORDER.filter((key) => food.missing?.includes(key));
  if (!missing.length) return "";
  const names = missing.map((key) => MACRO_LABEL[key]);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  return `This ${where} doesn't list ${list}, so FITX can't count ${names.length > 1 ? "them" : "it"}. ${names.length > 1 ? "They are" : "It is"} left out of your totals, not logged as 0 g.`;
}

/**
 * A food's calories for the chosen amount in a ring whose arcs are the share of energy from carbs, protein and fat
 * (4, 4 and 9 kcal per gram of what the source lists), with each macro's amount beside it. A macro the source does
 * not give is shown as unknown and left out of the split. The ring is described in full for screen readers.
 */
export function ProductSummary({ food, grams }: { food: FoodResult; grams: number }) {
  const valid = Number.isFinite(grams) && grams > 0;
  const kcal = valid ? Math.round(scaleMacros(food, grams).calories) : null;
  const amount = (key: MacroKey) => (valid && !food.missing?.includes(key) ? scaleNutrient(food[key], grams) : null);
  const values = { protein: amount("protein"), carbs: amount("carbs"), fat: amount("fat") };
  const split = macroEnergySplit(values);
  const label = !valid ? "Choose an amount to see the calories" : [
    `${kcal} kilocalories for ${formatAmount(grams)} grams`,
    ...ORDER.map((key) => (values[key] === null ? `${MACRO_LABEL[key]} not listed` : `${formatAmount(values[key])} grams ${MACRO_LABEL[key]}${split?.share[key] != null ? `, ${split.share[key]} percent of the energy` : ""}`)),
  ].join(". ");
  return (
    <div className={styles.summary}>
      <div role="img" aria-label={label}>
        <SegmentRing segments={split ? ORDER.map((key) => ({ percent: split.share[key] ?? 0, tone: key })) : []}>
          <strong className={styles.ringValue}>{kcal ?? "–"}</strong>
          <span className={styles.ringUnit}>kcal</span>
        </SegmentRing>
      </div>
      <ul className={styles.legend} aria-hidden="true">
        {ORDER.map((key) => (
          <li key={key}>
            <span className={`${styles.swatch} ${styles[`swatch_${key}`]}`} />
            <span className={styles.legendName}>{MACRO_LABEL[key][0].toUpperCase() + MACRO_LABEL[key].slice(1)}</span>
            <strong>{values[key] === null ? <span className={styles.unknown}>{valid ? "not listed" : "–"}</span> : `${formatAmount(values[key])} g`}</strong>
            {split?.share[key] != null && <small>{split.share[key]}% of energy</small>}
          </li>
        ))}
      </ul>
    </div>
  );
}
