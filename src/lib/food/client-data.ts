/**
 * Nutrition data the page reads and writes directly under row-level security: custom foods, saved meals and
 * routines, targets, recent foods and logged entries. Features that need the nutrition v2 migration
 * (20261118140001) report themselves unavailable until it is applied, instead of failing.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FoodPortion } from "@/lib/domain/food-query";
import { DEFAULT_MEALS, mealSections, SECTION_DAYS } from "@/lib/domain/meal-time";
import { MACRO_KEYS, scaleMacros, type MacroKey } from "@/lib/domain/nutrition";
import { localDateKey } from "@/lib/domain/dates";
import { parseExtraNutrients } from "@/lib/food/custom-nutrients";
import { FOOD_PHOTO_BUCKET, FoodPhotoError, photoRetryText, uploadFoodPhoto } from "@/lib/food/food-photos";
import type { CustomFoodOrigin, DietType, FoodResult, ValueBasis } from "@/lib/food/types";
import { basisForDataType, basisInfo, customValueBasis } from "@/lib/food/value-basis";
import { catalogueCopies } from "@/lib/food/catalogue-copies";
import { catalogueRef, customServingPortion, withSourceFood } from "@/lib/food/saved-foods";

export const CUSTOM_SOURCE = "FITX custom food";
export const MEAL_SLOTS = DEFAULT_MEALS;
export type MealSlot = (typeof MEAL_SLOTS)[number];

/** Which nutrition v2 tables and columns exist yet. */
export interface NutritionCapabilities {
  customFoodsV2: boolean;
  templates: boolean;
  targets: boolean;
  /**
   * Fibre, sugar, saturated fat and sodium on a custom food. Always false for now: the column for them exists only on
   * production, and the migration tests keep the app from naming it until the owner settles it (runbook 1.8).
   */
  customExtra: boolean;
}

/** Codes PostgREST and Postgres use for a table or column that does not exist yet. */
export function isMissingSchema(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "PGRST205" || code === "42P01" || code === "PGRST204" || code === "42703" || code === "PGRST200";
}

/**
 * Only a table or column that does not exist means the migration is missing. Any other failure (a timeout, a 5xx)
 * says nothing about the schema, so the feature counts as there and its own load reports the problem.
 */
export async function detectCapabilities(supabase: SupabaseClient): Promise<NutritionCapabilities> {
  const [custom, templates, targets] = await Promise.all([
    supabase.from("custom_foods").select("archived_at").limit(1),
    supabase.from("meal_templates").select("id").limit(1),
    supabase.from("nutrition_targets").select("user_id").limit(1),
  ]);
  const present = (result: { error: unknown }) => !result.error || !isMissingSchema(result.error);
  return { customFoodsV2: present(custom), templates: present(templates), targets: present(targets), customExtra: false };
}

/** A logged entry (public.meals). Totals are for the logged amount. */
export interface MealEntry {
  id: string;
  date: string;
  meal: string;
  food_name: string;
  brand: string | null;
  barcode: string | null;
  servings: number;
  calories: number;
  /** null: the source did not give the value (never 0). */
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  quantity_grams: number | null;
  source: string;
  provider_id: string | null;
  serving_size: string | null;
  nutrition_snapshot: MealSnapshot | null;
}

export interface MealSnapshot {
  /** Per 100 g. null means the source does not list the value; a missing key means an older entry that never recorded it. */
  per_100g?: {
    calories?: number; protein?: number | null; carbs?: number | null; fat?: number | null;
    fiber?: number | null; sugar?: number | null; saturated_fat?: number | null; sodium_mg?: number | null;
  };
  /** Protein, carbs or fat the source did not give: stored as NULL in the entry, and left out of totals. */
  missing?: MacroKey[];
  sodium_from_salt?: boolean;
  source?: string;
  data_type?: string;
  basis?: string;
  value_basis?: ValueBasis;
  kind?: string;
  /** The food's diet label when it was logged, so the diet filter also applies to Recent. */
  diet_type?: DietType;
  /** own_size: the member's own cup or spoon (FoodPortion.ownSize), never a US measure to work others out from. */
  portion?: { count?: number; label?: string; unit?: FoodPortion["unit"]; grams_each?: number; estimate?: boolean; converted_from?: { label: string; grams: number }; own_size?: boolean };
}

export const MEAL_COLUMNS = "id,date,meal,food_name,brand,barcode,servings,calories,protein,carbs,fat,quantity_grams,source,provider_id,serving_size,nutrition_snapshot";

/** Protein, carbs or fat a logged entry does not have: the snapshot's list, or any column that is NULL. */
export function entryMissing(entry: Pick<MealEntry, "protein" | "carbs" | "fat" | "nutrition_snapshot">): MacroKey[] {
  const listed = new Set<string>(Array.isArray(entry.nutrition_snapshot?.missing) ? entry.nutrition_snapshot?.missing : []);
  return MACRO_KEYS.filter((key) => entry[key] === null || entry[key] === undefined || listed.has(key));
}

