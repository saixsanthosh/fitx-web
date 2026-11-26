import { formatAmount } from "@/lib/domain/food-query";
import { scaleNutrient } from "@/lib/domain/nutrition";
import type { FoodResult } from "@/lib/food/types";
import styles from "./FoodUi.module.css";

/** Salt is sodium x 2.5; shown beside sodium so a label that lists salt reads the same way. */
const SALT_PER_SODIUM = 2.5;

/**
 * Every other nutrient the food has, for the chosen amount: fibre, sugars, saturated fat, sodium (with the salt it
 * equals). A value the food has none for says so (`missing`: "not listed by this label", or "unknown" for a food of
 * your own); it is never shown as 0.
 */
export function NutrientList({ food, grams, missing = "not listed" }: { food: FoodResult; grams: number; missing?: string }) {
  const valid = Number.isFinite(grams) && grams > 0;
  const g = (per100: number | null | undefined) => (valid ? scaleNutrient(per100, grams) : null);
  const sodium = valid ? scaleNutrient(food.sodiumMg, grams) : null;
  const rows: Array<{ label: string; value: string | null; note?: string }> = [
    { label: "Fibre", value: g(food.fiber) === null ? null : `${formatAmount(g(food.fiber) as number)} g` },
    { label: "Sugars", value: g(food.sugar) === null ? null : `${formatAmount(g(food.sugar) as number)} g` },
    { label: "Saturated fat", value: g(food.saturatedFat) === null ? null : `${formatAmount(g(food.saturatedFat) as number)} g` },
    {
      label: "Sodium",
      value: sodium === null ? null : `${formatAmount(sodium)} mg`,
      note: sodium === null ? undefined : `salt about ${formatAmount(Math.round((sodium * SALT_PER_SODIUM) / 10) / 100)} g${food.sodiumFromSalt ? " (the label gives salt)" : ""}`,
    },
  ];
  return (
    <dl className={styles.nutrients} aria-label="Other nutrients for this amount">
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value ?? <span className={styles.unknown}>{missing}</span>}{row.note && <small>{row.note}</small>}</dd>
        </div>
      ))}
    </dl>
  );
}
