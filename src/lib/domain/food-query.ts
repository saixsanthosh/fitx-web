/**
 * Turns what people type into the food search ("3 idlis", "150 g rice", "1.5 cups dal",
 * "200g paneer", "rice 150g", "half cup rice") into the food words to search for plus an
 * amount, and turns that amount into grams with a food's own portion weights.
 *
 * Portion weights come from USDA FoodData Central or from the user's own saved serving.
 * When a unit has no known weight for a food, resolvePortion() answers "ask", so the app asks
 * for grams instead of guessing.
 *
 * No runtime imports: the search route, the nutrition page and `node --test` all load this file.
 */

export type MassUnit = "g" | "kg" | "oz" | "lb";
export type VolumeUnit = "ml" | "l" | "floz" | "cup" | "tbsp" | "tsp";
export type CountUnit = "piece" | "slice" | "serving";
/** Household measures with no standard weight: the app asks for grams (or, for a spoon, which spoon). */
export type HouseholdUnit = "katori" | "bowl" | "plate" | "glass" | "ladle" | "spoon";
export type FoodUnit = MassUnit | VolumeUnit | CountUnit | HouseholdUnit;
export type PortionSize = "small" | "medium" | "large";
export type FoodState = "raw" | "cooked";

export interface ParsedFoodQuery {
  /** The food words without the amount: "3 idlis" gives "idlis". */
  text: string;
  /** Lower-case food words used for matching. */
  words: string[];
  /** The amount typed, or null when the phrase has none. */
  amount: number | null;
  /** The unit typed, or null for a bare count such as "3 idlis". */
  unit: FoodUnit | null;
  /** A size word typed next to the amount, as in "2 large rotis". */
  size: PortionSize | null;
  /**
   * An amount typed as 0 ("0 idli") or below 0 ("-2 idli"). It is not used (`amount` is null) and is not part of the
   * food's name; the app says so and asks how much was eaten, instead of searching for "0 idli" or logging 2.
   */
  problem?: "zero" | "negative";
}

export interface FoodPortion {
  /** The source's own wording, such as USDA's "1 item" or "1 cup, cooked". */
  label: string;
  unit: FoodUnit;
  /** Weight of one such portion in grams. */
  grams: number;
  /** The portion a bare count uses: "3 idlis" is 3 of this. */
  countDefault?: boolean;
  /** false for the user's own serving or a package label. USDA household weights are averages, so they are estimates. */
  estimate?: boolean;
  /** The sourced measure this weight was worked out from (a volume converted through the food's USDA cup weight). */
  derivedFrom?: { label: string; grams: number };
  /** A household vessel (katori, bowl, glass): its volume and whether the member set it. The weight is an estimate. */
  vessel?: { ml: number; custom: boolean };
}

export type PortionResolution =
  | { kind: "none" }
  | { kind: "grams"; grams: number }
  | { kind: "portion"; grams: number; count: number; portion: FoodPortion; estimate: boolean; derivedFrom?: FoodPortion }
  | { kind: "ask"; amount: number; unit: FoodUnit | null; reason: "no-count-weight" | "no-unit-weight" | "household-unit" }
  | { kind: "ask"; amount: number; unit: FoodUnit | null; reason: "no-size-weight"; size: PortionSize };

export interface MatchableFood {
  name: string;
  /** Names the food answers to exactly ("idly", "chana"); typing one can select the food. */
  aliases?: readonly string[];
  /** Words that help find the food but never select it, such as a source's extra descriptions. */
  keywords?: readonly string[];
  state?: FoodState | null;
}

export interface FoodMatch<T> {
  food: T;
  /** Higher is closer. A form the search did not name ("oat milk" for "oats") loses a word's worth. */
  score: number;
  /** The typed food words are the food's whole name or one of its aliases ("rice", "masala dosa"). */
  exact: boolean;
}

const UNIT_WORDS: Record<string, FoodUnit> = {
  g: "g", gm: "g", gms: "g", gr: "g", grm: "g", grms: "g", gram: "g", grams: "g", gramme: "g", grammes: "g",
  kg: "kg", kgs: "kg", kilo: "kg", kilos: "kg", kilogram: "kg", kilograms: "kg",
  oz: "oz", ounce: "oz", ounces: "oz",
  lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
  ml: "ml", mls: "ml", milliliter: "ml", milliliters: "ml", millilitre: "ml", millilitres: "ml",
  l: "l", ltr: "l", ltrs: "l", liter: "l", liters: "l", litre: "l", litres: "l",
  floz: "floz",
  cup: "cup", cups: "cup",
  tbsp: "tbsp", tbsps: "tbsp", tbs: "tbsp", tbl: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp",
  tsp: "tsp", tsps: "tsp", teaspoon: "tsp", teaspoons: "tsp",
  piece: "piece", pieces: "piece", pc: "piece", pcs: "piece", nos: "piece", item: "piece", items: "piece",
  slice: "slice", slices: "slice",
  // A scoop is what a package calls its serving (protein powder), so it uses the label's serving weight.
  serving: "serving", servings: "serving", portion: "serving", portions: "serving", scoop: "serving", scoops: "serving",
  katori: "katori", katoris: "katori", katora: "katori", vati: "katori", wati: "katori",
  bowl: "bowl", bowls: "bowl",
  plate: "plate", plates: "plate",
  glass: "glass", glasses: "glass",
  ladle: "ladle", ladles: "ladle",
  spoon: "spoon", spoons: "spoon", spoonful: "spoon", spoonfuls: "spoon",
};

