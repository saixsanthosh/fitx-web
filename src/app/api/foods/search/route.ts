import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import usdaFoundationFoods from "@/data/usda-foundation-foods.json";
import fitxStaples from "@/data/fitx-staples.json";
import { clearMatch, gramsInLabel, inferFoodState, matchFoods, parseFoodQuery, portionFromLabel, singular, withCountDefault } from "@/lib/domain/food-query";
import type { FoodPortion, FoodState } from "@/lib/domain/food-query";
import { KJ_PER_KCAL, per100gFromOpenFoodFacts } from "@/lib/domain/nutrition";

type FoodResult = {
  id: string;
  name: string;
  brand: string | null;
  image: string | null;
  /** Calories, protein, carbs and fat are per 100 g. */
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  source: "Open Food Facts" | "USDA FoodData Central";
  /** FoodData Central data type ("Survey (FNDDS)", "SR Legacy", "Foundation", "Branded"); null for Open Food Facts. */
  dataType: string | null;
  /** What the values are, in the words the app shows. */
  basis: string;
  state: FoodState | null;
  portions: FoodPortion[];
};

type LocalFood = FoodResult & { aliases?: string[]; origin: "fitx-staples" | "usda-foundation" };
type SourceId = "fitx-staples" | "usda-foundation" | "usda-live" | "open-food-facts";
type SourceState = "ok" | "no_results" | "not_used" | "not_configured" | "error" | "timeout";
type SourceStatus = { id: SourceId; label: string; status: SourceState; count: number };
type SourceAnswer = { status: SourceState; foods: FoodResult[] };

const OPEN_FOOD_FACTS = "https://world.openfoodfacts.org";
const OFF_FIELDS = "code,product_name,brands,image_front_small_url,nutriments,serving_size";
const DEFAULT_OFF_USER_AGENT = "FITX/1.0 (https://fitnessx.vercel.app)";
const USDA_SEARCH = "https://api.nal.usda.gov/fdc/v1/foods/search";
const USDA_DATA_TYPES = ["Survey (FNDDS)", "Foundation", "SR Legacy", "Branded"];
const TIMEOUT_MS = 3500;
const LOCAL_LIMIT = 15;
const USDA_LIMIT = 8;
const TOTAL_LIMIT = 30;

const BASIS: Record<string, string> = {
  "Survey (FNDDS)": "USDA typical recipe",
  "SR Legacy": "USDA reference values",
  Foundation: "USDA lab analysis",
  Branded: "Package label (USDA Branded Foods)",
};

const staples: LocalFood[] = fitxStaples.foods.map((food) => ({
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
  state: food.state as FoodState | null,
  portions: food.portions as FoodPortion[],
  aliases: food.aliases,
  origin: "fitx-staples",
}));

const foundationFoods: LocalFood[] = (usdaFoundationFoods as Array<Pick<FoodResult, "id" | "name" | "brand" | "image" | "calories" | "protein" | "carbs" | "fat">>).map((food) => ({
  ...food,
  source: "USDA FoodData Central",
  dataType: "Foundation",
  basis: BASIS.Foundation,
  state: inferFoodState(food.name),
  portions: [],
  origin: "usda-foundation",
}));

