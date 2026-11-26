// Regression found by the re-check on the integrated build (fix round 3a, reg-nutrition-b-1): a food of the member's
// own saved with Serving left blank ("Digestive biscuits", 45 g) opens on its weight-only serving since the review
// round (N1), and that serving's label already holds its weight. So the Unit list read "1 serving (45 g) · 45 g", the
// logged row "1 × 1 serving (45 g) (45 g)", and above the tiles "Grams only: your food has no piece weight saved…" while
// the sheet counted the food by that serving. (A package whose label serving is only a weight read the same way.) A
// measure is now named once wherever its weight is shown beside it, and a counted food that has other measures says
// how it is logged instead of "Grams only".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { customRowToFood } from "@/lib/food/catalog-search";
import { customFoodResult, customFoodRowValues, type CustomFoodRow } from "@/lib/food/client-data";
import { describePortion, extraPortions, formatAmount, portionName, type FoodPortion } from "@/lib/domain/food-query";
import { openingPortion } from "@/lib/food/log-sheet";
import { countMode, noPieceReason, notByPieceReason } from "@/lib/food/pieces";
import type { FoodResult } from "@/lib/food/types";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

/** What the Unit list shows for a measure (PortionPicker and Edit entry). */
const unitText = (portion: FoodPortion) => `${portionName(portion)} · ${formatAmount(portion.grams)} g`;

/** The re-check's food: Serving (optional) left blank, so it is saved as its weight. */
const typed = customFoodRowValues({
  name: "Digestive biscuits", brand: "", servingLabel: "", servingGrams: 45, calories: 216, protein: 3.2, carbs: 29, fat: 9.5,
  barcode: "5000159484695", valueBasis: "user_entered", origin: "user",
}, true);
const biscuits = { id: "c-biscuits", ...typed, origin: "user", value_basis: "user_entered" } as CustomFoodRow;

test("a measure is named once when its weight is shown beside it", () => {
  const cases: Array<[FoodPortion, string]> = [
    [{ label: "1 serving (45 g)", unit: "serving", grams: 45 }, "1 serving"],
    [{ label: "1 serving (100g)", unit: "serving", grams: 100 }, "1 serving"],
    [{ label: "1 serving (2 biscuits, 14 g)", unit: "serving", grams: 14 }, "1 serving (2 biscuits)"],
    [{ label: "1 serving (6 biscuits (27 g))", unit: "serving", grams: 27 }, "1 serving (6 biscuits)"],
    [{ label: "1 serving (1 scoop (30 g))", unit: "serving", grams: 30 }, "1 serving (1 scoop)"],
    [{ label: "1 serving (1 bar 40 g)", unit: "serving", grams: 40 }, "1 serving (1 bar)"],
    [{ label: "1 pack (200 g)", unit: "piece", grams: 200 }, "1 pack"],
    [{ label: "1 item", unit: "piece", grams: 38 }, "1 item"],
    [{ label: "1 medium chappatti or roti (7\")", unit: "piece", grams: 40 }, "1 medium chappatti or roti (7\")"],
    [{ label: "1 cup (240 ml)", unit: "cup", grams: 245 }, "1 cup (240 ml)"],
  ];
  for (const [portion, name] of cases) assert.equal(portionName(portion), name, portion.label);
  assert.equal(portionName({ label: "1 serving (27 g)", grams: 30 }), "1 serving (27 g)", "a weight that isn't the measure's own stays");
  assert.equal(describePortion(3, { label: "1 item", unit: "piece", grams: 38 }, 114), "3 × 1 item (114 g)", "as before");
});

test("your own food with a blank serving reads its weight once, and the panel doesn't say \"Grams only\"", () => {
  for (const [where, food] of [["My foods, Recent, the Log it toast", customFoodResult(biscuits)], ["search, barcode", customRowToFood({ ...biscuits })]] as const) {
    const options: FoodPortion[] = [...food.portions, ...extraPortions(food.portions, food.name)];
    const index = openingPortion(food, options);
    assert.equal(index, 0, `${where}: it opens on its serving (review N1)`);
    const serving = options[index];
    assert.equal(unitText(serving), "1 serving · 45 g", `${where}: not "1 serving (45 g) · 45 g"`);
    assert.equal(describePortion(1, serving, 45), "1 × 1 serving (45 g)", `${where}: the logged row, not "1 × 1 serving (45 g) (45 g)"`);
    assert.equal(describePortion(2, serving, 90), "2 × 1 serving (90 g)");
    const mode = countMode(food, options);
    assert.equal(mode.kind, "no-pieces", where);
    assert.equal(mode.kind === "no-pieces" && mode.reason, notByPieceReason(food));
    assert.doesNotMatch(notByPieceReason(food), /Grams only/);
    assert.match(notByPieceReason(food), /^Logged by your serving or in grams: your food has no piece weight saved\. To count it by the piece, edit it/);
  }
});

test("a package's weight-only serving reads the same way, and a food with no measure is still grams only", () => {
  const packaged = { kind: "packaged", source: "Open Food Facts", name: "Marie biscuits", portions: [{ label: "1 serving (30 g)", unit: "serving", grams: 30, estimate: false }] } as Pick<FoodResult, "kind" | "source" | "name" | "portions">;
  assert.equal(unitText(packaged.portions[0]), "1 serving · 30 g");
  assert.equal(describePortion(1, packaged.portions[0], 30), "1 × 1 serving (30 g)");
  assert.equal(countMode(packaged, packaged.portions).kind, "no-pieces");
  assert.match(notByPieceReason(packaged), /^Logged by the label's measures or in grams: the package label gives no weight per piece\.$/);
  const banana = { name: "Bananas, ripe and slightly ripe, raw", source: "USDA FoodData Central" };
  assert.deepEqual(countMode(banana, []), { kind: "grams-only", reason: noPieceReason(banana) }, "no measure at all: grams only, as before");
  assert.match(noPieceReason(banana), /^Grams only/);
});

test("the Unit lists and the result card name each measure once, and the panel shows the line for both kinds", () => {
  const picker = read("src/components/nutrition/PortionPicker.tsx");
  assert.match(picker, /\{portionName\(portion\)\} · \{formatAmount\(portion\.grams\)\} g<\/option>/);
  assert.match(picker, /\(counting\.kind === "grams-only" \|\| counting\.kind === "no-pieces"\) && <p className=\{styles\.gramsOnly\}>\{counting\.reason\}<\/p>/);
  assert.match(read("src/components/nutrition/EntryEditor.tsx"), /<option value="portion">\{portionName\(portion\)\} · \{formatAmount\(portion\.grams\)\} g<\/option>/);
  assert.match(read("src/components/nutrition/FoodResultCard.tsx"), /\{portionName\(piece\)\} · \{formatAmount\(piece\.grams\)\} g/);
});
