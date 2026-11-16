import "server-only";

/**
 * Diet and allergy rules FITX enforces in code on every food the coach suggests, whatever the model
 * said. Word lists include common Indian names (paneer, ghee, groundnut, atta, maida, suji…).
 * When in doubt a food is treated as containing the ingredient: a vegetarian never gets an egg dish.
 */

export type DietRule = "vegetarian" | "eggetarian" | "vegan" | "pescatarian" | "halal" | "jain" | "no_onion_garlic" | "no_beef" | "no_pork";
export type AllergyRule = "dairy" | "eggs" | "peanuts" | "tree_nuts" | "wheat" | "soy" | "fish" | "shellfish" | "sesame" | "mustard";

type Terms = { words: string[]; phrases?: string[] };

const MEAT: Terms = {
  words: [
    "chicken", "mutton", "lamb", "goat", "beef", "pork", "bacon", "ham", "sausage", "salami", "pepperoni", "turkey", "duck",
    "keema", "kheema", "meat", "steak", "venison", "veal", "liver", "gosht", "boti", "nihari", "haleem", "meatball", "jerky", "prosciutto", "chorizo",
  ],
};
const FISH: Terms = {
  words: [
    "fish", "salmon", "tuna", "sardine", "mackerel", "rohu", "pomfret", "surmai", "hilsa", "ilish", "katla", "basa", "tilapia", "cod",
    "anchovy", "bangda", "seer", "trout", "haddock", "herring", "machli", "macchi", "meen",
  ],
};
const SHELLFISH: Terms = {
  words: ["prawn", "shrimp", "crab", "lobster", "squid", "octopus", "oyster", "mussel", "clam", "scallop", "crayfish", "jhinga", "calamari", "seafood"],
};
const EGG: Terms = { words: ["egg", "omelette", "omelet", "anda", "mayonnaise", "mayo", "meringue", "frittata"], phrases: ["egg bhurji"] };
const DAIRY: Terms = {
  words: [
    "milk", "curd", "dahi", "yogurt", "yoghurt", "paneer", "cheese", "ghee", "butter", "cream", "khoa", "khoya", "mawa", "lassi", "raita",
    "buttermilk", "chaas", "chhaas", "whey", "casein", "kheer", "payasam", "malai", "kulfi", "rabri", "rabdi", "shrikhand", "milkshake",
    "latte", "cappuccino", "chai", "custard", "mozzarella", "cheddar", "ricotta", "burfi", "barfi", "peda", "rasgulla", "rasmalai", "gulab", "kefir",
  ],
  phrases: ["ice cream"],
};
/** Phrases that look dairy but are not. */
const DAIRY_EXCEPTIONS = [
  "coconut milk", "almond milk", "soy milk", "soya milk", "oat milk", "rice milk", "cashew milk", "peanut butter", "almond butter",
  "nut butter", "cocoa butter", "apple butter", "butter bean", "butter beans", "coconut cream", "vegan cheese", "coconut yogurt", "coconut curd",
];
const PEANUT: Terms = { words: ["peanut", "groundnut", "moongphali", "mungfali", "chikki"] };
const TREE_NUTS: Terms = {
  words: ["almond", "badam", "cashew", "kaju", "walnut", "akhrot", "pistachio", "pista", "hazelnut", "pecan", "macadamia", "chilgoza", "praline", "marzipan", "nut", "nuts"],
  phrases: ["dry fruit", "dry fruits", "brazil nut", "pine nut"],
};
const NUT_EXCEPTIONS = ["coconut", "nutmeg", "butternut", "doughnut", "donut", "nutrela", "nutrition"];
const WHEAT: Terms = {
  words: [
    "wheat", "atta", "maida", "suji", "sooji", "rava", "semolina", "roti", "chapati", "chapatti", "chappatti", "phulka", "paratha", "parantha",
    "puri", "poori", "naan", "bread", "pasta", "noodle", "spaghetti", "macaroni", "couscous", "bulgur", "seitan", "dalia", "upma", "biscuit",
    "cracker", "barley", "rye", "kulcha", "bhatura", "samosa", "kachori", "pizza", "burger", "sandwich", "toast", "cake", "muffin", "bun", "pav",
    "vermicelli", "sevai", "seviyan", "khakhra", "thepla", "mathri", "cookie",
  ],
};
const SOY: Terms = { words: ["soy", "soya", "tofu", "edamame", "tempeh", "miso", "nutrela"], phrases: ["soy sauce", "soya chunks"] };
const SESAME: Terms = { words: ["sesame", "til", "tahini", "gingelly", "hummus"] };
const MUSTARD: Terms = { words: ["mustard", "sarson", "rai", "kasundi"] };
const PORK_ALCOHOL: Terms = { words: ["pork", "bacon", "ham", "lard", "gelatin", "gelatine", "wine", "beer", "rum", "vodka", "whisky", "whiskey", "alcohol", "pepperoni", "salami", "prosciutto", "chorizo"] };
const HONEY_GELATIN: Terms = { words: ["honey", "gelatin", "gelatine"] };
const GELATIN: Terms = { words: ["gelatin", "gelatine"] };
/** Jain diets also avoid root vegetables. */
const ROOTS: Terms = { words: ["onion", "garlic", "potato", "aloo", "carrot", "beetroot", "radish", "mooli", "ginger", "turnip", "yam", "sweet potato", "shakarkandi"] };
const ONION_GARLIC: Terms = { words: ["onion", "onions", "garlic", "pyaz", "pyaaz", "lahsun", "lehsun", "shallot", "leek", "chive", "chives"] };
const BEEF: Terms = { words: ["beef", "veal"] };
const PORK: Terms = { words: ["pork", "bacon", "ham", "lard", "pepperoni", "salami", "prosciutto", "chorizo", "sausage"] };

