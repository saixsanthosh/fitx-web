/**
 * Food search for signed-in users, behind GET /api/foods/search. The route passes in its Supabase client, the
 * outside services and the built-in food list, so `node --test` can run all of it.
 * - ?q=…            FITX's food catalogue (database function search_foods) and the user's own foods, ranked. The
 *                   built-in list (curated staples and the USDA Foundation snapshot) answers for every food the
 *                   database did not return: before the catalogue migrations, while their seed parts are being
 *                   applied, and for foods the seed does not hold (FITX's recipe estimates). Once the catalogue is
 *                   seeded, a bundled food it holds is shown with the catalogue's current row, or not at all when
 *                   Admin hid it (src/lib/food/catalogue-copies.ts). "3 idlis" searches for "idli"; the page turns
 *                   the 3 into grams with the chosen food.
 * - ?q=…&packaged=1 Open Food Facts packaged products, only when the user asks (shared, rate-limited service).
 * - ?barcode=…      the user's own food with that barcode, else Open Food Facts.
 * - ?browse=1       the curated staples, as the catalogue has them once it is seeded. It asks nothing outside FITX,
 *                   so it takes no search quota.
 * Answers carry the user's own foods and recent logs, so browsers never keep them (`private, no-store`).
 */
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseFoodQuery, rankFoods, singular } from "@/lib/domain/food-query";
import { barcodeProblem, checkBarcode } from "@/lib/food/barcode";
import { customRowToFood, publicFood, rankAndPick, searchRowToFood, stemsFor, type RankableFood } from "@/lib/food/catalog-search";
import { catalogueCopies, heldByCatalogue, withCatalogueCopies } from "@/lib/food/catalogue-copies";
import type { OffAnswer } from "@/lib/food/open-food-facts";
import { catalogueRef, withSourceFood } from "@/lib/food/saved-foods";
import type { FoodResult, FoodSearchResponse, SourceId, SourceState, SourceStatus } from "@/lib/food/types";
import { isMissingColumnError, isMissingFunctionError } from "@/lib/supabase/errors";

export interface FoodSearchServices {
  lookupProduct: (code: string) => Promise<OffAnswer>;
  searchProducts: (text: string) => Promise<OffAnswer>;
  searchUsda: (text: string, apiKey: string) => Promise<{ status: SourceState; foods: RankableFood[] }>;
  /** USDA_API_KEY, or "" when live USDA search is not set up. */
  usdaKey: string;
  /** The built-in list: curated staples first, then the USDA Foundation snapshot. */
  localFoods: readonly RankableFood[];
  /** The curated staples, shown before anything is typed. */
  stapleFoods: readonly RankableFood[];
}

/** Every answer holds the user's own foods, barcodes or recent logs, or may soon (a retry after "busy"). */
export const SEARCH_CACHE_CONTROL = "private, no-store";
const TOTAL_LIMIT = 40;
const CUSTOM_COLUMNS = "id,name,brand,serving_size,serving_grams,calories_per_100g,protein_per_100g,carbs_per_100g,fat_per_100g";
const CUSTOM_COLUMNS_V2 = `${CUSTOM_COLUMNS},barcode,origin,value_basis,image_url,image_attribution,source_ref`;

