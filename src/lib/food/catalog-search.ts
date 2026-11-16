/**
 * Food search ranking for the search route: FITX catalogue rows (from public.search_foods) or, until the catalogue
 * migrations are applied, the built-in list (src/lib/food/local-catalog.ts), plus the user's own custom foods.
 * Pure functions, so the tests can run them.
 */
import { clearMatch, inferFoodState, matchFoods, singular } from "@/lib/domain/food-query";
import type { FoodPortion } from "@/lib/domain/food-query";
import type { CustomFoodOrigin, DietType, FoodResult, ValueBasis } from "@/lib/food/types";
import { basisForDataType, basisInfo } from "@/lib/food/value-basis";

export const USDA_SOURCE = "USDA FoodData Central";
export const CUSTOM_SOURCE = "FITX custom food";

/** A result plus what ranking needs: names it answers to exactly, and words that only help find it. */
export type RankableFood = FoodResult & { aliases?: string[]; keywords?: string[] };

function usdaFood(fields: Pick<FoodResult, "id" | "name" | "calories" | "protein" | "carbs" | "fat" | "state" | "portions" | "dataType"> & Partial<RankableFood>): RankableFood {
  const valueBasis = basisForDataType(fields.dataType);
  return {
    kind: "catalog",
    brand: null,
    image: null,
    imageCredit: null,
    sourceUrl: `https://fdc.nal.usda.gov/food-details/${fields.id}/nutrients`,
    fiber: null,
    sugar: null,
    sodiumMg: null,
    source: USDA_SOURCE,
    valueBasis,
    basis: basisInfo(valueBasis).label,
    dietType: null,
    barcode: null,
    origin: null,
    recentCount: 0,
    suggestion: false,
    ...fields,
  };
}

interface StapleJson {
  foods: Array<{ id: string; name: string; dataType: string; state: string | null; aliases: string[]; calories: number; protein: number; carbs: number; fat: number; portions: unknown[] }>;
}
type FoundationJson = Array<{ id: string; name: string; calories: number; protein: number; carbs: number; fat: number }>;

/**
 * The built-in list from src/data/fitx-staples.json and src/data/usda-foundation-foods.json: the curated staples
 * first, so they win ties ("rice" means cooked rice), then the Foundation foods they do not repeat.
 */
export function localFoodsFrom(staplesJson: StapleJson, foundationJson: FoundationJson) {
  const staples: RankableFood[] = staplesJson.foods.map((food) => usdaFood({
    id: food.id,
    name: food.name,
    calories: food.calories,
    protein: food.protein,
    carbs: food.carbs,
    fat: food.fat,
    dataType: food.dataType,
    state: food.state === "raw" || food.state === "cooked" ? food.state : null,
    portions: food.portions as FoodPortion[],
    aliases: food.aliases,
  }));
  const stapleIds = new Set(staples.map((food) => food.id));
  const foundation = foundationJson
    .filter((food) => !stapleIds.has(food.id))
    .map((food) => usdaFood({ ...food, dataType: "Foundation", state: inferFoodState(food.name), portions: [] }));
  return { staples, all: [...staples, ...foundation] };
}

/**
 * What the database matches each typed word against: the part every spelling of the word shares, so "idlis"
 * finds "idli" and "berries" finds "strawberries".
 */
export function stemsFor(words: readonly string[]): string[] {
  return [...new Set(words.map((word) => {
    const forms = [word, singular(word), word.endsWith("ies") ? word.slice(0, -1) : word];
    let stem = forms[0];
    for (const form of forms) while (!form.startsWith(stem)) stem = stem.slice(0, -1);
    return stem.length >= 2 ? stem : word;
  }))];
}

type Row = Record<string, unknown>;
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const num = (value: unknown) => (value === null || value === undefined || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null);
const DIETS = new Set(["vegan", "veg", "egg", "non_veg"]);
const BASES = new Set(["lab_analysed", "compiled", "recipe_calculated", "label", "user_entered", "ai_suggested", "estimated"]);
const UNITS = new Set(["piece", "slice", "serving", "cup", "tbsp", "tsp", "ml", "l", "floz", "katori", "bowl", "plate", "glass"]);

