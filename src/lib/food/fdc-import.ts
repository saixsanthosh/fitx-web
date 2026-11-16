/**
 * Turns USDA FoodData Central (FDC) API records into FITX food catalogue rows (public.food_catalog and
 * public.food_portions). Pure functions: scripts/import-fdc.mjs reads the saved API responses and writes the
 * seed migrations. Every number comes from FDC; this file only chooses, cleans and labels.
 *
 * FDC data is public domain (CC0 1.0). Suggested citation: U.S. Department of Agriculture, Agricultural
 * Research Service. FoodData Central. fdc.nal.usda.gov.
 */
import { inferFoodState, portionFromLabel, withCountDefault } from "@/lib/domain/food-query";
import type { FoodPortion, FoodState, FoodUnit } from "@/lib/domain/food-query";

export type CatalogValueBasis = "lab_analysed" | "compiled" | "recipe_calculated";
export type DietType = "vegan" | "veg" | "egg" | "non_veg";

export interface CatalogPortion {
  label: string;
  unit: Exclude<FoodUnit, "g" | "kg" | "oz" | "lb">;
  grams: number;
  /** The portion a bare count uses ("3 idlis"). */
  isDefault: boolean;
}

export interface CatalogRow {
  id: string;
  name: string;
  aliases: string[];
  keywords: string[];
  category: string | null;
  cuisine: string | null;
  dietType: DietType | null;
  state: FoodState | null;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number | null;
  sugar: number | null;
  sodiumMg: number | null;
  valueBasis: CatalogValueBasis;
  dataType: string;
  version: string | null;
  portions: CatalogPortion[];
}

/** A curated FITX staple from src/data/fitx-staples.json. */
export interface StapleRecord {
  id: string;
  fdcId: number;
  name: string;
  dataType: string;
  published: string | null;
  state: FoodState | null;
  aliases: string[];
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  portions: Array<{ label: string; unit: string; grams: number; countDefault?: boolean }>;
}

/** The FDC record shapes FITX reads: search results (FNDDS measures) and full records (SR Legacy, Foundation portions). */
export interface FdcRecord {
  fdcId: number;
  description: string;
  dataType: string;
  publishedDate?: string;
  publicationDate?: string;
  foodCategory?: string | { description?: string };
  additionalDescriptions?: string;
  foodNutrients?: Array<{ nutrientNumber?: string; value?: number; amount?: number; nutrient?: { number?: string } }>;
  foodMeasures?: Array<{ disseminationText?: string; gramWeight?: number }>;
  finalFoodInputFoods?: Array<{ foodDescription?: string }>;
}

export const VALUE_BASIS_BY_DATA_TYPE: Record<string, CatalogValueBasis> = {
  Foundation: "lab_analysed",
  "SR Legacy": "compiled",
  "Survey (FNDDS)": "recipe_calculated",
};

/** Foods FITX leaves out: infant formula, baby food and human milk are not logged by adults in a fitness app. */
export const EXCLUDED_CATEGORY_PATTERN = /^(baby food|formula|human milk|infant formula)/i;

/**
 * Records left out on purpose (see src/data/DATA_SOURCES.md):
 * - 2705740 FNDDS "Cheese, paneer": modelled as milk plus vinegar with the milk sugar kept (22.5 g carbs per 100 g),
 *   which misstates real paneer.
 * - 2710066 FNDDS "Pakora": 125 kcal per 100 g is implausibly low for a fried snack; left for a reviewed source.
 */
export const EXCLUDED_FDC_IDS = new Set(["2705740", "2710066"]);

/** Per-100 g values by FDC nutrient number. Energy: kcal (208), else the Atwater energies Foundation foods give. */
export function nutrientsOf(record: FdcRecord) {
  const values = new Map<string, number>();
  for (const nutrient of record.foodNutrients ?? []) {
    const number = nutrient.nutrientNumber ?? nutrient.nutrient?.number;
    const value = nutrient.value ?? nutrient.amount;
    if (number && typeof value === "number" && Number.isFinite(value) && !values.has(number)) values.set(number, value);
  }
  const get = (number: string) => values.get(number) ?? null;
  return {
    kcal: get("208") ?? get("958") ?? get("957"),
    protein: get("203"),
    carbs: get("205"),
    fat: get("204"),
    fiber: get("291"),
    sugar: get("269") ?? get("269.3"),
    sodiumMg: get("307"),
  };
}

/**
 * FDC household measures as FITX portions, in the order the app offers them: pieces and slices (small to large),
 * then servings, cups (plain "1 cup" or "1 cup, cooked" before chopped, diced and the like), spoons and fluid ounces.
 * Mass measures ("1 oz, cooked"), "Quantity not specified" and wording without a leading "1" are left out.
 */
