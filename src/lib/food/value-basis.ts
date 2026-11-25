/** Badges for how a food's values were obtained, so estimates are never mistaken for measurements. */
import type { DietType, ValueBasis } from "@/lib/food/types";

export interface BasisInfo {
  /** Short badge text. */
  label: string;
  /** One sentence the app can show when someone asks what the badge means. */
  detail: string;
  /** true when the values are an estimate for the food in front of the user. */
  estimate: boolean;
}

export const VALUE_BASIS: Record<ValueBasis, BasisInfo> = {
  lab_analysed: { label: "USDA lab analysis", detail: "Measured in a laboratory for USDA FoodData Central (Foundation Foods).", estimate: false },
  compiled: { label: "USDA reference values", detail: "USDA FoodData Central reference values (SR Legacy), compiled from analyses and calculations.", estimate: false },
  recipe_calculated: { label: "Typical recipe", detail: "Calculated by USDA (FNDDS) from a typical recipe, so a dish made differently will differ.", estimate: true },
  label: { label: "Package label", detail: "Copied from the product's nutrition label. Open Food Facts labels are entered by its community, not checked by FITX.", estimate: false },
  user_entered: { label: "Your entry", detail: "Values you entered yourself.", estimate: false },
  ai_suggested: { label: "AI suggestion", detail: "Added from an AI coach suggestion, with values from FITX's food data when FITX found a match, otherwise the coach's own estimate (marked “AI estimate”).", estimate: true },
  estimated: { label: "Estimate", detail: "An estimate: the values were worked out, not measured, so the real food can differ.", estimate: true },
};

/** The source FITX's own recipe estimates carry (catalog-search's RECIPE_SOURCE). */
export const FITX_RECIPE_SOURCE = "FITX recipe estimate";

/** FITX's own recipe estimates (curd rice, khichdi, dal tadka…): their value basis is "estimated", their badge names them. */
export const RECIPE_ESTIMATE: BasisInfo = {
  label: "FITX recipe estimate",
  detail: "Worked out by FITX from USDA values for the dish's ingredients, in the amounts listed with it, so a dish made another way will differ.",
  estimate: true,
};

export const PORTION_ESTIMATE: BasisInfo = {
  label: "Portion estimate",
  detail: "The grams come from an average weight for this piece or cup, so a real portion can differ. Weigh it for an exact log.",
  estimate: true,
};

export function basisInfo(basis: string | null | undefined): BasisInfo {
  return VALUE_BASIS[(basis ?? "") as ValueBasis] ?? VALUE_BASIS.estimated;
}

/**
 * What a value badge says and explains. A FITX recipe estimate (by its source) names itself; any other estimate adds
 * " · estimate" to its label, unless the label already says so ("Estimate" is never "Estimate · estimate").
 */
export function basisBadge(basis: string | null | undefined, source?: string | null, label?: string): { text: string; detail: string; estimate: boolean } {
  const info = source === FITX_RECIPE_SOURCE ? RECIPE_ESTIMATE : basisInfo(basis);
  const name = label ?? info.label;
  return { text: info.estimate && !/\bestimate\b/i.test(name) ? `${name} · estimate` : name, detail: info.detail, estimate: info.estimate };
}

/** The value basis FDC data types map to. */
export function basisForDataType(dataType: string | null | undefined): ValueBasis {
  if (dataType === "Foundation") return "lab_analysed";
  if (dataType === "SR Legacy") return "compiled";
  if (dataType === "Survey (FNDDS)") return "recipe_calculated";
  if (dataType === "Branded") return "label";
  return "estimated";
}

/**
 * A saved food's value basis. A food the AI coach saved without one (the column default, "user_entered") counts
 * as an AI suggestion: the coach's foods are never the user's own entry.
 */
export function customValueBasis(origin: string | null | undefined, valueBasis: string | null | undefined): ValueBasis {
  const basis = valueBasis && Object.hasOwn(VALUE_BASIS, valueBasis) ? (valueBasis as ValueBasis) : "user_entered";
  return origin === "ai_coach" && basis === "user_entered" ? "ai_suggested" : basis;
}

export const DIET_LABEL: Record<DietType, string> = {
  vegan: "Vegan",
  veg: "Vegetarian",
  egg: "Contains egg",
  non_veg: "Non-veg",
};

/** Source credits for the Sources page and image captions. */
export const OPEN_FOOD_FACTS_IMAGE_CREDIT = "Photo: Open Food Facts contributors, CC BY-SA";
