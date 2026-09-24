import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type FoodResult = {
  id: string;
  name: string;
  brand: string | null;
  image: string | null;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  source: "Open Food Facts" | "USDA FoodData Central";
};

const FIELDS = "code,product_name,brands,image_front_small_url,nutriments";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
  if (!user) return NextResponse.json({ error: "Sign in to search food." }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const query = (params.get("q") || "").trim().slice(0, 100);
  const barcode = (params.get("barcode") || "").replace(/\D/g, "").slice(0, 14);
  if (!query && !barcode) return NextResponse.json({ foods: [] });
  if (query.length < 2 && !barcode) return NextResponse.json({ foods: [] });

  const foods: FoodResult[] = [];
  try {
    const base = "https://world.openfoodfacts.org";
    const url = barcode
      ? `${base}/api/v3/product/${barcode}.json?fields=${FIELDS}`
      : `${base}/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=20&fields=${FIELDS}`;
    const response = await fetch(url, {
      headers: { "User-Agent": process.env.OPEN_FOOD_FACTS_USER_AGENT || "FITX/1.0 (food search; fitx-web-five.vercel.app)" },
      signal: AbortSignal.timeout(7000),
      next: { revalidate: 3600 },
    });
    if (response.ok) {
      const data = await response.json();
      const products = barcode ? (data.product ? [data.product] : []) : (data.products || []);
      for (const item of products) {
        const macros = item.nutriments || {};
        const name = String(item.product_name || "").trim();
        const calories = Number(macros["energy-kcal_100g"] ?? macros["energy-kcal"] ?? 0);
        if (!name || !Number.isFinite(calories) || calories <= 0) continue;
        foods.push({
          id: String(item.code || ""), name, brand: item.brands || null,
          image: item.image_front_small_url || null,
          calories: Math.round(calories), protein: numeric(macros.proteins_100g),
          carbs: numeric(macros.carbohydrates_100g), fat: numeric(macros.fat_100g),
          source: "Open Food Facts",
        });
      }
    }
  } catch {
    // Search is allowed to return any successful data already collected from other sources.
  }

  const apiKey = process.env.USDA_API_KEY;
  if (apiKey && query && foods.length < 12) {
    try {
      const response = await fetch("https://api.nal.usda.gov/fdc/v1/foods/search?api_key=" + encodeURIComponent(apiKey), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, pageSize: 12, dataType: ["Foundation", "SR Legacy", "Branded"] }),
        signal: AbortSignal.timeout(7000), next: { revalidate: 3600 },
      });
      if (response.ok) {
        const data = await response.json();
        for (const item of data.foods || []) {
          const nutrients: Array<{ nutrientNumber: string; value: number }> = item.foodNutrients || [];
          const n = (number: string) => Number(nutrients.find((value) => value.nutrientNumber === number)?.value || 0);
          foods.push({
            id: String(item.fdcId), name: String(item.description || "").trim(), brand: item.brandName || null,
            image: null, calories: Math.round(n("208") || n("957")), protein: n("203"), carbs: n("205"), fat: n("204"), source: "USDA FoodData Central",
          });
        }
      }
    } catch {
      // USDA is optional and should not make Open Food Facts results unavailable.
    }
  }
  return NextResponse.json({ foods: foods.slice(0, 25) }, { headers: { "Cache-Control": "private, max-age=60" } });
}

function numeric(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 10) / 10 : 0;
}
