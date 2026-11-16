/**
 * Open Food Facts (OFF) for the server routes: product lookups by barcode, and packaged-food search only when the
 * user asks for it. All FITX users share the server's IP, and OFF allows about 15 product reads and 10 searches a
 * minute per IP (with 429 or 503 when exceeded), so FITX never calls it for ordinary food searches.
 *
 * OFF data is under the Open Database Licence (ODbL); product photos are CC BY-SA, so every photo carries a credit.
 */
import { gramsInLabel, inferFoodState } from "@/lib/domain/food-query";
import type { FoodPortion } from "@/lib/domain/food-query";
import { per100gFromOpenFoodFacts } from "@/lib/domain/nutrition";
import type { FoodResult, SourceState } from "@/lib/food/types";
import { OPEN_FOOD_FACTS_IMAGE_CREDIT, VALUE_BASIS } from "@/lib/food/value-basis";

const OPEN_FOOD_FACTS = "https://world.openfoodfacts.org";
const FIELDS = "code,product_name,product_name_en,brands,image_front_small_url,nutriments,serving_size,serving_quantity,product_quantity,product_quantity_unit,quantity";
const DEFAULT_USER_AGENT = "FITX/1.0 (https://fitnessx.vercel.app)";
const TIMEOUT_MS = 3500;

export interface OffAnswer {
  status: SourceState;
  foods: FoodResult[];
  /** For a barcode: the product's name even when its label could not be used. */
  productName: string | null;
  /** For a barcode: the product exists but has no usable per-100 g label. */
  noLabel: boolean;
}

/** One product by barcode (already checked and normalised). Product reads are cached for a day. */
export async function lookupProduct(code: string): Promise<OffAnswer> {
  const answer = await fetchJson(`${OPEN_FOOD_FACTS}/api/v3/product/${encodeURIComponent(code)}.json?fields=${FIELDS}`, 86_400);
  if (answer.status !== "ok") return { status: answer.status, foods: [], productName: null, noLabel: false };
  const product = (answer.data?.product ?? null) as Record<string, unknown> | null;
  if (!product) return { status: "no_results", foods: [], productName: null, noLabel: false };
  const food = fromOpenFoodFacts(product);
  if (food) return { status: "ok", foods: [food], productName: food.name, noLabel: false };
  return { status: "no_results", foods: [], productName: productName(product), noLabel: true };
}

/** Packaged products by name, Indian products first; worldwide only when there are none. Cached for an hour. */
export async function searchProducts(text: string): Promise<OffAnswer> {
  const query = `${OPEN_FOOD_FACTS}/cgi/search.pl?search_terms=${encodeURIComponent(text)}&search_simple=1&action=process&json=1&page_size=20&fields=${FIELDS}`;
  const india = await fetchJson(`${query}&tagtype_0=countries&tag_contains_0=contains&tag_0=en%3Aindia`, 3600);
  const indianFoods = india.status === "ok" ? products(india.data) : [];
  if (india.status !== "ok" || indianFoods.length) {
    return { status: india.status === "ok" ? (indianFoods.length ? "ok" : "no_results") : india.status, foods: indianFoods, productName: null, noLabel: false };
  }
  const world = await fetchJson(query, 3600);
  const worldFoods = world.status === "ok" ? products(world.data) : [];
  return { status: world.status === "ok" ? (worldFoods.length ? "ok" : "no_results") : world.status, foods: worldFoods, productName: null, noLabel: false };
}

function products(data: Record<string, unknown> | null): FoodResult[] {
  const list = Array.isArray(data?.products) ? data.products : [];
  return list.map((item) => fromOpenFoodFacts(item)).filter((food): food is FoodResult => food !== null);
}

/** A search result from an OFF product, or null when its per-100 g label is missing or fails the label checks. */
export function fromOpenFoodFacts(item: unknown): FoodResult | null {
  const product = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
  const name = productName(product);
  const values = per100gFromOpenFoodFacts(product.nutriments);
  const code = typeof product.code === "number" ? String(product.code) : text(product.code);
  if (!name || !values || !code) return null;
  const portions: FoodPortion[] = [];
  const servingLabel = text(product.serving_size);
  const servingGrams = positive(product.serving_quantity) ?? gramsInLabel(servingLabel);
  if (servingGrams && servingGrams <= 2000 && (!servingLabel || !/\bml\b/i.test(servingLabel) || gramsInLabel(servingLabel))) {
    portions.push({ label: `1 serving (${servingLabel ?? `${servingGrams} g`})`, unit: "serving", grams: round1(servingGrams), estimate: false });
  }
  const packGrams = String(product.product_quantity_unit ?? "g").toLowerCase() === "g" ? positive(product.product_quantity) : null;
  if (packGrams && packGrams <= 5000 && packGrams !== servingGrams) {
    portions.push({ label: `1 pack (${text(product.quantity) ?? `${packGrams} g`})`, unit: "piece", grams: round1(packGrams), estimate: false });
  }
  const image = text(product.image_front_small_url);
  return {
    id: code,
    kind: "packaged",
    name,
    brand: text(product.brands),
    image: image && /^https:\/\/(images|static)\.openfoodfacts\.org\//.test(image) ? image : null,
    imageCredit: image ? OPEN_FOOD_FACTS_IMAGE_CREDIT : null,
    sourceUrl: `${OPEN_FOOD_FACTS}/product/${encodeURIComponent(code)}`,
    ...values,
    fiber: null,
    sugar: null,
    sodiumMg: null,
    source: "Open Food Facts",
    dataType: null,
    valueBasis: "label",
    basis: `${VALUE_BASIS.label.label} (Open Food Facts)`,
    state: inferFoodState(name),
    dietType: null,
    portions,
    barcode: /^\d{8,14}$/.test(code) ? code : null,
    origin: null,
    recentCount: 0,
    suggestion: false,
  };
}

/** Open Food Facts asks for "AppName/Version (contact)". A bare "FITX/1.0", as in .env.example, gets the site as its contact. */
export function openFoodFactsUserAgent(): string {
  const configured = (process.env.OPEN_FOOD_FACTS_USER_AGENT || "").replace(/[^\x20-\x7e]/g, " ").trim().slice(0, 200);
  if (!configured) return DEFAULT_USER_AGENT;
  return /\(.+\)/.test(configured) ? configured : `${configured} (https://fitnessx.vercel.app)`;
}

async function fetchJson(url: string, revalidate: number): Promise<{ status: SourceState; data: Record<string, unknown> | null }> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": openFoodFactsUserAgent() },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate },
    });
    // The product endpoint answers 404 for a barcode it does not know: no results, not an outage.
    if (response.status === 404) return { status: "no_results", data: null };
    // OFF answers 429, or 503 under load, when the shared per-IP limit is used up.
    if (response.status === 429 || response.status === 503) return { status: "rate_limited", data: null };
    if (!response.ok) return { status: "error", data: null };
    const data = (await response.json()) as Record<string, unknown> | null;
    return { status: "ok", data: data ?? {} };
  } catch (error) {
    return { status: isTimeout(error) ? "timeout" : "error", data: null };
  }
}

function productName(product: Record<string, unknown>): string | null {
  return text(product.product_name_en) ?? text(product.product_name);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positive(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(number) && number > 0 ? number : null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function isTimeout(error: unknown) {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}
