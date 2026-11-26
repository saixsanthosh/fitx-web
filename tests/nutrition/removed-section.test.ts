// Bug 15, re-check on the integrated build (fix round 3a): removing the only food of a meal of the member's own
// ("Pre-workout", logged on an earlier visit) lost the focus to the page. The section list is worked out from the last
// 30 days' meals, so once Recent was read again without the removed food the section went, its Undo was drawn again
// above the meals (a new element, out of view) and the focus fell to the page body; the next Tab went to "Open AI
// Coach". The same happened whenever the removal changed which day last used a section, because the list is in that
// order and a section moved in the page takes the focus out with it. Now a removed food's meal stays listed while its
// Undo stands, and the sections keep the order this visit first listed them in. Also: the same food removed from two
// meals gave two Undo buttons with one name; each names its meal now.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { keepSectionOrder, mealSections, sameSectionOrder } from "@/lib/domain/meal-time";
import { undoLabel } from "@/lib/food/meal-undo";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const STANDARD = ["Breakfast", "Lunch", "Dinner", "Snack"];

/** The page's rule: the meals of Recent, of the day and of the removed foods, in the order already listed. */
function listed(shown: readonly string[], recent: readonly string[], day: readonly string[], removed: readonly string[], added: readonly string[] = []) {
  return keepSectionOrder(shown, mealSections([...recent, ...day, ...removed], added));
}

test("a section keeps its place when the day reloads, and new ones follow", () => {
  assert.deepEqual(keepSectionOrder([], [...STANDARD, "Pre-workout"]), [...STANDARD, "Pre-workout"], "the first list is the list");
  assert.deepEqual(keepSectionOrder([...STANDARD, "Pre-workout", "Evening tea"], [...STANDARD, "Evening tea", "Pre-workout"]), [...STANDARD, "Pre-workout", "Evening tea"], "never moved");
  assert.deepEqual(keepSectionOrder([...STANDARD, "Pre-workout"], [...STANDARD, "Evening tea", "Pre-workout"]), [...STANDARD, "Pre-workout", "Evening tea"], "a new one comes last");
  assert.deepEqual(keepSectionOrder([...STANDARD, "Pre-workout"], STANDARD), STANDARD, "one no longer used goes");
  assert.deepEqual(keepSectionOrder([...STANDARD, "Pre-workout"], [...STANDARD, "pre-workout"]), [...STANDARD, "Pre-workout"], "the same name in other letters is the same section, spelled as shown");
  assert.equal(sameSectionOrder([...STANDARD], [...STANDARD]), true);
  assert.equal(sameSectionOrder([...STANDARD, "A", "B"], [...STANDARD, "B", "A"]), false);
  assert.equal(sameSectionOrder(STANDARD, [...STANDARD, "A"]), false);
});

test("removing the only food of a meal of your own keeps that meal, in its place, while its Undo stands", () => {
  // The re-check's day: Idli at Breakfast, Ghee the only food in "Pre-workout" (from an earlier visit), and a member's
  // "Evening tea" used yesterday, so Pre-workout is listed first because it was used last.
  const before = listed([], ["Pre-workout", "Breakfast", "Evening tea"], ["Breakfast", "Pre-workout"], []);
  assert.deepEqual(before, [...STANDARD, "Pre-workout", "Evening tea"]);
  // Ghee removed: the day reloads without it while Recent still has it, then Recent is read again without it.
  const reloaded = listed(before, ["Pre-workout", "Breakfast", "Evening tea"], ["Breakfast"], ["Pre-workout"]);
  assert.deepEqual(reloaded, before, "the day without Ghee: Pre-workout holds its Undo");
  const refreshed = listed(reloaded, ["Breakfast", "Evening tea"], ["Breakfast"], ["Pre-workout"]);
  assert.deepEqual(refreshed, before, "Recent without Ghee: Pre-workout neither goes nor moves below Evening tea");
  assert.deepEqual(mealSections(["Breakfast", "Evening tea", "Breakfast"]), [...STANDARD, "Evening tea"], "(the old rule: the section went with its Undo)");
  // Undo: Ghee is in the day again before Recent has it.
  const restored = listed(refreshed, ["Breakfast", "Evening tea"], ["Breakfast", "Pre-workout"], []);
  assert.deepEqual(restored, before, "putting it back moves nothing either");
  // Another day: the Undo is gone, and so is a section nothing uses any more.
  assert.deepEqual(listed(before, ["Breakfast", "Evening tea"], [], []), [...STANDARD, "Evening tea"]);
});

test("the same food removed from two meals has two Undo buttons a screen reader can tell apart", () => {
  assert.equal(undoLabel({ name: "Ghee, clarified butter", meal: "Breakfast" }), "Undo removing Ghee, clarified butter from Breakfast");
  assert.notEqual(undoLabel({ name: "Ghee, clarified butter", meal: "Breakfast" }), undoLabel({ name: "Ghee, clarified butter", meal: "Pre-workout" }));
});

test("the page lists removed foods' meals in a kept order, and the meal log draws each Undo in its own meal", () => {
  const page = read("src/app/(dashboard)/nutrition/page.tsx");
  assert.match(page, /mealSections\(\[\.\.\.recentMeals, \.\.\.entries, \.\.\.removedToday\]\.map\(\(entry\) => entry\.meal\), addedSections\)/);
  assert.match(page, /const sections = useMemo\(\(\) => keepSectionOrder\(sectionOrder, listedSections\), \[sectionOrder, listedSections\]\);/);
  assert.match(page, /if \(!sameSectionOrder\(sectionOrder, sections\)\) setSectionOrder\(sections\);/, "stored only when it changed, so it settles");
  assert.match(page, /removed=\{removedToday\}/);
  const log = read("src/components/nutrition/MealLog.tsx");
  assert.match(log, /const listed = mealSections\(sections, removedFoods\.map\(\(item\) => item\.meal\)\);/);
  assert.match(log, /\{listed\.map\(\(slot\) => \{/);
  assert.doesNotMatch(log, /orphans\.map/, "no Undo drawn again above the meals");
  assert.match(log, /aria-label=\{undoLabel\(entry\)\}/);
});
