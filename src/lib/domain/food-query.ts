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
export type HouseholdUnit = "katori" | "bowl" | "plate" | "glass";
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
}

export type PortionResolution =
  | { kind: "none" }
  | { kind: "grams"; grams: number }
  | { kind: "portion"; grams: number; count: number; portion: FoodPortion; estimate: boolean; derivedFrom?: FoodPortion }
  | { kind: "ask"; amount: number; unit: FoodUnit | null; reason: "no-count-weight" | "no-unit-weight" | "household-unit" };

export interface MatchableFood {
  name: string;
  aliases?: readonly string[];
  state?: FoodState | null;
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
  serving: "serving", servings: "serving", portion: "serving", portions: "serving",
  katori: "katori", katoris: "katori", katora: "katori",
  bowl: "bowl", bowls: "bowl",
  plate: "plate", plates: "plate",
  glass: "glass", glasses: "glass",
};

/** Units that may start a phrase without a number: "cup of rice" means 1 cup. */
const LEADING_UNITS = new Set<FoodUnit>(["cup", "tbsp", "tsp", "piece", "slice", "serving", "katori", "bowl", "plate", "glass"]);

const SIZE_WORDS: Record<string, PortionSize> = { small: "small", medium: "medium", regular: "medium", large: "large", big: "large" };
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
const HOUSEHOLD_UNITS = new Set<FoodUnit>(["katori", "bowl", "plate", "glass"]);

const COOKED_WORDS = new Set(["cooked", "boiled", "baked", "roasted", "fried", "grilled", "steamed", "broiled", "braised", "stewed", "sauteed", "poached", "microwaved", "toasted"]);
const RAW_WORDS = new Set(["raw", "uncooked"]);
/** "Dry" means uncooked only for grains, pulses and pasta ("Lentils, dry"), not for "Cheese, dry white". */
const DRY_MEANS_RAW = new Set([
  "rice", "wheat", "oat", "oats", "quinoa", "bulgur", "farro", "sorghum", "millet", "barley", "corn", "maize", "einkorn", "fonio", "khorasan",
  "spelt", "amaranth", "buckwheat", "teff", "rye", "lentil", "lentils", "bean", "beans", "chickpea", "chickpeas", "pea", "peas", "gram",
  "dal", "dhal", "pasta", "noodle", "noodles", "macaroni", "spaghetti", "vermicelli", "semolina",
]);
/** Concentrated forms whose values differ a lot from the plain food: egg powder is about 4x fresh egg per 100 g. */
const PROCESSED_WORDS = new Set(["dried", "dehydrated", "powder", "powdered", "flour", "concentrate", "concentrated"]);

