// Review round, finding N4 (bugs 13 and 15's mistake, D5): My foods and Routines swapped their whole list for a loading
// line on every reload, and a reload follows each save, so the control that had the focus went and it fell to the page:
// Routines' "Add to <day>" (aria-disabled so it would keep the focus), and My foods' pencil once Save changes gave the
// focus back to it. An empty day did the same once it had food: its "Log a food" and "Copy meals from the day before"
// buttons go with the empty state. Lists now keep their rows while they reload, and an empty day's buttons hand the
// focus on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { focusFellToPage, reloadFocusTargets } from "@/lib/food/reload-focus";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const page = read("src/app/(dashboard)/nutrition/page.tsx");
const between = (from: string, to: string) => {
  const start = page.indexOf(from);
  assert.ok(start >= 0, from);
  return page.slice(start, page.indexOf(to, start + from.length));
};

test("after a reload the focus moves only where a control was removed, or where it fell to the page", () => {
  assert.deepEqual(reloadFocusTargets(["[data-undo=\"m1\"]", "#meals-title"], null, false), ["[data-undo=\"m1\"]", "#meals-title"], "a removed entry's Undo, always");
  assert.deepEqual(reloadFocusTargets(null, ["[data-entry-edit=\"m2\"]", "#meals-title"], true), ["[data-entry-edit=\"m2\"]", "#meals-title"], "an empty day's Log a food went: the new entry's pencil");
  assert.deepEqual(reloadFocusTargets(null, ["#meals-title"], false), [], "the button pressed is still there (Log food, Copy the day before): it keeps the focus");
  assert.deepEqual(reloadFocusTargets(null, null, true), []);
  const body = {};
  assert.equal(focusFellToPage(body, body), true);
  assert.equal(focusFellToPage(null, body), true);
  assert.equal(focusFellToPage({}, body), false);
});

test("My foods and Routines say they are loading only before the first answer, so a reload keeps their rows", () => {
  assert.match(read("src/components/nutrition/MyFoods.tsx"), /\{loading && rows\.length === 0 \? <p className=\{styles\.muted\}>Loading your foods…<\/p>/);
  assert.match(read("src/components/nutrition/Routines.tsx"), /\{loading && templates\.length === 0 \? <p className=\{styles\.muted\}>Loading…<\/p>/);
  assert.match(between("async function removeFood(", "/**"), /setCustomRows\(\(list\) => list\.filter\(\(item\) => item\.id !== row\.id\)\);\s*await load\(\);/, "a deleted food leaves at once");
  assert.match(between("async function removeTemplate(", "/**"), /setTemplates\(\(list\) => list\.filter\(\(item\) => item\.id !== template\.id\)\);\s*await load\(\);/);
});

test("the page hands the focus on after every reload of the day, My foods or Routines", () => {
  const effect = between("const targets = reloadFocusTargets(", "/** \"Type the number\"");
  assert.match(effect, /reloadFocusTargets\(pendingFocus\.current, focusIfLost\.current, focusFellToPage\(document\.activeElement, document\.body\)\)/);
  assert.match(effect, /focusIfLost\.current = null;/, "used once, never by a later reload");
  assert.match(between("const fail = (message: string) => {", "};"), /pendingFocus\.current = null;\s*focusIfLost\.current = null;/, "nor after a failed one");
  assert.match(effect, /\}, \[entries, customRows, templates\]\);/);
  for (const [from, to] of [["async function insertLoggedFood(", "async function addUsual("], ["async function addUsual(", "function chooseFrequent("]]) {
    assert.match(between(from, to), /focusIfLost\.current = \[\.\.\.\(ids\[0\] \? \[`\[data-entry-edit="\$\{ids\[0\]\}"\]`\] : \[\]\), "#meals-title"\];/, from);
  }
  assert.match(between("async function copyYesterday(", "/**"), /focusIfLost\.current = \["#meals-title"\];\s*await load\(\);/);
  const log = read("src/components/nutrition/MealLog.tsx");
  assert.match(log, /data-entry-edit=\{entry\.id\}/);
  assert.match(log, /<h2 id="meals-title" tabIndex=\{-1\}/);
});
