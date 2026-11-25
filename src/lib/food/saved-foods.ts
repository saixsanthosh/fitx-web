/**
 * Your own foods' measures. A saved food has one serving, which counts as the measure it names ("1 item", "1 cup",
 * "1 bowl"), so "3 idli" and "1 cup dal" work with it. A food copied from FITX's catalogue ("Save to My foods", or the
 * AI coach's plan) remembers what it was copied from (custom_foods.source_ref), and while its values are still the
 * catalogue's it keeps every measure and the diet label that food has. The search, typing an amount, also prefers a
 * catalogue food that can weigh it over your own food of the same name that can't (and says so).
 *
 * Only food-query at run time, so `node --test` loads it as it is.
 */
import { extraPortions, portionFromLabel, resolvePortion, unitLabel, type FoodPortion, type ParsedFoodQuery } from "@/lib/domain/food-query";
import type { FoodResult, ValueBasis } from "@/lib/food/types";

const GRAMS_ONLY = /^\d+(?:\.\d+)?\s*g$/i;
const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * The saved serving as a measure. One that names a single measure counts as it: "1 item" (38 g) is a piece, "1 cup"
 * (240 g) a cup, so cups, ml and katori follow from it. Another named serving ("2 biscuits") is the food's default
 * count. A serving that is only a weight ("100 g", or no name) is not a count: "3 idli" is never 3 × 100 g; the app
 * asks for grams instead. None is an estimate: the member weighed it or copied it.
 */
export function customServingPortion(servingSize: unknown, servingGrams: unknown): FoodPortion {
  const grams = Number(servingGrams) > 0 ? Number(servingGrams) : 100;
  const named = typeof servingSize === "string" && servingSize.trim() && !GRAMS_ONLY.test(servingSize.trim()) ? servingSize.trim() : "";
  const measure = named ? portionFromLabel(named, grams) : null;
  if (measure && measure.unit !== "serving") return { label: measure.label, unit: measure.unit, grams, countDefault: true, estimate: false };
  if (named) return { label: `1 serving (${named}, ${round1(grams)} g)`, unit: "serving", grams, countDefault: true, estimate: false };
  return { label: `1 serving (${round1(grams)} g)`, unit: "serving", grams, estimate: false };
}

/** A serving that is only a weight ("1 serving (100 g)"): it says nothing about pieces. */
function plainWeight(portion: FoodPortion): boolean {
  return portion.unit === "serving" && /^1 serving \(\d+(?:\.\d+)? g\)$/.test(portion.label);
}

/**
 * Your food's own serving first, then the measures of the food it was copied from that it doesn't already have (your
 * own "1 cup" wins over the catalogue's). Your serving stays the default count unless it is only a weight and the
 * catalogue food has a default piece: a copy saved with "100 g" still counts "3 idli" as three 38 g idlis.
 */
export function withSourcePortions(own: readonly FoodPortion[], source: readonly FoodPortion[]): FoodPortion[] {
  const key = (portion: FoodPortion) => `${portion.unit}:${portion.label.trim().toLowerCase()}`;
  const have = new Set(own.map(key));
  const extra = source.filter((portion) => !have.has(key(portion)));
  if (!extra.length) return [...own];
  const sourceDefault = extra.find((portion) => portion.countDefault);
  const ownDefault = own.find((portion) => portion.countDefault);
  const handOver = Boolean(sourceDefault && (!ownDefault || plainWeight(ownDefault)));
  return [
    ...own.map((portion) => (handOver && portion.countDefault ? withoutDefault(portion) : portion)),
    ...extra.map((portion) => (handOver && portion === sourceDefault ? portion : withoutDefault(portion))),
  ];
}

function withoutDefault(portion: FoodPortion): FoodPortion {
  if (!portion.countDefault) return portion;
  const copy = { ...portion };
  delete copy.countDefault;
  return copy;
}

/** Bases a catalogue food's own values have. A saved food with one of them still has the values it was copied with. */
const CATALOGUE_BASES = new Set<ValueBasis>(["lab_analysed", "compiled", "recipe_calculated", "estimated"]);

/**
 * Your saved food with what it keeps from the catalogue food it was copied from: every measure and the diet label,
 * while its values are still that food's. Once you change them (your entry, a package label) it has only the serving
 * you saved, since the catalogue's piece sizes and diet may no longer describe it.
 */
export function withSourceFood<T extends FoodResult>(food: T, source: Pick<FoodResult, "portions" | "dietType"> | null | undefined): T {
  if (!source || food.kind !== "custom" || !CATALOGUE_BASES.has(food.valueBasis)) return food;
  return { ...food, portions: withSourcePortions(food.portions, source.portions), dietType: food.dietType ?? source.dietType ?? null };
}

/** source_ref values that name a catalogue food (an FDC id or a FITX recipe), not a barcode. */
const CATALOGUE_REF = /^(?:\d{1,7}|fitx-recipe-[a-z0-9-]+)$/;

export function catalogueRef(sourceRef: unknown): string | null {
  return typeof sourceRef === "string" && CATALOGUE_REF.test(sourceRef.trim()) ? sourceRef.trim() : null;
}

/**
 * The serving a food saved to My foods starts with: the measure in use when it is one of the food's own (3 idli: "1
 * item", 38 g), else the label's serving, the food's usual piece or its first measure; 100 g only when it has none.
 */
export function servingToSave(food: Pick<FoodResult, "portions">, inUse: FoodPortion | null): { label: string; grams: number } {
  const own = food.portions;
  const pick = (inUse && own.includes(inUse) ? inUse : null)
    ?? own.find((portion) => portion.unit === "serving" && portion.estimate === false)
    ?? own.find((portion) => portion.countDefault)
    ?? own[0]
    ?? null;
  if (!pick || !(pick.grams > 0)) return { label: "", grams: 100 };
  // "1 serving (6 biscuits, 27 g)" is saved as "6 biscuits"; its weight goes in the weight box.
  const label = pick.unit === "serving" ? pick.label.replace(/^1 serving \((.*?)(?:,\s*\d+(?:\.\d+)?\s*g)?\)$/, "$1") : pick.label;
  return { label: label.length <= 60 ? label : "", grams: pick.grams };
}

/** Whether a food can weigh the amount typed with its own measures (and the ml, cups and katori they give). */
export function answersAmount(food: Pick<FoodResult, "portions" | "name">, typed: Pick<ParsedFoodQuery, "amount" | "unit" | "size">): boolean {
  if (typed.amount === null) return true;
  const kind = resolvePortion(typed, [...food.portions, ...extraPortions(food.portions, food.name)]).kind;
  return kind === "grams" || kind === "portion";
}

/**
 * Why your own food was passed over for the catalogue's, next to the food selected instead: "Your own “Idli” has no
 * piece weight, so this is FITX's Idli. To log yours, go back to the results."
 */
export function passedOverNote(own: Pick<FoodResult, "portions" | "name">, chosen: Pick<FoodResult, "name">, typed: Pick<ParsedFoodQuery, "amount" | "unit" | "size">): string {
  const resolution = resolvePortion(typed, [...own.portions, ...extraPortions(own.portions, own.name)]);
  const lacks = resolution.kind !== "ask" ? "no weight for that amount"
    : resolution.reason === "no-count-weight" ? "no piece weight"
      : resolution.reason === "no-size-weight" ? `no ${resolution.size} size`
        : `no ${unitLabel(resolution.unit ?? "serving")} weight`;
  return `Your own “${own.name}” has ${lacks}, so this is FITX's ${chosen.name}. To log yours, go back to the results.`;
}
