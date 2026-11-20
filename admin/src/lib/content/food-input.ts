// Reads and checks the food and portion forms. Pure; fitx_admin_op_save_food and
// fitx_admin_op_set_food_portions run the same rules again. Values are per 100 g of food as eaten.
import { checked, decimal, oneOf, text, words, type FieldErrors, type FormLike } from "./form";
import { DIET_TYPES, PORTION_UNITS, VALUE_BASES, type PortionUnit } from "./vocabulary";

/** Food ids that can name a Storage folder: the USDA numbers and Admin's "fitx-…" ids. */
export const FOOD_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type FoodPayload = {
  name: string;
  aliases: string[];
  keywords: string[];
  category: string | null;
  cuisine: string | null;
  diet_type: string | null;
  state: string | null;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number | null;
  sugar_g: number | null;
  sodium_mg: number | null;
  value_basis: string;
  attribution: string | null;
  is_active?: boolean;
};

export type FoodParse = { ok: true; value: FoodPayload } | { ok: false; errors: FieldErrors };

/** Energy from the macros with the general factors (4, 4 and 9 kcal per g). An estimate, for a sanity hint only. */
export function energyFromMacros(protein: number, carbs: number, fat: number): number {
  return Math.round(protein * 4 + carbs * 4 + fat * 9);
}

/** True when the stated calories are far from what the macros suggest (fibre and alcohol explain small gaps). */
export function caloriesLookOff(kcal: number, protein: number, carbs: number, fat: number): boolean {
  if (![kcal, protein, carbs, fat].every(Number.isFinite)) return false;
  const expected = energyFromMacros(protein, carbs, fat);
  return Math.abs(kcal - expected) > Math.max(40, expected * 0.25);
}

function amount(form: FormLike, name: string, max: number, errors: FieldErrors, required: boolean, places = 2): number | null {
  const value = decimal(form, name, places);
  if (value === null) {
    if (required) errors[name] = "Required.";
    return null;
  }
  if (!Number.isFinite(value) || value < 0 || value > max) errors[name] = `0 to ${max.toLocaleString("en-IN")}.`;
  return value;
}

export function parseFoodForm(form: FormLike, { creating }: { creating: boolean }): FoodParse {
  const errors: FieldErrors = {};
  const name = text(form, "name", 260);
  if (name.length < 2 || name.length > 200) errors.name = "Use 2 to 200 characters.";
  const aliases = words(form, "aliases", 21).map((word) => word.toLowerCase());
  if (aliases.length > 20 || aliases.some((word) => word.length > 60)) errors.aliases = "At most 20 names of up to 60 characters.";
  const keywords = words(form, "keywords", 31).map((word) => word.toLowerCase());
  if (keywords.length > 30 || keywords.some((word) => word.length > 60)) errors.keywords = "At most 30 words of up to 60 characters.";
  const category = text(form, "category", 160) || null;
  if (category && category.length > 120) errors.category = "Keep it under 120 characters.";
  const cuisine = text(form, "cuisine", 60).toLowerCase() || null;
  if (cuisine && cuisine.length > 40) errors.cuisine = "Keep it under 40 characters.";
  const dietText = text(form, "diet_type", 20);
  const diet = dietText ? oneOf(dietText, DIET_TYPES) : null;
  if (dietText && !diet) errors.diet_type = "Choose a diet type.";
  const stateText = text(form, "state", 20);
  const state = stateText ? oneOf(stateText, ["raw", "cooked"] as const) : null;
  if (stateText && !state) errors.state = "Raw or cooked.";

  const kcal = amount(form, "kcal", 950, errors, true);
  const protein = amount(form, "protein_g", 100, errors, true);
  const carbs = amount(form, "carbs_g", 100, errors, true);
  const fat = amount(form, "fat_g", 100, errors, true);
  const fiber = amount(form, "fiber_g", 100, errors, false);
  const sugar = amount(form, "sugar_g", 100, errors, false);
  const sodium = amount(form, "sodium_mg", 40000, errors, false);
  if (protein !== null && carbs !== null && fat !== null && protein + carbs + fat > 100) errors.fat_g = "Protein, carbs and fat add up to more than 100 g.";

  const basis = oneOf(text(form, "value_basis", 40), VALUE_BASES);
  if (!basis) errors.value_basis = "Say how the values were obtained.";
  const attribution = text(form, "attribution", 320) || null;
  if (attribution && attribution.length > 300) errors.attribution = "Keep it under 300 characters.";

  if (Object.keys(errors).length || kcal === null || protein === null || carbs === null || fat === null || !basis) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name,
      aliases,
      keywords,
      category,
      cuisine,
      diet_type: diet,
      state,
      kcal,
      protein_g: protein,
      carbs_g: carbs,
      fat_g: fat,
      fiber_g: fiber,
      sugar_g: sugar,
      sodium_mg: sodium,
      value_basis: basis,
      attribution,
      ...(creating ? { is_active: checked(form, "is_active") } : {}),
    },
  };
}

export type PortionPayload = { label: string; unit: PortionUnit; grams: number; is_default: boolean; is_estimate: boolean };
export type PortionsParse = { ok: true; value: PortionPayload[] } | { ok: false; message: string };

export const MAX_PORTIONS = 12;

/**
 * The portion rows: parallel fields portion_label, portion_unit, portion_grams and portion_measured
 * ("true" when weighed, so not an estimate), plus portion_default holding the default row's index.
 * Fully empty rows are skipped.
 */
export function parsePortionsForm(form: FormLike): PortionsParse {
  const labels = form.getAll("portion_label").map((value) => (typeof value === "string" ? value.trim() : ""));
  const units = form.getAll("portion_unit").map((value) => (typeof value === "string" ? value : ""));
  const grams = form.getAll("portion_grams").map((value) => (typeof value === "string" ? value.trim().replace(",", ".") : ""));
  const measured = form.getAll("portion_measured").map((value) => value === "true");
  const defaultIndex = text(form, "portion_default", 4);
  const result: PortionPayload[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < Math.max(labels.length, grams.length); index += 1) {
    const label = labels[index] ?? "";
    const gramText = grams[index] ?? "";
    if (!label && !gramText) continue;
    const row = index + 1;
    if (!label || label.length > 120) return { ok: false, message: `Row ${row}: give a label of up to 120 characters.` };
    if (seen.has(label.toLowerCase())) return { ok: false, message: `Row ${row}: “${label}” is listed twice.` };
    seen.add(label.toLowerCase());
    const unit = oneOf(units[index] ?? "", PORTION_UNITS);
    if (!unit) return { ok: false, message: `Row ${row}: choose a unit.` };
    if (!/^\d{1,4}(\.\d{1,2})?$/.test(gramText) || Number(gramText) <= 0 || Number(gramText) > 5000) {
      return { ok: false, message: `Row ${row}: grams must be more than 0 and at most 5,000.` };
    }
    result.push({ label, unit, grams: Number(gramText), is_default: defaultIndex === String(index), is_estimate: !measured[index] });
  }
  if (result.length > MAX_PORTIONS) return { ok: false, message: `At most ${MAX_PORTIONS} portions.` };
  return { ok: true, value: result };
}
