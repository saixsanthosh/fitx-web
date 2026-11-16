/**
 * Nutrition data the page reads and writes directly under row-level security: custom foods, saved meals and
 * routines, targets, recent foods and logged entries. Features that need the nutrition v2 migration
 * (20261118140001) report themselves unavailable until it is applied, instead of failing.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FoodPortion } from "@/lib/domain/food-query";
import { scaleMacros } from "@/lib/domain/nutrition";
import { FOOD_PHOTO_BUCKET } from "@/lib/food/food-photos";
import type { CustomFoodOrigin, DietType, FoodResult, ValueBasis } from "@/lib/food/types";
import { basisForDataType, basisInfo, customValueBasis } from "@/lib/food/value-basis";

export const CUSTOM_SOURCE = "FITX custom food";
export const MEAL_SLOTS = ["Breakfast", "Lunch", "Dinner", "Snack"] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

/** Which nutrition v2 tables and columns exist yet. */
export interface NutritionCapabilities {
  customFoodsV2: boolean;
  templates: boolean;
  targets: boolean;
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
  return { customFoodsV2: present(custom), templates: present(templates), targets: present(targets) };
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
  protein: number;
  carbs: number;
  fat: number;
  quantity_grams: number | null;
  source: string;
  provider_id: string | null;
  serving_size: string | null;
  nutrition_snapshot: MealSnapshot | null;
}

export interface MealSnapshot {
  per_100g?: { calories?: number; protein?: number; carbs?: number; fat?: number };
  source?: string;
  data_type?: string;
  basis?: string;
  value_basis?: ValueBasis;
  kind?: string;
  /** The food's diet label when it was logged, so the diet filter also applies to Recent. */
  diet_type?: DietType;
  portion?: { count?: number; label?: string; unit?: FoodPortion["unit"]; grams_each?: number; estimate?: boolean; converted_from?: { label: string; grams: number } };
}

export const MEAL_COLUMNS = "id,date,meal,food_name,brand,barcode,servings,calories,protein,carbs,fat,quantity_grams,source,provider_id,serving_size,nutrition_snapshot";

/** Per-100 g values of a logged entry: from its snapshot, else worked out from its totals and grams. */
export function entryPer100g(entry: MealEntry): { calories: number; protein: number; carbs: number; fat: number } | null {
  const snapshot = entry.nutrition_snapshot?.per_100g;
  if (snapshot && Number.isFinite(Number(snapshot.calories))) {
    return { calories: Number(snapshot.calories) || 0, protein: Number(snapshot.protein) || 0, carbs: Number(snapshot.carbs) || 0, fat: Number(snapshot.fat) || 0 };
  }
  const grams = Number(entry.quantity_grams);
  if (!(grams > 0)) return null;
  const factor = 100 / grams;
  return { calories: Number(entry.calories) * factor, protein: Number(entry.protein) * factor, carbs: Number(entry.carbs) * factor, fat: Number(entry.fat) * factor };
}

/** The value basis a logged entry was saved with (older entries only kept the source and data type). */
export function entryBasis(entry: MealEntry): ValueBasis {
  const snapshot = entry.nutrition_snapshot;
  if (snapshot?.value_basis) return snapshot.value_basis;
  if (entry.source === CUSTOM_SOURCE) return "user_entered";
  if (entry.source === "Open Food Facts") return "label";
  return basisForDataType(snapshot?.data_type);
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
    const values = entryPer100g(entry);
    if (!values) continue;
    const valueBasis = entryBasis(entry);
    const portion = entry.nutrition_snapshot?.portion;
    const portions: FoodPortion[] = portion?.label && portion.unit && Number(portion.grams_each) > 0
      ? [{ label: portion.label, unit: portion.unit, grams: Number(portion.grams_each), estimate: portion.estimate !== false, countDefault: portion.unit === "piece" || portion.unit === "serving" }]
      : [];
    foods.push({
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
      fiber: null,
      sugar: null,
      sodiumMg: null,
      source: entry.source,
      dataType: entry.nutrition_snapshot?.data_type ?? null,
      valueBasis,
      basis: entry.nutrition_snapshot?.basis ?? basisInfo(valueBasis).label,
      state: null,
      dietType: DIET_TYPES.has(String(entry.nutrition_snapshot?.diet_type)) ? (entry.nutrition_snapshot?.diet_type as DietType) : null,
      portions,
      barcode: entry.barcode,
      origin: null,
      recentCount: 0,
      suggestion: false,
    });
    if (foods.length >= limit) break;
  }
  return foods;
}