/** Units that may start a phrase without a number: "cup of rice" means 1 cup. */
const LEADING_UNITS = new Set<FoodUnit>(["cup", "tbsp", "tsp", "piece", "slice", "serving", "katori", "bowl", "plate", "glass", "ladle", "spoon"]);

const SIZE_WORDS: Record<string, PortionSize> = { small: "small", medium: "medium", regular: "medium", large: "large", big: "large" };
const SIZES: readonly PortionSize[] = ["small", "medium", "large"];
const SIZE_LABEL_WORDS: Record<PortionSize, string[]> = { small: ["small"], medium: ["medium", "regular"], large: ["large", "big"] };

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, dozen: 12, half: 0.5, quarter: 0.25,
};

const UNICODE_FRACTIONS: Record<string, string> = {
  "½": "1/2", "⅓": "1/3", "⅔": "2/3", "¼": "1/4", "¾": "3/4", "⅕": "1/5", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8",
};

const FILLER_WORDS = new Set(["of", "x", "about", "around", "approx", "approximately", "roughly", "size", "sized"]);

const MASS_GRAMS: Record<MassUnit, number> = { g: 1, kg: 1000, oz: 28.349523125, lb: 453.59237 };
/** US customary measures, which is what USDA's "cup" and "tablespoon" weights use. */
const VOLUME_ML: Record<VolumeUnit, number> = { ml: 1, l: 1000, floz: 29.5735295625, cup: 236.5882365, tbsp: 14.78676478125, tsp: 4.92892159375 };
const HOUSEHOLD_UNITS = new Set<FoodUnit>(["katori", "bowl", "plate", "glass", "ladle", "spoon"]);

const COOKED_WORDS = new Set(["cooked", "boiled", "baked", "roasted", "fried", "grilled", "steamed", "broiled", "braised", "stewed", "sauteed", "poached", "microwaved", "toasted"]);
const RAW_WORDS = new Set(["raw", "uncooked"]);
/** "Dry" means uncooked only for grains, pulses and pasta ("Lentils, dry"), not for "Cheese, dry white". */
const DRY_MEANS_RAW = new Set([
  "rice", "wheat", "oat", "oats", "quinoa", "bulgur", "farro", "sorghum", "millet", "barley", "corn", "maize", "einkorn", "fonio", "khorasan",
  "spelt", "amaranth", "buckwheat", "teff", "rye", "lentil", "lentils", "bean", "beans", "chickpea", "chickpeas", "pea", "peas", "gram",
  "dal", "dhal", "pasta", "noodle", "noodles", "macaroni", "spaghetti", "vermicelli", "semolina",
]);
/**
 * Forms whose values differ a lot from the plain food: egg powder is about 4x fresh egg per 100 g, tomato
 * paste about 5x tomato, and onion rings are breaded and fried. They rank below the plain food unless the
 * search names them ("oat milk", "peanut butter").
 */
const FORM_WORDS = new Set([
  "dried", "powder", "flour", "concentrate", "breaded", "fried", "paste", "puree", "sauce", "milk", "butter", "juice", "oil",
]);
const FORM_SPELLINGS: Record<string, string> = { dehydrated: "dried", powdered: "powder", concentrated: "concentrate" };
const FORM_PENALTY = 3;
/**
 * Measures that are a container, not one of the food: a bare count ("2 milk", "2 marie biscuits") never means two
 * school cartons, two cans, two cubic inches of cheese or two whole packs.
 */
export const NOT_A_COUNT = /cubic inch|container|carton|\bpacks?\b|package|packet|\bcans?\b|bottle|\bjar\b|\bbox\b|\bbag\b|\bpouch\b/i;

