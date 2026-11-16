/**
 * For the AI coach's "Add to My Food Plan": turns a FITX catalogue food (a public.food_catalog row, or a search
 * result) into a public.custom_foods row with origin "ai_coach". The values are copied from the catalogue, so the
 * AI never supplies nutrition numbers; the AI only chooses the food and, optionally, one of its portions.
 *
 * Insert the result with the signed-in user's client (row-level security limits it to their own foods):
 *   await supabase.from("custom_foods").insert({ user_id, ...customFoodFromCatalog(food, portion) });
 * Needs migration 20261118140001 (origin, value_basis and source_ref columns).
 */
import type { FoodResult, ValueBasis } from "@/lib/food/types";

export interface CatalogFoodLike {
  id: string;
  name: string;
  /** Per 100 g. */
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  value_basis: ValueBasis | string;
}

const CATALOG_BASES = new Set(["lab_analysed", "compiled", "recipe_calculated", "label", "estimated"]);

export function customFoodFromCatalog(food: CatalogFoodLike | FoodResult, portion?: { label: string; grams: number } | null) {
  const values = "kcal" in food
    ? { calories: food.kcal, protein: food.protein_g, carbs: food.carbs_g, fat: food.fat_g, basis: food.value_basis }
    : { calories: food.calories, protein: food.protein, carbs: food.carbs, fat: food.fat, basis: food.valueBasis };
  if (![values.calories, values.protein, values.carbs, values.fat].every((value) => Number.isFinite(Number(value)) && Number(value) >= 0)) {
    throw new Error(`Catalogue food ${food.id} has no usable values.`);
  }
  const grams = portion && portion.grams > 0 && portion.grams <= 5000 ? Math.round(portion.grams * 100) / 100 : 100;
  return {
    name: food.name.slice(0, 160),
    brand: null,
    serving_size: portion ? portion.label.slice(0, 60) : "100 g",
    serving_grams: grams,
    calories_per_100g: Number(values.calories),
    protein_per_100g: Number(values.protein),
    carbs_per_100g: Number(values.carbs),
    fat_per_100g: Number(values.fat),
    origin: "ai_coach" as const,
    value_basis: (CATALOG_BASES.has(String(values.basis)) ? values.basis : "estimated") as ValueBasis,
    source_ref: food.id,
  };
}
