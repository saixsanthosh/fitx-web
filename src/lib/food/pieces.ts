/**
 * Logging a countable food (idli, dosa, chapati, egg, banana) by the piece or in grams. A piece weight is used only
 * when the food's own data has one: a USDA household measure, the staples file (also USDA), a package label or the
 * member's own saved serving. Where none exists FITX offers grams only and says why; it never invents a weight.
 *
 * No runtime imports beyond food-query, so `node --test` loads it as it is.
 */
import { NOT_A_COUNT, formatAmount, type FoodPortion } from "@/lib/domain/food-query";

/** Foods people count rather than weigh. Matching is on whole words of the food's name. */
const COUNTABLE_WORDS = [
  "idli", "idly", "dosa", "dosai", "chapati", "chapatti", "chappatti", "roti", "phulka", "paratha", "parotta", "puri", "poori",
  "naan", "kulcha", "bhatura", "appam", "uttapam", "vada", "vadai", "samosa", "kachori", "pakora", "bonda", "momo", "dumpling",
  "egg", "eggs", "banana", "bananas", "apple", "apples", "orange", "oranges", "mango", "guava", "pear", "peach", "plum", "kiwi",
  "date", "dates", "fig", "figs", "biscuit", "biscuits", "cookie", "cookies", "cracker", "crackers", "rusk", "ladoo", "laddu",
  "jalebi", "barfi", "gulab", "muffin", "bun", "roll", "bagel", "croissant", "tortilla", "pancake", "waffle", "sandwich",
  "burger", "slice", "bread", "toast", "potato", "tomato", "onion", "cutlet", "kebab", "nugget", "nuggets", "dhokla", "thepla",
];
const COUNTABLE = new RegExp(`\\b(${COUNTABLE_WORDS.join("|")})\\b`, "i");

/** Whether people usually count this food ("3 idli", "2 eggs"), from its name. */
export function isCountableName(name: string): boolean {
  return COUNTABLE.test(name);
}

/** A sourced weight for one piece or slice: not a container ("1 pack", "1 can") and above zero. */
export function isPiecePortion(portion: Pick<FoodPortion, "unit" | "label" | "grams">): boolean {
  return (portion.unit === "piece" || portion.unit === "slice") && Number.isFinite(portion.grams) && portion.grams > 0 && !NOT_A_COUNT.test(portion.label);
}

export type CountMode =
  /** Pieces can be counted: `indices` point into the options list, `preferred` is the size a count starts on. */
  | { kind: "pieces"; indices: number[]; preferred: number }
  /** A food people count, with no sourced piece weight: grams only, and why. */
  | { kind: "grams-only"; reason: string }
  /** Not a counted food and no piece weight: nothing to say. */
  | { kind: "none" };

/**
 * How a food can be counted, from its options (the food's portions plus measures worked out for it). Pieces come
 * only from those options, so every weight shown has a source.
 */
export function countMode(food: { name: string; kind?: string; source?: string }, options: readonly FoodPortion[]): CountMode {
  const indices = options.map((portion, index) => (isPiecePortion(portion) ? index : -1)).filter((index) => index >= 0);
  if (indices.length) {
    const preferred = indices.find((index) => options[index].countDefault) ?? indices.find((index) => /\bmedium|regular\b/i.test(options[index].label)) ?? indices[0];
    return { kind: "pieces", indices, preferred };
  }
  if (!isCountableName(food.name)) return { kind: "none" };
  return { kind: "grams-only", reason: noPieceReason(food) };
}

/** One line on why a counted food can only be logged in grams. */
export function noPieceReason(food: { kind?: string; source?: string }): string {
  if (food.kind === "custom") return "Grams only: your food has no piece weight saved. Edit it to add one.";
  if (food.source === "Open Food Facts") return "Grams only: the package label gives no weight per piece.";
  return "Grams only: the source data has no weight per piece, and FITX won't guess one.";
}

/**
 * A short name for a piece size, for the size buttons: USDA's "1 small" becomes "Small", "1 medium chappatti or
 * roti (7")" becomes "Medium", "1 item" becomes "1 piece". The weight follows.
 */
export function pieceSizeLabel(portion: Pick<FoodPortion, "label" | "grams">): string {
  const size = /\b(extra large|small|medium|regular|large|jumbo)\b/i.exec(portion.label);
  const name = size ? size[1].replace(/^./, (letter) => letter.toUpperCase()) : shortLabel(portion.label);
  return `${name} · ${formatAmount(portion.grams)} g`;
}

function shortLabel(label: string): string {
  const plain = label.replace(/\(.*?\)/g, "").replace(/,.*$/, "").trim();
  if (/^1 (item|piece|nos?)\b/i.test(plain) || plain === "1") return "1 piece";
  return plain.length > 22 ? `${plain.slice(0, 21).trim()}…` : plain;
}

/** Where a piece weight came from, in a few words. */
export function pieceSource(portion: Pick<FoodPortion, "label" | "grams" | "estimate">, food: { kind?: string; source?: string }): string {
  if (food.kind === "custom") return `Your saved serving: ${formatAmount(portion.grams)} g`;
  if (portion.estimate === false) return `Package label: ${formatAmount(portion.grams)} g each`;
  return `USDA average for ${portion.label}: ${formatAmount(portion.grams)} g`;
}

/** Which way the amount is entered now: by a piece size, in grams, or in some other measure (a cup, a katori). */
export function amountMode(unitKey: string, mode: CountMode): "pieces" | "grams" | "other" {
  if (unitKey === "g") return "grams";
  if (mode.kind !== "pieces" || !unitKey.startsWith("portion:")) return "other";
  return mode.indices.includes(Number(unitKey.slice("portion:".length))) ? "pieces" : "other";
}
