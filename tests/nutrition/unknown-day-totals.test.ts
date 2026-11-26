// Review finding (fix round 3a, numbers): when every entry of a day lacks protein (or carbs, or fat), the day's
// overview showed 0 g with "120 g protein left" and 0 / 200 g bars, and History's table read 0, although the brief's
// rule is that unknown is never shown as 0 and meal-totals' unknownDayTotal (used by Progress) already calls such a
// total unknown. This is bug 4's own re-check: chai with blank macros on an otherwise empty day still read 90, 0, 0, 0
// with only a footnote. Such a total is "unknown" now, with no number, percent or "left"; a day where some entries
// have the value keeps the known sum and its note, and a real 0 g stays 0.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dayMacroText } from "@/components/nutrition/history-tiles";
import { mealTotals, unknownDayTotal } from "@/lib/domain/meal-totals";
import { knownMacro, MACRO_KEYS, sumKnown } from "@/lib/domain/nutrition";
import { noValueText, overviewView, type OverviewInput } from "@/lib/domain/nutrition-day";
import { buildHistory, lastDays } from "@/lib/domain/nutrition-history";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const chai = { calories: 90, protein: null, carbs: null, fat: null };
const TARGETS = { calories: 2000, protein: 120, carbs: 200, fat: 60 };
/** A ready day of these entries, against the targets above. */
const day = (rows: Parameters<typeof sumKnown>[0]): OverviewInput => ({
  state: "ready", totals: sumKnown(rows), target: TARGETS, targetSource: "Targets you set", hasOwnTargets: true, estimateCount: 0, water: { ml: 0, target: null },
});

test("a total no entry gives is unknown, a real 0 g is 0, and the rule is meal-totals' own", () => {
  const only = sumKnown([chai]);
  assert.equal(only.entries, 1);
  for (const key of MACRO_KEYS) assert.equal(knownMacro(only, key), null, key);
  const some = sumKnown([chai, { calories: 300, protein: 20, carbs: 0, fat: 5 }]);
  assert.deepEqual([knownMacro(some, "protein"), knownMacro(some, "carbs"), knownMacro(some, "fat")], [20, 0, 5], "a known sum, and a real 0 g");
  assert.equal(knownMacro(sumKnown([]), "protein"), 0, "nothing logged: a true 0");
  for (const rows of [[chai], [chai, chai], [chai, { calories: 300, protein: 20, carbs: 0, fat: 5 }], []]) {
    for (const key of MACRO_KEYS) assert.equal(knownMacro(sumKnown(rows), key) === null, unknownDayTotal(mealTotals(rows), key), `${rows.length} rows, ${key}`);
  }
});

test("the overview of a day whose only food has no protein, carbs or fat shows them unknown, with nothing left", () => {
  const view = overviewView(day([chai]));
  assert.deepEqual([view.protein.number, view.protein.grams, view.protein.unit, view.protein.percent], ["–", false, "/ 120 g protein", 0]);
  assert.deepEqual(view.protein.line, { kind: "note", text: "Unknown: the food logged has no protein value." }, "never \"120 g protein left\"");
  assert.equal(view.protein.label, "Protein unknown: the food logged has no protein value. Target 120 grams");
  assert.deepEqual(view.macros.map((macro) => [macro.name, macro.value, macro.goal, macro.progress]), [["Carbs", "unknown", " /\u00a0200\u00a0g", null], ["Fat", "unknown", " /\u00a060\u00a0g", null]]);
  assert.equal(view.fine, "1 without protein, 1 without carbs, 1 without fat", "the fine print still says which");
  assert.deepEqual([view.energy.number, view.energy.unit], ["90", "/ 2,000 kcal"], "calories are known");
  assert.equal(overviewView({ ...day([chai]), target: null }).macros[0].goal, "", "no \" g\" after unknown");
  assert.equal(overviewView(day([chai, chai])).protein.line?.kind === "note" && overviewView(day([chai, chai])).protein.line?.text, "Unknown: none of the foods logged has a protein value.");
  assert.equal(noValueText(2, "fat"), "none of the foods logged has a fat value");
});

test("a day where some foods give protein keeps the known sum and its note; a real 0 g is shown as 0", () => {
  const view = overviewView(day([chai, { calories: 300, protein: 20, carbs: 40, fat: 5 }]));
  assert.deepEqual([view.protein.number, view.protein.grams], ["20", true]);
  assert.deepEqual(view.protein.line, { kind: "amount", amount: "100", text: "g protein left", over: false });
  assert.deepEqual(view.macros.map((macro) => macro.value), ["40", "5"]);
  assert.equal(view.fine, "1 without protein, 1 without carbs, 1 without fat");
  const zero = overviewView(day([{ calories: 120, protein: 0, carbs: 30, fat: 0 }]));
  assert.deepEqual([zero.protein.number, zero.macros[1].value], ["0", "0"], "black coffee's 0 g is known");
});

test("History's table says unknown for such a day, never 0, and counts the entries left out", () => {
  const dates = lastDays(new Date(2026, 10, 22), 7);
  const history = buildHistory([
    { date: "2026-11-22", calories: 90, protein: null, carbs: null, fat: null, estimated: false },
    { date: "2026-11-21", calories: 300, protein: 20, carbs: 40, fat: null, estimated: false },
    { date: "2026-11-21", calories: 90, protein: null, carbs: 10, fat: null, estimated: false },
    { date: "2026-11-21", calories: 50, protein: null, carbs: 5, fat: 1, estimated: false },
  ], dates, null);
  const chaiDay = history.days.find((item) => item.date === "2026-11-22");
  const mixed = history.days.find((item) => item.date === "2026-11-21");
  assert.ok(chaiDay && mixed);
  assert.deepEqual(["protein", "carbs", "fat"].map((key) => dayMacroText(chaiDay, key as "protein")), ["unknown", "unknown", "unknown"]);
  assert.equal(dayMacroText(mixed, "protein"), "20 (2 entries without a value left out)");
  assert.equal(dayMacroText(mixed, "fat"), "1 (2 entries without a value left out)");
  assert.equal(dayMacroText(mixed, "carbs"), "55");
  assert.equal(dayMacroText({ entries: 2, unknown: { protein: 1, carbs: 0, fat: 0 }, protein: 7, carbs: 1, fat: 1 }, "protein"), "7 (1 entry without a value left out)");
  assert.equal(history.averages?.protein, 20, "the averages already left the unknown day out");
  const source = read("src/components/nutrition/NutritionHistory.tsx");
  assert.match(source, /<td>\{dayMacroText\(day, "protein"\)\}<\/td><td>\{dayMacroText\(day, "carbs"\)\}<\/td><td>\{dayMacroText\(day, "fat"\)\}<\/td>/);
});
