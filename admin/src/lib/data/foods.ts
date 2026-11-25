import "server-only";
import { requireAdmin } from "@/lib/admin-auth";
import { isContentMigrationMissing } from "@/lib/content/errors";
import { logServerError } from "@/lib/log";
import { isMissingTable } from "@/lib/schema";
import { searchText } from "@/lib/search-params";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { likePattern } from "./exercises";

export const FOOD_PAGE_SIZE = 30;
/** Search on the lower-case name, aliases and keywords that food_catalog_before_write() keeps. */
const NO_CATEGORY = "__none";

export type FoodFilters = { q: string; category: string; visibility: "all" | "shown" | "hidden"; source: "all" | "admin" | "usda"; page: number };

type Params = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (typeof value === "string" ? value : Array.isArray(value) ? (value[0] ?? "") : "");

export function parseFoodFilters(params: Params): FoodFilters {
  const visibility = first(params.visibility);
  const source = first(params.source);
  const page = Number(first(params.page));
  return {
    q: searchText(first(params.q), 80),
    category: first(params.category).slice(0, 120),
    visibility: visibility === "shown" || visibility === "hidden" ? visibility : "all",
    source: source === "admin" || source === "usda" ? source : "all",
    page: Number.isInteger(page) && page >= 1 && page <= 1000 ? page : 1,
  };
}

export { NO_CATEGORY };

export type FoodRow = {
  id: string;
  name: string;
  category: string | null;
  diet_type: string | null;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  value_basis: string;
  source: string;
  image_url: string | null;
  is_active: boolean;
};

const LIST_COLUMNS = "id,name,category,diet_type,kcal,protein_g,carbs_g,fat_g,value_basis,source,image_url,is_active";

export async function listFoods(filters: FoodFilters) {
  await requireAdmin("nutrition.manage");
  const supabase = createAdminSupabase();
  if (!supabase) return { state: "service_key_missing" as const };
  let query = supabase.from("food_catalog").select(LIST_COLUMNS, { count: "exact" }).order("name");
  if (filters.q) query = query.ilike("search_text", likePattern(filters.q.toLowerCase()));
  if (filters.category === NO_CATEGORY) query = query.is("category", null);
  else if (filters.category) query = query.eq("category", filters.category);
  if (filters.visibility !== "all") query = query.eq("is_active", filters.visibility === "shown");
  if (filters.source === "admin") query = query.eq("source", "fitx_admin");
  if (filters.source === "usda") query = query.eq("source", "usda_fdc");
  const from = (filters.page - 1) * FOOD_PAGE_SIZE;
  const { data, error, count } = await query.range(from, from + FOOD_PAGE_SIZE - 1);
  if (error) {
    logServerError("data.list_foods", error);
    return { state: isMissingTable(error) ? ("migration_pending" as const) : ("query_failed" as const) };
  }
  return { state: "ready" as const, rows: (data ?? []).map(toFoodRow), total: count ?? 0 };
}

const numberOr = (value: unknown, fallback: number) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const nullableNumber = (value: unknown) => (value === null || value === undefined || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null);

function toFoodRow(row: Record<string, unknown>): FoodRow {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    category: typeof row.category === "string" ? row.category : null,
    diet_type: typeof row.diet_type === "string" ? row.diet_type : null,
    kcal: numberOr(row.kcal, 0),
    protein_g: numberOr(row.protein_g, 0),
    carbs_g: numberOr(row.carbs_g, 0),
    fat_g: numberOr(row.fat_g, 0),
    value_basis: String(row.value_basis ?? ""),
    source: String(row.source ?? ""),
    image_url: typeof row.image_url === "string" ? row.image_url : null,
    is_active: row.is_active === true,
  };
}

export type FoodDetail = FoodRow & {
  aliases: string[];
  keywords: string[];
  cuisine: string | null;
  state: string | null;
  fiber_g: number | null;
  sugar_g: number | null;
  sodium_mg: number | null;
  source_ref: string | null;
  source_data_type: string | null;
  source_version: string | null;
  licence: string;
  attribution: string | null;
  image_license: string | null;
  image_attribution: string | null;
  updated_at: string;
};

export type FoodPortion = { label: string; unit: string; grams: number; is_default: boolean; is_estimate: boolean; source: string };

export async function getFood(id: string) {
  await requireAdmin("nutrition.manage");
  const supabase = createAdminSupabase();
  if (!supabase) return { state: "service_key_missing" as const };
  const [food, portions] = await Promise.all([
    supabase
      .from("food_catalog")
      .select(`${LIST_COLUMNS},aliases,keywords,cuisine,state,fiber_g,sugar_g,sodium_mg,source_ref,source_data_type,source_version,licence,attribution,image_license,image_attribution,updated_at`)
      .eq("id", id)
      .maybeSingle(),
    supabase.from("food_portions").select("label,unit,grams,is_default,is_estimate,source,sort_order").eq("food_id", id).order("sort_order"),
  ]);
  const error = food.error ?? portions.error;
  if (error) {
    logServerError("data.get_food", error);
    return { state: isMissingTable(error) ? ("migration_pending" as const) : ("query_failed" as const) };
  }
  if (!food.data) return { state: "not_found" as const };
  const row = food.data as Record<string, unknown>;
  const detail: FoodDetail = {
    ...toFoodRow(row),
    aliases: Array.isArray(row.aliases) ? row.aliases.map(String) : [],
    keywords: Array.isArray(row.keywords) ? row.keywords.map(String) : [],
    cuisine: typeof row.cuisine === "string" ? row.cuisine : null,
    state: typeof row.state === "string" ? row.state : null,
    fiber_g: nullableNumber(row.fiber_g),
    sugar_g: nullableNumber(row.sugar_g),
    sodium_mg: nullableNumber(row.sodium_mg),
    source_ref: typeof row.source_ref === "string" ? row.source_ref : null,
    source_data_type: typeof row.source_data_type === "string" ? row.source_data_type : null,
    source_version: typeof row.source_version === "string" ? row.source_version : null,
    licence: String(row.licence ?? ""),
    attribution: typeof row.attribution === "string" ? row.attribution : null,
    image_license: typeof row.image_license === "string" ? row.image_license : null,
    image_attribution: typeof row.image_attribution === "string" ? row.image_attribution : null,
    updated_at: String(row.updated_at ?? ""),
  };
  const list: FoodPortion[] = ((portions.data ?? []) as Array<Record<string, unknown>>).map((portion) => ({
    label: String(portion.label ?? ""),
    unit: String(portion.unit ?? "serving"),
    grams: numberOr(portion.grams, 0),
    is_default: portion.is_default === true,
    is_estimate: portion.is_estimate !== false,
    source: String(portion.source ?? ""),
  }));
  return { state: "ready" as const, food: detail, portions: list };
}

export type FoodCategory = { category: string | null; foods: number; active: number };

export async function getFoodCategories() {
  const operator = await requireAdmin("nutrition.manage");
  const supabase = createAdminSupabase();
  if (!supabase) return { state: "service_key_missing" as const };
  const { data, error } = await supabase.rpc("fitx_admin_op_food_categories", { p_operator_id: operator.id });
  if (error) {
    if (!isContentMigrationMissing(error)) logServerError("data.food_categories", error);
    return { state: isContentMigrationMissing(error) ? ("migration_pending" as const) : ("query_failed" as const) };
  }
  const categories: FoodCategory[] = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    category: typeof row.category === "string" ? row.category : null,
    foods: numberOr(row.foods, 0),
    active: numberOr(row.active, 0),
  }));
  return { state: "ready" as const, categories };
}