export async function searchFoods(request: Request, supabase: SupabaseClient | null, services: FoodSearchServices): Promise<Response> {
  const { data: { user } } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
  if (!user) return NextResponse.json({ error: "Sign in to search food." }, { status: 401, headers: { "Cache-Control": SEARCH_CACHE_CONTROL } });

  const params = new URL(request.url).searchParams;
  const barcode = (params.get("barcode") || "").replace(/\D/g, "").slice(0, 14);
  const browse = params.get("browse") === "1";

  // Per-account limit, so one account can't use up the shared Open Food Facts and USDA quotas for
  // everyone. Until the database function exists (migration 20261117110000) searches stay unlimited.
  if (!browse && supabase) {
    const { data: quota, error: quotaError } = await supabase.rpc("fitx_take_food_search_quota");
    if (quotaError) {
      if (!isMissingFunctionError(quotaError)) console.warn("FITX food search quota check failed", quotaError.code);
    } else {
      const row = (Array.isArray(quota) ? quota[0] : quota) as { allowed?: boolean; retry_after_seconds?: number } | null;
      if (row?.allowed === false) {
        const retry = Math.max(1, Math.round(Number(row.retry_after_seconds) || 60));
        const error = retry > 3600 ? "You’ve reached today’s food search limit. Try again tomorrow." : `You’re searching quickly. Try again in ${retry} s.`;
        return NextResponse.json({ error }, { status: 429, headers: { "Retry-After": String(retry) } });
      }
    }
  }
  if (!supabase) return NextResponse.json({ error: "Sign in to search food." }, { status: 401 });
  const { usdaKey } = services;
  const sources: SourceStatus[] = [
    { id: "fitx-catalog", label: "FITX food catalogue", status: "not_used", count: 0 },
    { id: "fitx-built-in", label: "FITX built-in foods", status: "not_used", count: 0 },
    { id: "my-foods", label: "Your foods", status: "not_used", count: 0 },
    { id: "usda-live", label: "USDA live search", status: usdaKey ? "not_used" : "not_configured", count: 0 },
    { id: "open-food-facts", label: "Open Food Facts", status: "not_used", count: 0 },
  ];
  const report = (id: SourceId, status: SourceState, count: number) => {
    const source = sources.find((item) => item.id === id);
    if (source) Object.assign(source, { status, count });
  };

  // Browse skips the quota above, so it must answer before anything that calls an outside service.
  if (browse) {
    const copies = await catalogueCopies(supabase, services.stapleFoods.filter(heldByCatalogue).map((food) => food.id));
    if (!copies) {
      report("fitx-built-in", "ok", services.stapleFoods.length);
      return respond({ foods: [...services.stapleFoods], sources, pick: null, mode: "browse" });
    }
    const staples = withCatalogueCopies(services.stapleFoods, copies);
    const fromCatalogue = staples.filter((food) => copies.has(food.id)).length;
    report("fitx-catalog", fromCatalogue ? "ok" : "no_results", fromCatalogue);
    if (staples.length > fromCatalogue) report("fitx-built-in", "ok", staples.length - fromCatalogue);
    return respond({ foods: staples, sources, pick: null, mode: "browse" });
  }

  if (params.has("barcode")) {
    const checked = checkBarcode(barcode);
    if (!checked.ok) return respond({ foods: [], sources, pick: null, mode: "barcode", barcodeStatus: "invalid", error: barcodeProblem(checked.reason) });
    // The user's own food with this barcode comes first (custom_foods.barcode, from the nutrition v2 migration).
    const own = await supabase.from("custom_foods").select(CUSTOM_COLUMNS_V2)
      .eq("user_id", user.id).eq("barcode", checked.code).is("archived_at", null).limit(1);
    if (!own.error && own.data?.length) {
      const food = customRowToFood(own.data[0] as unknown as Record<string, unknown>);
      report("my-foods", "ok", 1);
      return respond({ foods: [food], sources, pick: food, mode: "barcode", barcodeStatus: "found" });
    }
    // Before the v2 migration there are no barcodes on your foods to check, so the source is simply not used.
    report("my-foods", own.error ? (isMissingColumnError(own.error) ? "not_used" : "error") : "no_results", 0);
    const answer = await services.lookupProduct(checked.code);
    report("open-food-facts", answer.status, answer.foods.length);
    const barcodeStatus = answer.foods.length ? "found" : answer.noLabel ? "no_label"
      : answer.status === "rate_limited" ? "rate_limited" : answer.status === "timeout" ? "timeout"
      : answer.status === "error" ? "unavailable" : "not_found";
    return respond({ foods: answer.foods, sources, pick: answer.foods[0] ?? null, mode: "barcode", barcodeStatus, productName: answer.productName });
  }

  const query = parseFoodQuery((params.get("q") || "").slice(0, 100));
  const searchText = query.words.map(singular).join(" ");
  if (searchText.length < 2) return respond({ foods: [], sources, pick: null, mode: "catalog" });

  if (params.get("packaged") === "1") {
    const answer = await services.searchProducts(searchText);
    report("open-food-facts", answer.status, answer.foods.length);
    return respond({ foods: answer.foods, sources, pick: null, mode: "packaged" });
  }

  // FITX's catalogue in the database, with the built-in list for the foods it did not return. Their ids are the
  // same FDC ids, so a food the database has is listed once, with the database's values.
  let mode: "catalog" | "fallback" = "catalog";
  let fromDb: RankableFood[] = [];
  let custom: RankableFood[];
  /** The catalogue food each of your own foods was copied from (its source_ref), by your food's id. */
  let copiedFrom: Map<string, string>;
  let catalogState: SourceState;
  let seeded = false;
  const { data: rows, error } = await supabase.rpc("search_foods", { phrase: searchText, stems: stemsFor(query.words), max_results: 120 });
  if (!error) {
    const results = (Array.isArray(rows) ? rows : []).map((row) => searchRowToFood(row as Record<string, unknown>));
    fromDb = results.filter((food) => food.kind === "catalog");
    custom = results.filter((food) => food.kind === "custom");
    copiedFrom = await sourceRefs(supabase, user.id, custom.map((food) => food.id));
    catalogState = "no_results";
    seeded = fromDb.length > 0;
    if (!fromDb.length) {
      // The catalogue tables can exist before any seed part is applied: an empty catalogue is not set up, not a miss.
      const probe = await supabase.from("food_catalog").select("id").limit(1);
      if (!probe.error && !probe.data?.length) { mode = "fallback"; catalogState = "not_used"; }
      seeded = !probe.error && Boolean(probe.data?.length);
    }
  } else {
    // Before the migrations the function is missing, which is expected; anything else is an outage worth showing.
    if (!isMissingFunctionError(error)) console.warn("FITX food catalogue search failed", error.code);
    mode = "fallback";
    catalogState = isMissingFunctionError(error) ? "not_used" : "error";
    ({ foods: custom, copiedFrom } = await customFoods(supabase, user.id));
  }
  const inDb = new Set(fromDb.map((food) => food.id));
  let builtIn = services.localFoods.filter((food) => !inDb.has(food.id));
  if (seeded) {
    // Bundled foods that match but that search_foods did not return: Admin hid them, or only their bundled
    // everyday names match. Show the catalogue's current row, or nothing when it is hidden.
    builtIn = rankFoods(builtIn, query.words);
    const copies = await catalogueCopies(supabase, builtIn.filter(heldByCatalogue).map((food) => food.id), { seeded: true });
    if (copies) {
      builtIn = withCatalogueCopies(builtIn, copies);
      for (const id of copies.keys()) inDb.add(id);
    }
  }
  // Your own foods copied from a catalogue food keep its measures and diet label while their values are its own, so a
  // copy of Idli still counts "3 idli" as three 38 g idlis (src/lib/food/saved-foods.ts).
  if (copiedFrom.size) {
    const sources = await copiedFoods(supabase, [...copiedFrom.values()], [...fromDb, ...builtIn], services.localFoods, seeded);
    custom = custom.map((food) => withSourceFood(food, sources.get(copiedFrom.get(food.id) ?? "")));
  }
  const ranked = rankAndPick([...fromDb, ...builtIn], custom, query.words, query);
  const dbCount = ranked.foods.filter((food) => food.kind === "catalog" && inDb.has(food.id)).length;
  const builtInCount = ranked.foods.filter((food) => food.kind === "catalog" && !inDb.has(food.id)).length;
  const customCount = ranked.foods.length - dbCount - builtInCount;
  report("fitx-catalog", catalogState === "no_results" && dbCount ? "ok" : catalogState, dbCount);
  if (builtInCount || mode === "fallback") report("fitx-built-in", builtInCount ? "ok" : "no_results", builtInCount);
  report("my-foods", customCount ? "ok" : "no_results", customCount);

  // Live USDA adds branded foods, and only when FITX found little.
  let foods: RankableFood[] = ranked.foods;
  if (usdaKey && ranked.foods.length < 8) {
    const usda = await services.searchUsda(searchText, usdaKey);
    report("usda-live", usda.status, usda.foods.length);
    const seen = new Set(foods.map((food) => `${food.source}:${food.id}`));
    foods = [...foods, ...usda.foods.filter((food) => !seen.has(`${food.source}:${food.id}`)).slice(0, 8)];
  }
  return respond({ foods: foods.slice(0, TOTAL_LIMIT), sources, pick: ranked.pick, passedOver: ranked.passedOver, mode });
}