const DIET_TYPES = new Set(["vegan", "veg", "egg", "non_veg"]);

/**
 * Recent foods with your own foods as they are saved now: an edit applies at once, and a deleted food drops out,
 * so Recent never re-logs values you have corrected. Other foods keep what was logged.
 */
export function withCurrentCustomFoods(recent: readonly FoodResult[], rows: readonly CustomFoodRow[], photoFor: (row: CustomFoodRow) => string | null = () => null): FoodResult[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return recent.flatMap((food) => {
    if (food.kind !== "custom") return [food];
    const row = byId.get(food.id);
    return row ? [customFoodResult(row, photoFor(row))] : [];
  });
}

/** A custom food as stored (values per 100 g), with the v2 fields when the migration is applied. */
export interface CustomFoodRow {
  id: string;
  name: string;
  brand: string | null;
  serving_size: string | null;
  serving_grams: number | null;
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  barcode?: string | null;
  origin?: CustomFoodOrigin | null;
  value_basis?: ValueBasis | null;
  image_path?: string | null;
  image_url?: string | null;
  image_attribution?: string | null;
  source_ref?: string | null;
  archived_at?: string | null;
}

const CUSTOM_V1 = "id,name,brand,serving_size,serving_grams,calories_per_100g,protein_per_100g,carbs_per_100g,fat_per_100g";
const CUSTOM_V2 = `${CUSTOM_V1},barcode,origin,value_basis,image_path,image_url,image_attribution,source_ref,archived_at`;

export async function loadCustomFoods(supabase: SupabaseClient, userId: string, v2: boolean): Promise<{ rows: CustomFoodRow[]; error: boolean }> {
  const query = supabase.from("custom_foods").select(v2 ? CUSTOM_V2 : CUSTOM_V1).eq("user_id", userId).order("name").limit(300);
  const { data, error } = v2 ? await query.is("archived_at", null) : await query;
  return { rows: (data ?? []) as unknown as CustomFoodRow[], error: Boolean(error) };
}

