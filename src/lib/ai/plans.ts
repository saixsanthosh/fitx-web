import "server-only";
import type { JsonSchema } from "./types";
import { clampNumber, cleanText, isRecord, oneOf } from "./validate";

/**
 * What the model must return for structured tasks, and strict parsers for it. A reply that does not
 * fit is rejected (the router then tries the next model); numbers are clamped into sane ranges.
 * These are the model's proposals only: FITX then checks every food against its own data.
 */

export const FOOD_UNITS = ["g", "ml", "piece", "slice", "cup", "tbsp", "tsp", "katori", "bowl", "glass", "serving"] as const;
export type FoodUnitWord = (typeof FOOD_UNITS)[number];
export const COST_LEVELS = ["low", "medium", "high"] as const;

export type ModelFood = {
  name: string;
  search: string;
  quantity: number;
  unit: FoodUnitWord;
  grams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  cost: (typeof COST_LEVELS)[number] | null;
  /** Set only for a packaged product; FITX then looks for its label on Open Food Facts. */
  brand: string | null;
  note: string | null;
};

export type ModelMealPlan = { title: string; summary: string; meals: Array<{ name: string; items: ModelFood[] }>; tips: string[] };
export type ModelWorkout = {
  title: string;
  summary: string;
  exercises: Array<{ id: string; sets: number; repsMin: number; repsMax: number; restSeconds: number; holdSeconds: number | null; note: string | null }>;
  tips: string[];
};
export type ModelSwap = { options: Array<ModelFood & { why: string | null }> };

const FOOD_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    name: { type: "string", description: "The food as people call it, e.g. Idli, Boiled egg, Cooked white rice" },
    search: { type: "string", description: "1 to 4 plain words to find it in a nutrition database, e.g. idli, boiled egg, cooked white rice" },
    quantity: { type: "number", description: "How many units" },
    unit: { type: "string", enum: [...FOOD_UNITS] },
    grams: { type: "number", description: "Estimated total weight in grams for this quantity" },
    calories: { type: "number", description: "Estimated kcal for this quantity" },
    protein: { type: "number", description: "Estimated grams of protein for this quantity" },
    carbs: { type: "number", description: "Estimated grams of carbohydrate for this quantity" },
    fat: { type: "number", description: "Estimated grams of fat for this quantity" },
    cost: { type: "string", enum: [...COST_LEVELS], description: "Rough cost level where the member lives" },
    brand: { type: "string", description: "Brand name only for a packaged product the member would buy as is, otherwise an empty string" },
    note: { type: "string", description: "Optional short preparation tip, or an empty string" },
  },
  required: ["name", "search", "quantity", "unit", "grams", "calories", "protein", "carbs", "fat", "cost"],
};

export const MEAL_PLAN_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short title, at most 60 characters" },
    summary: { type: "string", description: "One or two sentences on why this day fits the member" },
    meals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Breakfast, Lunch, Snack or Dinner" },
          items: { type: "array", items: FOOD_SCHEMA },
        },
        required: ["name", "items"],
      },
    },
    tips: { type: "array", items: { type: "string" }, description: "Up to three short, practical tips" },
  },
  required: ["title", "summary", "meals", "tips"],
};

export const WORKOUT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short title, at most 60 characters" },
    summary: { type: "string", description: "One or two sentences on why this session fits the member" },
    exercises: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "An id copied exactly from the exercise list" },
          sets: { type: "integer" },
          reps_min: { type: "integer" },
          reps_max: { type: "integer" },
          rest_seconds: { type: "integer" },
          hold_seconds: { type: "integer", description: "For holds such as a plank or wall sit: seconds per set (then reps are 1). Otherwise 0" },
          note: { type: "string", description: "Optional short cue, or an empty string" },
        },
        required: ["id", "sets", "reps_min", "reps_max", "rest_seconds"],
      },
    },
    tips: { type: "array", items: { type: "string" } },
  },
  required: ["title", "summary", "exercises", "tips"],
};

export const SWAP_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    options: {
      type: "array",
      items: { ...FOOD_SCHEMA, properties: { ...FOOD_SCHEMA.properties, why: { type: "string", description: "One short sentence on why it is a fair swap" } } },
      description: "One to three replacements, best first",
    },
  },
  required: ["options"],
};