/** Splits a typed phrase into the food words and the amount. */
export function parseFoodQuery(input: string): ParsedFoodQuery {
  const signed = tokenizeWithSigns(input);
  const tokens = signed.map((item) => item.token);
  let amount: number | null = null;
  let unit: FoodUnit | null = null;
  let size: PortionSize | null = null;
  let problem: ParsedFoodQuery["problem"];
  let start = -1;
  let end = -1;

  for (let index = 0; index < tokens.length && start < 0; index += 1) {
    const read = readAmount(tokens, index);
    if (!read) continue;
    // "0 idli" and "-2 idli" name no amount that can be eaten: say so, rather than search "0 idli" or log 2.
    if (read.value === 0) problem = "zero";
    else if (signed[index].negative) problem = "negative";
    amount = problem ? null : read.value;
    let next = read.next;
    if (tokens[next] === "x") next += 1;
    if (SIZE_WORDS[tokens[next]]) { size = SIZE_WORDS[tokens[next]]; next += 1; }
    if (UNIT_WORDS[tokens[next]]) {
      unit = UNIT_WORDS[tokens[next]];
      next += 1;
      if (tokens[next] === "of") next += 1;
    }
    start = index > 0 && tokens[index - 1] === "x" ? index - 1 : index;
    end = next;
  }

  if (start < 0 && tokens.length && LEADING_UNITS.has(UNIT_WORDS[tokens[0]])) {
    amount = 1;
    unit = UNIT_WORDS[tokens[0]];
    start = 0;
    end = tokens[1] === "of" ? 2 : 1;
  }

  const rest = start < 0 ? tokens : [...tokens.slice(0, start), ...tokens.slice(end)];
  const words = unique(rest.flatMap(splitText).filter((word) => !FILLER_WORDS.has(word)));
  return problem ? { text: words.join(" "), words, amount: null, unit: null, size: null, problem } : { text: words.join(" "), words, amount, unit, size };
}

/** What to tell the member about an amount of 0 or below, before they pick a food (`picking`) or in the food's panel. */
export function amountProblemMessage(problem: NonNullable<ParsedFoodQuery["problem"]>, picking: boolean): string {
  const said = problem === "zero" ? "An amount of 0 can't be logged." : "An amount below 0 can't be logged.";
  return `${said} ${picking ? "Tap the food you mean, then enter how much you had." : "Enter how much you had."}`;
}

/** "idlis" -> "idli", "tomatoes" -> "tomato", "berries" -> "berry". */
export function singular(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(?:ches|shes|sses|xes|zes|oes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss") && !word.endsWith("us")) return word.slice(0, -1);
  return word;
}

/** 0 when the food does not match every word; higher means a closer match. */
export function foodMatchScore(food: MatchableFood, words: readonly string[]): number {
  return scoreFood(food, words).score;
}

/**
 * Foods that match every word, best first, with how well each matched. A form the search did not name
 * ranks below the plain food ("oats" before oat milk, "tomato" before tomato paste). For grains and pulses,
 * cooked forms come before raw ones ("rice" usually means cooked rice); other foods keep the order given,
 * so callers list their most trusted source first.
 */
export function matchFoods<T extends MatchableFood>(
  foods: readonly T[],
  words: readonly string[],
  options: { boost?: (food: T) => number } = {},
): FoodMatch<T>[] {
  const asked = new Set(words.map((word) => formWord(singular(word))));
  return foods
    .map((food, index) => {
      const { score, exact } = scoreFood(food, words);
      const penalty = !exact && hasUnaskedForm(food.name, asked) ? FORM_PENALTY : 0;
      const boost = score > 0 && options.boost ? options.boost(food) : 0;
      return { food, index, exact, matched: score > 0, score: score - penalty + boost, state: grainStateRank(food, words) };
    })
    .filter((item) => item.matched)
    // An exact name or alias always comes first, whatever a boost adds to looser matches.
    .sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score || a.state - b.state || a.index - b.index)
    .map(({ food, score, exact }) => ({ food, score, exact }));
}

export function rankFoods<T extends MatchableFood>(foods: readonly T[], words: readonly string[]): T[] {
  return matchFoods(foods, words).map((match) => match.food);
}

/**
 * The food to select without asking: the only one whose whole name or alias is what was typed ("rice",
 * "2 eggs", "masala dosa"). Anything looser waits for the user to tap a food: "paneer" only appears inside
 * Palak Paneer, and the one watermelon in the USDA snapshot is the rind.
 */
export function clearMatch<T>(matches: readonly FoodMatch<T>[]): T | null {
  const exact = matches.filter((match) => match.exact);
  return exact.length === 1 ? exact[0].food : null;
}