export function usdaPortions(measures: Array<{ label: string; grams: number }>): CatalogPortion[] {
  const seen = new Set<string>();
  const portions: FoodPortion[] = [];
  for (const measure of measures) {
    const portion = portionFromLabel(measure.label, measure.grams);
    if (!portion || portion.grams > 5000 || HOUSEHOLD_ONLY.has(portion.unit)) continue;
    const key = portion.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    portions.push(portion);
  }
  portions.sort((a, b) => unitOrder(a.unit) - unitOrder(b.unit) || plainness(a) - plainness(b) || a.grams - b.grams);
  // A bare count ("2 milk") must not mean two school milk cartons or two cubic inches of cheese.
  const natural = portions.filter((portion) => !NOT_A_COUNT.test(portion.label));
  const defaults = new Set(withCountDefault(natural).filter((portion) => portion.countDefault).map((portion) => portion.label));
  return portions.map((portion) => ({
    label: portion.label,
    unit: portion.unit as CatalogPortion["unit"],
    grams: portion.grams,
    isDefault: defaults.has(portion.label),
  }));
}

/** Search words from FDC's "additional descriptions", minus survey notes such as "NS as to skin eaten". */
export function keywordsOf(additionalDescriptions: string | undefined): string[] {
  return unique(String(additionalDescriptions ?? "")
    .split(";")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part && part.length <= 40 && part.split(/\s+/).length <= 5)
    .filter((part) => !/^(ns as to|nfs$|any source$|other |made with |with or without|from |eaten$)/.test(part) && !/\bns as to\b/.test(part)))
    .slice(0, 6);
}

/**
 * Meat, fish or egg, when the food's own name, category or USDA ingredient list says so (FNDDS lists every
 * ingredient, down to "Soup, chicken broth"). Otherwise null: an ingredient can itself be a product whose
 * contents its name does not show ("Candies, marshmallows" has gelatin), so FITX never claims "vegetarian"
 * from this. Hand-checked staples carry veg and vegan labels instead (STAPLE_DIET).
 */
export function dietTypeOf(name: string, ingredients: readonly string[], category: string | null): DietType | null {
  const texts = [name, ...ingredients].map((text) => text.toLowerCase());
  if (texts.some(isNonVeg) || NON_VEG_CATEGORY.test(category ?? "")) return "non_veg";
  if (texts.some((text) => EGG.test(text))) return "egg";
  return null;
}

/** Common Indian dishes in FNDDS, so the app can tell them apart from similar Western foods. */
export function cuisineOf(name: string): string | null {
  return INDIAN_DISH.test(name.toLowerCase()) ? "indian" : null;
}

export function categoryOf(record: FdcRecord): string | null {
  const category = typeof record.foodCategory === "string" ? record.foodCategory : record.foodCategory?.description;
  return category?.trim() || null;
}

/** A full FDC record: GET /v1/food/{id}, and every record in the bulk JSON downloads (fdc.nal.usda.gov/download-datasets). */
export interface FdcFullRecord {
  fdcId: number;
  description: string;
  dataType: string;
  publicationDate?: string;
  foodCategory?: { description?: string } | string;
  wweiaFoodCategory?: { wweiaFoodCategoryDescription?: string };
  foodNutrients?: FdcRecord["foodNutrients"];
  foodPortions?: Array<{ gramWeight?: number; amount?: number; modifier?: string; portionDescription?: string; measureUnit?: { name?: string } }>;
  foodAttributes?: Array<{ value?: string; foodAttributeType?: { name?: string } }>;
  inputFoods?: Array<{ ingredientDescription?: string; foodDescription?: string }>;
}

/**
 * A full record in the search-result shape catalogRow reads, so the bulk downloads and the API pages give the same
 * rows: the WWEIA category of FNDDS foods, their "Additional Description" attributes as search words, their
 * ingredients for the diet label, and portions written the way search results write household measures.
 */
export function fromFullRecord(record: FdcFullRecord): FdcRecord {
  const extraNames = (record.foodAttributes ?? [])
    .filter((attribute) => /^additional description$/i.test(String(attribute.foodAttributeType?.name ?? "").trim()))
    .map((attribute) => String(attribute.value ?? "").trim())
    .filter(Boolean);
  return {
    fdcId: record.fdcId,
    description: record.description,
    dataType: record.dataType,
    publicationDate: record.publicationDate,
    foodCategory: record.wweiaFoodCategory?.wweiaFoodCategoryDescription ?? record.foodCategory,
    additionalDescriptions: extraNames.length ? extraNames.join("; ") : undefined,
    foodNutrients: record.foodNutrients,
    foodMeasures: (record.foodPortions ?? []).map((portion) => ({ disseminationText: portionText(portion), gramWeight: portion.gramWeight })),
    finalFoodInputFoods: (record.inputFoods ?? []).map((input) => ({ foodDescription: input.ingredientDescription ?? input.foodDescription })),
  };
}

