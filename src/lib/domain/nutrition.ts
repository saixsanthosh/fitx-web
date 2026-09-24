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

function round(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 10) / 10;
}