/** Reads "raw" or "cooked" from a food description such as "Rice, white, long grain, unenriched, raw". */
export function inferFoodState(name: string): FoodState | null {
  // USDA's "baked, from raw" is cooked food that started raw, not raw food.
  const tokens = splitText(name.replace(/\bfrom raw\b/gi, " "));
  const cooked = tokens.some((token) => COOKED_WORDS.has(token));
  const raw = tokens.some((token) => RAW_WORDS.has(token)) || (tokens.includes("dry") && tokens.some((token) => DRY_MEANS_RAW.has(token)));
  if (cooked === raw) return null;
  return cooked ? "cooked" : "raw";
}

/**
 * Turns the typed amount into grams with the food's portions. Grams and other weights are exact;
 * USDA piece and cup weights are averages, so those results are marked as estimates.
 */
export function resolvePortion(query: Pick<ParsedFoodQuery, "amount" | "unit" | "size">, portions: readonly FoodPortion[] = []): PortionResolution {
  const { amount, unit, size } = query;
  if (amount === null || !Number.isFinite(amount) || amount <= 0) return { kind: "none" };
  if (unit && isMassUnit(unit)) return { kind: "grams", grams: round1(amount * MASS_GRAMS[unit]) };

  // "2 small boiled eggs" when USDA only weighs a large one: ask rather than use the wrong size.
  const sized = portionCandidates(portions, unit).filter((portion) => SIZES.some((each) => labelHasSize(portion.label, each)));
  if (size && sized.length && !sized.some((portion) => labelHasSize(portion.label, size))) return { kind: "ask", amount, unit, reason: "no-size-weight", size };

  const direct = pickPortion(portions, unit, size);
  if (direct) return { kind: "portion", grams: round1(amount * direct.grams), count: amount, portion: direct, estimate: direct.estimate !== false };

  if (unit && isVolumeUnit(unit)) {
    const volume = closestVolumePortion(portions, unit);
    if (volume && isVolumeUnit(volume.unit)) {
      const each = (volume.grams / VOLUME_ML[volume.unit]) * VOLUME_ML[unit];
      const portion: FoodPortion = { label: `1 ${unitLabel(unit)}`, unit, grams: round2(each), estimate: true };
      return { kind: "portion", grams: round1(amount * each), count: amount, portion, estimate: true, derivedFrom: volume };
    }
  }

  const reason = unit === null || unit === "piece" ? "no-count-weight" : HOUSEHOLD_UNITS.has(unit) ? "household-unit" : "no-unit-weight";
  return { kind: "ask", amount, unit, reason };
}

/** The sentence the app shows when it needs grams from the user. */
export function askForGramsMessage(foodName: string, resolution: Extract<PortionResolution, { kind: "ask" }>): string {
  if (resolution.reason === "no-count-weight") return `FITX has no per-piece weight for ${foodName}, so it can't tell what ${formatAmount(resolution.amount)} of it weighs. Enter the amount in grams.`;
  if (resolution.reason === "no-size-weight") return `USDA gives no ${resolution.size} size for ${foodName}. Pick one of its sizes under Unit, or enter the amount in grams.`;
  const unit = unitLabel(resolution.unit ?? "serving");
  if (resolution.unit === "spoon") return `A spoon could be a teaspoon (5 ml) or a tablespoon (15 ml). Pick one, or enter the amount in grams.`;
  if (resolution.reason === "household-unit") return `A ${unit} has no standard weight, so FITX can't tell how much ${foodName} that is. Weigh it, or enter the amount in grams.`;
  return `There is no ${unit} weight for ${foodName}. Enter the amount in grams.`;
}

/** Builds a portion from a source's wording, such as USDA's "1 medium" (38 g), or null if it is not a usable household measure. */
export function portionFromLabel(label: string, grams: number): FoodPortion | null {
  if (!Number.isFinite(grams) || grams <= 0) return null;
  const lower = label.toLowerCase();
  if (lower.includes("quantity not specified") || lower.includes("surface inch")) return null;
  const parsed = parseFoodQuery(label);
  // USDA measures start with "1" ("1 cup, cooked"); wording without one ("Guideline amount per fl oz") is not a portion.
  if (parsed.amount !== 1) return null;
  const unit = parsed.unit ?? "piece";
  if (isMassUnit(unit)) return null;
  return { label: label.trim(), unit, grams: round2(grams) };
}

/**
 * Picks which piece portion a bare count uses when a source does not say: the only one, else a medium or regular
 * one. A container ("1 can", "1 pack") is never picked.
 */
export function withCountDefault(portions: FoodPortion[]): FoodPortion[] {
  if (portions.some((portion) => portion.countDefault)) return portions;
  const pieces = portions.filter((portion) => portion.unit === "piece" && !NOT_A_COUNT.test(portion.label));
  const choice = pieces.length === 1 ? pieces[0] : pieces.find((portion) => labelHasSize(portion.label, "medium"));
  return choice ? portions.map((portion) => (portion === choice ? { ...portion, countDefault: true } : portion)) : portions;
}

