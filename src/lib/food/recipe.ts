/**
 * FITX recipe estimates: everyday regional dishes that FoodData Central does not list (curd rice, khichdi, chole...),
 * worked out from USDA values for their ingredients. The amounts of each ingredient are FITX's assumption of a typical
 * home portion, written down in src/data/fitx-staples.json and src/data/DATA_SOURCES.md, so the result is always an
 * estimate: a dish made with other proportions differs. Every ingredient is a USDA FoodData Central record already in
 * FITX's data; tests/nutrition/recipe.test.ts checks each one against that record.
 * Only already-cooked or ready ingredients are used, so the weights add up without a guess at cooking losses.
 * Pure, with no runtime imports of its own, so the search route, the tests and `node --test` all load it.
 */
import type { FoodPortion } from "@/lib/domain/food-query";
import type { FoodMacros } from "@/lib/domain/nutrition";

export interface RecipeIngredient {
  /** The USDA FoodData Central id, or null for plain water. */
  fdcId: string | null;
  name: string;
  /** Grams of this ingredient in one serving of the dish. */
  grams: number;
  /** USDA's values per 100 g for this ingredient. */
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface RecipeDef {
  id: string;
  name: string;
  aliases: string[];
  state: "cooked" | "raw" | null;
  /** Checked by hand against the ingredients: no meat, fish or egg. */
  diet: "veg" | "vegan";
  /** What the estimate leaves out or assumes, in one sentence for the food's page. */
  note: string;
  ingredients: RecipeIngredient[];
}

export interface RecipeFood extends FoodMacros {
  servingGrams: number;
  /** "150 g cooked rice + 100 g plain yogurt", the line shown under the name. */
  summary: string;
  portion: FoodPortion;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/** Per-100 g values of the whole dish (the ingredients' energy and macros added up over the dish's weight). */
export function recipeValues(recipe: RecipeDef): RecipeFood {
  const total = recipe.ingredients.reduce((sum, item) => sum + item.grams, 0);
  if (!(total > 0)) throw new Error(`${recipe.id} has no ingredients`);
  const share = (pick: (item: RecipeIngredient) => number) => recipe.ingredients.reduce((sum, item) => sum + (pick(item) * item.grams) / 100, 0) / total * 100;
  return {
    calories: Math.round(share((item) => item.calories)),
    protein: round1(share((item) => item.protein)),
    carbs: round1(share((item) => item.carbs)),
    fat: round1(share((item) => item.fat)),
    servingGrams: total,
    summary: recipe.ingredients.map((item) => `${item.grams} g ${item.name.toLowerCase()}`).join(" + "),
    portion: { label: `1 serving (FITX recipe, ${total} g)`, unit: "serving", grams: total, countDefault: true, estimate: true },
  };
}
