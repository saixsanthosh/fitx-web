import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import fitxStaples from "@/data/fitx-staples.json";
import usdaFoundationFoods from "@/data/usda-foundation-foods.json";
import { catalogueCopies } from "@/lib/food/catalogue-copies";
import { buildCatalogue, withCatalogueRows, type CatalogueFood } from "./food-catalogue";

let cached: CatalogueFood[] | null = null;

/** FITX's local food data (USDA staples and Foundation Foods), built once per server instance. */
export function foodCatalogue(): CatalogueFood[] {
  cached ??= buildCatalogue(fitxStaples, usdaFoundationFoods);
  return cached;
}

/**
 * The local food data as the catalogue has it now, read with the member's client: once the catalogue is seeded,
 * Admin's corrections win and hidden foods are left out. Before that, or if it cannot be read, the bundled list.
 */
export async function currentFoodCatalogue(db: SupabaseClient): Promise<CatalogueFood[]> {
  const bundled = foodCatalogue();
  const copies = await catalogueCopies(db, bundled.map((food) => food.id));
  return copies ? withCatalogueRows(bundled, copies) : bundled;
}
