/**
 * Live USDA FoodData Central search, used only when the server has USDA_API_KEY. FITX's own catalogue already holds
 * the FNDDS, Foundation and curated SR Legacy foods, so this mainly adds Branded (package label) foods.
 */
import { inferFoodState, portionFromLabel, withCountDefault } from "@/lib/domain/food-query";
import type { FoodPortion } from "@/lib/domain/food-query";
import { KJ_PER_KCAL } from "@/lib/domain/nutrition";
import type { SourceState } from "@/lib/food/types";
import { USDA_SOURCE, type RankableFood } from "@/lib/food/catalog-search";
import { basisForDataType, basisInfo } from "@/lib/food/value-basis";

const USDA_SEARCH = "https://api.nal.usda.gov/fdc/v1/foods/search";
const USDA_DATA_TYPES = ["Survey (FNDDS)", "Foundation", "SR Legacy", "Branded"];
const TIMEOUT_MS = 3500;

type UsdaSearchFood = {
  fdcId?: number;
  description?: string;
  dataType?: string;
  brandName?: string;
  brandOwner?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  householdServingFullText?: string;
  foodNutrients?: Array<{ nutrientNumber?: string; value?: number }>;
  foodMeasures?: Array<{ disseminationText?: string; gramWeight?: number }>;
};

export async function searchUsda(query: string, apiKey: string): Promise<{ status: SourceState; foods: RankableFood[] }> {
  try {
    const response = await fetch(USDA_SEARCH, {
      method: "POST",
      // In a header, the key stays out of URLs, logs and caches keyed by URL.
      headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
      body: JSON.stringify({ query, pageSize: 12, dataType: USDA_DATA_TYPES }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate: 3600 },
    });
    if (response.status === 429) return { status: "rate_limited", foods: [] };
    if (!response.ok) return { status: "error", foods: [] };
    const data = (await response.json()) as { foods?: unknown };
    const foods = (Array.isArray(data?.foods) ? data.foods : []).map(fromUsda).filter((food): food is RankableFood => food !== null);
    return { status: foods.length ? "ok" : "no_results", foods };
  } catch (error) {
    return { status: error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError") ? "timeout" : "error", foods: [] };
  }
}

export function fromUsda(item: unknown): RankableFood | null {
  const food = (item && typeof item === "object" ? item : {}) as UsdaSearchFood;
  const name = typeof food.description === "string" ? food.description.trim() : "";
  const nutrients = Array.isArray(food.foodNutrients) ? food.foodNutrients : [];
  const value = (number: string) => {
    const found = nutrients.find((nutrient) => nutrient?.nutrientNumber === number)?.value;
    return typeof found === "number" && Number.isFinite(found) && found >= 0 ? found : null;
  };
  const kj = value("268");
  // 208 is kcal; Foundation foods may give only the Atwater energies 958 or 957.
  const calories = value("208") ?? value("958") ?? value("957") ?? (kj === null ? null : kj / KJ_PER_KCAL);
  if (!name || !food.fdcId || calories === null || calories > 950) return null;
  const dataType = typeof food.dataType === "string" ? food.dataType : null;
  const measures = (Array.isArray(food.foodMeasures) ? food.foodMeasures : [])
    .map((measure) => portionFromLabel(String(measure?.disseminationText ?? ""), Number(measure?.gramWeight)))
    .filter((portion): portion is FoodPortion => portion !== null);
  const portions = withCountDefault(measures);
  const servingUnit = String(food.servingSizeUnit ?? "").toLowerCase();
  if (dataType === "Branded" && (servingUnit === "g" || servingUnit === "grm") && Number(food.servingSize) > 0) {
    const household = typeof food.householdServingFullText === "string" ? food.householdServingFullText.trim() : "";
    portions.push({ label: `1 serving (${household ? `${household}, ` : ""}${food.servingSize} g)`, unit: "serving", grams: Number(food.servingSize), estimate: false });
  }
  const valueBasis = basisForDataType(dataType);
  // A nutrient USDA does not list is unknown, not 0 g: it is named in `missing` and logged as NULL.
  const macros = { protein: value("203"), carbs: value("205"), fat: value("204") };
  const missing = (["protein", "carbs", "fat"] as const).filter((key) => macros[key] === null);
  return {
    id: String(food.fdcId),
    kind: "catalog",
    name,
    brand: food.brandName?.trim() || food.brandOwner?.trim() || null,
    image: null,
    imageCredit: null,
    sourceUrl: `https://fdc.nal.usda.gov/food-details/${food.fdcId}/nutrients`,
    calories: Math.round(calories),
    protein: round1(macros.protein ?? 0),
    carbs: round1(macros.carbs ?? 0),
    fat: round1(macros.fat ?? 0),
    missing,
    fiber: value("291"),
    saturatedFat: value("606"),
    sugar: value("269"),
    sodiumMg: value("307"),
    source: USDA_SOURCE,
    dataType,
    valueBasis,
    basis: dataType === "Branded" ? "Package label (USDA Branded Foods)" : basisInfo(valueBasis).label,
    state: inferFoodState(name),
    dietType: null,
    portions,
    barcode: null,
    origin: null,
    recentCount: 0,
    suggestion: false,
  };
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}
