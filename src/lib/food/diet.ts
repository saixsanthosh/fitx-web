/**
 * Diet labels for FITX foods. "Non-veg" and "Contains egg" are set when the food's own name, category or USDA
 * ingredient list says so; "Vegetarian" and "Vegan" only for the curated staples, checked by hand (STAPLE_DIET).
 * Null means FITX can't tell, never "vegetarian": an ingredient can be a product whose contents its name does not
 * show ("Candies, marshmallows" has gelatin).
 *
 * The catalogue importer (scripts/food/import-fdc.mjs, through fdc-import.ts) and the built-in food list
 * (catalog-search.ts) both use these rules, so a food carries the same label in either. Pure, no runtime imports.
 */
import type { DietType } from "@/lib/food/types";

/**
 * Meat, fish or egg from the food's name, its USDA ingredient descriptions and its category. A meat dish word
 * ("Hamburger, NFS", "Whopper", "Corn dog") counts when it is what the food or ingredient is ("Hot dog, NFS",
 * "Fast foods, cheeseburger; …"), not when it describes something else ("Rolls, hamburger or hotdog, plain").
 */
export function dietTypeOf(name: string, ingredients: readonly string[], category: string | null): DietType | null {
  const texts = [name, ...ingredients].map((text) => text.toLowerCase());
  if (texts.some(isMeat) || NON_VEG_CATEGORY.test(category ?? "")) return "non_veg";
  if (texts.some((text) => EGG.test(text))) return "egg";
  return null;
}

/**
 * The more cautious of two labels (non-veg, then egg, then vegetarian, then vegan), so a catalogue row saved under
 * older rules never shows a weaker label than its name and category give now. No label never overrides one.
 */
export function strongerDiet(a: DietType | null, b: DietType | null): DietType | null {
  const rank = (diet: DietType | null) => (diet === null ? -1 : DIET_ORDER.indexOf(diet));
  return rank(b) > rank(a) ? b : a;
}
const DIET_ORDER: readonly DietType[] = ["vegan", "veg", "egg", "non_veg"];

/** The label to show for one of the curated staples: what its name says, else FITX's check of its ingredients. */
export function stapleDietType(id: string, name: string, aliases: readonly string[]): DietType | null {
  return dietTypeOf(name, aliases, null) ?? STAPLE_DIET[id] ?? null;
}

/**
 * Whether a lower-case name or ingredient description names meat or fish. A food that says it is meatless
 * ("Hot dog sandwich, vegetarian", "Frankfurter, meatless") is not meat, whatever else it names. Meat dish words
 * count only in the part that says what the food is (headOf).
 */
function isMeat(text: string): boolean {
  if (MEATLESS.test(text)) return false;
  if (NON_VEG.test(text.replace(NOT_MEAT, " "))) return true;
  const dish = headOf(text).replace(/\bburger king\b/g, " ");
  return MEAT_DISH.test(dish) && !VEG_DISH.test(dish);
}

/**
 * What a USDA description is about: its first part ("hot dog" in "Hot dog, NFS", "roll" in "Roll, hamburger or hot
 * dog"), or the food after SR Legacy's "Fast foods," ("cheeseburger" in "Fast foods, cheeseburger; double patty").
 */
function headOf(text: string): string {
  const parts = text.split(",");
  const first = parts[0].trim();
  return first === "fast foods" && parts[1] ? parts[1].split(";")[0].trim() : first;
}

