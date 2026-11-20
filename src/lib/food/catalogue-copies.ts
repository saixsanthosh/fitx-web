/**
 * The database's current copy of foods the app also bundles (src/data/fitx-staples.json and the USDA Foundation
 * snapshot). Admin can correct, rename or hide any catalogue food, so once the catalogue is seeded a bundled copy
 * must not be shown as it was: an active row replaces it and a hidden one (which row-level security leaves out)
 * drops it. Every bundled USDA food is in seed part 01 or 02 (tests/nutrition/search-route.test.ts checks this),
 * so on a seeded catalogue a bundled id the database did not return is one Admin hid.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { searchRowToFood, USDA_SOURCE, type RankableFood } from "@/lib/food/catalog-search";
import { isMissingTableError } from "@/lib/supabase/errors";

const COLUMNS = "id,name,aliases,keywords,category,diet_type,state,kcal,protein_g,carbs_g,fat_g,fiber_g,sugar_g,sodium_mg,value_basis,source_data_type,image_url,image_attribution,food_portions(label,unit,grams,is_default,is_estimate,sort_order)";

type PortionRow = { label?: unknown; unit?: unknown; grams?: unknown; is_default?: unknown; is_estimate?: unknown; sort_order?: unknown };

/** A food_catalog row with its food_portions, in the shape search_foods returns. */
export function catalogueRowToFood(row: Record<string, unknown>): RankableFood {
  const portions = (Array.isArray(row.food_portions) ? (row.food_portions as PortionRow[]) : [])
    .slice()
    .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0) || Number(a.grams ?? 0) - Number(b.grams ?? 0))
    .map((portion) => ({ label: portion.label, unit: portion.unit, grams: portion.grams, isDefault: portion.is_default === true, estimate: portion.is_estimate !== false }));
  return searchRowToFood({ ...row, kind: "catalog", portions, recent_count: 0, fuzzy: false });
}

/** Bundled foods the catalogue holds: FDC ids, not FITX's own recipe estimates. */
export function heldByCatalogue(food: Pick<RankableFood, "source">): boolean {
  return food.source === USDA_SOURCE;
}

/**
 * The catalogue's active rows for these ids, or null when the catalogue cannot answer for them: not set up, not
 * seeded yet, or unavailable. The bundled copies then stand. `seeded` skips the check for an empty catalogue
 * when the caller already knows it has rows.
 */
export async function catalogueCopies(supabase: SupabaseClient, ids: readonly string[], options: { seeded?: boolean } = {}): Promise<Map<string, RankableFood> | null> {
  const wanted = [...new Set(ids)];
  if (!wanted.length) return new Map();
  const { data, error } = await supabase.from("food_catalog").select(COLUMNS).in("id", wanted);
  if (error) {
    if (!isMissingTableError(error)) console.warn("FITX food catalogue read failed", (error as { code?: string }).code);
    return null;
  }
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  if (!rows.length && !options.seeded) {
    // Every one hidden, or a catalogue with no seed part applied yet: only the second leaves the bundled copies.
    const probe = await supabase.from("food_catalog").select("id").limit(1);
    if (probe.error || !probe.data?.length) return null;
  }
  return new Map(rows.map((row) => [String(row.id), catalogueRowToFood(row)]));
}

/**
 * The bundled foods as members should see them: each held food replaced by the catalogue's row, keeping the
 * bundled everyday names so "dahi" still finds yoghurt, or left out when the catalogue no longer shows it.
 */
export function withCatalogueCopies(foods: readonly RankableFood[], copies: ReadonlyMap<string, RankableFood>): RankableFood[] {
  return foods.flatMap((food) => {
    if (!heldByCatalogue(food)) return [food];
    const current = copies.get(food.id);
    if (!current) return [];
    return [{
      ...current,
      aliases: [...new Set([...(current.aliases ?? []), ...(food.aliases ?? [])])],
      keywords: [...new Set([...(current.keywords ?? []), ...(food.keywords ?? [])])],
    }];
  });
}
