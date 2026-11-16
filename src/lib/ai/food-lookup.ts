import "server-only";
import { gramsInLabel, inferFoodState, portionFromLabel, withCountDefault } from "@/lib/domain/food-query";
import type { FoodPortion } from "@/lib/domain/food-query";
import { KJ_PER_KCAL, per100gFromOpenFoodFacts } from "@/lib/domain/nutrition";
import { BASIS, type CatalogueFood } from "./food-catalogue";
import type { FetchLike } from "./providers/types";

/**
 * Live lookups for foods the local data does not have, with the same sources and wording as the
 * Nutrition search: USDA FoodData Central (only when USDA_API_KEY is set) and Open Food Facts for
 * packaged products, which is also the only source of food photos.
 */

const USDA_SEARCH = "https://api.nal.usda.gov/fdc/v1/foods/search";
const OPEN_FOOD_FACTS = "https://world.openfoodfacts.org";
const OFF_FIELDS = "code,product_name,brands,image_front_small_url,nutriments,serving_size";
const TIMEOUT_MS = 3500;

export type LiveLookups = {
  usda?: (query: string) => Promise<CatalogueFood[]>;
  openFoodFacts?: (query: string) => Promise<CatalogueFood[]>;
};

export function createLiveLookups(options: { fetch?: FetchLike; usdaKey?: string; offUserAgent?: string } = {}): LiveLookups {
  const fetcher: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const lookups: LiveLookups = {
    openFoodFacts: async (query) => {
      try {
        const response = await fetcher(
          `${OPEN_FOOD_FACTS}/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=10&fields=${OFF_FIELDS}`,
          { headers: { "User-Agent": openFoodFactsUserAgent(options.offUserAgent) }, signal: AbortSignal.timeout(TIMEOUT_MS) },
        );
        if (!response.ok) return [];
        const data = (await response.json()) as { products?: unknown };
        return (Array.isArray(data?.products) ? data.products : []).map(fromOpenFoodFacts).filter((food): food is CatalogueFood => food !== null);
      } catch {
        return [];
      }
    },
  };
  if (options.usdaKey) {
    const key = options.usdaKey;
    lookups.usda = async (query) => {
      try {
        const response = await fetcher(USDA_SEARCH, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Api-Key": key },
          // Generic foods only: branded rows rarely describe a home-cooked dish.
          body: JSON.stringify({ query, pageSize: 8, dataType: ["Survey (FNDDS)", "Foundation", "SR Legacy"] }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) return [];
        const data = (await response.json()) as { foods?: unknown };
        return (Array.isArray(data?.foods) ? data.foods : []).map(fromUsda).filter((food): food is CatalogueFood => food !== null);
      } catch {
        return [];
      }
    };
  }
  return lookups;
}

/** Same rule as the search route: "AppName/Version (contact)". */
function openFoodFactsUserAgent(configured = "") {
  const value = configured.replace(/[^\x20-\x7e]/g, " ").trim().slice(0, 200);
  if (!value) return "FITX/1.0 (https://fitnessx.vercel.app)";
  return /\(.+\)/.test(value) ? value : `${value} (https://fitnessx.vercel.app)`;
}

export function fromOpenFoodFacts(item: unknown): CatalogueFood | null {
  const product = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
  const name = text(product.product_name);
  const values = per100gFromOpenFoodFacts(product.nutriments);
  if (!name || !values) return null;
  const servingLabel = text(product.serving_size);
  const servingGrams = gramsInLabel(servingLabel);
  const image = text(product.image_front_small_url);
  return {
    id: typeof product.code === "number" ? String(product.code) : text(product.code) ?? "",
    name,
    brand: text(product.brands),
    // Only Open Food Facts' own image hosts, which next.config.ts already allows.
    image: image && /^https:\/\/(images|static|world)\.openfoodfacts\.org\//.test(image) ? image : null,
    ...values,
    source: "Open Food Facts",
    dataType: null,
    basis: "Package label (Open Food Facts)",
    state: inferFoodState(name),
    portions: servingGrams && servingGrams <= 2000 ? [{ label: `1 serving (${servingLabel})`, unit: "serving", grams: servingGrams, estimate: false }] : [],
  };
}

type UsdaFood = {
  fdcId?: number;
  description?: string;
  dataType?: string;
  foodNutrients?: Array<{ nutrientNumber?: string; value?: number }>;
  foodMeasures?: Array<{ disseminationText?: string; gramWeight?: number }>;
};

export function fromUsda(item: unknown): CatalogueFood | null {
  const food = (item && typeof item === "object" ? item : {}) as UsdaFood;
  const name = text(food.description);
  const nutrients = Array.isArray(food.foodNutrients) ? food.foodNutrients : [];
  const value = (number: string) => {
    const found = nutrients.find((nutrient) => nutrient?.nutrientNumber === number)?.value;
    return typeof found === "number" && Number.isFinite(found) && found >= 0 ? found : null;
  };
  const kj = value("268");
  const calories = value("208") ?? value("958") ?? value("957") ?? (kj === null ? null : kj / KJ_PER_KCAL);
  if (!name || !food.fdcId || calories === null) return null;
  const dataType = text(food.dataType);
  const portions = withCountDefault(
    (Array.isArray(food.foodMeasures) ? food.foodMeasures : [])
      .map((measure) => portionFromLabel(String(measure?.disseminationText ?? ""), Number(measure?.gramWeight)))
      .filter((portion): portion is FoodPortion => portion !== null),
  );
  return {
    id: String(food.fdcId),
    name,
    brand: null,
    image: null,
    calories: Math.round(calories),
    protein: round1(value("203") ?? 0),
    carbs: round1(value("205") ?? 0),
    fat: round1(value("204") ?? 0),
    source: "USDA FoodData Central",
    dataType,
    basis: (dataType && BASIS[dataType]) || "USDA FoodData Central",
    state: inferFoodState(name),
    portions,
  };
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}