/** A public.search_foods row as a result. */
export function searchRowToFood(row: Row): RankableFood {
  if (row.kind === "custom") return customRowToFood({
    id: row.id, name: row.name, brand: row.brand, serving_size: row.serving_size, serving_grams: row.serving_grams,
    calories_per_100g: row.kcal, protein_per_100g: row.protein_g, carbs_per_100g: row.carbs_g, fat_per_100g: row.fat_g,
    barcode: row.barcode, origin: row.origin, value_basis: row.value_basis, image_url: row.image_url, image_attribution: row.image_attribution,
  }, num(row.recent_count) ?? 0);
  const portions = (Array.isArray(row.portions) ? row.portions : [])
    .map((item) => item as Row)
    .filter((item) => text(item.label) && UNITS.has(String(item.unit)) && (num(item.grams) ?? 0) > 0)
    .map((item): FoodPortion => ({
      label: String(item.label),
      unit: item.unit as FoodPortion["unit"],
      grams: num(item.grams) ?? 0,
      ...(item.isDefault ? { countDefault: true } : {}),
      estimate: item.estimate !== false,
    }));
  const valueBasis = (BASES.has(String(row.value_basis)) ? row.value_basis : basisForDataType(text(row.source_data_type))) as ValueBasis;
  const image = text(row.image_url);
  return usdaFood({
    id: String(row.id),
    name: String(row.name),
    calories: num(row.kcal) ?? 0,
    protein: num(row.protein_g) ?? 0,
    carbs: num(row.carbs_g) ?? 0,
    fat: num(row.fat_g) ?? 0,
    fiber: num(row.fiber_g),
    sugar: num(row.sugar_g),
    sodiumMg: num(row.sodium_mg),
    dataType: text(row.source_data_type),
    valueBasis,
    basis: basisInfo(valueBasis).label,
    state: row.state === "raw" || row.state === "cooked" ? row.state : null,
    dietType: DIETS.has(String(row.diet_type)) ? (row.diet_type as DietType) : null,
    portions,
    image,
    imageCredit: image ? text(row.image_attribution) : null,
    aliases: Array.isArray(row.aliases) ? row.aliases.map(String) : [],
    keywords: Array.isArray(row.keywords) ? row.keywords.map(String) : [],
    recentCount: num(row.recent_count) ?? 0,
    suggestion: row.fuzzy === true,
  });
}

/** A custom_foods row (values per 100 g, a saved serving) as a result. */
export function customRowToFood(row: Row, recentCount = 0): RankableFood {
  const serving = (num(row.serving_grams) ?? 0) > 0 ? (num(row.serving_grams) as number) : 100;
  const valueBasis = (BASES.has(String(row.value_basis)) ? row.value_basis : "user_entered") as ValueBasis;
  const origin = row.origin === "barcode" || row.origin === "ai_coach" || row.origin === "user" ? (row.origin as CustomFoodOrigin) : "user";
  const image = text(row.image_url);
  return {
    id: String(row.id),
    kind: "custom",
    name: String(row.name),
    brand: text(row.brand),
    image,
    imageCredit: image ? text(row.image_attribution) : null,
    sourceUrl: null,
    calories: num(row.calories_per_100g) ?? 0,
    protein: num(row.protein_per_100g) ?? 0,
    carbs: num(row.carbs_per_100g) ?? 0,
    fat: num(row.fat_per_100g) ?? 0,
    fiber: null,
    sugar: null,
    sodiumMg: null,
    source: CUSTOM_SOURCE,
    dataType: null,
    valueBasis,
    basis: origin === "ai_coach" ? `${basisInfo("ai_suggested").label} · saved` : `Your food · ${basisInfo(valueBasis).label}`,
    state: null,
    dietType: null,
    portions: [{ label: `1 serving (${text(row.serving_size) && !/^\d+(\.\d+)?\s*g$/i.test(String(row.serving_size)) ? `${row.serving_size}, ` : ""}${Math.round(serving * 10) / 10} g)`, unit: "serving", grams: serving, countDefault: true, estimate: false }],
    barcode: text(row.barcode),
    origin,
    recentCount,
    suggestion: false,
  };
}

/**
 * Ranks catalogue and custom results together (exact name or alias first, then closeness; your own and recently
 * logged foods get a small lift) and picks the food to select without asking: your own food named exactly what
 * was typed, or else the one catalogue food whose name or alias is exactly that, but only when none of your own
 * foods also matches. Suggestions (close spellings) are kept after the matches and never picked.
 */
export function rankAndPick(catalog: readonly RankableFood[], custom: readonly RankableFood[], words: readonly string[]) {
  const boost = (food: RankableFood) => (food.kind === "custom" ? 1 : 0) + Math.min(2, food.recentCount);
  const matchable = catalog.filter((food) => !food.suggestion);
  const customMatches = matchFoods(custom, words, { boost });
  const catalogMatches = matchFoods(matchable, words, { boost });
  const pick = clearMatch(customMatches) ?? (customMatches.length ? null : clearMatch(catalogMatches));
  const ranked = matchFoods([...custom, ...matchable], words, { boost }).map((match) => match.food);
  const suggestions = catalog.filter((food) => food.suggestion);
  return { foods: [...ranked, ...suggestions], pick };
}

/** What the browser gets: the result without the ranking-only fields. */
export function publicFood(food: RankableFood): FoodResult {
  const { aliases, keywords, ...rest } = food;
  void aliases;
  void keywords;
  return rest;
}
