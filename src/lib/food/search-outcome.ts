/**
 * What the Log food sheet does with a search's answer: just list the foods, select one with the amount typed, or ask
 * which one is meant (keeping the amount, or explaining why an amount of 0 or below can't be used). Pure, so
 * `node --test` can check it; the page only carries it out.
 */
import { amountProblemMessage, describeTypedAmount, type ParsedFoodQuery } from "@/lib/domain/food-query";
import { hiddenByDiet, type DietFilter } from "@/lib/food/diet";
import type { FoodResult, FoodSearchResponse } from "@/lib/food/types";

export type SearchOutcome =
  /** Show the results; nothing is selected. */
  | { kind: "list" }
  /** Select this food with the typed amount. */
  | { kind: "pick"; food: FoodResult }
  /** Ask the member to tap a food: `hint` says why. */
  | { kind: "choose"; hint: string };

export function searchOutcome(
  typed: ParsedFoodQuery,
  found: readonly FoodResult[],
  pick: FoodSearchResponse["pick"],
  dietFilter: DietFilter,
  packaged = false,
): SearchOutcome {
  if (!found.length || packaged) return { kind: "list" };
  // "0 idli", "-2 idli": the food is listed, the amount is not used, and the member is told why.
  if (typed.problem) return { kind: "choose", hint: amountProblemMessage(typed.problem, true) };
  if (typed.amount === null) return { kind: "list" };
  // Select a food only when it is clearly the one meant (its whole name or alias is what was typed); otherwise the
  // member taps one, and the typed amount is applied to it.
  const chosen = pick ? found.find((food) => food.source === pick.source && food.id === pick.id) ?? null : null;
  // The diet filter hides a food, so it is never selected behind the member's back either.
  const hiddenPick = chosen && hiddenByDiet(chosen.dietType, dietFilter) ? chosen : null;
  if (chosen && !hiddenPick) return { kind: "pick", food: chosen };
  const visible = found.filter((food) => !hiddenByDiet(food.dietType, dietFilter));
  const amountText = describeTypedAmount(typed);
  const hint = hiddenPick
    ? `“${hiddenPick.name}” is marked ${hiddenPick.dietType === "egg" ? "egg" : "non-veg"}, so it is hidden. Turn off “Hide ${hiddenPick.dietType === "egg" ? "egg" : "non-veg"}” to log it.`
    : visible.length === 1
      ? `Is it “${visible[0].name}”? Tap it to keep ${amountText}.`
      : visible.length
        ? `Tap the “${typed.text}” you mean to keep ${amountText}.`
        : `Every food that matches “${typed.text}” is hidden by the diet filter.`;
  return { kind: "choose", hint };
}