// Curated staples first: on equal matches they win, so cooked rice and idli come before the raw grains.
// A Foundation food that is also a staple (whole milk) appears once, as the staple with its aliases and portions.
const stapleIds = new Set(staples.map((food) => food.id));
const localFoods = [...staples, ...foundationFoods.filter((food) => !stapleIds.has(food.id))];

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
  if (!user) return NextResponse.json({ error: "Sign in to search food." }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const barcode = (params.get("barcode") || "").replace(/\D/g, "").slice(0, 14);
  const browse = params.get("browse") === "1";
  const usdaKey = process.env.USDA_API_KEY?.trim() || "";
  const sources: SourceStatus[] = [
    { id: "fitx-staples", label: "FITX staples (USDA)", status: "not_used", count: 0 },
    { id: "usda-foundation", label: "USDA Foundation Foods", status: "not_used", count: 0 },
    { id: "usda-live", label: "USDA live search", status: usdaKey ? "not_used" : "not_configured", count: 0 },
    { id: "open-food-facts", label: "Open Food Facts", status: "not_used", count: 0 },
  ];
  const report = (id: SourceId, status: SourceState, count: number) => {
    const source = sources.find((item) => item.id === id);
    if (source) Object.assign(source, { status, count });
  };

  if (barcode) {
    const answer = await fetchOpenFoodFacts(`${OPEN_FOOD_FACTS}/api/v3/product/${barcode}.json?fields=${OFF_FIELDS}`, (data) => (data.product ? [data.product] : []));
    report("open-food-facts", answer.status, answer.foods.length);
    return respond(answer.foods, sources);
  }

  if (browse) {
    report("fitx-staples", "ok", staples.length);
    return respond(staples, sources);
  }

  // "3 idlis" searches for "idli"; the page turns the 3 into grams with the chosen food's portions.
  const query = parseFoodQuery((params.get("q") || "").slice(0, 100));
  const searchText = query.words.map(singular).join(" ");
  if (searchText.length < 2) return respond([], sources);

  const matches = matchFoods(localFoods, query.words);
  const local = matches.slice(0, LOCAL_LIMIT).map((match) => match.food);
  // Only a food whose whole name or alias is what was typed is picked for the user; otherwise they choose.
  const pick = clearMatch(matches);
  for (const origin of ["fitx-staples", "usda-foundation"] as const) {
    const count = local.filter((food) => food.origin === origin).length;
    report(origin, count ? "ok" : "no_results", count);
  }

  const [usda, off] = await Promise.all([
    usdaKey ? searchUsda(searchText, usdaKey) : Promise.resolve(null),
    fetchOpenFoodFacts(
      `${OPEN_FOOD_FACTS}/cgi/search.pl?search_terms=${encodeURIComponent(searchText)}&search_simple=1&action=process&json=1&page_size=20&fields=${OFF_FIELDS}`,
      (data) => (Array.isArray(data.products) ? data.products : []),
    ),
  ]);
  if (usda) report("usda-live", usda.status, usda.foods.length);
  report("open-food-facts", off.status, off.foods.length);

  const foods: FoodResult[] = [];
  const seen = new Set<string>();
  for (const food of [...local, ...(usda?.foods ?? []).slice(0, USDA_LIMIT), ...off.foods]) {
    const key = `${food.source}:${food.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    foods.push(food);
  }
  return respond(foods.slice(0, TOTAL_LIMIT), sources, pick);
}

/** `pick` names the one food that clearly matches what was typed, so the page can select it and fill in the amount. */
function respond(foods: FoodResult[], sources: SourceStatus[], pick: FoodResult | null = null) {
  const body = foods.map((food) => ({
    id: food.id,
    name: food.name,
    brand: food.brand,
    image: food.image,
    calories: food.calories,
    protein: food.protein,
    carbs: food.carbs,
    fat: food.fat,
    source: food.source,
    dataType: food.dataType,
    basis: food.basis,
    state: food.state,
    portions: food.portions,
  }));
  return NextResponse.json(
    { foods: body, sources, pick: pick ? { source: pick.source, id: pick.id } : null },
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}

async function fetchOpenFoodFacts(url: string, pick: (data: Record<string, unknown>) => unknown[]): Promise<SourceAnswer> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": openFoodFactsUserAgent() },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate: 3600 },
    });
    // The product endpoint answers 404 for a barcode it does not know: no results, not an outage.
    if (response.status === 404) return { status: "no_results", foods: [] };
    if (!response.ok) return { status: "error", foods: [] };
    const data = (await response.json()) as Record<string, unknown>;
    const foods = pick(data ?? {}).map(fromOpenFoodFacts).filter((food): food is FoodResult => food !== null);
    return { status: foods.length ? "ok" : "no_results", foods };
  } catch (error) {
    return { status: isTimeout(error) ? "timeout" : "error", foods: [] };
  }
}

function fromOpenFoodFacts(item: unknown): FoodResult | null {
  const product = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
  const name = text(product.product_name);
  const values = per100gFromOpenFoodFacts(product.nutriments);
  if (!name || !values) return null;
  const servingLabel = text(product.serving_size);
  const servingGrams = gramsInLabel(servingLabel);
  return {
    id: typeof product.code === "number" ? String(product.code) : text(product.code) ?? "",
    name,
    brand: text(product.brands),
    image: text(product.image_front_small_url),
    ...values,
    source: "Open Food Facts",
    dataType: null,
    basis: "Package label (Open Food Facts)",
    state: inferFoodState(name),
    portions: servingGrams && servingGrams <= 2000 ? [{ label: `1 serving (${servingLabel})`, unit: "serving", grams: servingGrams, estimate: false }] : [],
  };
}

/** Open Food Facts asks for "AppName/Version (contact)". A bare "FITX/1.0", as in .env.example, gets the site as its contact. */
function openFoodFactsUserAgent() {
  const configured = (process.env.OPEN_FOOD_FACTS_USER_AGENT || "").replace(/[^\x20-\x7e]/g, " ").trim().slice(0, 200);
  if (!configured) return DEFAULT_OFF_USER_AGENT;
  return /\(.+\)/.test(configured) ? configured : `${configured} (https://fitnessx.vercel.app)`;
}

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

async function searchUsda(query: string, apiKey: string): Promise<SourceAnswer> {
  try {
    const response = await fetch(USDA_SEARCH, {
      method: "POST",
      // In a header, the key stays out of URLs, logs and caches keyed by URL.
      headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
      body: JSON.stringify({ query, pageSize: 12, dataType: USDA_DATA_TYPES }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate: 3600 },
    });
    if (!response.ok) return { status: "error", foods: [] };
    const data = (await response.json()) as { foods?: unknown };
    const foods = (Array.isArray(data?.foods) ? data.foods : []).map(fromUsda).filter((food): food is FoodResult => food !== null);
    return { status: foods.length ? "ok" : "no_results", foods };
  } catch (error) {
    return { status: isTimeout(error) ? "timeout" : "error", foods: [] };
  }
}

function fromUsda(item: unknown): FoodResult | null {
  const food = (item && typeof item === "object" ? item : {}) as UsdaSearchFood;
  const name = text(food.description);
  const nutrients = Array.isArray(food.foodNutrients) ? food.foodNutrients : [];
  const value = (number: string) => {
    const found = nutrients.find((nutrient) => nutrient?.nutrientNumber === number)?.value;
    return typeof found === "number" && Number.isFinite(found) && found >= 0 ? found : null;
  };
  const kj = value("268");
  // 208 is kcal; Foundation foods may give only the Atwater energies 958 or 957.
  const calories = value("208") ?? value("958") ?? value("957") ?? (kj === null ? null : kj / KJ_PER_KCAL);
  if (!name || !food.fdcId || calories === null) return null;
  const dataType = text(food.dataType);
  const measures = (Array.isArray(food.foodMeasures) ? food.foodMeasures : [])
    .map((measure) => portionFromLabel(String(measure?.disseminationText ?? ""), Number(measure?.gramWeight)))
    .filter((portion): portion is FoodPortion => portion !== null);
  const portions = withCountDefault(measures);
  const servingUnit = String(food.servingSizeUnit ?? "").toLowerCase();
  if (dataType === "Branded" && (servingUnit === "g" || servingUnit === "grm") && Number(food.servingSize) > 0) {
    const household = text(food.householdServingFullText);
    portions.push({ label: `1 serving (${household ? `${household}, ` : ""}${food.servingSize} g)`, unit: "serving", grams: Number(food.servingSize), estimate: false });
  }
  return {
    id: String(food.fdcId),
    name,
    brand: text(food.brandName) ?? text(food.brandOwner),
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

function isTimeout(error: unknown) {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}
