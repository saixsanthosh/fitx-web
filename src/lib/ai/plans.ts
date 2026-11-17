import "server-only";
import { parseFoodQuery } from "@/lib/domain/food-query";
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
  const name = cleanText(value.name ?? value.food ?? value.item, 80);
  // Models without the schema sometimes write the amount as text ("3 pieces", "150 g").
  let amount: unknown = value.quantity ?? value.qty ?? value.amount;
  let unitText: unknown = value.unit ?? value.units;
  if (typeof amount === "string" && !/^\s*\d+(?:\.\d+)?\s*$/.test(amount)) {
    const parsed = parseFoodQuery(amount);
    if (parsed.amount !== null) {
      amount = parsed.amount;
      if (!unitText && parsed.unit) unitText = parsed.unit;
    }
  }
  const unit = unitWord(unitText);
  // Grams and millilitres can run into the hundreds; counts (pieces, cups, servings) cannot.
  const quantity = clampNumber(amount, 0, unit === "g" || unit === "ml" ? 2000 : 50);
  const grams = clampNumber(value.grams ?? value.weight_g ?? value.weight_grams, 0, 2000);
  if (!name || quantity === null || quantity <= 0 || grams === null || grams <= 0) return null;
  const macro = (field: unknown, max: number) => clampNumber(field, 0, max) ?? 0;
  const food: ModelFood = {
    name,
    search: cleanText(value.search, 60) ?? name,
    quantity,
    unit,
    grams,
    calories: macro(value.calories ?? value.kcal ?? value.energy_kcal, 3000),
    protein: macro(value.protein ?? value.protein_g, 300),
    carbs: macro(value.carbs ?? value.carbohydrates ?? value.carbs_g, 500),
    fat: macro(value.fat ?? value.fat_g, 300),
    cost: oneOf(value.cost, COST_LEVELS),
    brand: cleanText(value.brand, 60),
    note: cleanText(value.note, 140),
  };
  // Impossible numbers mean the model mixed up its units (2 g for two rotis): more energy than pure fat,
  // or more protein, carbs and fat than the food weighs. Such an item is dropped, never saved.
  if ((food.calories / food.grams) * 100 > 900 || food.protein + food.carbs + food.fat > food.grams * 1.05) return null;
  return food;
}

/** "pieces", "Grams", "cups" → the plan's unit words; anything else counts as a serving. */
function unitWord(value: unknown): FoodUnitWord {
  const direct = oneOf(value, FOOD_UNITS);
  if (direct) return direct;
  if (typeof value !== "string" || !value.trim()) return "serving";
  const parsed = parseFoodQuery(`1 ${value}`).unit;
  return oneOf(parsed, FOOD_UNITS) ?? "serving";
}

export function parseMealPlan(value: unknown): ModelMealPlan | null {
  if (!isRecord(value)) return null;
  // Also accept { breakfast: [...], lunch: [...] } and meals with "foods" instead of "items".
  const rawMeals = Array.isArray(value.meals)
    ? value.meals
    : Object.entries(value)
        .filter(([key, items]) => /^(breakfast|lunch|dinner|snacks?|brunch|supper|pre.?workout|post.?workout|evening snack|morning snack)$/i.test(key) && Array.isArray(items))
        .map(([key, items]) => ({ name: key.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase()), items }));
  const meals = rawMeals
    .slice(0, 8)
    .map((meal) => {
      if (!isRecord(meal)) return null;
      const list = meal.items ?? meal.foods ?? meal.dishes;
      if (!Array.isArray(list)) return null;
      const items = list.slice(0, 10).map(parseFood).filter((item): item is ModelFood => item !== null);
      const name = cleanText(meal.name ?? meal.meal ?? meal.title, 40);
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
    if (!isRecord(raw)) continue;
    const rawId = raw.id ?? raw.exercise_id;
    if (typeof rawId !== "string") continue;
    const id = rawId.trim();
    if (!allowedIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    const hold = Math.round(clampNumber(raw.hold_seconds ?? raw.hold ?? raw.duration_seconds, 0, 600) ?? 0);
    // "reps": 10 or "8-12" when the model did not use reps_min and reps_max.
    const range = typeof raw.reps === "string" ? /^\s*(\d+)\s*(?:-|–|to)\s*(\d+)\s*$/.exec(raw.reps) : null;
    const repsFrom = raw.reps_min ?? (range ? range[1] : raw.reps);
    const repsTo = raw.reps_max ?? (range ? range[2] : raw.reps);
    const repsMin = hold ? 1 : Math.round(clampNumber(repsFrom, 1, 100) ?? 8);
    const repsMax = hold ? 1 : Math.max(repsMin, Math.round(clampNumber(repsTo, 1, 100) ?? repsMin + 4));
    exercises.push({
      id,
      sets: Math.round(clampNumber(raw.sets, 1, 10) ?? 3),
      repsMin,
      repsMax,
      restSeconds: Math.round(clampNumber(raw.rest_seconds ?? raw.rest ?? raw.rest_sec, 15, 600) ?? 90),
      holdSeconds: hold >= 5 ? hold : null,
      note: cleanText(raw.note, 140),
    });
    if (exercises.length === 12) break;
  }
  if (exercises.length < 2) return null;
  return { title: cleanText(value.title, 70) ?? "Coach workout", summary: cleanText(value.summary, 400) ?? "", exercises, tips: tipsOf(value.tips) };
}

export function parseSwap(value: unknown): ModelSwap | null {
  if (!isRecord(value)) return null;
  const list = value.options ?? value.replacements ?? value.alternatives ?? value.swaps ?? value.suggestions;
  if (!Array.isArray(list)) return null;
  const options = list
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

/**
 * The schema written out for the prompt, so every model sees the exact shape, including models that
 * only get plain JSON mode (Gemini and OpenRouter also get the schema itself as a request parameter).
 */
export function jsonShape(schema: JsonSchema): string {
  return [
    "Reply with only one JSON object in exactly this shape (no other keys, no text before or after it; fields marked (optional) may be left out):",
    render(schema, ""),
  ].join("\n");
}

function render(schema: JsonSchema, indent: string): string {
  if (schema.type === "object" && schema.properties) {
    const required = new Set(schema.required ?? []);
    const lines = Object.entries(schema.properties).map(([key, value]) => {
      const note = [required.has(key) ? "" : "(optional)", value.description ?? ""].filter(Boolean).join(" ");
      return `${indent}  "${key}": ${render(value, `${indent}  `)}${note ? ` // ${note}` : ""}`;
    });
    return `{\n${lines.join(",\n")}\n${indent}}`;
  }
  if (schema.type === "array") return `[ ${schema.items ? render(schema.items, indent) : "any"}, … ]`;
  if (schema.enum) return schema.enum.map((value) => `"${value}"`).join(" | ");
  return schema.type;
}
