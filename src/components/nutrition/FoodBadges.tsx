import type { FoodState } from "@/lib/domain/food-query";
import type { DietType, ValueBasis } from "@/lib/food/types";
import { basisInfo, DIET_LABEL, PORTION_ESTIMATE } from "@/lib/food/value-basis";
import styles from "./FoodUi.module.css";

/** How the values were obtained: measured or declared values look different from estimates. */
export function BasisBadge({ basis, label }: { basis: ValueBasis; label?: string }) {
  const info = basisInfo(basis);
  const className = basis === "user_entered" ? styles.badgeYours : info.estimate ? styles.badgeEstimate : styles.badgeMeasured;
  return <span className={className} title={info.detail}>{label ?? info.label}{info.estimate ? " · estimate" : ""}</span>;
}

/** The amount came from an average piece, cup or spoon weight. */
export function PortionEstimateBadge({ detail }: { detail?: string }) {
  return <span className={styles.badgeEstimate} title={detail ?? PORTION_ESTIMATE.detail}>{PORTION_ESTIMATE.label}</span>;
}

export function DietBadge({ diet }: { diet: DietType | null | undefined }) {
  if (!diet) return null;
  const className = diet === "non_veg" ? styles.dietNonVeg : diet === "egg" ? styles.dietEgg : styles.dietVeg;
  const detail = "From USDA's ingredient list or FITX's check of it. Check the label if it matters to you.";
  return <span className={className} title={detail}><span className={styles.dot} aria-hidden="true"/>{DIET_LABEL[diet]}</span>;
}

export function StateTag({ state }: { state: FoodState | null | undefined }) {
  if (!state) return null;
  return <span className={state === "cooked" ? styles.tagCooked : styles.tagRaw}>{state === "cooked" ? "Cooked" : "Raw"}</span>;
}
