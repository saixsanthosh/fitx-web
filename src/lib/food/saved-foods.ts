/**
 * Your own foods' measures. A saved food has one serving, which counts as the measure it names ("1 item", "1 cup",
 * "1 bowl"), so "3 idli" and "1 cup dal" work with it. A food copied from FITX's catalogue ("Save to My foods", or the
 * AI coach's plan) remembers what it was copied from (custom_foods.source_ref), and while its values are still the
 * catalogue's it keeps every measure and the diet label that food has. The search, typing an amount, also prefers a
 * catalogue food that can weigh it over your own food of the same name that can't (and says so).
 *
 * Only food-query at run time, so `node --test` loads it as it is.
 */
import { countsSeveral, extraPortions, isVolumeUnit, NOT_A_COUNT, parseFoodQuery, portionFromLabel, resolvePortion, unitLabel, type FoodPortion, type FoodUnit, type ParsedFoodQuery } from "@/lib/domain/food-query";
import type { FoodResult, ValueBasis } from "@/lib/food/types";

const GRAMS_ONLY = /^\d+(?:\.\d+)?\s*g$/i;
const WEIGHT_UNITS = new Set<FoodUnit>(["g", "kg", "oz", "lb"]);
const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * Whether a saved serving's name is one of something ("Small bowl", "1 scoop", "1 bowl (250 g)"), so a bare count can
 * mean that many servings. One that starts with another count ("2 idli", "6 biscuits", "2 biscuits (14 g)", "half
 * cup") is not: its pieces have no weight of their own, and "3 idli" must never be 3 × a 2-idli serving (228 g for 3
 * idlis). Nor is one whose "1" holds several ("1 plate (2 idli)", "1 serving (2 pcs)", "1 bowl (2 vada)"; fix round
 * 3f: only its first number was read), whatever the sizes in it say (countsSeveral). Nor is a weight ("1 oz").
 */
function namesOne(named: string): boolean {
  const parsed = parseFoodQuery(named);
  if (parsed.problem) return false;
  if (parsed.amount !== null && (parsed.amount !== 1 || (parsed.unit && WEIGHT_UNITS.has(parsed.unit)))) return false;
  return !countsSeveral(named);
}

/**
 * The saved serving as a measure. One that names a single measure counts as it: "1 item" (38 g) is a piece, "1 cup"
 * (150 g) a cup, so "2 cups" is 300 g. A cup or spoon is the member's own size (`ownSize`): nobody said it is a US cup
 * (a teacup of chai may be 150 ml), so no ml, spoon or katori is worked out from it, unless it is the very measure of
 * the catalogue food the copy came from (withSourcePortions). Another serving that names one of something ("Small
 * bowl") is the food's default count. One that names several ("2 idli", "6 biscuits", a package's "2 biscuits (14 g)"
 * kept by Save to My foods, "1 plate (2 idli)") or only a weight ("100 g", or no name) is not a count: "3 idli" is
 * never 3 × 2 idli, 3 plates of 2 or 3 × 100 g, and a package copied to My foods answers a count as the package does.
 * Its measure still counts as itself ("2 plates idli" is 2 of that plate). A "piece" that holds several ("1 (2
 * idli)") is not one of the food, so it is kept as a serving of them. Nor is a container ever a count ("1 pack (200
 * g)", "1 can (330 ml)"), as for every food (NOT_A_COUNT): "3 marie gold" is not 3 packs. A food holding a package's
 * values (`food`: scanned or made for a barcode, or copied from a label) counts as the package does: its "1 serving
 * (25 g)", "1 portion (…)" or "1 scoop (…)" is never a count (open-food-facts.ts), only one piece of it is ("1 biscuit
 * (7 g)"). The app asks for grams instead, or a catalogue food that weighs the count is picked with a note. It is still
 * what the food opens on when nothing was typed (log-sheet's openingPortion). None is an estimate: the member weighed
 * it or copied it.
 */
export function customServingPortion(servingSize: unknown, servingGrams: unknown, food: OwnFoodKind = {}): FoodPortion {
  const grams = Number(servingGrams) > 0 ? Number(servingGrams) : 100;
  const named = typeof servingSize === "string" && servingSize.trim() && !GRAMS_ONLY.test(servingSize.trim()) ? servingSize.trim() : "";
  if (!named) return { label: `1 serving (${round1(grams)} g)`, unit: "serving", grams, estimate: false };
  const one = namesOne(named);
  const container = NOT_A_COUNT.test(named);
  const read = portionFromLabel(named, grams);
  // A pack stays a pack: no bare count takes one, whatever it holds.
  const measure = read && read.unit !== "serving" && (one || read.unit !== "piece" || container) ? read : null;
  const counts = one && !container && (!holdsPackageValues(food) || measure?.unit === "piece" || measure?.unit === "slice");
  if (measure) return { label: measure.label, unit: measure.unit, grams, ...(counts ? { countDefault: true } : {}), estimate: false, ...(isVolumeUnit(measure.unit) ? { ownSize: true } : {}) };
  return { label: `1 serving (${named}, ${round1(grams)} g)`, unit: "serving", grams, ...(counts ? { countDefault: true } : {}), estimate: false };
}

/** Where a food of the member's own got its values: custom_foods.origin and value_basis. */
export interface OwnFoodKind {
  origin?: string | null;
  valueBasis?: string | null;
}

/** A packaged product's values: a food scanned or made for a barcode, or one whose values were copied from its label. */
function holdsPackageValues(food: OwnFoodKind): boolean {
  return food.origin === "barcode" || food.valueBasis === "label";
}

/** A serving that is only a weight ("1 serving (100 g)"): it says nothing about pieces. */
function plainWeight(portion: FoodPortion): boolean {
  return portion.unit === "serving" && /^1 serving \(\d+(?:\.\d+)? g\)$/.test(portion.label);
}

/**
 * Your food's own serving first, then the measures of the food it was copied from that it doesn't already have (your
 * own "1 cup" wins over the catalogue's). Your serving stays the default count unless it is only a weight and the
 * catalogue food has a default piece: a copy saved with "100 g" still counts "3 idli" as three 38 g idlis. A cup of
 * yours that is the catalogue food's own (the same measure and weight: Dal's "1 cup", 240 g, saved as it was) is that
 * food's US cup again, so ml and katori follow from it.
 */
export function withSourcePortions(own: readonly FoodPortion[], source: readonly FoodPortion[]): FoodPortion[] {
  const key = (portion: FoodPortion) => `${portion.unit}:${portion.label.trim().toLowerCase()}`;
  const twin = (portion: FoodPortion) => source.some((other) => key(other) === key(portion) && Math.abs(other.grams - portion.grams) <= 0.05);
  const mine = own.map((portion) => (portion.ownSize && twin(portion) ? withoutFlag(portion, "ownSize") : portion));
  const have = new Set(mine.map(key));
  const extra = source.filter((portion) => !have.has(key(portion)));
  if (!extra.length) return mine;
  const sourceDefault = extra.find((portion) => portion.countDefault);
  const ownDefault = mine.find((portion) => portion.countDefault);
  const handOver = Boolean(sourceDefault && (!ownDefault || plainWeight(ownDefault)));
  return [
    ...mine.map((portion) => (handOver && portion.countDefault ? withoutFlag(portion, "countDefault") : portion)),
    ...extra.map((portion) => (handOver && portion === sourceDefault ? portion : withoutFlag(portion, "countDefault"))),
  ];
}

function withoutFlag(portion: FoodPortion, flag: "countDefault" | "ownSize"): FoodPortion {
  if (!portion[flag]) return portion;
  const copy = { ...portion };
  delete copy[flag];
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
