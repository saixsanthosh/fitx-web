/**
 * The built-in food list the search route uses until the catalogue migrations are applied, and the staples it
 * shows before anything is typed. Server code only: it bundles both JSON files.
 */
import usdaFoundationFoods from "@/data/usda-foundation-foods.json";
import fitxStaples from "@/data/fitx-staples.json";
import { localFoodsFrom } from "@/lib/food/catalog-search";

const local = localFoodsFrom(fitxStaples, usdaFoundationFoods);

/** The curated staples, shown before anything is typed. */
export const STAPLE_FOODS = local.staples;
/** Staples first, then the USDA Foundation snapshot. */
export const LOCAL_FOODS = local.all;
