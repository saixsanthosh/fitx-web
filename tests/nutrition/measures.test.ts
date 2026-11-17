import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_HOUSEHOLD_ML, densityFromPortions, extraPortions, householdOptions, noVolumeReason, parseFoodQuery, resolvePortion, stepAmount, stepKindOf, volumeOptions,
  type FoodPortion,
} from "@/lib/domain/food-query";
import { cleanHousehold } from "@/lib/food/household-storage";

const dal: FoodPortion[] = [{ label: "1 cup", unit: "cup", grams: 240 }];
const ghee: FoodPortion[] = [{ label: "1 cup", unit: "cup", grams: 224 }, { label: "1 tablespoon", unit: "tbsp", grams: 14 }];

test("the amount steps by 10 for grams and ml and by half for pieces, never below the minimum", () => {
  assert.equal(stepAmount(100, 1, "mass"), 110);
  assert.equal(stepAmount(100, -1, "mass"), 90);
  assert.equal(stepAmount(5, -1, "mass"), 1);
  assert.equal(stepAmount(1, 1, "count"), 1.5);
  assert.equal(stepAmount(1, -1, "count"), 0.5);
  assert.equal(stepAmount(0.5, -1, "count"), 0.25, "the floor is a quarter");
  assert.equal(stepAmount(Number.NaN, 1, "count"), 0.5, "an empty box starts from one step");
  assert.equal(stepAmount(Number.NaN, 1, "mass"), 10);
  assert.equal(stepKindOf(null), "mass");
  assert.equal(stepKindOf("ml"), "mass");
  assert.equal(stepKindOf("serving"), "count");
  assert.equal(stepKindOf("katori"), "count");
});

test("millilitres and spoons are offered only when the food has a sourced volume measure", () => {
  assert.deepEqual(volumeOptions([{ label: "1 item", unit: "piece", grams: 38 }]), []);
  assert.match(noVolumeReason([{ label: "1 item", unit: "piece", grams: 38 }]) ?? "", /no volume measure/);
  assert.equal(noVolumeReason(dal), null);
  const options = volumeOptions(dal);
  assert.deepEqual(options.map((option) => option.unit), ["ml", "tsp", "tbsp"], "its own cup is not repeated");
  const ml = options.find((option) => option.unit === "ml");
  assert.ok(ml);
  assert.equal(Math.round(ml.grams * 236.5882365 * 100) / 100, 240, "1 US cup of dal weighs USDA's 240 g");
  assert.equal(ml.estimate, true);
  assert.deepEqual(ml.derivedFrom, { label: "1 cup", grams: 240 });
});

test("a typed amount in ml becomes grams through the food's own cup weight", () => {
  const portions = [...dal, ...volumeOptions(dal)];
  const result = resolvePortion(parseFoodQuery("200 ml dal"), portions);
  assert.equal(result.kind, "portion");
  if (result.kind === "portion") {
    assert.equal(result.estimate, true);
    assert.ok(Math.abs(result.grams - (200 * 240) / 236.5882365) < 0.5);
  }
  assert.equal(densityFromPortions([]), null);
});

test("katori and bowl are estimates built from the food's volume measure and the member's own size", () => {
  const defaults = householdOptions(dal, "Dal");
  assert.deepEqual(defaults.map((option) => option.unit), ["katori", "bowl"]);
  const katori = defaults[0];
  assert.equal(katori.vessel?.ml, DEFAULT_HOUSEHOLD_ML.katori);
  assert.equal(katori.vessel?.custom, false);
  assert.equal(katori.estimate, true);
  assert.equal(katori.grams, Math.round(((240 / 236.5882365) * 150) * 10) / 10);
  assert.match(katori.label, /^1 katori \(150 ml\)$/);
  const mine = householdOptions(dal, "Dal", { katori: 180 })[0];
  assert.equal(mine.vessel?.custom, true);
  assert.match(mine.label, /your size/);
  assert.ok(mine.grams > katori.grams);
  assert.equal(householdOptions(dal, "Dal", { katori: 5 })[0].vessel?.ml, DEFAULT_HOUSEHOLD_ML.katori, "an out-of-range size is ignored");
  assert.deepEqual(householdOptions([{ label: "1 item", unit: "piece", grams: 38 }], "Idli"), [], "no volume measure, no bowl");
});

test("a glass is offered only for drinks", () => {
  assert.ok(householdOptions([{ label: "1 cup", unit: "cup", grams: 249 }], "Milk, whole").some((option) => option.unit === "glass"));
  assert.ok(!householdOptions(dal, "Dal").some((option) => option.unit === "glass"));
});

test("typing katori selects the measure when the food has one and still asks when it has none", () => {
  const withMeasures = [...dal, ...extraPortions(dal, "Dal")];
  const result = resolvePortion(parseFoodQuery("2 katori dal"), withMeasures);
  assert.equal(result.kind, "portion");
  if (result.kind === "portion") assert.equal(result.count, 2);
  const none = resolvePortion(parseFoodQuery("2 katori idli"), [{ label: "1 item", unit: "piece", grams: 38 }, ...extraPortions([{ label: "1 item", unit: "piece", grams: 38 }], "Idli")]);
  assert.deepEqual(none.kind === "ask" ? none.reason : none.kind, "household-unit");
});

test("spoons for ghee come from its own spoon weight, not the cup", () => {
  const options = extraPortions(ghee, "Ghee");
  assert.ok(!options.some((option) => option.unit === "tbsp"), "its own tablespoon is not repeated");
  assert.ok(options.some((option) => option.unit === "tsp"));
});

test("saved household sizes keep only valid millilitres", () => {
  assert.deepEqual(cleanHousehold({ katori: 160, bowl: "300", glass: 5, extra: 1 }), { katori: 160, bowl: 300 });
  assert.deepEqual(cleanHousehold(null), {});
  assert.deepEqual(cleanHousehold({ katori: Number.NaN }), {});
});
