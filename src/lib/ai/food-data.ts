import "server-only";
import fitxStaples from "@/data/fitx-staples.json";
import usdaFoundationFoods from "@/data/usda-foundation-foods.json";
import { buildCatalogue, type CatalogueFood } from "./food-catalogue";

let cached: CatalogueFood[] | null = null;

/** FITX's local food data (USDA staples and Foundation Foods), built once per server instance. */
export function foodCatalogue(): CatalogueFood[] {
  cached ??= buildCatalogue(fitxStaples, usdaFoundationFoods);
  return cached;
}