const ALLERGY_TERMS: Record<AllergyRule, Terms> = {
  dairy: DAIRY,
  eggs: EGG,
  peanuts: PEANUT,
  tree_nuts: TREE_NUTS,
  wheat: WHEAT,
  soy: SOY,
  fish: FISH,
  shellfish: SHELLFISH,
  sesame: SESAME,
  mustard: MUSTARD,
};

const ALLERGY_LABELS: Record<AllergyRule, string> = {
  dairy: "dairy",
  eggs: "egg",
  peanuts: "peanuts",
  tree_nuts: "tree nuts",
  wheat: "wheat or gluten",
  soy: "soy",
  fish: "fish",
  shellfish: "shellfish",
  sesame: "sesame",
  mustard: "mustard",
};

/**
 * Reads the diet choices FITX stores: onboarding v1 labels ("Vegetarian", "Halal"), and onboarding v2's
 * diet_type (vegetarian, non_vegetarian, both, vegan, eggetarian) plus food_rules (halal, jain,
 * no_onion_garlic, no_beef, no_pork, pescatarian, low_carb). low_carb is a preference, not a rule.
 */
export function dietRulesFrom(values: readonly unknown[]): DietRule[] {
  const rules = new Set<DietRule>();
  for (const value of values) {
    const text = String(value ?? "").toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "");
    if (!text) continue;
    if (/^(non_?veg|nonveg|non_vegetarian|both|flexible|omnivore|no_preference|none|any|low_carb)/.test(text)) continue;
    if (text === "no_onion_garlic") rules.add("no_onion_garlic");
    else if (text === "no_beef") rules.add("no_beef");
    else if (text === "no_pork") rules.add("no_pork");
    else if (text.includes("vegan")) rules.add("vegan");
    else if (text.includes("egg")) rules.add("eggetarian");
    else if (text.includes("vegetarian") || text === "veg") rules.add("vegetarian");
    else if (text.includes("pescatarian") || text.includes("pescetarian")) rules.add("pescatarian");
    else if (text.includes("halal")) rules.add("halal");
    else if (text.includes("jain")) rules.add("jain");
  }
  return [...rules];
}

/** Maps stored allergies ("Peanuts", "tree_nuts", "wheat_gluten", free-text "gluten") to rules; unknown free text is kept as words. */
export function allergyRulesFrom(values: readonly unknown[]): { rules: AllergyRule[]; other: string[] } {
  const rules = new Set<AllergyRule>();
  const other = new Set<string>();
  for (const value of values) {
    const text = String(value ?? "").toLowerCase().replace(/_/g, " ").trim();
    if (!text) continue;
    if (/dairy|milk|lactose|casein/.test(text)) rules.add("dairy");
    else if (/egg/.test(text)) rules.add("eggs");
    else if (/peanut|groundnut/.test(text)) rules.add("peanuts");
    else if (/tree ?nut|almond|cashew|walnut|pistachio|hazelnut/.test(text)) rules.add("tree_nuts");
    else if (/wheat|gluten|celiac|coeliac/.test(text)) rules.add("wheat");
    else if (/soy/.test(text)) rules.add("soy");
    else if (/shellfish|prawn|shrimp|crab|lobster/.test(text)) rules.add("shellfish");
    else if (/fish/.test(text)) rules.add("fish");
    else if (/sesame|\btil\b/.test(text)) rules.add("sesame");
    else if (/mustard/.test(text)) rules.add("mustard");
    else if (/^[a-z][a-z \-]{1,40}$/.test(text)) other.add(text);
  }
  return { rules: [...rules], other: [...other] };
}