const NON_VEG_WORDS = [
  "beef", "pork", "chicken", "turkey", "lamb", "mutton", "goat", "veal", "venison", "bison", "rabbit", "duck", "goose", "quail",
  "pheasant", "dove", "squab", "pigeon", "ostrich", "emu", "elk", "moose", "caribou", "deer", "bacon", "ham", "sausage", "sausages",
  "salami", "pepperoni", "chorizo", "frankfurter", "frankfurters", "franks", "bologna", "pastrami", "prosciutto", "jerky", "meat", "meats",
  "meatball", "meatballs", "meatloaf", "poultry", "fish", "salmon", "tuna", "cod", "tilapia", "sardine", "sardines", "anchovy",
  "anchovies", "mackerel", "herring", "trout", "catfish", "pollock", "haddock", "halibut", "flounder", "perch", "pike", "carp",
  "whiting", "snapper", "swordfish", "mahi", "bass", "sole", "shark", "eel", "roe", "caviar", "shrimp", "prawn", "prawns", "crab",
  "lobster", "clam", "clams", "oyster", "oysters", "mussel", "mussels", "scallop", "scallops", "squid", "calamari", "octopus",
  "crayfish", "crawfish", "seafood", "shellfish", "gelatin", "gelatine", "lard", "tallow", "suet", "giblets", "gizzard", "gizzards",
  "liver", "tripe", "chitterlings", "worcestershire", "crustaceans", "mollusks", "game", "liverwurst", "pate", "scrapple", "gyro",
];
const NON_VEG = new RegExp(`\\b(${NON_VEG_WORDS.join("|")})\\b`);
/** Words that look like meat but are not: kidney beans, coconut meat, nut meats, veggie and soy products. */
const NOT_MEAT = /\b(kidney beans?|beans?, kidney|coconut meat|nut meats?|imitation meat|veggie (burger|patty)|meat substitutes?|soy(bean)? (burger|patty|crumbles))\b/g;
/** The food says it has no meat. */
const MEATLESS = /\b(vegetarian|vegan|meatless|meat[- ]free|meat substitutes?|plant[- ]based)\b/;
/** Dishes that are meat although their names name no meat. */
const MEAT_DISH = /\b(hamburgers?|cheeseburgers?|chiliburgers?|burgers?|sliders?|whoppers?|big macs?|mcdoubles?|quarter pounders?|hot ?dogs?|corn ?dogs?|pigs? in (a )?blankets?|wieners?)\b/;
/** A dish word used for a meatless version: veggie, soy, tofu or bean burgers, garden burgers. */
const VEG_DISH = /\b(veggie|tofu|soy|soya|soybean|garden|mushroom|paneer|aloo|falafel|((black|kidney|pinto) )?bean (burgers?|patty|patties))\b/;
const EGG = /\b(eggs?|egg (white|yolk|noodles)|mayonnaise|meringue|custard|eggnog)\b/;
const NON_VEG_CATEGORY = /(poultry|beef|pork|lamb|veal|game|finfish|shellfish|sausages|luncheon meats|seafood|fish|chicken|turkey|meat)/i;

/**
 * Diet labels for the curated staples, checked by hand against each food's USDA ingredient list (FNDDS) or
 * description (SR Legacy, Foundation). Only these foods are labelled vegetarian or vegan.
 */
export const STAPLE_DIET: Readonly<Record<string, DietType>> = {
  // FNDDS: rice, idli (rice, split peas), dosa (rice, lentils, oil), puri, sambar, upma, vada, channa saag, pasta.
  "2708408": "vegan", "2708414": "vegan", "2708346": "vegan", "2708347": "vegan", "2707714": "vegan", "2707430": "vegan",
  "2709128": "vegan", "2709130": "vegan", "2709632": "vegan", "2708357": "vegan",
  // FNDDS with butter oil, butter, yogurt or cottage cheese: dal, samosa, veg biryani, palak paneer, ghee.
  "2707427": "veg", "2708730": "veg", "2708985": "veg", "2709631": "veg", "2710168": "veg",
  // Commercial frozen chapati and paratha (SR Legacy ingredient): no meat or egg, dairy possible.
  "2707713": "veg", "2707715": "veg",
  // SR Legacy and Foundation single foods.
  "171287": "egg", "173424": "egg", "173904": "vegan", "746782": "veg", "170000": "vegan", "170457": "vegan",
  "171413": "vegan", "169640": "veg", "173410": "veg", "173757": "vegan", "169736": "vegan", "169759": "vegan",
  // Not labelled: naan (commercial naan may contain egg) and masala dosa (its pakora filling's ingredients are not listed).
};

/** What the nutrition page's diet filter hides: foods labelled non-veg, and foods labelled "Contains egg". */
export interface DietFilter {
  nonVeg: boolean;
  egg: boolean;
}

/**
 * The filter a user starts with, from the diet they chose (the labels user_preferences.dietary_preferences keeps):
 * vegetarian and vegan hide non-veg and egg (FITX's vegetarian is "no meat, fish or eggs"), eggetarian hides
 * non-veg only, anything else hides nothing.
 */
export function dietFilterFor(preferences: readonly unknown[] | null | undefined): DietFilter {
  const labels = (Array.isArray(preferences) ? preferences : []).map((value) => String(value ?? "").trim().toLowerCase());
  const eggetarian = labels.includes("eggetarian");
  const vegetarian = labels.some((label) => /^(veg|vegetarian|vegan|pure veg)$/.test(label));
  return { nonVeg: vegetarian || eggetarian, egg: vegetarian && !eggetarian };
}

/** Whether the filter hides a food with this label. A food without a label is never hidden: FITX could not check it. */
export function hiddenByDiet(diet: DietType | null | undefined, filter: DietFilter): boolean {
  return (filter.nonVeg && diet === "non_veg") || (filter.egg && diet === "egg");
}
