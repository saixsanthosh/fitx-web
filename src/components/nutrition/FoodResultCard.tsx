import Image from "next/image";
import { formatAmount } from "@/lib/domain/food-query";
import type { FoodResult } from "@/lib/food/types";
import { BasisBadge, DietBadge, StateTag } from "./FoodBadges";
import styles from "./FoodUi.module.css";

/** One search result: name, where the values come from, raw or cooked, a typical piece, and kcal per 100 g. */
export function FoodResultCard({ food, active, onSelect }: { food: FoodResult; active: boolean; onSelect: (food: FoodResult) => void }) {
  const piece = food.portions.find((portion) => portion.countDefault) ?? food.portions[0];
  const meta = [food.brand, food.kind === "custom" ? "Your food" : food.source === "Open Food Facts" ? "Open Food Facts" : food.kind === "catalog" ? "USDA" : food.source]
    .filter(Boolean)
    .join(" · ");
  return (
    <button type="button" onClick={() => onSelect(food)} aria-pressed={active} className={`${styles.foodResult} ${active ? styles.foodResultActive : ""}`}>
      {food.image && <Image src={food.image} alt="" width={44} height={44} className={styles.thumb} unoptimized loading="lazy"/>}
      <span className={styles.foodResultMain}>
        <span className={styles.foodName}>{food.name}</span>
        <span className={styles.foodMeta}>{meta}{food.recentCount > 0 ? " · logged recently" : ""}{food.suggestion ? " · similar spelling" : ""}</span>
        <span className={styles.foodTags}>
          <BasisBadge basis={food.valueBasis}/>
          <StateTag state={food.state}/>
          <DietBadge diet={food.dietType}/>
          {piece && <span className={styles.tag}>{piece.label} · {formatAmount(piece.grams)} g</span>}
        </span>
        <span className={styles.foodMacros}>P {formatAmount(food.protein)} g · C {formatAmount(food.carbs)} g · F {formatAmount(food.fat)} g</span>
      </span>
      <span className={styles.foodKcal}>{Math.round(food.calories)}<small>kcal / 100 g</small></span>
    </button>
  );
}