/** What the custom-food form collects. Values are for one serving, as printed on most labels. */
export interface CustomFoodInput {
  name: string;
  brand: string;
  servingLabel: string;
  servingGrams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
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
  const per100 = (value: number) => Math.round((value * 100 / input.servingGrams) * 100) / 100;
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

async function removePhotoFile(supabase: SupabaseClient, userId: string, path: string | null | undefined) {
  if (path && path.startsWith(`${userId}/foods/`)) await supabase.storage.from(FOOD_PHOTO_BUCKET).remove([path]);
}

/** A custom food as a search result; `photoUrl` is a signed link to the user's own photo of it. */
export function customFoodResult(row: CustomFoodRow, photoUrl: string | null = null): FoodResult {
  const serving = Number(row.serving_grams) > 0 ? Number(row.serving_grams) : 100;
  const label = row.serving_size && !/^\d+(\.\d+)?\s*g$/i.test(row.serving_size) ? `1 serving (${row.serving_size}, ${round1(serving)} g)` : `1 serving (${round1(serving)} g)`;
  const origin = row.origin ?? "user";
  const valueBasis = customValueBasis(origin, row.value_basis);
  return {
    id: row.id,
    kind: "custom",
    name: row.name,
    brand: row.brand,
    image: photoUrl ?? row.image_url ?? null,
    imageCredit: photoUrl ? "Your photo" : row.image_url ? row.image_attribution ?? null : null,
    sourceUrl: null,
    calories: Number(row.calories_per_100g),
    protein: Number(row.protein_per_100g),
    carbs: Number(row.carbs_per_100g),
    fat: Number(row.fat_per_100g),
    fiber: null,
    sugar: null,
    sodiumMg: null,
    source: CUSTOM_SOURCE,
    dataType: null,
    valueBasis,
    basis: origin === "ai_coach" ? `${basisInfo("ai_suggested").label} · saved` : `Your food · ${basisInfo(valueBasis).label}`,
    state: null,
    dietType: null,
    portions: [{ label, unit: "serving", grams: serving, countDefault: true, estimate: false }],
    barcode: row.barcode ?? null,
    origin,
    recentCount: 0,
    suggestion: false,
  };
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
export async function saveTemplate(supabase: SupabaseClient, userId: string, name: string, kind: "meal" | "day", entries: MealEntry[], slot: MealSlot | null) {
  const created = await supabase.from("meal_templates").insert({ user_id: userId, name: name.trim(), kind, meal_slot: kind === "meal" ? slot : null }).select("id").single();
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
    calories: Number(entry.calories) || 0,
    protein: Number(entry.protein) || 0,
    carbs: Number(entry.carbs) || 0,
    fat: Number(entry.fat) || 0,
    nutrition_snapshot: entry.nutrition_snapshot ?? {},
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

/** New meals rows for a date from saved items; a saved meal can go into another slot. One insert, so all or nothing. */
export function rowsFromItems(userId: string, date: string, items: Array<MealTemplateItem | MealEntry>, slot: MealSlot | null) {
  return items.map((item) => ({
    user_id: userId,
    date,
    meal: slot ?? slotOf("meal_slot" in item ? item.meal_slot : item.meal),
    food_name: item.food_name,
    brand: item.brand,
    barcode: "barcode" in item ? item.barcode : null,
    source: item.source,
    provider_id: item.provider_id,
    serving_size: item.serving_size,
    servings: Number(item.quantity_grams) > 0 ? Number(item.quantity_grams) / 100 : 1,
    quantity_grams: item.quantity_grams,
    calories: Number(item.calories) || 0,
    protein: Number(item.protein) || 0,
    carbs: Number(item.carbs) || 0,
    fat: Number(item.fat) || 0,
    nutrition_snapshot: item.nutrition_snapshot ?? {},
  }));
}

export async function insertEntries(supabase: SupabaseClient, rows: ReturnType<typeof rowsFromItems>) {
  if (!rows.length) return { error: null };
  return supabase.from("meals").insert(rows);
}

/** Changes a logged entry's amount (recomputing its totals from per-100 g values), meal or date. */
export function entryUpdate(entry: MealEntry, change: { grams: number; servingSize: string; portion: MealSnapshot["portion"] | null; meal: string; date: string }) {
  const per100 = entryPer100g(entry);
  const totals = per100 ? scaleMacros(per100, change.grams) : null;
  const snapshot: MealSnapshot = { ...(entry.nutrition_snapshot ?? {}) };
  if (per100 && !snapshot.per_100g) snapshot.per_100g = { calories: round1(per100.calories), protein: round1(per100.protein), carbs: round1(per100.carbs), fat: round1(per100.fat) };
  if (change.portion) snapshot.portion = change.portion;
  else delete snapshot.portion;
  return {
    meal: change.meal,
    date: change.date,
    ...(totals ? { calories: totals.calories, protein: totals.protein, carbs: totals.carbs, fat: totals.fat, quantity_grams: change.grams, servings: change.grams / 100 } : {}),
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

/** A typed custom food's energy against 4/4/9 kcal per gram; a warning when they disagree a lot. */
export function customFoodWarning(calories: number, protein: number, carbs: number, fat: number): string | null {
  const fromMacros = protein * 4 + carbs * 4 + fat * 9;
  if (fromMacros < 20 && calories < 20) return null;
  const gap = Math.abs(fromMacros - calories);
  if (gap <= Math.max(25, calories * 0.25)) return null;
  return `Protein, carbs and fat add up to about ${Math.round(fromMacros)} kcal per serving, but you entered ${Math.round(calories)} kcal. Check the label (fibre and alcohol also count).`;
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}
