import { createClient } from "@/lib/supabase/server";
import { LOCAL_FOODS, STAPLE_FOODS } from "@/lib/food/local-catalog";
import { lookupProduct, searchProducts } from "@/lib/food/open-food-facts";
import { searchFoods } from "@/lib/food/search-route";
import { searchUsda } from "@/lib/food/usda-live";

/**
 * Food search for signed-in users: FITX's food catalogue and the user's own foods, Open Food Facts for barcodes and
 * packaged products, and live USDA search when FITX found little. The search itself is in src/lib/food/search-route.ts;
 * this route gives it the request's Supabase client, the outside services and the built-in food list.
 */
export async function GET(request: Request) {
  return searchFoods(request, await createClient(), {
    lookupProduct: (code) => lookupProduct(code),
    searchProducts: (text) => searchProducts(text),
    searchUsda: (text, apiKey) => searchUsda(text, apiKey),
    usdaKey: process.env.USDA_API_KEY?.trim() || "",
    localFoods: LOCAL_FOODS,
    stapleFoods: STAPLE_FOODS,
  });
}
