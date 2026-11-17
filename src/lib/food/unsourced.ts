/**
 * Everyday Indian foods FITX has no identifiable source for yet. Instead of guessing a value, the search says so and
 * points to the ways to get a real one: a packaged product's label, or the member's own food. A name is listed only
 * when none of FITX's data (USDA FoodData Central and the FITX recipe estimates) has the food itself.
 */
import { parseFoodQuery, singular } from "@/lib/domain/food-query";

export interface UnsourcedFood {
  /** The words that name it. */
  words: string[];
  /** What to call it in the message. */
  label: string;
}

export const UNSOURCED_FOODS: readonly UnsourcedFood[] = [
  { words: ["paneer"], label: "Plain paneer" },
  { words: ["bhindi", "okra", "ladyfinger", "lady finger"], label: "Bhindi (okra)" },
  { words: ["lauki", "dudhi", "ghia", "bottle gourd"], label: "Lauki (bottle gourd)" },
  { words: ["karela", "bitter gourd", "bitter melon"], label: "Karela (bitter gourd)" },
  { words: ["methi", "fenugreek"], label: "Methi (fenugreek leaves)" },
  { words: ["poha", "pohe"], label: "Poha" },
  { words: ["rasam"], label: "Rasam" },
  { words: ["pongal"], label: "Pongal" },
  { words: ["kheer", "payasam"], label: "Kheer" },
];

const phrase = (text: string) => parseFoodQuery(text).words.map(singular).join(" ");

/**
 * The unsourced food a search names, unless the member's own food or a packaged product of that name is already in
 * the results (then there is something real to log). Plain "paneer" still counts when only Palak Paneer matched:
 * that is a different dish.
 */
export function unsourcedFor(search: string, results: ReadonlyArray<{ name: string; kind: string }>): UnsourcedFood | null {
  const typed = phrase(search);
  if (!typed) return null;
  const entry = UNSOURCED_FOODS.find((item) => item.words.some((word) => ` ${typed} `.includes(` ${phrase(word)} `)));
  if (!entry) return null;
  const covered = results.some((food) => (food.kind === "custom" || food.kind === "packaged") && entry.words.some((word) => ` ${phrase(food.name)} `.includes(` ${phrase(word)} `)));
  return covered ? null : entry;
}