/**
 * Per-100 g values of a logged entry: from its snapshot, else worked out from its totals and grams. Values the
 * entry does not have are listed in `missing` (and are 0 here only so the arithmetic works).
 */
export function entryPer100g(entry: MealEntry): { calories: number; protein: number; carbs: number; fat: number; missing: MacroKey[] } | null {
  const missing = entryMissing(entry);
  const snapshot = entry.nutrition_snapshot?.per_100g;
  if (snapshot && Number.isFinite(Number(snapshot.calories))) {
    const value = (key: MacroKey) => (missing.includes(key) ? 0 : Number(snapshot[key]) || 0);
    return { calories: Number(snapshot.calories) || 0, protein: value("protein"), carbs: value("carbs"), fat: value("fat"), missing };
  }
  const grams = Number(entry.quantity_grams);
  if (!(grams > 0)) return null;
  const factor = 100 / grams;
  const value = (key: MacroKey) => (missing.includes(key) ? 0 : Number(entry[key]) * factor);
  return { calories: Number(entry.calories) * factor, protein: value("protein"), carbs: value("carbs"), fat: value("fat"), missing };
}

/**
 * The columns and snapshot to write for `grams` of a food. Protein, carbs or fat the source does not list are NULL in
 * the entry and listed in snapshot.missing, never 0. Fibre, sugar, saturated fat and sodium go into the snapshot
 * (per 100 g, null where the source is silent), so the entry keeps everything the product had.
 */
export function buildMealValues(food: FoodResult, grams: number): {
  calories: number; protein: number | null; carbs: number | null; fat: number | null;
  snapshot: Pick<MealSnapshot, "per_100g" | "missing" | "sodium_from_salt">;
} {
  const scaled = scaleMacros(food, grams);
  const missing = MACRO_KEYS.filter((key) => food.missing?.includes(key));
  const known = (key: MacroKey, value: number) => (missing.includes(key) ? null : value);
  return {
    calories: scaled.calories,
    protein: known("protein", scaled.protein),
    carbs: known("carbs", scaled.carbs),
    fat: known("fat", scaled.fat),
    snapshot: {
      per_100g: {
        calories: food.calories,
        protein: known("protein", food.protein), carbs: known("carbs", food.carbs), fat: known("fat", food.fat),
        fiber: food.fiber ?? null, sugar: food.sugar ?? null, saturated_fat: food.saturatedFat ?? null, sodium_mg: food.sodiumMg ?? null,
      },
      ...(missing.length ? { missing } : {}),
      ...(food.sodiumFromSalt ? { sodium_from_salt: true } : {}),
    },
  };
}

/** The value basis a logged entry was saved with (older entries only kept the source and data type). */
export function entryBasis(entry: Pick<MealEntry, "nutrition_snapshot" | "source">): ValueBasis {
  const snapshot = entry.nutrition_snapshot;
  if (snapshot?.value_basis) return snapshot.value_basis;
  if (entry.source === CUSTOM_SOURCE) return "user_entered";
  if (entry.source === "Open Food Facts") return "label";
  return basisForDataType(snapshot?.data_type);
}

/** A logged entry as a food that can be logged again, rebuilt from its snapshot; null when it has no per-100 g values. */
export function foodFromEntry(entry: MealEntry): FoodResult | null {
  const values = entryPer100g(entry);
  if (!values) return null;
  const snapshot = entry.nutrition_snapshot;
  const valueBasis = entryBasis(entry);
  const portion = snapshot?.portion;
  const portions: FoodPortion[] = portion?.label && portion.unit && Number(portion.grams_each) > 0
    ? [{ label: portion.label, unit: portion.unit, grams: Number(portion.grams_each), estimate: portion.estimate !== false, countDefault: portion.unit === "piece" || portion.unit === "serving", ...(portion.own_size === true ? { ownSize: true } : {}) }]
    : [];
  const stored = snapshot?.per_100g;
  const optional = (value: number | null | undefined) => (value === null || value === undefined || !Number.isFinite(Number(value)) ? null : round1(Number(value)));
  return {
    id: entry.provider_id ?? `recent:${entry.id}`,
    kind: entry.source === CUSTOM_SOURCE ? "custom" : entry.source === "Open Food Facts" ? "packaged" : "catalog",
    name: entry.food_name,
    brand: entry.brand,
    image: null,
    imageCredit: null,
    sourceUrl: null,
    calories: round1(values.calories),
    protein: round1(values.protein),
    carbs: round1(values.carbs),
    fat: round1(values.fat),
    missing: values.missing,
    fiber: optional(stored?.fiber),
    sugar: optional(stored?.sugar),
    saturatedFat: optional(stored?.saturated_fat),
    sodiumMg: optional(stored?.sodium_mg),
    sodiumFromSalt: snapshot?.sodium_from_salt === true,
    source: entry.source,
    dataType: snapshot?.data_type ?? null,
    valueBasis,
    basis: snapshot?.basis ?? basisInfo(valueBasis).label,
    state: null,
    dietType: DIET_TYPES.has(String(snapshot?.diet_type)) ? (snapshot?.diet_type as DietType) : null,
    portions,
    barcode: entry.barcode,
    origin: null,
    recentCount: 0,
    suggestion: false,
  };
}

