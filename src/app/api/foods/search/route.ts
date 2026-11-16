import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isMissingColumnError, isMissingFunctionError } from "@/lib/supabase/errors";
import { parseFoodQuery, singular } from "@/lib/domain/food-query";
import { barcodeProblem, checkBarcode } from "@/lib/food/barcode";
import { customRowToFood, publicFood, rankAndPick, searchRowToFood, stemsFor, type RankableFood } from "@/lib/food/catalog-search";
import { LOCAL_FOODS, STAPLE_FOODS } from "@/lib/food/local-catalog";
import { lookupProduct, searchProducts } from "@/lib/food/open-food-facts";
import type { FoodResult, FoodSearchResponse, SourceId, SourceState, SourceStatus } from "@/lib/food/types";
import { searchUsda } from "@/lib/food/usda-live";

/**
 * Food search for signed-in users.
 * - ?q=…            FITX's food catalogue (database function search_foods) and the user's own foods, ranked; the
 *                   built-in list of curated staples and USDA Foundation foods until the catalogue migrations are
 *                   applied. "3 idlis" searches for "idli"; the page turns the 3 into grams with the chosen food.
 * - ?q=…&packaged=1 Open Food Facts packaged products, only when the user asks (shared, rate-limited service).
 * - ?barcode=…      the user's own food with that barcode, else Open Food Facts.
 * - ?browse=1       the curated staples.
 */
