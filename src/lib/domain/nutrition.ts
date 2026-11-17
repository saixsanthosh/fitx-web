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

// ─── Daily targets ───────────────────────────────────────────────────────────────────────────────
// Mifflin-St Jeor BMR × activity gives maintenance; the goal then adds a surplus or takes a deficit as
// a share of maintenance, capped in calories. A loss goal's deficit never takes the target below a safe
// floor (1,200 kcal for women, 1,500 for men, 1,350 otherwise); when maintenance is already under that
// floor there is no deficit at all and the target stays at maintenance. Under-18s stay at maintenance.
// Callers pass the latest weigh-in as `weight` (see loadUserContext), so targets follow what the user logs.

type TargetProfile = {
  age?: number | null;
  gender?: string | null;
  height?: number | null;
  weight?: number | null;
};

export type TargetRule = "deficit" | "surplus" | "maintenance";

export type NutritionTargets = FoodMacros & {
  /** Estimated calories that keep weight steady. */
  maintenance: number;
  bmr: number;
  /** Calories added to maintenance (negative for a deficit), after the floor and the under-18 rule. */
  adjustment: number;
  rule: TargetRule;
  /** The floor that set a loss target (the target equals it), or null when it didn't. */
  floorApplied: number | null;
  /** True when a loss goal was chosen but maintenance is already under the floor, so the target stays at maintenance. */
  maintenanceBelowFloor: boolean;
  /** True when an under-18 picked a loss goal: FITX keeps the target at maintenance. */
  youthMaintenance: boolean;
  proteinPerKg: number;
  /** Estimated change in body weight a week at this target (kg, negative for loss). */
  weeklyChangeKg: number;
  /** The body weight the targets were calculated from (kg). */
  weightKg: number;
};

const ACTIVITY_FACTORS: Record<string, number> = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9 };

/** Share of maintenance added or removed, the largest change in kcal, and protein in g per kg. */
const GOAL_RULES: Record<string, { share: number; cap: number; proteinPerKg: number }> = {
  muscle_gain: { share: 0.1, cap: 350, proteinPerKg: 1.8 },
  weight_gain: { share: 0.15, cap: 500, proteinPerKg: 1.6 },
  fat_loss: { share: -0.15, cap: 600, proteinPerKg: 2.0 },
  weight_loss: { share: -0.2, cap: 750, proteinPerKg: 1.8 },
  general_fitness: { share: 0, cap: 0, proteinPerKg: 1.6 },
  strength: { share: 0, cap: 0, proteinPerKg: 1.8 },
  endurance: { share: 0, cap: 0, proteinPerKg: 1.6 },
};

/** The lowest daily target FITX suggests for a loss goal without a professional's guidance. */
export const CALORIE_FLOORS = { female: 1200, male: 1500, other: 1350 } as const;
/** No target is ever lower than this. */
export const MINIMUM_CALORIES = 1000;
/** Energy in about a kilogram of body weight change. */
const KCAL_PER_KG = 7700;
/** Protein is counted against weight up to this BMI, so very heavy bodies don't get unrealistic targets. */
const PROTEIN_REFERENCE_BMI = 27.5;

export function calorieFloor(gender: string | null | undefined) {
  return gender === "male" ? CALORIE_FLOORS.male : gender === "female" ? CALORIE_FLOORS.female : CALORIE_FLOORS.other;
}