/**
 * The amount an entry was logged as, for choosing it again: its count of the portion foodFromEntry rebuilds (always
 * that food's first portion, "portion:0"), else its grams. Null when the entry has neither.
 */
export function usualAmount(entry: Pick<MealEntry, "nutrition_snapshot" | "quantity_grams">): { amount: number; unitKey: string } | null {
  const portion = entry.nutrition_snapshot?.portion;
  const count = Number(portion?.count);
  if (portion?.label && portion.unit && Number(portion.grams_each) > 0 && Number.isFinite(count) && count > 0) return { amount: count, unitKey: "portion:0" };
  const grams = Number(entry.quantity_grams);
  return Number.isFinite(grams) && grams > 0 ? { amount: round1(grams), unitKey: "g" } : null;
}

/** Whether an entry's values or its grams are an estimate (a typical recipe, an AI suggestion, an average portion weight). */
export function isEstimateSnapshot(entry: Pick<MealEntry, "nutrition_snapshot" | "source">): boolean {
  return Boolean(entry.nutrition_snapshot?.portion?.estimate) || basisInfo(entryBasis(entry)).estimate;
}

/** Whether two meal section names are the same section (no regard to case or surrounding space). */
export function sameMeal(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Recently logged foods, newest first and each once, rebuilt from their snapshots so they can be logged again. */
export async function loadRecentFoods(supabase: SupabaseClient, userId: string, limit = 12): Promise<FoodResult[]> {
  const { data, error } = await supabase.from("meals").select(MEAL_COLUMNS).eq("user_id", userId).order("created_at", { ascending: false }).limit(150);
  if (error || !data) return [];
  const seen = new Set<string>();
  const foods: FoodResult[] = [];
  for (const entry of data as MealEntry[]) {
    const key = `${entry.source}:${entry.provider_id ?? entry.food_name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const food = foodFromEntry(entry);
    if (!food) continue;
    foods.push(food);
    if (foods.length >= limit) break;
  }
  return foods;
}

/** A food the member logs often, with the amount they usually log. */
export interface FrequentFood {
  key: string;
  name: string;
  brand: string | null;
  /** Times it was logged in the window. */
  count: number;
  /** The entry that carries the usual amount, so one tap can log a copy of it. */
  entry: MealEntry;
  /** "150 g" or "2 x 1 item (76 g)". */
  amountText: string;
}

/**
 * The foods logged at least `minCount` times in `entries` (the member's own last 30 days), most often first, each
 * with its most common amount. Entries should be newest first so ties go to the newest. Pure, so it can be tested.
 */
export function frequentFromEntries(entries: readonly MealEntry[], minCount = 2, limit = 8): FrequentFood[] {
  const groups = new Map<string, MealEntry[]>();
  for (const entry of entries) {
    const key = `${entry.source}:${entry.provider_id ?? entry.food_name.trim().toLowerCase()}`;
    const list = groups.get(key);
    if (list) list.push(entry); else groups.set(key, [entry]);
  }
  const out: FrequentFood[] = [];
  for (const [key, list] of groups) {
    if (list.length < minCount) continue;
    const tally = new Map<string, { entries: MealEntry[] }>();
    for (const entry of list) {
      const grams = Number(entry.quantity_grams) > 0 ? round1(Number(entry.quantity_grams)) : 0;
      if (!(grams > 0)) continue;
      const bucket = tally.get(String(grams));
      if (bucket) bucket.entries.push(entry); else tally.set(String(grams), { entries: [entry] });
    }
    // The most common grams; on a tie the amount used most recently (the first one met, as entries are newest first).
    let best: MealEntry | null = null;
    let bestCount = 0;
    for (const { entries: same } of tally.values()) if (same.length > bestCount) { best = same[0]; bestCount = same.length; }
    if (!best) continue;
    const grams = round1(Number(best.quantity_grams));
    out.push({ key, name: best.food_name, brand: best.brand, count: list.length, entry: best, amountText: best.nutrition_snapshot?.portion && best.serving_size ? best.serving_size : `${grams} g` });
  }
  return out.sort((a, b) => b.count - a.count).slice(0, limit);
}

/** The member's meals of the last 30 days, newest first: what Frequent foods and the meal sections are built from. */
export async function loadRecentMeals(supabase: SupabaseClient, userId: string, today: Date, days = SECTION_DAYS) {
  const since = localDateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - days));
  const { data, error } = await supabase.from("meals").select(MEAL_COLUMNS).eq("user_id", userId).gte("date", since)
    .order("date", { ascending: false }).order("created_at", { ascending: false }).limit(600);
  return error ? [] : ((data ?? []) as MealEntry[]);
}

/** Meal sections to offer: the four standard ones plus every other name used in `entries`. */
export function sectionsFromEntries(entries: ReadonlyArray<Pick<MealEntry, "meal">>, extra: readonly string[] = []): string[] {
  return mealSections(entries.map((entry) => entry.meal), extra);
}

const DIET_TYPES = new Set(["vegan", "veg", "egg", "non_veg"]);

/**
 * Recent foods with your own foods as they are saved now: an edit applies at once, and a deleted food drops out,
 * so Recent never re-logs values you have corrected. Other foods keep what was logged.
 */
export function withCurrentCustomFoods(
  recent: readonly FoodResult[],
  rows: readonly CustomFoodRow[],
  photoFor: (row: CustomFoodRow) => string | null = () => null,
  savedFrom: SavedFrom = new Map(),
): FoodResult[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return recent.flatMap((food) => {
    if (food.kind !== "custom") return [food];
    const row = byId.get(food.id);
    return row ? [customFoodResult(row, photoFor(row), sourceOf(row, savedFrom))] : [];
  });
}

/** The catalogue foods your own foods were copied from, by catalogue id (their source_ref). */
export type SavedFrom = ReadonlyMap<string, Pick<FoodResult, "portions" | "dietType">>;

/** The catalogue food a saved food was copied from, when this page has it. */
export function sourceOf(row: Pick<CustomFoodRow, "source_ref">, savedFrom: SavedFrom): Pick<FoodResult, "portions" | "dietType"> | null {
  const ref = catalogueRef(row.source_ref);
  return ref ? savedFrom.get(ref) ?? null : null;
}

/**
 * The catalogue foods (with their measures and diet labels) that the member's saved foods were copied from, read under
 * row-level security. Empty when there are none, or when the catalogue can't answer (not seeded, or a read failed):
 * the saved foods then keep only their own serving.
 */
export async function loadSavedFrom(supabase: SupabaseClient, rows: readonly Pick<CustomFoodRow, "source_ref">[]): Promise<SavedFrom> {
  const ids = [...new Set(rows.map((row) => catalogueRef(row.source_ref)).filter((ref): ref is string => Boolean(ref) && /^\d+$/.test(ref as string)))];
  if (!ids.length) return new Map();
  try {
    return (await catalogueCopies(supabase, ids)) ?? new Map();
  } catch {
    return new Map();
  }
}

/** A custom food as stored (values per 100 g), with the v2 fields when the migration is applied. */
export interface CustomFoodRow {
  id: string;
  name: string;
  brand: string | null;
  serving_size: string | null;
  serving_grams: number | null;
  calories_per_100g: number;
  /** null: not known (left blank, or not on the label), never 0. Allowed from migration 20261126100000. */
  protein_per_100g: number | null;
  carbs_per_100g: number | null;
  fat_per_100g: number | null;
  barcode?: string | null;
  origin?: CustomFoodOrigin | null;
  value_basis?: ValueBasis | null;
  image_path?: string | null;
  image_url?: string | null;
  image_attribution?: string | null;
  source_ref?: string | null;
  archived_at?: string | null;
  /** Fibre, sugar, saturated fat and sodium per 100 g, when the database keeps them (see NutritionCapabilities.customExtra). */
  extra?: unknown;
}

const CUSTOM_V1 = "id,name,brand,serving_size,serving_grams,calories_per_100g,protein_per_100g,carbs_per_100g,fat_per_100g";
const CUSTOM_V2 = `${CUSTOM_V1},barcode,origin,value_basis,image_path,image_url,image_attribution,source_ref,archived_at`;

/**
 * The member's own foods. `v2` says whether the Nutrition v2 columns exist; left out, the v2 read is tried first and,
 * only if those columns are missing, the older one, so the read needn't wait for detectCapabilities.
 */
export async function loadCustomFoods(supabase: SupabaseClient, userId: string, v2?: boolean): Promise<{ rows: CustomFoodRow[]; error: boolean }> {
  const read = async (newer: boolean) => {
    const query = supabase.from("custom_foods").select(newer ? CUSTOM_V2 : CUSTOM_V1).eq("user_id", userId).order("name").limit(300);
    return newer ? await query.is("archived_at", null) : await query;
  };
  if (v2 !== false) {
    const { data, error } = await read(true);
    if (!error) return { rows: (data ?? []) as unknown as CustomFoodRow[], error: false };
    if (v2 === true || !isMissingSchema(error)) return { rows: [], error: true };
  }
  const { data, error } = await read(false);
  return { rows: (data ?? []) as unknown as CustomFoodRow[], error: Boolean(error) };
}

/** What the custom-food form collects. Values are for one serving, as printed on most labels. */
export interface CustomFoodInput {
  name: string;
  brand: string;
  servingLabel: string;
  servingGrams: number;
  calories: number;
  /** null: left blank, so not known. It is saved as NULL and shown as unknown, never as 0 g. */
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  barcode: string | null;
  /** user_entered or label for typed values; an edit that leaves the values alone keeps the food's own basis. */
  valueBasis: ValueBasis;
  origin: CustomFoodOrigin;
  imageUrl?: string | null;
  imageAttribution?: string | null;
  sourceRef?: string | null;
}

/**
 * Where a saved food's values come from. An edit that leaves the serving and values alone keeps the food's own
 * origin and basis (a typical recipe the AI coach saved stays one, and stays the coach's). Values the user typed or
 * changed are theirs: "Your entry", or "Package label" when they say they copied the label.
 */
export function savedFoodSource(
  editing: Pick<CustomFoodRow, "origin" | "value_basis"> | null,
  valuesChanged: boolean,
  fromLabel: boolean,
  newOrigin: CustomFoodOrigin,
): { origin: CustomFoodOrigin; valueBasis: ValueBasis } {
  const typed: ValueBasis = fromLabel ? "label" : "user_entered";
  if (!editing) return { origin: newOrigin, valueBasis: typed };
  const origin = editing.origin ?? "user";
  if (!valuesChanged) return { origin, valueBasis: editing.value_basis ?? typed };
  return { origin: origin === "ai_coach" ? "user" : origin, valueBasis: typed };
}

export function customFoodRowValues(input: CustomFoodInput, v2: boolean) {
  const per100 = <T extends number | null>(value: T): T => (value === null ? value : Math.round((value * 100 / input.servingGrams) * 100) / 100) as T;
  const base = {
    name: input.name.trim(),
    brand: input.brand.trim() || null,
    serving_size: input.servingLabel.trim() || `${input.servingGrams} g`,
    serving_grams: input.servingGrams,
    calories_per_100g: per100(input.calories),
    protein_per_100g: per100(input.protein),
    carbs_per_100g: per100(input.carbs),
    fat_per_100g: per100(input.fat),
  };
  if (!v2) return base;
  return {
    ...base,
    barcode: input.barcode || null,
    origin: input.origin,
    value_basis: input.valueBasis,
    ...(input.imageUrl !== undefined ? { image_url: input.imageUrl, image_attribution: input.imageAttribution ?? null } : {}),
    ...(input.sourceRef !== undefined ? { source_ref: input.sourceRef } : {}),
  };
}

/** Creates or updates a custom food; returns its row. */
export async function saveCustomFood(supabase: SupabaseClient, userId: string, input: CustomFoodInput, v2: boolean, id?: string) {
  const values = customFoodRowValues(input, v2);
  const select = v2 ? CUSTOM_V2 : CUSTOM_V1;
  const result = id
    ? await supabase.from("custom_foods").update(values).eq("id", id).eq("user_id", userId).select(select).single()
    : await supabase.from("custom_foods").insert({ user_id: userId, ...values }).select(select).single();
  return { row: (result.data ?? null) as unknown as CustomFoodRow | null, error: result.error };
}

/**
 * Deletes a custom food and its photo. Nothing else needs the row: past logs and saved meals keep their own
 * per-100 g snapshots. The photo goes only after the row, so a failed delete never leaves a food without it.
 */
export async function removeCustomFood(supabase: SupabaseClient, userId: string, row: Pick<CustomFoodRow, "id" | "image_path">) {
  const result = await supabase.from("custom_foods").delete().eq("id", row.id).eq("user_id", userId);
  if (!result.error) await removePhotoFile(supabase, userId, row.image_path);
  return result;
}

/**
 * Takes the photo off a custom food: the user's own photo (deleted from storage once the row no longer points at
 * it) and any linked package photo.
 */
export async function removeCustomFoodPhoto(supabase: SupabaseClient, userId: string, row: Pick<CustomFoodRow, "id" | "image_path">) {
  const result = await supabase.from("custom_foods").update({ image_path: null, image_url: null, image_attribution: null }).eq("id", row.id).eq("user_id", userId);
  if (!result.error) await removePhotoFile(supabase, userId, row.image_path);
  return result;
}

/**
 * Gives a custom food a new photo of the member's own (a Blob from shrinkPhoto) and returns its storage path. The order
 * keeps the food from ever pointing at a deleted file (bug 21's rule): the new photo is uploaded, the food is pointed
 * at it, and only then is the photo it had removed. When the upload fails nothing changes; when the food can't be
 * pointed at the new photo, the new upload is removed and the food keeps its old one. Every failure is a
 * FoodPhotoError, which photoNotSavedText says in FITX's words.
 */
export async function replaceCustomFoodPhoto(
  supabase: SupabaseClient,
  userId: string,
  row: Pick<CustomFoodRow, "id" | "image_path">,
  photo: Blob,
  stamp = Date.now(),
): Promise<string> {
  const path = await uploadFoodPhoto(supabase, userId, row.id, photo, stamp);
  const updated = await supabase.from("custom_foods").update({ image_path: path }).eq("id", row.id).eq("user_id", userId);
  if (updated.error) {
    await removePhotoFile(supabase, userId, path);
    // Status 0: the save never reached FITX.
    throw new FoodPhotoError(photoRetryText(updated.status === 0));
  }
  if (row.image_path !== path) await removePhotoFile(supabase, userId, row.image_path);
  return path;
}

/**
 * Removes one of the member's own food photos from storage, and only one in their own folder. Clean-up only, so it
 * never fails the step before it: the food row is what counts, and a file left in the member's own private folder is
 * harmless (deleting the account clears the folder).
 */
async function removePhotoFile(supabase: SupabaseClient, userId: string, path: string | null | undefined) {
  if (!path || !path.startsWith(`${userId}/foods/`)) return;
  try {
    await supabase.storage.from(FOOD_PHOTO_BUCKET).remove([path]);
  } catch {
    // Left in the member's own folder: harmless.
  }
}

/**
 * A custom food as a search result; `photoUrl` is a signed link to the user's own photo of it, and `source` the
 * catalogue food it was copied from (its measures and diet label apply while the values are still that food's).
 */
export function customFoodResult(row: CustomFoodRow, photoUrl: string | null = null, source: Pick<FoodResult, "portions" | "dietType"> | null = null): FoodResult {
  const origin = row.origin ?? "user";
  const valueBasis = customValueBasis(origin, row.value_basis);
  const extra = parseExtraNutrients(row.extra);
  return withSourceFood({
    id: row.id,
    kind: "custom",
    name: row.name,
    brand: row.brand,
    image: photoUrl ?? row.image_url ?? null,
    imageCredit: photoUrl ? "Your photo" : row.image_url ? row.image_attribution ?? null : null,
    sourceUrl: null,
    calories: Number(row.calories_per_100g),
    // A value the member left blank is unknown: listed in `missing` (0 here only so sums work) and logged as NULL.
    ...customMacros(row),
    fiber: extra.fiber,
    sugar: extra.sugar,
    saturatedFat: extra.saturatedFat,
    sodiumMg: extra.sodiumMg,
    source: CUSTOM_SOURCE,
    dataType: null,
    valueBasis,
    basis: origin === "ai_coach" ? `${basisInfo("ai_suggested").label} · saved` : `Your food · ${basisInfo(valueBasis).label}`,
    state: null,
    dietType: null,
    // The saved serving counts as the measure it names ("1 item", "1 cup").
    portions: [customServingPortion(row.serving_size, row.serving_grams)],
    barcode: row.barcode ?? null,
    origin,
    recentCount: 0,
    suggestion: false,
  }, source);
}

/** Saved meals ("meal") and daily routines ("day"). */
export interface MealTemplate {
  id: string;
  name: string;
  kind: "meal" | "day";
  meal_slot: MealSlot | null;
  items: MealTemplateItem[];
}

export interface MealTemplateItem {
  id?: string;
  meal_slot: MealSlot;
  food_name: string;
  brand: string | null;
  source: string;
  provider_id: string | null;
  serving_size: string | null;
  quantity_grams: number | null;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  nutrition_snapshot: MealSnapshot | null;
  sort_order?: number;
}

const TEMPLATE_ITEM_COLUMNS = "id,meal_slot,food_name,brand,source,provider_id,serving_size,quantity_grams,calories,protein,carbs,fat,nutrition_snapshot,sort_order";

export async function loadTemplates(supabase: SupabaseClient, userId: string): Promise<MealTemplate[]> {
  const { data, error } = await supabase
    .from("meal_templates")
    .select(`id,name,kind,meal_slot,meal_template_items(${TEMPLATE_ITEM_COLUMNS})`)
    .eq("user_id", userId)
    .order("name")
    .limit(100);
  if (error || !data) return [];
  return (data as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    kind: row.kind === "day" ? "day" : "meal",
    meal_slot: (MEAL_SLOTS as readonly string[]).includes(String(row.meal_slot)) ? (row.meal_slot as MealSlot) : null,
    items: ((row.meal_template_items as MealTemplateItem[] | null) ?? []).slice().sort((a, b) => Number(a.sort_order) - Number(b.sort_order)),
  }));
}

function slotOf(value: string): MealSlot {
  return (MEAL_SLOTS as readonly string[]).includes(value) ? (value as MealSlot) : "Snack";
}

/** Saves entries as a meal (one slot) or a day routine (every slot). */
export async function saveTemplate(supabase: SupabaseClient, userId: string, name: string, kind: "meal" | "day", entries: MealEntry[], slot: string | null) {
  const created = await supabase.from("meal_templates").insert({ user_id: userId, name: name.trim(), kind, meal_slot: kind === "meal" && slot ? slotOf(slot) : null }).select("id").single();
  if (created.error || !created.data) return { error: created.error ?? new Error("not saved") };
  const items = entries.map((entry, index) => ({
    template_id: created.data.id,
    user_id: userId,
    meal_slot: slotOf(entry.meal),
    food_name: entry.food_name,
    brand: entry.brand,
    source: entry.source,
    provider_id: entry.provider_id,
    serving_size: entry.serving_size,
    quantity_grams: entry.quantity_grams,
    // The template columns cannot hold NULL, so an unknown value is stored as 0 and stays listed in the snapshot's
    // `missing`, which rowsFromItems reads to put NULL back.
    calories: Number(entry.calories) || 0,
    protein: Number(entry.protein) || 0,
    carbs: Number(entry.carbs) || 0,
    fat: Number(entry.fat) || 0,
    nutrition_snapshot: { ...(entry.nutrition_snapshot ?? {}), ...(entryMissing(entry).length ? { missing: entryMissing(entry) } : {}) },
    sort_order: index,
  }));
  const inserted = await supabase.from("meal_template_items").insert(items);
  if (inserted.error) {
    await supabase.from("meal_templates").delete().eq("id", created.data.id).eq("user_id", userId);
    return { error: inserted.error };
  }
  return { error: null };
}

export async function deleteTemplate(supabase: SupabaseClient, userId: string, id: string) {
  return supabase.from("meal_templates").delete().eq("id", id).eq("user_id", userId);
}

/**
 * New meals rows for a date from saved items; a saved meal can go into another slot. One insert, so all or nothing.
 * A logged entry keeps its own meal section (a member's "Pre-workout" stays one); a saved meal's slot is one of the
 * four standard ones. Unknown protein, carbs or fat stay NULL.
 */
export function rowsFromItems(userId: string, date: string, items: Array<MealTemplateItem | MealEntry>, slot: string | null) {
  return items.map((item) => {
    const missing = entryMissing({ protein: item.protein, carbs: item.carbs, fat: item.fat, nutrition_snapshot: item.nutrition_snapshot });
    const macro = (key: MacroKey) => (missing.includes(key) ? null : Number(item[key]) || 0);
    return {
      user_id: userId,
      date,
      meal: slot ?? ("meal_slot" in item ? slotOf(item.meal_slot) : item.meal.trim() || "Snack"),
      food_name: item.food_name,
      brand: item.brand,
      barcode: "barcode" in item ? item.barcode : null,
      source: item.source,
      provider_id: item.provider_id,
      serving_size: item.serving_size,
      servings: Number(item.quantity_grams) > 0 ? Number(item.quantity_grams) / 100 : 1,
      quantity_grams: item.quantity_grams,
      calories: Number(item.calories) || 0,
      protein: macro("protein"),
      carbs: macro("carbs"),
      fat: macro("fat"),
      nutrition_snapshot: item.nutrition_snapshot ?? {},
    };
  });
}

export async function insertEntries(supabase: SupabaseClient, rows: ReturnType<typeof rowsFromItems>) {
  if (!rows.length) return { error: null, data: [] as Array<{ id: string }> };
  return supabase.from("meals").insert(rows).select("id");
}

/** Changes a logged entry's amount (recomputing its totals from per-100 g values), meal or date. Unknown values stay NULL. */
export function entryUpdate(entry: MealEntry, change: { grams: number; servingSize: string; portion: MealSnapshot["portion"] | null; meal: string; date: string }) {
  const per100 = entryPer100g(entry);
  const totals = per100 ? scaleMacros(per100, change.grams) : null;
  const snapshot: MealSnapshot = { ...(entry.nutrition_snapshot ?? {}) };
  if (per100 && !snapshot.per_100g) {
    const known = (key: MacroKey) => (per100.missing.includes(key) ? null : round1(per100[key]));
    snapshot.per_100g = { calories: round1(per100.calories), protein: known("protein"), carbs: known("carbs"), fat: known("fat") };
  }
  if (per100 && per100.missing.length) snapshot.missing = per100.missing;
  if (change.portion) snapshot.portion = change.portion;
  else delete snapshot.portion;
  const total = (key: MacroKey) => (per100?.missing.includes(key) ? null : totals?.[key] ?? null);
  return {
    meal: change.meal,
    date: change.date,
    ...(totals ? { calories: totals.calories, protein: total("protein"), carbs: total("carbs"), fat: total("fat"), quantity_grams: change.grams, servings: change.grams / 100 } : {}),
    serving_size: change.servingSize,
    nutrition_snapshot: snapshot,
    updated_at: new Date().toISOString(),
  };
}

/** Manual daily targets; null when the user has none (the app then uses its estimate). */
export interface ManualTargets {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export async function loadTargets(supabase: SupabaseClient, userId: string): Promise<ManualTargets | null> {
  const { data, error } = await supabase.from("nutrition_targets").select("calories,protein_g,carbs_g,fat_g").eq("user_id", userId).maybeSingle();
  if (error || !data) return null;
  return { calories: Number(data.calories), protein: Number(data.protein_g), carbs: Number(data.carbs_g), fat: Number(data.fat_g) };
}

export async function saveTargets(supabase: SupabaseClient, userId: string, targets: ManualTargets) {
  return supabase.from("nutrition_targets").upsert({
    user_id: userId,
    calories: Math.round(targets.calories),
    protein_g: Math.round(targets.protein),
    carbs_g: Math.round(targets.carbs),
    fat_g: Math.round(targets.fat),
  }, { onConflict: "user_id" });
}

export async function clearTargets(supabase: SupabaseClient, userId: string) {
  return supabase.from("nutrition_targets").delete().eq("user_id", userId);
}

/** Problems with typed targets, or null. Calories must be 800-8,000; a warning when macros don't add up. */
export function targetProblem(targets: ManualTargets): { error: string | null; warning: string | null } {
  const values = [targets.calories, targets.protein, targets.carbs, targets.fat];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) return { error: "Enter a number for each target.", warning: null };
  if (targets.calories < 800 || targets.calories > 8000) return { error: "Daily calories must be between 800 and 8,000 kcal.", warning: null };
  if (targets.protein > 600 || targets.carbs > 1200 || targets.fat > 400) return { error: "That macro target is too high to save.", warning: null };
  const fromMacros = targets.protein * 4 + targets.carbs * 4 + targets.fat * 9;
  const gap = Math.abs(fromMacros - targets.calories);
  const warning = gap > Math.max(100, targets.calories * 0.1)
    ? `Your protein, carbs and fat add up to about ${Math.round(fromMacros).toLocaleString()} kcal, not ${Math.round(targets.calories).toLocaleString()}.`
    : targets.calories < 1200 ? "Under 1,200 kcal a day is very low for most adults; check with a doctor or dietitian." : null;
  return { error: null, warning };
}

/**
 * Protein, carbs and fat of a custom_foods row (per 100 g) as a result has them: a NULL column is unknown, so it is
 * listed in `missing` and its number is 0 only so sums work.
 */
export function customMacros(row: Pick<CustomFoodRow, "protein_per_100g" | "carbs_per_100g" | "fat_per_100g">): Pick<FoodResult, "protein" | "carbs" | "fat"> & { missing: MacroKey[] } {
  const value = (raw: number | null | undefined) => (raw === null || raw === undefined || String(raw).trim() === "" || !Number.isFinite(Number(raw)) ? null : Number(raw));
  const protein = value(row.protein_per_100g);
  const carbs = value(row.carbs_per_100g);
  const fat = value(row.fat_per_100g);
  const missing = MACRO_KEYS.filter((key) => ({ protein, carbs, fat })[key] === null);
  return { protein: protein ?? 0, carbs: carbs ?? 0, fat: fat ?? 0, missing };
}

/**
 * A typed custom food's energy against 4/4/9 kcal per gram; a warning when they disagree a lot. Nothing to compare
 * while protein, carbs or fat is unknown.
 */
export function customFoodWarning(calories: number, protein: number | null, carbs: number | null, fat: number | null): string | null {
  if (protein === null || carbs === null || fat === null || ![calories, protein, carbs, fat].every(Number.isFinite)) return null;
  const fromMacros = protein * 4 + carbs * 4 + fat * 9;
  if (fromMacros < 20 && calories < 20) return null;
  const gap = Math.abs(fromMacros - calories);
  if (gap <= Math.max(25, calories * 0.25)) return null;
  return `Protein, carbs and fat add up to about ${Math.round(fromMacros)} kcal per serving, but you entered ${Math.round(calories)} kcal. Check the label (fibre and alcohol also count).`;
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}