/**
 * How a full record's portion reads as a household measure: FNDDS writes it out ("1 medium chappatti or roti (7")");
 * SR Legacy and Foundation give an amount, a unit and a note ("1" + "cup" + "chopped"). RACC, the labelling
 * reference amount, is not something people measure out, so it is left out.
 */
function portionText(portion: NonNullable<FdcFullRecord["foodPortions"]>[number]): string {
  const written = String(portion.portionDescription ?? "").trim();
  if (written) return written;
  const unit = String(portion.measureUnit?.name ?? "").trim().toLowerCase();
  const note = String(portion.modifier ?? "").trim();
  if (unit === "racc" || (!note && (!unit || unit === "undetermined"))) return "";
  const amount = Number.isFinite(Number(portion.amount)) && Number(portion.amount) > 0 ? String(Number(portion.amount)) : "1";
  if (!unit || unit === "undetermined") return `${amount} ${note}`;
  return note ? `${amount} ${unit} (${note.toLowerCase()})` : `${amount} ${unit}`;
}

/** A catalogue row from an FDC record, or a reason it was left out. */
export function catalogRow(record: FdcRecord): CatalogRow | { skip: string } {
  const id = String(record.fdcId);
  const name = String(record.description ?? "").trim();
  const category = categoryOf(record);
  if (!name) return { skip: "no name" };
  if (EXCLUDED_FDC_IDS.has(id)) return { skip: "excluded on review" };
  if (category && EXCLUDED_CATEGORY_PATTERN.test(category)) return { skip: `category ${category}` };
  const valueBasis = VALUE_BASIS_BY_DATA_TYPE[record.dataType];
  if (!valueBasis) return { skip: `data type ${record.dataType}` };
  const values = nutrientsOf(record);
  if (values.kcal === null || values.protein === null || values.carbs === null || values.fat === null) return { skip: "missing energy or macros" };
  const kcal = round(values.kcal, 1);
  const protein = round(Math.max(0, values.protein), 2);
  const carbs = round(Math.max(0, values.carbs), 2);
  const fat = round(Math.max(0, values.fat), 2);
  if (kcal < 0 || kcal > 950 || protein > 100 || carbs > 100 || fat > 100 || protein + carbs + fat > 101) return { skip: "values out of range" };
  const ingredients = (record.finalFoodInputFoods ?? []).map((item) => String(item.foodDescription ?? "")).filter(Boolean);
  const measures = (record.foodMeasures ?? []).map((measure) => ({ label: String(measure.disseminationText ?? ""), grams: Number(measure.gramWeight) }));
  return {
    id,
    name,
    aliases: [],
    keywords: keywordsOf(record.additionalDescriptions),
    category,
    cuisine: cuisineOf(name),
    dietType: dietTypeOf(name, ingredients, category),
    state: inferFoodState(name),
    kcal,
    protein,
    carbs,
    fat,
    fiber: nonNegative(values.fiber, 2),
    sugar: nonNegative(values.sugar, 2),
    sodiumMg: nonNegative(values.sodiumMg, 1),
    valueBasis,
    dataType: record.dataType,
    version: (record.publishedDate ?? isoDate(record.publicationDate)) || null,
    portions: usdaPortions(measures),
  };
}

/**
 * Applies a curated FITX staple: its aliases, raw/cooked state and chosen portions win over the bulk import's,
 * because they were picked by hand (src/data/DATA_SOURCES.md). Values must be the FDC values already in the row.
 */
export function withStaple(row: CatalogRow | null, staple: StapleRecord): CatalogRow {
  const base: CatalogRow = row ?? {
    id: staple.id,
    name: staple.name,
    aliases: [],
    keywords: [],
    category: null,
    cuisine: cuisineOf(staple.name),
    dietType: null,
    state: staple.state,
    kcal: staple.calories,
    protein: staple.protein,
    carbs: staple.carbs,
    fat: staple.fat,
    fiber: null,
    sugar: null,
    sodiumMg: null,
    valueBasis: VALUE_BASIS_BY_DATA_TYPE[staple.dataType] ?? "compiled",
    dataType: staple.dataType,
    version: staple.published,
    portions: [],
  };
  return {
    ...base,
    aliases: unique([...staple.aliases.map((alias) => alias.toLowerCase())]),
    state: staple.state,
    dietType: base.dietType ?? STAPLE_DIET[staple.id] ?? null,
    portions: staple.portions.map((portion) => ({
      label: portion.label,
      unit: portion.unit as CatalogPortion["unit"],
      grams: portion.grams,
      isDefault: Boolean(portion.countDefault),
    })),
  };
}