/** Why a food breaks the member's diet or allergies, in plain words, or null when it is fine. */
export function foodConflict(foodText: string, diet: readonly DietRule[], allergies: { rules: readonly AllergyRule[]; other: readonly string[] }): string | null {
  const text = normalize(foodText);
  for (const rule of allergies.rules) {
    if (contains(text, ALLERGY_TERMS[rule], rule)) return `it contains ${ALLERGY_LABELS[rule]}, which is on your allergy list`;
  }
  for (const word of allergies.other) {
    const phrase = normalize(word).trim();
    if (phrase && contains(text, { words: [], phrases: [phrase] }, null)) return `it contains ${word}, which is on your allergy list`;
  }
  const meatOrFish = () => contains(text, MEAT, null) || contains(text, FISH, null) || contains(text, SHELLFISH, null);
  for (const rule of diet) {
    if (rule === "vegan" && (meatOrFish() || contains(text, EGG, null) || contains(text, DAIRY, "dairy") || contains(text, HONEY_GELATIN, null))) return "it is not vegan";
    if ((rule === "vegetarian" || rule === "jain") && (meatOrFish() || contains(text, EGG, null) || contains(text, GELATIN, null))) return "it is not vegetarian";
    if (rule === "jain" && contains(text, ROOTS, null)) return "Jain meals leave out onion, garlic and root vegetables";
    if (rule === "eggetarian" && (meatOrFish() || contains(text, GELATIN, null))) return "it has meat or fish";
    if (rule === "pescatarian" && contains(text, MEAT, null)) return "it has meat";
    if (rule === "halal" && contains(text, PORK_ALCOHOL, null)) return "it is not halal";
    if (rule === "no_onion_garlic" && contains(text, ONION_GARLIC, null)) return "you avoid onion and garlic";
    if (rule === "no_beef" && contains(text, BEEF, null)) return "you avoid beef";
    if (rule === "no_pork" && contains(text, PORK, null)) return "you avoid pork";
  }
  return null;
}

export function describeDiet(diet: readonly DietRule[]): string {
  if (!diet.length) return "no diet restrictions recorded";
  const words: Record<DietRule, string> = {
    vegetarian: "vegetarian (no meat, fish or eggs)",
    eggetarian: "vegetarian that eats eggs (no meat or fish)",
    vegan: "vegan (no animal products, including dairy, ghee, paneer, eggs and honey)",
    pescatarian: "pescatarian (fish but no meat)",
    halal: "halal (no pork or alcohol)",
    jain: "Jain (vegetarian without onion, garlic or root vegetables)",
    no_onion_garlic: "no onion or garlic",
    no_beef: "no beef",
    no_pork: "no pork",
  };
  return diet.map((rule) => words[rule]).join("; ");
}

export function describeAllergies(allergies: { rules: readonly AllergyRule[]; other: readonly string[] }): string {
  const list = [...allergies.rules.map((rule) => ALLERGY_LABELS[rule]), ...allergies.other];
  return list.length ? list.join(", ") : "none recorded";
}

function normalize(text: string) {
  return ` ${text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;
}

function contains(text: string, terms: Terms, rule: AllergyRule | "dairy" | null): boolean {
  let haystack = text;
  if (rule === "dairy") for (const phrase of DAIRY_EXCEPTIONS) haystack = haystack.replaceAll(` ${phrase} `, " ");
  if (rule === "tree_nuts") for (const word of NUT_EXCEPTIONS) haystack = haystack.replaceAll(` ${word} `, " ");
  for (const phrase of terms.phrases ?? []) if (haystack.includes(` ${phrase} `)) return true;
  if (terms.words.some((word) => word.includes(" ") && haystack.includes(` ${word} `))) return true;
  for (const token of haystack.trim().split(" ")) {
    const forms = [token, token.replace(/s$/, ""), token.replace(/es$/, ""), token.replace(/ies$/, "y")];
    if (terms.words.some((word) => forms.includes(word))) return true;
  }
  return false;
}