const TOTAL_LIMIT = 40;
const CUSTOM_COLUMNS = "id,name,brand,serving_size,serving_grams,calories_per_100g,protein_per_100g,carbs_per_100g,fat_per_100g";
const CUSTOM_COLUMNS_V2 = `${CUSTOM_COLUMNS},barcode,origin,value_basis,image_url,image_attribution`;

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
  if (!user) return NextResponse.json({ error: "Sign in to search food." }, { status: 401 });

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
  const usdaKey = process.env.USDA_API_KEY?.trim() || "";
  const sources: SourceStatus[] = [
    { id: "fitx-catalog", label: "FITX food catalogue", status: "not_used", count: 0 },
    { id: "my-foods", label: "Your foods", status: "not_used", count: 0 },
    { id: "usda-live", label: "USDA live search", status: usdaKey ? "not_used" : "not_configured", count: 0 },
    { id: "open-food-facts", label: "Open Food Facts", status: "not_used", count: 0 },
  ];
  const report = (id: SourceId, status: SourceState, count: number) => {
    const source = sources.find((item) => item.id === id);
    if (source) Object.assign(source, { status, count });
  };

  if (params.has("barcode")) {
    const checked = checkBarcode(barcode);
    if (!checked.ok) return respond({ foods: [], sources, pick: null, mode: "barcode", barcodeStatus: "invalid", error: barcodeProblem(checked.reason) });
    // The user's own food with this barcode comes first (custom_foods.barcode, from the nutrition v2 migration).
    const own = await supabase.from("custom_foods").select(CUSTOM_COLUMNS_V2)
      .eq("user_id", user.id).eq("barcode", checked.code).is("archived_at", null).limit(1);
    if (!own.error && own.data?.length) {
      const food = customRowToFood(own.data[0]);
      report("my-foods", "ok", 1);
      return respond({ foods: [food], sources, pick: food, mode: "barcode", barcodeStatus: "found" });
    }
    // Before the v2 migration there are no barcodes on your foods to check, so the source is simply not used.
    report("my-foods", own.error ? (isMissingColumnError(own.error) ? "not_used" : "error") : "no_results", 0);
    const answer = await lookupProduct(checked.code);
    report("open-food-facts", answer.status, answer.foods.length);
    const barcodeStatus = answer.foods.length ? "found" : answer.noLabel ? "no_label"
      : answer.status === "rate_limited" ? "rate_limited" : answer.status === "timeout" ? "timeout"
      : answer.status === "error" ? "unavailable" : "not_found";
    return respond({ foods: answer.foods, sources, pick: answer.foods[0] ?? null, mode: "barcode", barcodeStatus, productName: answer.productName });
  }

  if (browse) {
    report("fitx-catalog", "ok", STAPLE_FOODS.length);
    return respond({ foods: [...STAPLE_FOODS], sources, pick: null, mode: "browse" });
  }

  const query = parseFoodQuery((params.get("q") || "").slice(0, 100));
  const searchText = query.words.map(singular).join(" ");
  if (searchText.length < 2) return respond({ foods: [], sources, pick: null, mode: "catalog" });

  if (params.get("packaged") === "1") {
    const answer = await searchProducts(searchText);
    report("open-food-facts", answer.status, answer.foods.length);
    return respond({ foods: answer.foods, sources, pick: null, mode: "packaged" });
  }

  // FITX's catalogue in the database; the built-in list until its migrations are applied.
  let mode: "catalog" | "fallback" = "catalog";
  let catalog: RankableFood[];
  let custom: RankableFood[];
  const { data: rows, error } = await supabase.rpc("search_foods", { phrase: searchText, stems: stemsFor(query.words), max_results: 120 });
  if (!error) {
    const results = (Array.isArray(rows) ? rows : []).map((row) => searchRowToFood(row as Record<string, unknown>));
    catalog = results.filter((food) => food.kind === "catalog");
    custom = results.filter((food) => food.kind === "custom");
  } else {
    if (!isMissingFunctionError(error)) console.warn("FITX food catalogue search failed", error.code);
    mode = "fallback";
    catalog = [...LOCAL_FOODS];
    custom = await customFoods(supabase, user.id);
  }
  const ranked = rankAndPick(catalog, custom, query.words);
  const catalogCount = ranked.foods.filter((food) => food.kind === "catalog").length;
  const customCount = ranked.foods.length - catalogCount;
  report("fitx-catalog", mode === "fallback" && error && !isMissingFunctionError(error) ? "error" : catalogCount ? "ok" : "no_results", catalogCount);
  if (mode === "fallback") sources[0].label = "FITX built-in foods";
  report("my-foods", customCount ? "ok" : "no_results", customCount);

  // Live USDA adds branded foods, and only when FITX found little.
  let foods: RankableFood[] = ranked.foods;
  if (usdaKey && ranked.foods.length < 8) {
    const usda = await searchUsda(searchText, usdaKey);
    report("usda-live", usda.status, usda.foods.length);
    const seen = new Set(foods.map((food) => `${food.source}:${food.id}`));
    foods = [...foods, ...usda.foods.filter((food) => !seen.has(`${food.source}:${food.id}`)).slice(0, 8)];
  }
  return respond({ foods: foods.slice(0, TOTAL_LIMIT), sources, pick: ranked.pick, mode });
}

/** The user's custom foods for the built-in search: archived ones left out once the v2 columns exist. */
async function customFoods(supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>, userId: string): Promise<RankableFood[]> {
  const v2 = await supabase.from("custom_foods").select(CUSTOM_COLUMNS_V2).eq("user_id", userId).is("archived_at", null).order("name").limit(300);
  const result = v2.error && isMissingColumnError(v2.error)
    ? await supabase.from("custom_foods").select(CUSTOM_COLUMNS).eq("user_id", userId).order("name").limit(300)
    : v2;
  if (result.error) return [];
  return ((result.data ?? []) as Array<Record<string, unknown>>).map((row) => customRowToFood(row));
}

function respond(body: Omit<FoodSearchResponse, "foods" | "pick"> & { foods: Array<RankableFood | FoodResult>; pick: RankableFood | FoodResult | null }) {
  const payload: FoodSearchResponse = {
    ...body,
    foods: body.foods.map((food) => publicFood(food)),
    pick: body.pick ? { source: body.pick.source, id: body.pick.id } : null,
  };
  return NextResponse.json(payload, { headers: { "Cache-Control": "private, max-age=60" } });
}