/** The user's custom foods for the built-in search: archived ones left out once the v2 columns exist. */
async function customFoods(supabase: SupabaseClient, userId: string): Promise<{ foods: RankableFood[]; copiedFrom: Map<string, string> }> {
  const v2 = await supabase.from("custom_foods").select(CUSTOM_COLUMNS_V2).eq("user_id", userId).is("archived_at", null).order("name").limit(300);
  const result = v2.error && isMissingColumnError(v2.error)
    ? await supabase.from("custom_foods").select(CUSTOM_COLUMNS).eq("user_id", userId).order("name").limit(300)
    : v2;
  if (result.error) return { foods: [], copiedFrom: new Map() };
  const rows = (result.data ?? []) as unknown as Array<Record<string, unknown>>;
  return { foods: rows.map((row) => customRowToFood(row)), copiedFrom: refsOf(rows) };
}

/** Your foods' catalogue sources (source_ref) by food id; barcodes and blanks are left out. */
function refsOf(rows: ReadonlyArray<Record<string, unknown>>): Map<string, string> {
  return new Map(rows.flatMap((row) => {
    const ref = catalogueRef(row.source_ref);
    return ref ? [[String(row.id), ref] as [string, string]] : [];
  }));
}

/** search_foods leaves source_ref out of your foods' rows: one read for the ones it found. Nothing before Nutrition v2. */
async function sourceRefs(supabase: SupabaseClient, userId: string, ids: readonly string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { data, error } = await supabase.from("custom_foods").select("id,source_ref").eq("user_id", userId).in("id", [...ids]);
  return error || !Array.isArray(data) ? new Map() : refsOf(data as Array<Record<string, unknown>>);
}

