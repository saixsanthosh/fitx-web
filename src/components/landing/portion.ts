/** A food that can be logged in pieces, with its per-100 g values from a named source. */
export type PieceFood = {
  name: string;
  pieceLabel: string;
  pieceGrams: number;
  per100g: { kcal: number; protein: number; carbs: number; fat: number };
  source: string;
};

type StapleFood = {
  id: string;
  name: string;
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  portions?: { label?: string; unit?: string; grams?: number | null; countDefault?: boolean }[];
};

const known = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;

/**
 * The landing page's portion example from the built-in food list: a food with a piece weight and every macro
 * known. Returns null rather than guessing when anything is missing.
 */
export function pieceFoodFrom(foods: readonly StapleFood[], id: string, { pieceLabel, source }: { pieceLabel: string; source: string }): PieceFood | null {
  const food = foods.find((item) => item.id === id);
  if (!food) return null;
  const piece = food.portions?.find((portion) => portion.unit === "piece" && known(portion.grams) && portion.grams > 0);
  if (!piece || !known(food.calories) || !known(food.protein) || !known(food.carbs) || !known(food.fat)) return null;
  return { name: food.name, pieceLabel, pieceGrams: piece.grams as number, per100g: { kcal: food.calories, protein: food.protein, carbs: food.carbs, fat: food.fat }, source };
}

const oneDecimal = (n: number) => Math.round(n * 10) / 10;

/** Totals for a number of pieces: grams and kcal whole, macros to one decimal. */
export function portionNutrition(food: PieceFood, pieces: number) {
  const grams = food.pieceGrams * Math.max(0, pieces);
  const factor = grams / 100;
  return {
    grams: Math.round(grams),
    kcal: Math.round(food.per100g.kcal * factor),
    protein: oneDecimal(food.per100g.protein * factor),
    carbs: oneDecimal(food.per100g.carbs * factor),
    fat: oneDecimal(food.per100g.fat * factor),
  };
}