/** The gram weight written in a label such as "2 biscuits (25 g)", or null when it gives none. */
export function gramsInLabel(text: string | null | undefined): number | null {
  const match = /(\d+(?:[.,]\d+)?)\s*(?:g|gm|gms|gr|gram|grams)\b/i.exec(String(text ?? ""));
  if (!match) return null;
  const grams = Number(match[1].replace(",", "."));
  return Number.isFinite(grams) && grams > 0 ? grams : null;
}

/**
 * The amount to show after the user picks another unit for the same food. `from` and `to` are the old and new
 * portions, null meaning grams.
 * - Between two versions of the same measure (a large and a small samosa, "1 cup" and "1 cup, chopped") the
 *   count stays: the user is saying which one they had, so 2 large samosas become 2 small ones.
 * - Between grams and a measure, or two different measures (a cup and a tablespoon), the weight stays: 114 g of
 *   idli becomes 3 × 38 g, and 3 idlis become 114 g.
 * - With no amount yet: the count typed earlier ("2 small boiled eggs" when the food has no small size) once the
 *   user picks a measure of that kind, else 1 of a measure or 100 g.
 */
export function amountAfterUnitChange(
  amount: number,
  from: Pick<FoodPortion, "unit" | "grams"> | null,
  to: Pick<FoodPortion, "unit" | "grams"> | null,
  typed: { amount: number; unit: FoodUnit | null } | null = null,
): number {
  const hasAmount = Number.isFinite(amount) && amount > 0;
  if (hasAmount && from && to && from.unit === to.unit) return amount;
  const grams = hasAmount ? amount * (from ? from.grams : 1) : Number.NaN;
  const converted = grams > 0 ? (to ? grams / to.grams : grams) : Number.NaN;
  if (converted >= 0.01) return round2(converted);
  if (to && typed && typed.amount > 0 && to.unit === (typed.unit ?? "piece")) return typed.amount;
  return to ? 1 : 100;
}

/** "3 × 1 item (114 g)", for the meal log. */
export function describePortion(count: number, portion: FoodPortion, grams: number): string {
  return `${formatAmount(count)} × ${portion.label} (${formatAmount(grams)} g)`;
}

/** The amount part of what was typed: "200 g", "1 tablespoon", "2 large", or "" when there is none. */
export function describeTypedAmount(query: Pick<ParsedFoodQuery, "amount" | "unit" | "size">): string {
  if (query.amount === null) return "";
  return [formatAmount(query.amount), query.size, query.unit && unitLabel(query.unit, query.amount)].filter(Boolean).join(" ");
}

export function unitLabel(unit: FoodUnit, count = 1): string {
  const labels: Record<FoodUnit, [string, string]> = {
    g: ["g", "g"], kg: ["kg", "kg"], oz: ["oz", "oz"], lb: ["lb", "lb"], ml: ["ml", "ml"], l: ["litre", "litres"], floz: ["fl oz", "fl oz"],
    cup: ["cup", "cups"], tbsp: ["tablespoon", "tablespoons"], tsp: ["teaspoon", "teaspoons"], piece: ["piece", "pieces"],
    slice: ["slice", "slices"], serving: ["serving", "servings"], katori: ["katori", "katoris"], bowl: ["bowl", "bowls"],
    plate: ["plate", "plates"], glass: ["glass", "glasses"], ladle: ["ladle", "ladles"], spoon: ["spoon", "spoons"],
  };
  return labels[unit][count === 1 ? 0 : 1];
}

