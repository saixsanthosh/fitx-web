// Release 3 re-check, round 3d (nutrition-a, reg-3d-nutrition-a-unknown-macro-overflow): since 2260a38 a day whose foods
// give no carbs (or fat) reads "unknown / 202 g" in the overview's Carbs and fat row. On phones that value didn't fit
// beside its name, and held on one line (white-space: nowrap) it ran out of its half of the row: at 375 px it touched
// the Fat label ("202 g●Fat"), at 320 px it was drawn over it, and the Fat value ran past the card's edge and was
// clipped. Now a value that doesn't fit beside its name goes onto its own line under it, inside its half, and if even
// that line is too narrow it breaks before "/", nowhere else. A row that fits is drawn as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sumKnown } from "@/lib/domain/nutrition";
import { macroGoalText, overviewView, type OverviewInput, type OverviewView } from "@/lib/domain/nutrition-day";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const uncomment = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "");
const css = uncomment(read("src/components/nutrition/DayOverview.module.css"));
/** The declarations of one top-level rule of DayOverview.module.css, as written. */
function rule(selector: string, source = css): string {
  const found = source.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`));
  assert.ok(found, `${selector} has a rule`);
  return found[1];
}

// What the round 3d re-check measured on the hunt copy, light and dark alike, in CSS px
// (recheck-3/r2-nutrition-a/q3-macro-overlap.out.json and q4-card-shots.out.json).
const HALF = { 320: 117, 375: 145, 390: 152 } as const; // each <li> of the "Carbs and fat" list
const NAME = { carbs: 47, fat: 30 } as const; // "● Carbs", "● Fat"
const VALUE = { carbs: 111, fat: 103 } as const; // "unknown / 202 g", "unknown / 57 g"
const DIGIT = VALUE.carbs - VALUE.fat; // "202" against "57": one tabular digit
const NAME_GAP = 8; // .macroTop's .5rem between the name and the value
const COLUMN_GAP = 20; // .macros' 1.25rem between the halves
/** A half's width on a phone (to 400 px): the page's 16 px gutters, the card's 1 px border and 16 px padding, the gap. */
const half = (viewport: number) => (viewport - 2 * 16 - 2 * 1 - 2 * 16 - COLUMN_GAP) / 2;
const PHONES = [320, 360, 375, 390] as const;
const KEYS = ["carbs", "fat"] as const;

test("held on one line, the unknown value ran out of its half on phones, into the Fat column at 375 and 320 px", () => {
  for (const width of [320, 375, 390] as const) assert.ok(Math.abs(half(width) - HALF[width]) <= 0.5, `${width} px: ${half(width)} against the measured ${HALF[width]}`);
  assert.equal(DIGIT, 8);
  const carbs = NAME.carbs + NAME_GAP + VALUE.carbs;
  assert.equal(carbs, 166);
  for (const width of PHONES) assert.ok(carbs > half(width), `${width} px: ${carbs} px of name and value in a ${half(width)} px half`);
  // Past its half and the gap is the Fat column: by 1.5 px at 375 (measured: 199 against 198) and 29 px at 320 (199 against 170).
  assert.equal(carbs - (half(375) + COLUMN_GAP), 1.5);
  assert.equal(carbs - (half(320) + COLUMN_GAP), 29);
  // The Fat value at 320 px ran 24 px past its half: past the card's 16 px padding and 1 px border (measured: 312 against 304).
  assert.equal(NAME.fat + NAME_GAP + VALUE.fat - half(320), 24);
  // The markup is as it was: the name and the value side by side in .macroTop, the figure in <strong>, then its target.
  assert.match(read("src/components/nutrition/DayOverview.tsx"), /<div className=\{styles\.macroTop\}>\s*<span className=\{styles\.macroName\}><i aria-hidden="true"\/>\{macro\.name\}<\/span>\s*<span className=\{styles\.macroValue\}><strong>\{macro\.value\}<\/strong>\{macro\.goal\}<\/span>\s*<\/div>/);
});

test("a value that doesn't fit beside its name goes under it, and then fits its half at 320, 360, 375 and 390 px", () => {
  const top = rule(".macroTop");
  assert.match(top, /display: flex;/);
  assert.match(top, /flex-wrap: wrap;/, "the value may take its own line");
  assert.match(top, /justify-content: space-between;/, "while it fits beside its name it stays at the right, as before");
  assert.match(top, /gap: \.1rem \.5rem;/, "the same .5rem beside the name");
  const value = rule(".macroValue");
  assert.doesNotMatch(value, /white-space/, "no nowrap: a value too wide for its own line may break");
  assert.match(value, /overflow-wrap: anywhere;/, "the last resort for one word wider than its half");
  for (const width of PHONES) {
    for (const key of KEYS) {
      const oneLine = NAME[key] + NAME_GAP + VALUE[key];
      // flex-wrap moves the value only when name and value don't fit side by side.
      const widest = oneLine <= half(width) ? oneLine : Math.max(NAME[key], VALUE[key]);
      assert.ok(widest <= half(width), `${width} px, ${key}: ${widest} px in a ${half(width)} px half`);
    }
  }
  // At 320 and 360 px both values go under their names; at 375 and 390 px Fat still fits on one line beside a wrapped
  // Carbs, so the halves differ in height and the bars stay level because each half's rows sit at its bottom.
  for (const width of [320, 360]) for (const key of KEYS) assert.ok(NAME[key] + NAME_GAP + VALUE[key] > half(width), `${width} px, ${key}`);
  for (const width of [375, 390]) assert.ok(NAME.fat + NAME_GAP + VALUE.fat <= half(width), `${width} px, fat`);
  const item = rule(".macro");
  assert.match(item, /display: grid;/);
  assert.match(item, /align-content: end;/);
  assert.match(rule(".macros"), /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/, "two equal halves, as before");
});

test("a value too wide even for its own line breaks before \"/\" only, never inside \"/ 1200 g\"", () => {
  // Carbs targets go up to 1,200 g (the save's own limit and the table's check), one digit more than 202.
  assert.match(read("src/lib/food/client-data.ts"), /targets\.carbs > 1200/);
  assert.match(read("supabase/migrations/20261118140001_fitx_nutrition_user_data.sql"), /carbs_g integer not null check \(carbs_g between 0 and 1200\)/);
  const longest = VALUE.carbs + DIGIT;
  assert.ok(longest > half(320), `"unknown / 1200 g" (${longest} px) is wider than a 320 px half (${half(320)} px) on one line`);
  const goal = macroGoalText(1200, false);
  assert.equal(goal, " /\u00a01200\u00a0g");
  assert.deepEqual(`unknown${goal}`.split(" "), ["unknown", "/\u00a01200\u00a0g"], "one ordinary space, the only place a line may break");
  // Each piece is narrower than the 111 px "unknown / 202 g", which fits a 320 px half whole: "unknown" is that value
  // less " / 202 g", and "/ 1200 g" is " / 202 g" and one digit, narrower than the seven letters of "unknown".
  assert.ok(VALUE.carbs <= half(320));
});

/** Each small macro as the member reads it: name, value, then what follows it. */
const shown = (view: OverviewView) => view.macros.map((macro) => `${macro.name} ${macro.value}${macro.goal}`);
const TARGETS = { calories: 2000, protein: 120, carbs: 202, fat: 57 };
const day = (rows: Parameters<typeof sumKnown>[0], target: OverviewInput["target"] = TARGETS): OverviewInput => ({
  state: "ready", totals: sumKnown(rows), target, targetSource: "Targets you set", hasOwnTargets: true, estimateCount: 0, water: { ml: 0, target: null },
});
const chai = { calories: 90, protein: null, carbs: null, fat: null };
const dal = { calories: 600, protein: 30, carbs: 150, fat: 20 };

test("a figure and its target or unit never split, and the words are the same as before", () => {
  assert.equal(macroGoalText(202, false), " /\u00a0202\u00a0g");
  assert.equal(macroGoalText(202, true), " /\u00a0202\u00a0g");
  assert.equal(macroGoalText(null, true), "\u00a0g", "\"70 g\" stays together");
  assert.equal(macroGoalText(null, false), "", "nothing after \"unknown\"");
  const noTargets = { ...TARGETS, carbs: null, fat: null };
  const cases: Array<[OverviewView, string[]]> = [
    [overviewView(day([chai])), ["Carbs unknown / 202 g", "Fat unknown / 57 g"]],
    [overviewView(day([dal])), ["Carbs 150 / 202 g", "Fat 20 / 57 g"]],
    [overviewView(day([chai, dal])), ["Carbs 150 / 202 g", "Fat 20 / 57 g"]],
    [overviewView(day([chai], noTargets)), ["Carbs unknown", "Fat unknown"]],
    [overviewView(day([dal], noTargets)), ["Carbs 150 g", "Fat 20 g"]],
    [overviewView({ ...day([dal]), state: "loading" }), ["Carbs –", "Fat –"]],
  ];
  for (const [view, words] of cases) {
    // A no-break space reads and looks like a space (the same width in Inter), so members see what they saw before.
    assert.deepEqual(shown(view).map((text) => text.replace(/\u00a0/g, " ")), words);
    for (const [index, macro] of view.macros.entries()) {
      const pieces = `${macro.value}${macro.goal}`.split(" ");
      assert.ok(pieces.length <= 2 && (pieces.length === 1 || pieces[1].startsWith("/")), `${words[index]}: it may break before "/" only`);
    }
  }
});

test("the other places that now say unknown for a macro wrap as text, so none holds it on one line beside a neighbour", () => {
  const ui = uncomment(read("src/components/nutrition/FoodUi.module.css"));
  // Meal rows: "P unknown · C unknown · F unknown" (MealLog's EntryRow); Log food's results: the same line (FoodResultCard).
  assert.match(read("src/components/nutrition/MealLog.tsx"), /<p className=\{styles\.rowMacros\}>\{macro\("P", "protein"\)\} · \{macro\("C", "carbs"\)\} · \{macro\("F", "fat"\)\}<\/p>/);
  for (const selector of [".rowMacros", ".foodMacros"]) assert.doesNotMatch(rule(selector, ui), /white-space|overflow: hidden/, selector);
  // The summary's protein: "–" in the ring and the reason in a paragraph under it.
  assert.doesNotMatch(rule(".noTarget"), /white-space/);
  assert.match(read("src/components/nutrition/DayOverview.tsx"), /\{view\.protein\.line && line\(view\.protein\.line, false\)\}/);
});
