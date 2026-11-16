export interface FoodMacros {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export function scaleMacros(per100g: FoodMacros, grams: number): FoodMacros {
  const factor = Math.max(0, grams) / 100;
  return {
    calories: round(per100g.calories * factor),
    protein: round(per100g.protein * factor),
    carbs: round(per100g.carbs * factor),
    fat: round(per100g.fat * factor),
  };
}

export function sumMacros<T extends FoodMacros>(items: T[]): FoodMacros {
  return items.reduce(
    (sum, item) => ({
      calories: sum.calories + Number(item.calories || 0),
      protein: sum.protein + Number(item.protein || 0),
      carbs: sum.carbs + Number(item.carbs || 0),
      fat: sum.fat + Number(item.fat || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

export function estimateNutritionTargets(profile: {
  age?: number | null;
  gender?: string | null;
  height?: number | null;
  weight?: number | null;
}, activityLevel = "moderate", goal = "general_fitness"): FoodMacros | null {
  const age = Number(profile.age);
  const height = Number(profile.height);
  const weight = Number(profile.weight);
  if (!age || !height || !weight || age < 13 || age > 100 || height < 90 || weight < 30) return null;
  const offsets: Record<string, number> = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9 };
  const sexOffset = profile.gender === "male" ? 5 : profile.gender === "female" ? -161 : -78;
  const bmr = 10 * weight + 6.25 * height - 5 * age + sexOffset;
  const adjustment = goal === "fat_loss" ? -300 : goal === "muscle_gain" ? 200 : 0;
  const calories = Math.max(1000, Math.round(bmr * (offsets[activityLevel] ?? 1.55) + adjustment));
  const protein = Math.round(weight * (goal === "muscle_gain" || goal === "fat_loss" ? 1.8 : 1.6));
  const fat = Math.round((calories * 0.27) / 9);
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));
  return { calories, protein, carbs, fat };
}

export function goalPercent(current: number, target: number) {
  return target > 0 ? Math.min(100, Math.max(0, Math.round((current / target) * 100))) : 0;
}

/** Progress toward a daily target that also says how far past it the day went (goalPercent stops at 100). */
export function goalProgress(current: number, target: number) {
  const over = target > 0 ? Math.max(0, Math.round(current) - Math.round(target)) : 0;
  return { percent: goalPercent(current, target), over, isOver: over > 0 };
}

export const KJ_PER_KCAL = 4.184;
/** Pure fat is 9 kcal per gram, so no food has more than about 900 kcal per 100 g. */
const MAX_KCAL_PER_100G = 900;

/**
 * Per-100 g values from an Open Food Facts `nutriments` object, or null when the label can't be trusted.
 * Only the `_100g` fields are used: the plain `energy-kcal` field follows the label's own basis, which
 * can be per serving. Labels that give only kJ are converted; a declared 0 kcal (water, black coffee) is kept.
 */
export function per100gFromOpenFoodFacts(nutriments: unknown): FoodMacros | null {
  const values = (nutriments && typeof nutriments === "object" ? nutriments : {}) as Record<string, unknown>;
  const protein = labelAmount(values.proteins_100g);
  const carbs = labelAmount(values.carbohydrates_100g);
  const fat = labelAmount(values.fat_100g);
  // Protein, carbs and fat can't weigh more than the 100 g they are part of (1 g allowed for label rounding).
  if (protein + carbs + fat > 101) return null;
  // The energy the label's own nutrients account for: 4 kcal per gram of protein and carbs, 9 of fat, 2 of fibre,
  // and alcohol at 7 kcal per gram (OFF gives it in % vol; 1 % vol is 0.789 g per 100 ml).
  const expected = 4 * protein + 4 * carbs + 9 * fat + 2 * labelAmount(values.fiber_100g) + 5.5 * labelAmount(values.alcohol_100g);
  const calories = labelKcal(values, expected);
  if (calories === null) return null;
  const macros = { calories: Math.round(calories), protein, carbs, fat };
  // A "0 kcal" label that lists real protein, carbs or fat was entered wrongly; treat it as having no energy value.
  if (macros.calories === 0 && protein + carbs + fat > 1) return null;
  return macros;
}

/**
 * kcal per 100 g, or null when the label's energy can't be trusted. Contributors sometimes type the kJ figure
 * into the kcal field, which would log 4.2 times too much. A kcal value equal to the kJ value, above what any
 * food can have, or far above what the label's own nutrients allow is read as kJ when that fits those
 * nutrients; otherwise the product is left out.
 */
function labelKcal(values: Record<string, unknown>, expected: number): number | null {
  const kcal = labelNumber(values["energy-kcal_100g"]);
  // OFF stores `energy_100g` in kJ.
  const kj = labelNumber(values["energy-kj_100g"]) ?? labelNumber(values["energy_100g"]);
  if (kcal === null) {
    if (kj === null || kj < 0) return null;
    const fromKj = kj / KJ_PER_KCAL;
    return fromKj <= MAX_KCAL_PER_100G ? fromKj : null;
  }
  if (kcal < 0) return null;
  // Below 20 kcal the nutrients say too little to check against (drinks, and labels that list energy only).
  const checkable = expected >= 20;
  const sameAsKj = kj !== null && kj >= 20 && Math.abs(kcal - kj) <= kj * 0.02;
  const tooHigh = kcal > MAX_KCAL_PER_100G || (checkable && kcal > expected * 2.5 + 20);
  if (!sameAsKj && !tooHigh) return kcal;
  const asKcal = kcal / KJ_PER_KCAL;
  if (checkable) return Math.abs(asKcal - expected) <= Math.max(8, expected * 0.15) ? asKcal : null;
  return sameAsKj ? asKcal : null;
}

function labelNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

function labelAmount(value: unknown) {
  const number = labelNumber(value);
  return number !== null && number >= 0 ? round(number) : 0;
}

function round(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 10) / 10;
}