export function formatAmount(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function tokenize(input: string): string[] {
  return tokenizeWithSigns(input).map((item) => item.token);
}

/** The tokens, each marked when it was a number typed with a minus sign ("-2", "−2"), which the token itself drops. */
function tokenizeWithSigns(input: string): Array<{ token: string; negative: boolean }> {
  let text = String(input ?? "").toLowerCase().replace(/[−–]/g, "-");
  for (const [glyph, ascii] of Object.entries(UNICODE_FRACTIONS)) text = text.replaceAll(glyph, ` ${ascii} `);
  text = text
    .normalize("NFKC")
    .replace(/⁄/g, "/")
    .replace(/[×*]/g, " x ")
    .replace(/\bfl\.?\s*oz\b|\bfluid\s+ounces?\b/g, " floz ")
    .replace(/[()[\]{}"“”‘’!?;:+]/g, " ")
    // Keep "1,5" and "1,000"; any other comma separates words. (No lookbehind: older iOS Safari rejects it.)
    .replace(/(\d?),(\d?)/g, (match, before: string, after: string) => (before && after ? match : `${before} ${after}`))
    .replace(/(\d)x\b/g, "$1 x ")
    .replace(/\bx(\d)/g, " x $1");
  text = text.replace(UNIT_SUFFIX, "$1 $2");
  return text
    .split(/\s+/)
    .map((raw) => ({ token: raw.replace(/^['-]+|[.'-]+$/g, "").replace(/^\.(?!\d)/, ""), negative: /^-+\.?\d/.test(raw) }))
    .filter((item) => item.token);
}

/** "200g" -> "200 g", "1.5cups" -> "1.5 cups", but "7up" stays one word. */
const UNIT_SUFFIX = new RegExp(`(\\d)(${Object.keys(UNIT_WORDS).sort((a, b) => b.length - a.length).join("|")})(?![a-z])`, "g");

function readAmount(tokens: string[], index: number): { value: number; next: number } | null {
  const token = tokens[index];
  let value = parseNumberToken(token);
  let next = index + 1;
  if (value === null) {
    const word = NUMBER_WORDS[token];
    if (word === undefined || ((token === "a" || token === "an") && index !== 0)) return null;
    value = word;
  }
  if (Number.isInteger(value) && /^\d+\/\d+$/.test(tokens[next] ?? "")) {
    value += parseNumberToken(tokens[next]) ?? 0;
    next += 1;
  }
  if (token !== "dozen" && tokens[next] === "dozen") {
    value *= 12;
    next += 1;
  }
  // 0 is read as an amount too, so "0 idli" is not a search for a food called "0 idli" (parseFoodQuery flags it).
  return value >= 0 ? { value, next } : null;
}

function parseNumberToken(token: string | undefined): number | null {
  if (!token) return null;
  if (/^\d+(?:\.\d+)?$/.test(token) || /^\.\d+$/.test(token)) return Number(token);
  if (/^\d+,\d{1,2}$/.test(token)) return Number(token.replace(",", "."));
  if (/^\d{1,3}(?:,\d{3})+$/.test(token)) return Number(token.replace(/,/g, ""));
  const fraction = /^(\d+)\/(\d+)$/.exec(token);
  if (fraction && Number(fraction[2]) > 0) return Number(fraction[1]) / Number(fraction[2]);
  return null;
}

/** The portions that can answer a unit: piece portions (and the default serving) for a bare count, otherwise that unit's own. */
function portionCandidates(portions: readonly FoodPortion[], unit: FoodUnit | null): FoodPortion[] {
  const countable = unit === null || unit === "piece";
  return portions.filter((portion) => (countable ? portion.unit === "piece" || (unit === null && portion.countDefault) : portion.unit === unit));
}

function pickPortion(portions: readonly FoodPortion[], unit: FoodUnit | null, size: PortionSize | null): FoodPortion | null {
  const countable = unit === null || unit === "piece";
  const candidates = portionCandidates(portions, unit);
  if (!candidates.length) return null;
  if (size) {
    const sized = candidates.find((portion) => labelHasSize(portion.label, size));
    if (sized) return sized;
  }
  const preferred = candidates.find((portion) => portion.countDefault);
  if (preferred) return preferred;
  if (!countable) return candidates[0];
  // A bare count uses a lone piece measure only when it is one of the food, not its can, carton or pack.
  return candidates.length === 1 && !NOT_A_COUNT.test(candidates[0].label) ? candidates[0] : null;
}

/** The volume measure nearest in size to the one asked for, so "2 tsp ghee" scales USDA's tablespoon, not its cup. */
function closestVolumePortion(portions: readonly FoodPortion[], unit: VolumeUnit): FoodPortion | null {
  let best: FoodPortion | null = null;
  let bestDistance = Infinity;
  for (const portion of portions) {
    if (!isVolumeUnit(portion.unit)) continue;
    const distance = Math.abs(Math.log(VOLUME_ML[portion.unit] / VOLUME_ML[unit]));
    if (distance < bestDistance) { best = portion; bestDistance = distance; }
  }
  return best;
}

function labelHasSize(label: string, size: PortionSize): boolean {
  const tokens = splitText(label);
  return SIZE_LABEL_WORDS[size].some((word) => tokens.includes(word));
}

/** 3 for the same word, 2 for a prefix ("egg" in "eggplant"), 1 for a longer word inside a name ("berry" in "blueberries"). */
function wordScore(forms: readonly string[], tokens: readonly string[], allowInside: boolean): number {
  let best = 0;
  for (const token of tokens) {
    for (const form of forms) {
      if (token === form || singular(token) === form) return 3;
      if (form.length >= 2 && token.startsWith(form)) best = Math.max(best, 2);
      else if (allowInside && form.length >= 4 && token.includes(form)) best = Math.max(best, 1);
    }
  }
  return best;
}

function scoreFood(food: MatchableFood, words: readonly string[]): { score: number; exact: boolean } {
  if (!words.length) return { score: 0, exact: false };
  const nameTokens = splitText(food.name);
  const aliasPhrases = (food.aliases ?? []).map((alias) => splitText(alias));
  const aliasTokens = aliasPhrases.flat();
  const keywordTokens = (food.keywords ?? []).flatMap((keyword) => splitText(keyword));
  let score = 0;
  for (const word of words) {
    const forms = unique([word, singular(word), word.endsWith("ies") ? word.slice(0, -1) : word]);
    // A keyword match counts one less than the same match in the name or an alias.
    const best = Math.max(wordScore(forms, nameTokens, true), wordScore(forms, aliasTokens, false), wordScore(forms, keywordTokens, false) - 1);
    if (best <= 0) return { score: 0, exact: false };
    score += best;
  }
  const phrase = words.map(singular).join(" ");
  const samePhrase = (tokens: string[]) => tokens.map(singular).join(" ") === phrase;
  const exact = samePhrase(nameTokens) || aliasPhrases.some(samePhrase);
  if (exact) score += 4;
  // The food itself heads its name: "Bananas, raw", "Cheese, Brie", or one group word and then the food ("Nuts,
  // almonds", "Fish, salmon"). A dish that only starts with the word ("Banana split", "Almond chicken") gets less.
  const head = singular(words[0]);
  const parts = food.name.replace(/\([^)]*\)/g, " ").split(",").map((part) => splitText(part).map(singular).join(" ")).filter(Boolean);
  const names = (part: string | undefined) => part === head || part === phrase;
  if (names(parts[0]) || (parts.length > 1 && !parts[0].includes(" ") && names(parts[1]))) score += 2;
  else if (nameTokens[0] && singular(nameTokens[0]) === head) score += 1;
  return { score, exact };
}

/**
 * Whether the food is a form the search did not name: a form word in the first part of its name
 * ("Oat milk", "Almond butter") or leading a later part ("Tomato, paste", "Onion rings, breaded").
 * "Yogurt, plain, whole milk" is yogurt, so its "milk" does not count.
 */
function hasUnaskedForm(name: string, asked: ReadonlySet<string>): boolean {
  const parts = name.split(",").map(splitText).filter((tokens) => tokens.length > 0);
  const heads = [...(parts[0] ?? []), ...parts.slice(1).map((tokens) => tokens[0])];
  return heads.some((token) => {
    const form = formWord(token);
    return FORM_WORDS.has(form) && !asked.has(form);
  });
}

function formWord(word: string): string {
  return FORM_SPELLINGS[word] ?? word;
}

/**
 * Raw and cooked grains and pulses differ about 2-3x per 100 g, so cooked comes first for them only: when the food's
 * name starts with one ("Rice, white, cooked") or one was typed. A dish that merely mentions one ("Chicken fillet
 * sandwich, grilled, on wheat bun") keeps its place.
 */
function grainStateRank(food: MatchableFood, words: readonly string[]): number {
  const grain = (word: string | undefined) => word !== undefined && (DRY_MEANS_RAW.has(word) || DRY_MEANS_RAW.has(singular(word)));
  return grain(splitText(food.name)[0]) || words.some(grain) ? stateRank(food.state) : 1;
}

function splitText(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9%]+/)
    .filter(Boolean);
}

