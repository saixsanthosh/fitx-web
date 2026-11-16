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
  ai_suggested: { label: "AI suggestion", detail: "Added from an AI coach suggestion; the values come from FITX's food data, not from the AI.", estimate: true },
  estimated: { label: "Estimate", detail: "An estimate.", estimate: true },
};

export const PORTION_ESTIMATE: BasisInfo = {
  label: "Portion estimate",
  detail: "The grams come from an average weight for this piece or cup, so a real portion can differ. Weigh it for an exact log.",
  estimate: true,
};

export function basisInfo(basis: string | null | undefined): BasisInfo {
  return VALUE_BASIS[(basis ?? "") as ValueBasis] ?? VALUE_BASIS.estimated;
}

/** The value basis FDC data types map to. */
export function basisForDataType(dataType: string | null | undefined): ValueBasis {
  if (dataType === "Foundation") return "lab_analysed";
  if (dataType === "SR Legacy") return "compiled";
  if (dataType === "Survey (FNDDS)") return "recipe_calculated";
  if (dataType === "Branded") return "label";
  return "estimated";
}

export const DIET_LABEL: Record<DietType, string> = {
  vegan: "Vegan",
  veg: "Vegetarian",
  egg: "Contains egg",
  non_veg: "Non-veg",
};

/** Source credits for the Sources page and image captions. */
export const OPEN_FOOD_FACTS_IMAGE_CREDIT = "Photo: Open Food Facts contributors, CC BY-SA";
