import "server-only";
import { formatAmount, parseFoodQuery, rankFoods, resolvePortion, unitLabel } from "@/lib/domain/food-query";
import type { FoodUnit } from "@/lib/domain/food-query";
import { scaleMacros } from "@/lib/domain/nutrition";
import { foodConflict, type AllergyRule, type DietRule } from "./diet-rules";
import { searchCatalogue, type CatalogueFood } from "./food-catalogue";
import type { LiveLookups } from "./food-lookup";
import type { ModelFood } from "./plans";
import type { CoachFoodItem, Macros } from "./types";
import { round1 } from "./validate";

/**
 * Turns a food the model suggested into values FITX can stand behind: it looks the food up with the
 * same data and matching rules as Nutrition search, works out the portion weight from the database's
 * own portion sizes ("3 idli" = 3 × 38 g), and scales the per-100 g values. When nothing plausible
 * matches, the model's own numbers are kept and labelled "AI estimate". No photo is ever invented.
 */

export type CustomFoodPayload = {
  name: string;
  brand: string | null;
  serving_size: string;
  serving_grams: number;
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
};

export type GroundedFood = {
  item: Omit<CoachFoodItem, "key" | "actionId">;
  per100: Macros;
  /** Gram-measured portions can be resized to fit the day's target; counted pieces are left alone. */
  scalable: boolean;
};

export type GroundingContext = {
  catalogue: readonly CatalogueFood[];
  live?: LiveLookups;
  diet: readonly DietRule[];
  allergies: { rules: readonly AllergyRule[]; other: readonly string[] };
};

const DESCRIPTORS = new Set([
  "cooked", "boiled", "steamed", "grilled", "roasted", "fried", "baked", "plain", "fresh", "homemade", "home", "made", "style", "indian",
  "south", "north", "small", "medium", "large", "hot", "warm", "cold", "simple", "light", "healthy", "mixed", "with", "and", "a", "the",
]);
const COOKED_TEXT = /\b(cooked|boiled|steamed|grilled|roasted|fried|baked|stewed|curry|sabzi|sabji|gravy)\b/i;
const COUNT_UNITS = new Set(["piece", "slice", "serving"]);

export async function groundFood(food: ModelFood, context: GroundingContext): Promise<GroundedFood> {
  const safe = (match: CatalogueFood) => plausible(match, food) && !foodConflict(`${match.name} ${match.brand ?? ""}`, context.diet, context.allergies);

  if (food.brand && context.live?.openFoodFacts) {
    const brand = normalize(food.brand);
    const products = await context.live.openFoodFacts(`${food.brand} ${food.name}`);
    const product = products.find((item) => item.brand && normalize(item.brand).includes(brand) && safe(item));
    if (product) return fromMatch(food, product);
  }

  for (const words of wordLists(food)) {
    const match = searchCatalogue(context.catalogue, words).find(safe);
    if (match) return fromMatch(food, match);
  }

  if (context.live?.usda) {
    const words = parseFoodQuery(food.search).words;
    const results = await context.live.usda(words.join(" "));
    const match = rankFoods(results, words).find(safe);
    if (match) return fromMatch(food, match);
  }

  return estimate(food);
}

/** Resizes gram-measured portions, keeping per-100 g values. */
export function resize(grounded: GroundedFood, factor: number): GroundedFood {
  if (!grounded.scalable || factor === 1) return grounded;
  const grams = Math.max(1, Math.round(grounded.item.grams * factor));
  const macros = scaleMacros(grounded.per100, grams);
  return {
    ...grounded,
    item: { ...grounded.item, grams, portion: `${formatAmount(grams)} g`, calories: Math.round(macros.calories), protein: macros.protein, carbs: macros.carbs, fat: macros.fat },
  };
}

/** The custom food row "Add to My Food Plan" creates: per-100 g values plus the suggested serving. */
export function customFoodFor(item: Omit<CoachFoodItem, "key" | "actionId">, per100: Macros): CustomFoodPayload {
  // Nutrition's "My custom foods" shows this line under the name, so the origin and basis stay visible there.
  const brand = item.basis === "ai_estimate" ? "FITX Coach · AI estimate" : item.basis === "label" ? "Package label · via FITX Coach" : `FITX Coach · ${item.basisLabel}`;
  return {
    name: item.name.slice(0, 160),
    brand: brand.slice(0, 160),
    serving_size: item.portion.slice(0, 80),
    serving_grams: Math.max(1, round1(item.grams)),
    calories_per_100g: nonNegative(per100.calories),
    protein_per_100g: nonNegative(per100.protein),
    carbs_per_100g: nonNegative(per100.carbs),
    fat_per_100g: nonNegative(per100.fat),
  };
}