function stateRank(state: FoodState | null | undefined): number {
  return state === "cooked" ? 0 : state === "raw" ? 2 : 1;
}

function isMassUnit(unit: FoodUnit): unit is MassUnit {
  return unit in MASS_GRAMS;
}

function isVolumeUnit(unit: FoodUnit): unit is VolumeUnit {
  return unit in VOLUME_ML;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ─── Millilitres and household measures ─────────────────────────────────────────────────────────────

/** What unit a typed or chosen amount is in, for stepping it: a mass or volume moves in tens, a count in halves. */
export type StepKind = "mass" | "count";

/**
 * The amount after one tap on the + or - button next to the amount field. Grams and millilitres move by 10 (never
 * below 1); pieces, servings and household measures by 0.5 (never below 0.25). A typed value that is not a number
 * starts from one step.
 */
export function stepAmount(current: number, direction: 1 | -1, kind: StepKind): number {
  const step = kind === "mass" ? 10 : 0.5;
  const floor = kind === "mass" ? 1 : 0.25;
  const base = Number.isFinite(current) && current > 0 ? current : 0;
  const next = round2(base + direction * step);
  return Math.max(next, floor);
}

/** Whether a unit is counted in tens (grams, millilitres) or in halves (everything else) when stepping. */
export function stepKindOf(unit: FoodUnit | null): StepKind {
  return unit === null || isMassUnit(unit) || unit === "ml" || unit === "l" || unit === "floz" ? "mass" : "count";
}

/** The volume measures a food could be asked for, in order of use. */
const DERIVED_VOLUMES: ReadonlyArray<{ unit: VolumeUnit; label: string }> = [
  { unit: "ml", label: "1 ml" },
  { unit: "tsp", label: "1 teaspoon" },
  { unit: "tbsp", label: "1 tablespoon" },
  { unit: "cup", label: "1 cup" },
];

/** Grams per millilitre from the food's own USDA volume measure (US cup or spoon), or null when it has none. */
export function densityFromPortions(portions: readonly FoodPortion[]): { gramsPerMl: number; from: FoodPortion } | null {
  const volume = portions.find((portion) => isVolumeUnit(portion.unit) && portion.grams > 0);
  if (!volume || !isVolumeUnit(volume.unit)) return null;
  return { gramsPerMl: volume.grams / VOLUME_ML[volume.unit as VolumeUnit], from: volume };
}

/**
 * Millilitres, teaspoons, tablespoons and cups for a food that USDA gives at least one volume measure for, each
 * weighed through that measure and marked as a portion estimate with the measure it came from. A food with no
 * volume measure gets none: FITX never assumes that 1 ml weighs 1 g.
 */
export function volumeOptions(portions: readonly FoodPortion[]): FoodPortion[] {
  const density = densityFromPortions(portions);
  if (!density) return [];
  const have = new Set(portions.map((portion) => portion.unit));
  return DERIVED_VOLUMES.filter(({ unit }) => !have.has(unit)).map(({ unit, label }) => ({
    label,
    unit,
    grams: Math.round(density.gramsPerMl * VOLUME_ML[unit] * 10000) / 10000,
    estimate: true,
    derivedFrom: { label: density.from.label, grams: density.from.grams },
  }));
}

export type Vessel = "katori" | "bowl" | "glass";
export type HouseholdMl = Partial<Record<Vessel, number>>;

/**
 * Working volumes for the household vessels, used until the member sets their own. These are FITX assumptions, not a
 * sourced standard: katori and bowl sizes differ from home to home. They are shown as estimates and documented in
 * src/data/DATA_SOURCES.md. The weight of a vessel comes from the food's own sourced volume measure, never from a
 * made-up weight per food.
 */
export const DEFAULT_HOUSEHOLD_ML: Readonly<Record<Vessel, number>> = { katori: 150, bowl: 250, glass: 200 };
/** The volume a member may set for a vessel. */
export const HOUSEHOLD_ML_RANGE = { min: 30, max: 1500 } as const;

const LIQUID_NAME = /\b(milk|juice|lassi|buttermilk|chaas|water|tea|coffee|drink|soup|smoothie|shake|broth|rasam|kadha)\b/i;

/** Katori and bowl for any food with a volume measure; a glass only for drinks. */
export function householdOptions(portions: readonly FoodPortion[], foodName: string, household: HouseholdMl = {}): FoodPortion[] {
  const density = densityFromPortions(portions);
  if (!density) return [];
  const vessels: Vessel[] = LIQUID_NAME.test(foodName) ? ["katori", "bowl", "glass"] : ["katori", "bowl"];
  return vessels.map((vessel) => {
    const custom = typeof household[vessel] === "number" && Number.isFinite(household[vessel]) && (household[vessel] as number) >= HOUSEHOLD_ML_RANGE.min && (household[vessel] as number) <= HOUSEHOLD_ML_RANGE.max;
    const ml = custom ? (household[vessel] as number) : DEFAULT_HOUSEHOLD_ML[vessel];
    return {
      label: `1 ${vessel} (${formatAmount(ml)} ml${custom ? ", your size" : ""})`,
      unit: vessel,
      grams: round1(density.gramsPerMl * ml),
      estimate: true,
      derivedFrom: { label: density.from.label, grams: density.from.grams },
      vessel: { ml, custom },
    };
  });
}

/** Every measure a food can be logged in beyond its own portions: volume units, then household vessels. */
export function extraPortions(portions: readonly FoodPortion[], foodName: string, household: HouseholdMl = {}): FoodPortion[] {
  return [...volumeOptions(portions), ...householdOptions(portions, foodName, household)];
}

/** Why a food has no ml, cup or katori option, in one line, or null when it has some. */
export function noVolumeReason(portions: readonly FoodPortion[]): string | null {
  return densityFromPortions(portions) ? null : "This food has no volume measure from its source, so ml, cups and katori are not offered. Use grams or a piece.";
}
