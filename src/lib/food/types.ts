/** Shapes shared by the food search route and the nutrition page. No runtime code. */
import type { FoodPortion, FoodState } from "@/lib/domain/food-query";
import type { MacroKey } from "@/lib/domain/nutrition";

/**
 * How a food's values were obtained, shown as a badge so estimates are never mistaken for measurements:
 * - lab_analysed: USDA Foundation Foods, measured in a lab.
 * - compiled: USDA SR Legacy reference values.
 * - recipe_calculated: USDA FNDDS typical recipe (an estimate for any particular dish).
 * - label: a package's nutrition label (Open Food Facts community data, or what the user copied from a pack).
 * - user_entered: values the user typed.
 * - ai_suggested: values attached to an AI coach suggestion (looked up in FITX's food data when it has a match,
 *   otherwise the coach's own estimate, which the food's brand line marks as "AI estimate").
 * - estimated: anything else that is an estimate.
 */
export type ValueBasis = "lab_analysed" | "compiled" | "recipe_calculated" | "label" | "user_entered" | "ai_suggested" | "estimated";

/** Detected from a source's ingredient list, or hand-checked for the curated staples; null when unknown. */
export type DietType = "vegan" | "veg" | "egg" | "non_veg";

export type FoodKind = "catalog" | "custom" | "packaged";

export type CustomFoodOrigin = "user" | "barcode" | "ai_coach";

/** A food in search results. Calories, protein, carbs, fat, fibre and sugar are per 100 g; sodium in mg per 100 g. */
export interface FoodResult {
  id: string;
  kind: FoodKind;
  name: string;
  brand: string | null;
  image: string | null;
  /** Credit line for a third-party image, such as an Open Food Facts product photo (CC BY-SA). */
  imageCredit: string | null;
  /** Where to read more or correct the record (the Open Food Facts product page). */
  sourceUrl: string | null;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number | null;
  sugar: number | null;
  sodiumMg: number | null;
  source: string;
  /** FoodData Central data type ("Survey (FNDDS)", "SR Legacy", "Foundation", "Branded"); null otherwise. */
  dataType: string | null;
  valueBasis: ValueBasis;
  /** The value basis in the words the app shows. */
  basis: string;
  state: FoodState | null;
  dietType: DietType | null;
  portions: FoodPortion[];
  barcode: string | null;
  origin: CustomFoodOrigin | null;
  /** Saturated fat in g per 100 g; null or absent when the source does not give it. */
  saturatedFat?: number | null;
  /** Protein, carbs or fat the source leaves blank. Their numbers above are 0 only so sums work: show them as unknown and log them as NULL. */
  missing?: MacroKey[];
  /** The sodium figure was worked out from the label's salt (salt / 2.5). */
  sodiumFromSalt?: boolean;
  /** The serving as the label words it ("6 biscuits (27 g)", "250 ml"), shown as a fact under the name. */
  servingLabel?: string | null;
  /** For a FITX recipe estimate: the ingredients and what the estimate assumes. */
  recipeNote?: string | null;
  /** Why the label serving cannot be used directly (a serving given only in ml). */
  servingNote?: string | null;
  /** Times the user logged this food in the last 60 days, when the catalogue search knows it. */
  recentCount: number;
  /** A close spelling offered because nothing matched every word; never selected automatically. */
  suggestion: boolean;
}

/** fitx-catalog is the database catalogue; fitx-built-in the curated staples and USDA Foundation snapshot bundled with the app. */
export type SourceId = "fitx-catalog" | "fitx-built-in" | "my-foods" | "usda-live" | "open-food-facts";
export type SourceState = "ok" | "no_results" | "not_used" | "not_configured" | "not_set_up" | "error" | "timeout" | "rate_limited";
export interface SourceStatus {
  id: SourceId;
  label: string;
  status: SourceState;
  count: number;
}

/** What the search route answers. */
export interface FoodSearchResponse {
  foods: FoodResult[];
  sources: SourceStatus[];
  /** The one food that clearly matches what was typed, so the page can select it and fill in the amount. */
  pick: { source: string; id: string } | null;
  /** catalog: FITX's food catalogue in the database (with the built-in list for foods it lacks). fallback: the built-in list only, while the catalogue is not set up or not answering. */
  mode: "catalog" | "fallback" | "packaged" | "barcode" | "browse";
  /** For barcode lookups: why nothing usable came back. */
  barcodeStatus?: "found" | "not_found" | "no_label" | "invalid" | "rate_limited" | "unavailable" | "timeout";
  /** For barcode lookups without usable values: the product name, so the custom-food form can start from it. */
  productName?: string | null;
  error?: string;
}