/** Daily calorie and macro targets with the reasoning behind them, or null when a measurement is missing. */
export function calculateNutritionTargets(
  profile: TargetProfile,
  activityLevel: string | null = "moderate",
  goal: string | null = "general_fitness",
): NutritionTargets | null {
  const age = Number(profile.age);
  const height = Number(profile.height);
  const weight = Number(profile.weight);
  if (!Number.isFinite(age) || !Number.isFinite(height) || !Number.isFinite(weight)) return null;
  if (age < 13 || age > 100 || height < 90 || height > 250 || weight < 30 || weight > 500) return null;

  const sexOffset = profile.gender === "male" ? 5 : profile.gender === "female" ? -161 : -78;
  const exactBmr = 10 * weight + 6.25 * height - 5 * age + sexOffset;
  const bmr = Math.round(exactBmr);
  const maintenance = Math.max(MINIMUM_CALORIES, Math.round(exactBmr * (ACTIVITY_FACTORS[activityLevel ?? ""] ?? 1.55)));
  const rules = GOAL_RULES[goal ?? ""] ?? GOAL_RULES.general_fitness;

  let adjustment = Math.round(Math.sign(rules.share) * Math.min(rules.cap, Math.abs(maintenance * rules.share)));
  const youthMaintenance = adjustment < 0 && age < 18;
  if (youthMaintenance) adjustment = 0;

  let calories = maintenance + adjustment;
  let floorApplied: number | null = null;
  let maintenanceBelowFloor = false;
  if (adjustment < 0) {
    const floor = calorieFloor(profile.gender);
    if (maintenance < floor) {
      // Maintenance is already under the floor: no deficit at all. The floor did not set this number.
      calories = maintenance;
      maintenanceBelowFloor = true;
    } else if (calories < floor) {
      calories = floor;
      floorApplied = floor;
    }
  }
  calories = Math.max(MINIMUM_CALORIES, calories);
  adjustment = calories - maintenance;

  const referenceWeight = Math.min(weight, PROTEIN_REFERENCE_BMI * (height / 100) ** 2);
  // Protein stays at or below 40% of calories, even on the lowest targets.
  const protein = Math.round(Math.min(referenceWeight * rules.proteinPerKg, (calories * 0.4) / 4));
  const fat = Math.round((calories * 0.27) / 9);
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));
  const rule: TargetRule = adjustment < 0 ? "deficit" : adjustment > 0 ? "surplus" : "maintenance";

  return {
    calories,
    protein,
    carbs,
    fat,
    maintenance,
    bmr,
    adjustment,
    rule,
    floorApplied,
    maintenanceBelowFloor,
    youthMaintenance,
    proteinPerKg: rules.proteinPerKg,
    weeklyChangeKg: Math.round(((adjustment * 7) / KCAL_PER_KG) * 100) / 100 || 0,
    weightKg: weight,
  };
}

/** Daily calorie and macro targets (see calculateNutritionTargets for the rules and the reasoning). */
export function estimateNutritionTargets(profile: TargetProfile, activityLevel = "moderate", goal = "general_fitness"): FoodMacros | null {
  return calculateNutritionTargets(profile, activityLevel, goal);
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
/**
 * Pure fat is 9 kcal per gram, so no food has much more than 900 kcal per 100 g. The margin is for labels: US
 * labels round per serving (110 kcal per 12 g of shortening is 917 per 100 g), and USDA lists lard at 902.
 */
const MAX_KCAL_PER_100G = 950;

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
  // A blank protein, carbs or fat field means unknown, not 0 g, so the nutrients only rule an energy figure too
  // high when the label gives all three.
  const complete = [values.proteins_100g, values.carbohydrates_100g, values.fat_100g].every((value) => labelNumber(value) !== null);
  const calories = labelKcal(values, expected, complete);
  if (calories === null) return null;
  const macros = { calories: Math.round(calories), protein, carbs, fat };
  // A "0 kcal" label that lists real protein, carbs or fat was entered wrongly; treat it as having no energy value.
  if (macros.calories === 0 && protein + carbs + fat > 1) return null;
  return macros;
}

/**
 * kcal per 100 g, or null when the label's energy can't be trusted. Contributors sometimes type the kJ figure
 * into the kcal field, which would log 4.2 times too much. A kcal value equal to the kJ value, above what any
 * food can have, or far above what the label's protein, carbs and fat allow (when it gives all three) is read
 * as kJ when that fits those nutrients, unless the nutrients account for the kcal figure itself; otherwise the
 * product is left out.
 */
function labelKcal(values: Record<string, unknown>, expected: number, complete: boolean): number | null {
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
  const fits = (value: number) => Math.abs(value - expected) <= Math.max(8, expected * 0.15);
  const sameAsKj = kj !== null && kj >= 20 && Math.abs(kcal - kj) <= kj * 0.02;
  const tooHigh = kcal > MAX_KCAL_PER_100G || (complete && checkable && kcal > expected * 2.5 + 20);
  if (!sameAsKj && !tooHigh) return kcal;
  // Both energy fields can hold the kcal figure; keep it when the label's own nutrients account for it.
  if (checkable && kcal <= MAX_KCAL_PER_100G && fits(kcal)) return kcal;
  const asKcal = kcal / KJ_PER_KCAL;
  if (checkable) return fits(asKcal) ? asKcal : null;
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