/** Splits a typed phrase into the food words and the amount. */
export function parseFoodQuery(input: string): ParsedFoodQuery {
  const tokens = tokenize(input);
  let amount: number | null = null;
  let unit: FoodUnit | null = null;
  let size: PortionSize | null = null;
  let start = -1;
  let end = -1;

  for (let index = 0; index < tokens.length && start < 0; index += 1) {
    const read = readAmount(tokens, index);
    if (!read) continue;
    amount = read.value;
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
  return { text: words.join(" "), words, amount, unit, size };
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
  if (!words.length) return 0;
  const nameTokens = splitText(food.name);
  const aliasPhrases = (food.aliases ?? []).map((alias) => splitText(alias));
  const aliasTokens = aliasPhrases.flat();
  let score = 0;
  for (const word of words) {
    const forms = unique([word, singular(word), word.endsWith("ies") ? word.slice(0, -1) : word]);
    const best = Math.max(wordScore(forms, nameTokens, true), wordScore(forms, aliasTokens, false));
    if (best === 0) return 0;
    score += best;
  }
  const phrase = words.map(singular).join(" ");
  const samePhrase = (tokens: string[]) => tokens.map(singular).join(" ") === phrase;
  if (samePhrase(nameTokens) || aliasPhrases.some(samePhrase)) score += 4;
  if (nameTokens[0] && singular(nameTokens[0]) === singular(words[0])) score += 2;
  return score;
}

/**
 * Foods that match every word, best first. Ties put plain foods before dried or powdered forms the
 * search did not ask for ("egg" before egg powder), then cooked before unlabelled and raw forms, then
 * keep the order given, so callers list their most trusted source first.
 */
export function rankFoods<T extends MatchableFood>(foods: readonly T[], words: readonly string[]): T[] {
  const askedForm = words.some((word) => PROCESSED_WORDS.has(singular(word)));
  return foods
    .map((food, index) => ({ food, index, score: foodMatchScore(food, words), form: askedForm ? 0 : processedRank(food.name) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.form - b.form || stateRank(a.food.state) - stateRank(b.food.state) || a.index - b.index)
    .map((item) => item.food);
}

/** Reads "raw" or "cooked" from a food description such as "Rice, white, long grain, unenriched, raw". */
export function inferFoodState(name: string): FoodState | null {
  const tokens = splitText(name);
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
  const unit = unitLabel(resolution.unit ?? "serving");
  if (resolution.reason === "household-unit") return `A ${unit} has no standard weight, so FITX can't tell how much ${foodName} that is. Weigh it, or enter the amount in grams.`;
  return `There is no ${unit} weight for ${foodName}. Enter the amount in grams.`;
}

/** Builds a portion from a source's wording, such as USDA's "1 medium" (38 g), or null if it is not a usable household measure. */
export function portionFromLabel(label: string, grams: number): FoodPortion | null {
  if (!Number.isFinite(grams) || grams <= 0) return null;
  const lower = label.toLowerCase();
  if (lower.includes("quantity not specified") || lower.includes("surface inch")) return null;
  const parsed = parseFoodQuery(label);
  if (parsed.amount !== null && parsed.amount !== 1) return null;
  const unit = parsed.unit ?? "piece";
  if (isMassUnit(unit)) return null;
  return { label: label.trim(), unit, grams: round2(grams) };
}

/** Picks which piece portion a bare count uses when a source does not say: the only one, else a medium or regular one. */
export function withCountDefault(portions: FoodPortion[]): FoodPortion[] {
  if (portions.some((portion) => portion.countDefault)) return portions;
  const pieces = portions.filter((portion) => portion.unit === "piece");
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

/** "3 × 1 item (114 g)", for the meal log. */
export function describePortion(count: number, portion: FoodPortion, grams: number): string {
  return `${formatAmount(count)} × ${portion.label} (${formatAmount(grams)} g)`;
}

export function unitLabel(unit: FoodUnit, count = 1): string {
  const labels: Record<FoodUnit, [string, string]> = {
    g: ["g", "g"], kg: ["kg", "kg"], oz: ["oz", "oz"], lb: ["lb", "lb"], ml: ["ml", "ml"], l: ["litre", "litres"], floz: ["fl oz", "fl oz"],
    cup: ["cup", "cups"], tbsp: ["tablespoon", "tablespoons"], tsp: ["teaspoon", "teaspoons"], piece: ["piece", "pieces"],
    slice: ["slice", "slices"], serving: ["serving", "servings"], katori: ["katori", "katoris"], bowl: ["bowl", "bowls"],
    plate: ["plate", "plates"], glass: ["glass", "glasses"],
  };
  return labels[unit][count === 1 ? 0 : 1];
}

export function formatAmount(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function tokenize(input: string): string[] {
  let text = String(input ?? "").toLowerCase();
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
    .map((token) => token.replace(/^['-]+|[.'-]+$/g, "").replace(/^\.(?!\d)/, ""))
    .filter(Boolean);
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
  return value > 0 ? { value, next } : null;
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

function pickPortion(portions: readonly FoodPortion[], unit: FoodUnit | null, size: PortionSize | null): FoodPortion | null {
  const countable = unit === null || unit === "piece";
  const candidates = portions.filter((portion) => (countable ? portion.unit === "piece" || (unit === null && portion.countDefault) : portion.unit === unit));
  if (!candidates.length) return null;
  if (size) {
    const sized = candidates.find((portion) => labelHasSize(portion.label, size));
    if (sized) return sized;
  }
  return candidates.find((portion) => portion.countDefault) ?? (candidates.length === 1 || !countable ? candidates[0] : null);
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

function processedRank(name: string): number {
  return splitText(name).some((token) => PROCESSED_WORDS.has(token)) ? 1 : 0;
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