const HOUSEHOLD_ONLY = new Set<FoodUnit>(["katori", "ladle", "spoon"]);
const NOT_A_COUNT = /cubic inch|container|carton|package|packet|\bcan\b|bottle|\bjar\b|\bbox\b|\bbag\b|\bpouch\b/i;

function unitOrder(unit: FoodUnit): number {
  const order: Partial<Record<FoodUnit, number>> = { piece: 0, slice: 1, serving: 2, cup: 3, bowl: 4, plate: 5, glass: 6, tbsp: 7, tsp: 8, floz: 9, ml: 10, l: 11 };
  return order[unit] ?? 20;
}

/** Plain measures first: "1 cup" and "1 cup, cooked" before "1 cup, chopped" or "1 cup, melted". */
function plainness(portion: FoodPortion): number {
  const label = portion.label.toLowerCase().replace(/\s+/g, " ").trim();
  if (/^1 (cup|tablespoon|tbsp|teaspoon|tsp|fl oz|slice|piece|serving)(, (nfs|cooked|prepared|any size))?$/.test(label)) return 0;
  return 1;
}

const NON_VEG_WORDS = [
  "beef", "pork", "chicken", "turkey", "lamb", "mutton", "goat", "veal", "venison", "bison", "rabbit", "duck", "goose", "quail",
  "pheasant", "dove", "squab", "pigeon", "ostrich", "emu", "elk", "moose", "caribou", "deer", "bacon", "ham", "sausage", "sausages",
  "salami", "pepperoni", "chorizo", "frankfurter", "frankfurters", "bologna", "pastrami", "prosciutto", "jerky", "meat", "meats",
  "meatball", "meatballs", "meatloaf", "poultry", "fish", "salmon", "tuna", "cod", "tilapia", "sardine", "sardines", "anchovy",
  "anchovies", "mackerel", "herring", "trout", "catfish", "pollock", "haddock", "halibut", "flounder", "perch", "pike", "carp",
  "whiting", "snapper", "swordfish", "mahi", "bass", "sole", "shark", "eel", "roe", "caviar", "shrimp", "prawn", "prawns", "crab",
  "lobster", "clam", "clams", "oyster", "oysters", "mussel", "mussels", "scallop", "scallops", "squid", "calamari", "octopus",
  "crayfish", "crawfish", "seafood", "shellfish", "gelatin", "gelatine", "lard", "tallow", "suet", "giblets", "gizzard", "gizzards",
  "liver", "tripe", "chitterlings", "worcestershire", "crustaceans", "mollusks", "game", "liverwurst", "pate", "scrapple", "gyro",
];
const NON_VEG = new RegExp(`\\b(${NON_VEG_WORDS.join("|")})\\b`);
/** Words that look like meat but are not: kidney beans, coconut meat, meatless and veggie products. */
const NOT_MEAT = /\b(kidney beans?|beans?, kidney|coconut meat|nut meats?|meatless|imitation (crab|meat)|vegetarian|veggie (burger|patty)|meat substitutes?|soy(bean)? (burger|patty|crumbles))\b/g;
const EGG = /\b(eggs?|egg (white|yolk|noodles)|mayonnaise|meringue|custard|eggnog)\b/;
const NON_VEG_CATEGORY = /(poultry|beef|pork|lamb|veal|game|finfish|shellfish|sausages|luncheon meats|seafood|fish|chicken|turkey|meat)/i;

function isNonVeg(text: string): boolean {
  return NON_VEG.test(text.replace(NOT_MEAT, " "));
}

const INDIAN_DISH = /\b(idli|idly|dosa|sambar|sambhar|dal|daal|dhal|biryani|biriyani|paratha|parantha|puri|poori|naan|chappatti|chapati|roti|upma|vada|samosa|pakora|paneer|channa|chana|saag|korma|tikka|tandoori|vindaloo|chutney|raita|lassi|kheer|halwa|jalebi|gulab jamun|kulfi|khichdi|pulao|pongal|rasam|kofta|aloo|gobi|bhaji|bhindi|dhokla|uttapam|poha|makhani|rajma|chole|masala)\b/;

/**
 * Diet labels for the curated staples, checked by hand against each food's USDA ingredient list (FNDDS) or
 * description (SR Legacy, Foundation). Only these foods are labelled vegetarian or vegan.
 */
const STAPLE_DIET: Record<string, DietType> = {
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

function nonNegative(value: number | null, digits: number): number | null {
  return value === null ? null : round(Math.max(0, value), digits);
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function isoDate(value: string | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  return match ? `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}` : value;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