/**
 * The catalogue foods your foods were copied from: from this search's results when they are there, else the
 * catalogue's current rows (a food Admin hid stays out), else, before the catalogue is seeded or while it can't be
 * read, the built-in list. FITX's recipe estimates are only in the built-in list.
 */
async function copiedFoods(supabase: SupabaseClient, refs: readonly string[], found: readonly RankableFood[], localFoods: readonly RankableFood[], seeded: boolean): Promise<Map<string, RankableFood>> {
  const wanted = [...new Set(refs)];
  const out = new Map<string, RankableFood>();
  for (const ref of wanted) {
    const hit = found.find((food) => food.kind === "catalog" && food.id === ref);
    if (hit) out.set(ref, hit);
  }
  const numeric = wanted.filter((ref) => !out.has(ref) && /^\d+$/.test(ref));
  const copies = numeric.length && seeded ? await catalogueCopies(supabase, numeric, { seeded: true }) : null;
  if (copies) for (const [id, food] of copies) out.set(id, food);
  for (const ref of wanted) {
    if (out.has(ref)) continue;
    const local = localFoods.find((food) => food.id === ref);
    // On a seeded catalogue, a catalogue food missing from its answer is one Admin hid.
    if (local && !(copies && heldByCatalogue(local))) out.set(ref, local);
  }
  return out;
}

function respond(body: Omit<FoodSearchResponse, "foods" | "pick" | "passedOver"> & { foods: Array<RankableFood | FoodResult>; pick: RankableFood | FoodResult | null; passedOver?: RankableFood | FoodResult | null }) {
  const { passedOver, ...rest } = body;
  const payload: FoodSearchResponse = {
    ...rest,
    foods: body.foods.map((food) => publicFood(food)),
    pick: body.pick ? { source: body.pick.source, id: body.pick.id } : null,
    ...(passedOver ? { passedOver: { source: passedOver.source, id: passedOver.id } } : {}),
  };
  return NextResponse.json(payload, { headers: { "Cache-Control": SEARCH_CACHE_CONTROL } });
}
