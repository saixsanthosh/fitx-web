/**
 * The custom-food form's decisions, kept out of the component so `node --test` can check them: what the typed
 * numbers mean (a blank protein, carbs or fat is unknown, never 0), whether they can be saved, and where a refused
 * save is explained (a duplicate barcode next to the barcode field, anything else next to Save).
 *
 * No runtime imports, so the tests load it as it is.
 */
import type { MacroKey } from "@/lib/domain/nutrition";

/** The form's text boxes for the numbers, as typed. */
export interface CustomFoodNumberText {
  grams: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
}

/**
 * The typed numbers, per serving. `calories` and `grams` are NaN when blank or not a number; protein, carbs and fat
 * are null when left blank (not known) and NaN when they are not a number.
 */
export interface CustomFoodNumbers {
  grams: number;
  calories: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
}

const MACROS: readonly MacroKey[] = ["protein", "carbs", "fat"];

function number(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? Number.NaN : Number(trimmed.replace(",", "."));
}

/** A blank protein, carbs or fat box is unknown (null), not 0. */
function macro(text: string): number | null {
  return text.trim() === "" ? null : number(text);
}

export function readCustomFoodNumbers(text: CustomFoodNumberText): CustomFoodNumbers {
  return { grams: number(text.grams), calories: number(text.calories), protein: macro(text.protein), carbs: macro(text.carbs), fat: macro(text.fat) };
}

/** Protein, carbs or fat left blank, in the form's order. */
export function unknownMacros(values: Pick<CustomFoodNumbers, MacroKey>): MacroKey[] {
  return MACROS.filter((key) => values[key] === null);
}

/** Whether the typed values differ from the ones the form opened with (blank and 0 are different answers). */
export function numbersChanged(a: CustomFoodNumbers, b: CustomFoodNumbers): boolean {
  const same = (x: number | null, y: number | null) => (x === null || y === null ? x === y : Object.is(x, y) || (Number.isNaN(x) && Number.isNaN(y)));
  return (["grams", "calories", ...MACROS] as const).some((key) => !same(a[key], b[key]));
}

/** Why the typed values can't be saved, in the form's words, or null when they can. */
export function customFoodProblem(name: string, values: CustomFoodNumbers): string | null {
  if (!name.trim()) return "Give the food a name.";
  const { grams, calories } = values;
  if (!Number.isFinite(grams) || grams <= 0 || grams > 5000) return "The serving size must be between 1 and 5,000 grams.";
  if (!Number.isFinite(calories)) return "Enter the calories in one serving.";
  if (calories < 0) return "Calories can't be below 0.";
  const macros = MACROS.map((key) => values[key]);
  if (macros.some((value) => value !== null && (!Number.isFinite(value) || value < 0))) {
    return "Enter protein, carbs and fat as numbers of 0 or more, or leave one blank if you don't know it.";
  }
  const known = macros.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  if (known > grams * 1.01) return "Protein, carbs and fat can't weigh more than the serving itself.";
  if (calories * 100 / grams > 950) return "That is more than 950 kcal per 100 g, which no food has. Check whether the label gives kJ (divide by 4.184).";
  return null;
}

/** The note under the form while some macros are blank: they stay unknown. */
export function unknownMacrosNote(values: Pick<CustomFoodNumbers, MacroKey>): string | null {
  const blank = unknownMacros(values);
  if (!blank.length) return null;
  const list = blank.length > 1 ? `${blank.slice(0, -1).join(", ")} and ${blank[blank.length - 1]}` : blank[0];
  const capital = list.replace(/^./, (letter) => letter.toUpperCase());
  return `${capital} ${blank.length > 1 ? "stay" : "stays"} unknown: shown as unknown and left out of your totals, not counted as 0 g.`;
}

/** Where a refused save is explained, and how. */
export interface CustomFoodSaveProblem {
  /** "barcode": next to the barcode field, which is marked invalid and takes the focus. null: next to Save. */
  field: "barcode" | null;
  message: string;
}

/**
 * The message for a save the database refused. 23505 is the one-food-per-barcode rule; 23502 means the database
 * can't keep a blank protein, carbs or fat yet (before migration 20261126100000).
 */
export function customFoodSaveProblem(error: unknown): CustomFoodSaveProblem {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "23505") return { field: "barcode", message: "One of your foods already has that barcode. Change it, or leave it blank." };
  if (code === "23502") return { field: null, message: "This food can't be saved with protein, carbs or fat left blank yet. Enter them, or 0 if there is none." };
  return { field: null, message: "Your food could not be saved. Please try again." };
}