export function parseFood(value: unknown): ModelFood | null {
  if (!isRecord(value)) return null;
  const name = cleanText(value.name, 80);
  const unit = oneOf(value.unit, FOOD_UNITS) ?? "serving";
  // Grams and millilitres can run into the hundreds; counts (pieces, cups, servings) cannot.
  const quantity = clampNumber(value.quantity, 0, unit === "g" || unit === "ml" ? 2000 : 50);
  const grams = clampNumber(value.grams, 0, 2000);
  if (!name || quantity === null || quantity <= 0 || grams === null || grams <= 0) return null;
  const macro = (field: unknown, max: number) => clampNumber(field, 0, max) ?? 0;
  return {
    name,
    search: cleanText(value.search, 60) ?? name,
    quantity,
    unit,
    grams,
    calories: macro(value.calories, 3000),
    protein: macro(value.protein, 300),
    carbs: macro(value.carbs, 500),
    fat: macro(value.fat, 300),
    cost: oneOf(value.cost, COST_LEVELS),
    brand: cleanText(value.brand, 60),
    note: cleanText(value.note, 140),
  };
}

export function parseMealPlan(value: unknown): ModelMealPlan | null {
  if (!isRecord(value) || !Array.isArray(value.meals)) return null;
  const meals = value.meals
    .slice(0, 8)
    .map((meal) => {
      if (!isRecord(meal) || !Array.isArray(meal.items)) return null;
      const items = meal.items.slice(0, 10).map(parseFood).filter((item): item is ModelFood => item !== null);
      const name = cleanText(meal.name, 40);
      return name && items.length ? { name, items } : null;
    })
    .filter((meal): meal is ModelMealPlan["meals"][number] => meal !== null);
  if (!meals.length) return null;
  return {
    title: cleanText(value.title, 70) ?? "Your food plan",
    summary: cleanText(value.summary, 400) ?? "",
    meals,
    tips: tipsOf(value.tips),
  };
}

/** Exercise ids must come from the list FITX sent; anything else is dropped. */
export function parseWorkout(value: unknown, allowedIds: ReadonlySet<string>): ModelWorkout | null {
  if (!isRecord(value) || !Array.isArray(value.exercises)) return null;
  const seen = new Set<string>();
  const exercises: ModelWorkout["exercises"] = [];
  for (const raw of value.exercises.slice(0, 16)) {
    if (!isRecord(raw) || typeof raw.id !== "string") continue;
    const id = raw.id.trim();
    if (!allowedIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    const hold = Math.round(clampNumber(raw.hold_seconds, 0, 600) ?? 0);
    const repsMin = hold ? 1 : Math.round(clampNumber(raw.reps_min, 1, 100) ?? 8);
    const repsMax = hold ? 1 : Math.max(repsMin, Math.round(clampNumber(raw.reps_max, 1, 100) ?? repsMin + 4));
    exercises.push({
      id,
      sets: Math.round(clampNumber(raw.sets, 1, 10) ?? 3),
      repsMin,
      repsMax,
      restSeconds: Math.round(clampNumber(raw.rest_seconds, 15, 600) ?? 90),
      holdSeconds: hold >= 5 ? hold : null,
      note: cleanText(raw.note, 140),
    });
    if (exercises.length === 12) break;
  }
  if (exercises.length < 2) return null;
  return { title: cleanText(value.title, 70) ?? "Coach workout", summary: cleanText(value.summary, 400) ?? "", exercises, tips: tipsOf(value.tips) };
}

export function parseSwap(value: unknown): ModelSwap | null {
  if (!isRecord(value) || !Array.isArray(value.options)) return null;
  const options = value.options
    .slice(0, 3)
    .map((option) => {
      const food = parseFood(option);
      return food ? { ...food, why: isRecord(option) ? cleanText(option.why, 160) : null } : null;
    })
    .filter((option): option is ModelSwap["options"][number] => option !== null);
  return options.length ? { options } : null;
}

function tipsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.map((tip) => cleanText(tip, 200)).filter((tip): tip is string => tip !== null).slice(0, 3) : [];
}
