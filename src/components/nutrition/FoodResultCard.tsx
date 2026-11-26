import Image from "next/image";
import { formatAmount, portionName } from "@/lib/domain/food-query";
import type { FoodResult } from "@/lib/food/types";
import { FITX_RECIPE_SOURCE } from "@/lib/food/value-basis";
import { BasisBadge, DietBadge, StateTag } from "./FoodBadges";
import styles from "./FoodUi.module.css";

/**
 * One search result: name, where the values come from, raw or cooked, a typical piece, and kcal per 100 g.
 * `dietUnchecked` marks a food without a diet label while the diet filter is on, since the filter can't hide it.
 * `card` names this entry of the list (data-food-card), so the focus can come back to it after Back to results.
 */
export function FoodResultCard({ food, active, dietUnchecked = false, card, onSelect }: { food: FoodResult; active: boolean; dietUnchecked?: boolean; card?: string; onSelect: (food: FoodResult) => void }) {
  const piece = food.portions.find((portion) => portion.countDefault) ?? food.portions[0];
  // Who the values come from; the badge says how. A FITX recipe estimate is FITX's own, as a USDA food is "USDA".
  const meta = [food.brand, food.kind === "custom" ? "Your food" : food.source === "Open Food Facts" ? "Open Food Facts" : food.kind === "catalog" && food.source === "USDA FoodData Central" ? "USDA" : food.source === FITX_RECIPE_SOURCE ? "FITX" : food.source]
    .filter(Boolean)
    .join(" · ");
  return (
    <button type="button" onClick={() => onSelect(food)} aria-pressed={active} data-food-card={card} className={`${styles.foodResult} ${active ? styles.foodResultActive : ""}`}>
      {food.image && <Image src={food.image} alt="" width={44} height={44} className={styles.thumb} unoptimized loading="lazy"/>}
      <span className={styles.foodResultMain}>
        <span className={styles.foodName}>{food.name}</span>
        <span className={styles.foodMeta}>{meta}{food.recentCount > 0 ? " · logged recently" : ""}{food.suggestion ? " · similar spelling" : ""}</span>
        <span className={styles.foodTags}>
          <BasisBadge basis={food.valueBasis} source={food.source}/>
          <StateTag state={food.state}/>
          <DietBadge diet={food.dietType}/>
          {dietUnchecked && <span className={styles.tag} title="FITX has no diet label for this food, so the diet filter can't hide it. Check its ingredients.">Diet not checked</span>}
          {piece && <span className={styles.tag}>{portionName(piece)} · {formatAmount(piece.grams)} g</span>}
        </span>
        <span className={styles.foodMacros}>{(["protein", "carbs", "fat"] as const).map((key) => `${key[0].toUpperCase()} ${food.missing?.includes(key) ? "unknown" : `${formatAmount(food[key])} g`}`).join(" · ")}</span>
      </span>
      <span className={styles.foodKcal}>{Math.round(food.calories)}<small>kcal / 100 g</small></span>
    </button>
  );
}
