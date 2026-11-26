/**
 * What the Add to log panel says about values a food has none for (bug 4): never 0 g, and in the words of where the
 * food comes from. A package label or a source doesn't list a value; a food of the member's own has it blank because
 * they left it blank (fix round 3c: it said "This source doesn't list …" for those too). Pure, so `node --test` can
 * check it; FoodDetail, ProductSummary and NutrientList show it.
 */
import { MACRO_LABEL, type MacroKey } from "@/lib/domain/nutrition";
import type { FoodResult } from "@/lib/food/types";

/** The order the panel names them in, as its calorie ring does. */
const ORDER: MacroKey[] = ["carbs", "protein", "fat"];

type Described = Pick<FoodResult, "missing" | "kind" | "source" | "origin">;

/** "carbs", "carbs and fat", "carbs, protein and fat". */
function listOf(names: readonly string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
}

/**
 * The sentence that says which of protein, carbs and fat the food has no value for, and that they are left out of the
 * totals, or "" when it has all three. A label or source "doesn't list" them; for a food of your own, you left them
 * blank (one the AI Coach saved "was saved without" them), and editing it in My foods adds them.
 */
export function missingSentence(food: Described): string {
  const missing = ORDER.filter((key) => food.missing?.includes(key));
  if (!missing.length) return "";
  const list = listOf(missing.map((key) => MACRO_LABEL[key]));
  const several = missing.length > 1;
  const them = several ? "them" : "it";
  const leftOut = `${several ? "They are" : "It is"} left out of your totals, not logged as 0 g.`;
  if (food.kind === "custom") {
    const why = food.origin === "ai_coach" ? `This food was saved without ${list}` : `You left ${list} blank for this food`;
    return `${why}, so FITX can't count ${them}. ${leftOut} To add ${them}, edit the food in My foods.`;
  }
  return `This ${food.source === "Open Food Facts" ? "label" : "source"} doesn't list ${list}, so FITX can't count ${them}. ${leftOut}`;
}

/** What protein, carbs or fat without a value reads as beside the calorie ring: "not listed", or "unknown" for a food of your own. */
export function missingMacroWord(food: Pick<FoodResult, "kind">): string {
  return food.kind === "custom" ? "unknown" : "not listed";
}

/**
 * What fibre, sugars, saturated fat or sodium without a value reads as: "not listed by this label" (or "… this
 * source"); for a food of your own, which has no place for them yet, "unknown".
 */
export function otherNutrientMissing(food: Pick<FoodResult, "kind" | "source">): string {
  if (food.kind === "custom") return "unknown";
  return `not listed by ${food.source === "Open Food Facts" ? "this label" : "this source"}`;
}
