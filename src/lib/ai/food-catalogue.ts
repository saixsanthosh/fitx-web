import "server-only";
import { inferFoodState, rankFoods } from "@/lib/domain/food-query";
import type { FoodPortion, FoodState } from "@/lib/domain/food-query";
import type { MacroKey } from "@/lib/domain/nutrition";
import { FITX_CATALOGUE_SOURCE, type RankableFood } from "@/lib/food/catalog-search";
import type { ValueBasis } from "@/lib/food/types";

/**
 * The same local food data the Nutrition search uses (src/app/api/foods/search/route.ts): FITX's
 * curated USDA staples first, then USDA Foundation Foods, ranked with the shared food-query logic.
 * The data is passed in (food-data.ts loads the JSON files), so this module runs under `node --test`.
 *
 * Kept in step with the search route by hand for now; see the hand-over note about moving both onto
 * one shared module.
 */

export type CatalogueFood = {
  id: string;
  name: string;
  brand: string | null;
  image: string | null;
  /** Per 100 g. */
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  /** "FITX food catalogue" once Admin added the food or changed its values (it has no USDA record then). */
  source: "USDA FoodData Central" | "Open Food Facts" | typeof FITX_CATALOGUE_SOURCE;
  dataType: string | null;
  /** What the values are, in the words the Nutrition page shows. */
  basis: string;
  state: FoodState | null;
  portions: FoodPortion[];
  aliases?: string[];
  /** Set for a FITX catalogue food: what its values are (a USDA food's follow from its data type). */
  valueBasis?: ValueBasis;
  /**
   * Protein, carbs or fat a live lookup's source left blank (an Open Food Facts label, a USDA record without the
   * nutrient): unknown, held as 0 above only so the type stays numeric. Grounding never plans with such a food
   * (grounding.ts). FITX's own catalogue foods have every value, so theirs is never set.
   */
  missing?: readonly MacroKey[];
};

type StapleFile = {
  foods: Array<{ id: string; name: string; dataType: string; state: string | null; aliases?: string[]; calories: number; protein: number; carbs: number; fat: number; portions: unknown[] }>;
};
type FoundationFood = { id: string; name: string; brand?: string | null; image?: string | null; calories: number; protein: number; carbs: number; fat: number };

/** The same wording as the search route. */
export const BASIS: Record<string, string> = {
  "Survey (FNDDS)": "USDA typical recipe",
  "SR Legacy": "USDA reference values",
  Foundation: "USDA lab analysis",
  Branded: "Package label (USDA Branded Foods)",
};

export function buildCatalogue(staples: StapleFile, foundation: readonly FoundationFood[]): CatalogueFood[] {
  const curated: CatalogueFood[] = staples.foods.map((food) => ({
    id: food.id,
    name: food.name,
    brand: null,
    image: null,
    calories: food.calories,
    protein: food.protein,
    carbs: food.carbs,
    fat: food.fat,
    source: "USDA FoodData Central",
    dataType: food.dataType,
    basis: BASIS[food.dataType] ?? "USDA FoodData Central",
    state: (food.state as FoodState | null) ?? null,
    portions: food.portions as FoodPortion[],
    aliases: food.aliases,
  }));
  const lab: CatalogueFood[] = foundation.map((food) => ({
    id: food.id,
    name: food.name,
    brand: food.brand ?? null,
    image: food.image ?? null,
    calories: food.calories,
    protein: food.protein,
    carbs: food.carbs,
    fat: food.fat,
    source: "USDA FoodData Central",
    dataType: "Foundation",
    basis: BASIS.Foundation,
    state: inferFoodState(food.name),
    portions: [],
  }));
  // Curated staples first: on equal matches they win, as in the search route.
  return [...curated, ...lab];
}

/**
 * The bundled foods as the catalogue has them now (src/lib/food/catalogue-copies.ts): Admin's corrections,
 * renames and portions win, and a food Admin hid is left out. Bundled everyday names stay, so matching still works.
 */
export function withCatalogueRows(catalogue: readonly CatalogueFood[], copies: ReadonlyMap<string, RankableFood>): CatalogueFood[] {
  return catalogue.flatMap((food) => {
    const row = copies.get(food.id);
    if (!row) return [];
    // A food Admin made FITX's own has no USDA data type: it is credited to the FITX catalogue, never to USDA.
    const own = row.source === FITX_CATALOGUE_SOURCE;
    const dataType = own ? null : row.dataType ?? food.dataType;
    return [{
      ...food,
      name: row.name,
      calories: row.calories,
      protein: row.protein,
      carbs: row.carbs,
      fat: row.fat,
      source: own ? FITX_CATALOGUE_SOURCE : food.source,
      dataType,
      basis: own ? row.basis : (dataType && BASIS[dataType]) || food.basis,
      ...(own ? { valueBasis: row.valueBasis } : {}),
      state: row.state ?? food.state,
      portions: row.portions ?? [],
      aliases: [...new Set([...(row.aliases ?? []), ...(food.aliases ?? [])])],
    }];
  });
}

/** Ranked matches for some food words, best first (every word must match, as in Nutrition search). */
export function searchCatalogue(catalogue: readonly CatalogueFood[], words: readonly string[], limit = 6): CatalogueFood[] {
  return words.length ? rankFoods(catalogue, words).slice(0, limit) : [];
}
