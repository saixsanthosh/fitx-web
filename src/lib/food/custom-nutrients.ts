/**
 * Fibre, sugars, saturated fat and sodium on a member's own food. The form takes them per serving, the food keeps them
 * per 100 g like every other value, and a value the member leaves blank stays unknown (null), never 0.
 * Pure, so the tests can run it. Storing them needs a database column that does not exist in the migrations yet
 * (NutritionCapabilities.customExtra), so the form's "More nutrients" section stays hidden until then.
 */

export interface ExtraNutrients {
  fiber: number | null;
  sugar: number | null;
  saturatedFat: number | null;
  sodiumMg: number | null;
}

export const NO_EXTRA: ExtraNutrients = { fiber: null, sugar: null, saturatedFat: null, sodiumMg: null };

/** The keys the stored object may hold, with the largest value each may take per 100 g. */
const KEYS = { fiber_g: 100, sugar_g: 100, saturated_fat_g: 100, sodium_mg: 40000 } as const;

function amount(value: unknown, max: number): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isFinite(number) && number >= 0 && number <= max ? Math.round(number * 100) / 100 : null;
}

/** The stored object as nutrients per 100 g; anything that is not a valid amount is unknown. */
export function parseExtraNutrients(raw: unknown): ExtraNutrients {
  const object = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  return {
    fiber: amount(object.fiber_g, KEYS.fiber_g),
    sugar: amount(object.sugar_g, KEYS.sugar_g),
    saturatedFat: amount(object.saturated_fat_g, KEYS.saturated_fat_g),
    sodiumMg: amount(object.sodium_mg, KEYS.sodium_mg),
  };
}

/** The object to store: only the values that are known, per 100 g. */
export function extraNutrientsJson(extra: ExtraNutrients): Record<string, number> {
  const out: Record<string, number> = {};
  if (extra.fiber !== null) out.fiber_g = extra.fiber;
  if (extra.sugar !== null) out.sugar_g = extra.sugar;
  if (extra.saturatedFat !== null) out.saturated_fat_g = extra.saturatedFat;
  if (extra.sodiumMg !== null) out.sodium_mg = extra.sodiumMg;
  return out;
}

/** Typed per-serving amounts (blank = unknown) as per-100 g values. A value larger than the serving itself is rejected. */
export function extraPer100g(perServing: { fiber: string; sugar: string; saturatedFat: string; sodiumMg: string }, servingGrams: number): { extra: ExtraNutrients; problem: string | null } {
  if (!(servingGrams > 0)) return { extra: NO_EXTRA, problem: null };
  const read = (text: string) => (text.trim() === "" ? null : Number(text));
  const values = { fiber: read(perServing.fiber), sugar: read(perServing.sugar), saturatedFat: read(perServing.saturatedFat), sodiumMg: read(perServing.sodiumMg) };
  for (const value of Object.values(values)) if (value !== null && (!Number.isFinite(value) || value < 0)) return { extra: NO_EXTRA, problem: "Enter the extra nutrients as numbers, or leave them blank." };
  for (const key of ["fiber", "sugar", "saturatedFat"] as const) {
    if ((values[key] ?? 0) > servingGrams * 1.01) return { extra: NO_EXTRA, problem: "Fibre, sugars and saturated fat can't weigh more than the serving itself." };
  }
  const per100 = (value: number | null) => (value === null ? null : Math.round(((value * 100) / servingGrams) * 100) / 100);
  return { extra: { fiber: per100(values.fiber), sugar: per100(values.sugar), saturatedFat: per100(values.saturatedFat), sodiumMg: per100(values.sodiumMg) }, problem: null };
}
