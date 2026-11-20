// Admin's content scope (prompt.md, 2026-11-20): no placeholder Meal plans tab in Nutrition, and the fixed workout
// lists (muscle groups, categories, equipment) say what they are, read-only with counts, with no "coming soon".
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Nutrition has the food database and categories, and no Meal plans tab", async () => {
  const page = await read("src/app/(control)/nutrition/page.tsx");
  assert.doesNotMatch(page, /Meal plans|tab=plans|"plans"/);
  assert.match(page, /label: "Food database"/);
  assert.match(page, /label: "Categories"/);
  assert.match(page, /const tab: Tab = tabParam === "categories" \? tabParam : "foods";/, "an old ?tab=plans link opens the food database");
  assert.doesNotMatch(await read("src/lib/data/foods.ts"), /MEAL_PLANS_SOURCE/);
});

test("the fixed workout lists are described as fixed lists, with nothing promised for later", async () => {
  const page = await read("src/app/(control)/training/page.tsx");
  const library = page.slice(page.indexOf("function LibraryTab"), page.indexOf("export default async function"));
  assert.match(library, /Fixed lists in the app/);
  for (const title of ["Muscle groups", "Categories", "Equipment and machines"]) assert.match(library, new RegExp(`<Section title="${title}">`));
  assert.doesNotMatch(library, /coming soon|soon|later|<form|action=/i, "read-only: no forms and no promises");
});
