// Bug 9 (nutrition-3): while the day loaded, the summary said "0 kcal eaten", "Set a target to see what's left.", "No
// protein target yet." and "Set a water goal" (also in the page as first sent), and Previous day showed the new date
// over the old day's figures. The page now knows which day its figures belong to and shows a loading (or failed)
// state until the day asked for is in: no figures, no "no target", and water can't be added before the total is known.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dayLoadState, dayStatusText, mealsStatusText, overviewView } from "@/lib/domain/nutrition-day";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("a day is ready only once its own figures are in", () => {
  assert.equal(dayLoadState(null, null, "2026-11-25"), "loading", "the first load, and the page as first sent");
  assert.equal(dayLoadState("2026-11-25", null, "2026-11-25"), "ready");
  assert.equal(dayLoadState("2026-11-25", null, "2026-11-24"), "loading", "Previous day: Wednesday's figures never show under Tuesday's date");
  assert.equal(dayLoadState(null, "2026-11-25", "2026-11-25"), "failed");
  assert.equal(dayLoadState("2026-11-25", "2026-11-25", "2026-11-25"), "ready", "a failed reload after a save keeps the day's figures, with the page's error");
  assert.equal(dayStatusText("loading"), "Loading this day…");
  assert.equal(dayStatusText("failed"), "This day couldn't be loaded.");
  assert.equal(mealsStatusText("loading"), "Loading meals…");
  assert.match(mealsStatusText("failed"), /couldn't be loaded/);
});

/** Every string in the overview's view: what it shows and says. */
function texts(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(texts);
  if (value && typeof value === "object") return Object.values(value).flatMap(texts);
  return [];
}

const DAY = { totals: { calories: 1990, protein: 60, carbs: 200, fat: 70, unknown: { protein: 0, carbs: 0, fat: 1 }, entries: 6 }, target: { calories: 1800, protein: 90, carbs: 220, fat: null }, targetSource: "Targets you set", hasOwnTargets: true, estimateCount: 2, water: { ml: 800, target: 2000 } };

test("until the day is in, the overview shows no number, no missing target and nothing that acts", () => {
  for (const state of ["loading", "failed"] as const) {
    const view = overviewView({ ...DAY, state });
    for (const text of texts(view)) {
      assert.doesNotMatch(text, /\d/, `${state}: no figure, the day's or another day's ("${text}")`);
      for (const claim of ["Set a target", "No protein target yet", "kcal eaten", "Set a water goal", "Edit targets", "Your targets"]) assert.ok(!text.includes(claim), `${state}: nothing like "${claim}"`);
    }
    assert.equal(view.status, dayStatusText(state));
    assert.equal(view.busy, state === "loading");
    assert.deepEqual(view.targets, { label: "Targets", acts: false });
    assert.deepEqual([view.water.acts, view.water.goalLink, view.water.percent, view.energy.percent, view.protein.percent], [false, false, null, 0, 0]);
    assert.deepEqual(view.energy.line, { kind: "note", text: dayStatusText(state) });
    assert.equal(view.fine, null);
  }
});

test("once the day is in, the overview says what it said before", () => {
  const view = overviewView({ ...DAY, state: "ready" });
  assert.deepEqual([view.status, view.busy, view.source], [null, false, "Targets you set"]);
  assert.deepEqual(view.targets, { label: "Your targets", acts: true });
  assert.deepEqual([view.energy.number, view.energy.unit, view.energy.over], ["1,990", "/ 1,800 kcal", true]);
  assert.equal(view.energy.label, "1990 calories logged of 1800 calorie target, 190 over");
  assert.deepEqual(view.energy.line, { kind: "amount", amount: "190", text: "kcal over your target", over: true });
  assert.deepEqual([view.protein.number, view.protein.unit], ["60", "/ 90 g protein"]);
  assert.deepEqual(view.protein.line, { kind: "amount", amount: "30", text: "g protein left", over: false });
  assert.deepEqual(view.macros.map((macro) => [macro.name, macro.value, macro.goal, macro.progress?.percent ?? null]), [["Carbs", "200", " / 220 g", 91], ["Fat", "70", " g", null]]);
  assert.equal(view.fine, "Includes 2 estimates. 1 without fat");
  assert.deepEqual(view.water, { amount: "0.8 L", target: " / 2.0 L", percent: 40, goalLink: false, acts: true });
  const bare = overviewView({ ...DAY, state: "ready", target: null, hasOwnTargets: false, estimateCount: 0, totals: { ...DAY.totals, unknown: { protein: 0, carbs: 0, fat: 0 } }, water: { ml: 0, target: null } });
  assert.deepEqual([bare.targets.label, bare.source, bare.energy.unit, bare.protein.unit, bare.fine], ["Edit targets", null, "kcal eaten", "protein", null]);
  assert.deepEqual(bare.energy.line, { kind: "note", text: "Set a target to see what's left." });
  assert.deepEqual(bare.protein.line, { kind: "note", text: "No protein target yet." });
  assert.deepEqual([bare.water.goalLink, bare.water.percent], [true, null]);
});

test("the overview is one structure, so the Targets and water buttons keep the focus when the day comes in", () => {
  const overview = read("src/components/nutrition/DayOverview.tsx");
  assert.doesNotMatch(overview, /LoadedOverview|if \(state !== "ready"\)/, "no separate tree for a day that is not in yet (review N5)");
  assert.equal((overview.match(/className=\{styles\.targets\}/g) ?? []).length, 1, "one Targets button");
  assert.equal((overview.match(/\+\{ml\} ml<\/button>/g) ?? []).length, 1, "one pair of water buttons");
  assert.match(overview, /aria-disabled=\{view\.targets\.acts \? undefined : true\} onClick=\{view\.targets\.acts \? onTargets : undefined\}/);
  assert.match(overview, /onClick=\{\(\) => \{ if \(view\.water\.acts && !water\.busy\) water\.onAdd\(ml\); \}\}/);
  assert.match(overview, /aria-busy=\{view\.busy \|\| undefined\}/);
  assert.match(overview, /<p role=\{view\.status \? "status" : undefined\} className=\{styles\.noTarget\}>/);
});

test("the page shows this day's entries only, loads in one round trip and signs photos after", () => {
  const page = read("src/app/(dashboard)/nutrition/page.tsx");
  assert.match(page, /const dayState = dayLoadState\(shownKey, failedKey, dateKey\);/);
  assert.match(page, /<DayOverview [^\n]*state=\{dayState\}/);
  assert.match(page, /<MealLog entries=\{dayEntries\}[^\n]*state=\{dayState\}/);
  const load = page.slice(page.indexOf("const load = useCallback("), page.indexOf("const refreshRecent"));
  assert.match(load, /await Promise\.all\(\[\s*detectCapabilities\(supabase\),/, "the capabilities are read with the day, not before it");
  assert.ok(load.indexOf("setShownKey(dateKey)") > load.indexOf("setEntries("), "the day counts as shown once its entries are set");
  assert.match(load, /if \(!current\(\)\) return;/, "a load replaced by a newer one sets nothing");
  assert.ok(load.indexOf("signedPhotoUrls") > load.indexOf("setLoading(false)"), "photo links don't hold the day up");
  assert.match(page, /if \(loggingWater\.current \|\| dayState !== "ready"\) return;/);
});