/** A whole meal as one custom food: the summed values over the summed weight. */
export function customMealFor(mealName: string, items: ReadonlyArray<Omit<CoachFoodItem, "key" | "actionId">>): CustomFoodPayload | null {
  const grams = items.reduce((sum, item) => sum + item.grams, 0);
  if (!items.length || grams <= 0) return null;
  const totals = sumItems(items);
  const estimated = items.some((item) => item.basis === "ai_estimate");
  const names = items.map((item) => item.name).join(", ");
  return {
    name: `${mealName}: ${names}`.slice(0, 160),
    brand: estimated ? "FITX Coach · includes AI estimates" : "FITX Coach · database values",
    serving_size: `1 meal (${formatAmount(Math.round(grams))} g)`,
    serving_grams: Math.round(grams),
    calories_per_100g: nonNegative((totals.calories / grams) * 100),
    protein_per_100g: nonNegative((totals.protein / grams) * 100),
    carbs_per_100g: nonNegative((totals.carbs / grams) * 100),
    fat_per_100g: nonNegative((totals.fat / grams) * 100),
  };
}

export function sumItems(items: ReadonlyArray<Pick<CoachFoodItem, "calories" | "protein" | "carbs" | "fat">>): Macros {
  const total = items.reduce(
    (sum, item) => ({ calories: sum.calories + item.calories, protein: sum.protein + item.protein, carbs: sum.carbs + item.carbs, fat: sum.fat + item.fat }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
  return { calories: Math.round(total.calories), protein: round1(total.protein), carbs: round1(total.carbs), fat: round1(total.fat) };
}

function fromMatch(food: ModelFood, match: CatalogueFood): GroundedFood {
  const resolution = resolvePortion({ amount: food.quantity, unit: food.unit as FoodUnit, size: null }, match.portions);
  let grams: number;
  let portion: string;
  let portionEstimated: boolean;
  if (resolution.kind === "grams") {
    grams = resolution.grams;
    portion = `${formatAmount(grams)} g`;
    portionEstimated = false;
  } else if (resolution.kind === "portion") {
    grams = resolution.grams;
    portion = `${formatAmount(resolution.count)} ${unitLabel(resolution.portion.unit, resolution.count)} (${formatAmount(grams)} g)`;
    portionEstimated = resolution.estimate;
  } else {
    // No database weight for this unit (a katori, a bowl): keep the coach's weight and say it is an estimate.
    grams = round1(food.grams);
    portion = `${formatAmount(food.quantity)} ${unitLabel(food.unit as FoodUnit, food.quantity)} (about ${formatAmount(grams)} g)`;
    portionEstimated = true;
  }
  const per100 = { calories: match.calories, protein: match.protein, carbs: match.carbs, fat: match.fat };
  const macros = scaleMacros(per100, grams);
  return {
    per100,
    scalable: !COUNT_UNITS.has(food.unit),
    item: {
      name: food.name,
      portion,
      grams,
      calories: Math.round(macros.calories),
      protein: macros.protein,
      carbs: macros.carbs,
      fat: macros.fat,
      basis: match.source === "Open Food Facts" ? "label" : "database",
      basisLabel: match.basis,
      source: match.source,
      matchedName: match.brand && match.source === "Open Food Facts" ? `${match.name} (${match.brand})` : match.name,
      portionEstimated,
      image: match.image,
      cost: food.cost,
      note: food.note,
    },
  };
}

function estimate(food: ModelFood): GroundedFood {
  const grams = round1(food.grams);
  const per100 = {
    calories: round1((food.calories / grams) * 100),
    protein: round1((food.protein / grams) * 100),
    carbs: round1((food.carbs / grams) * 100),
    fat: round1((food.fat / grams) * 100),
  };
  return {
    per100,
    scalable: !COUNT_UNITS.has(food.unit),
    item: {
      name: food.name,
      portion: food.unit === "g" ? `${formatAmount(grams)} g` : `${formatAmount(food.quantity)} ${unitLabel(food.unit as FoodUnit, food.quantity)} (about ${formatAmount(grams)} g)`,
      grams,
      calories: Math.round(food.calories),
      protein: round1(food.protein),
      carbs: round1(food.carbs),
      fat: round1(food.fat),
      basis: "ai_estimate",
      basisLabel: "AI estimate",
      source: null,
      matchedName: null,
      portionEstimated: true,
      image: null,
      cost: food.cost,
      note: food.note,
    },
  };
}

/** Search words to try, most specific first: the coach's search words, the food's name, then without cooking words. */
function wordLists(food: ModelFood): string[][] {
  const lists: string[][] = [];
  const add = (words: string[]) => {
    if (words.length && !lists.some((list) => list.join(" ") === words.join(" "))) lists.push(words);
  };
  const search = parseFoodQuery(food.search).words;
  add(search);
  add(parseFoodQuery(food.name).words);
  add(search.filter((word) => !DESCRIPTORS.has(word)));
  return lists;
}

/** Rejects matches whose energy density is far from the coach's estimate (rice flour for cooked rice). */
function plausible(match: CatalogueFood, food: ModelFood): boolean {
  if (COOKED_TEXT.test(`${food.name} ${food.search}`) && match.state === "raw") return false;
  if (!(food.grams > 0 && food.calories > 0)) return true;
  const estimated = (food.calories / food.grams) * 100;
  if (match.calories < 40 && estimated < 60) return true;
  if (match.calories <= 0) return estimated < 15;
  const ratio = match.calories / estimated;
  return ratio >= 0.4 && ratio <= 2.5;
}

function normalize(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function nonNegative(value: number) {
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 0;
}
