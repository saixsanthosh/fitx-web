// Bug 15 (nutrition-6): removing a logged food was instant and silent (no undo, focus on the page body), and the old
// "Added …" toast's Undo then sent a second deletion and claimed "Removed …". Now the removed row is replaced by
// "Removed …" with an Undo (which takes the focus and puts the same entry back), and an "Added …" toast can never take
// back an entry removed since.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addedUndoRegistry, removedText, RESTORE_COLUMNS, restoreRow, undoAddedMessage } from "@/lib/food/meal-undo";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("an Added toast can take back only entries nobody has removed since", () => {
  const registry = addedUndoRegistry();
  registry.remember(["m1"], "toast-1");
  assert.equal(registry.canUndo(["m1"]), true);
  assert.equal(registry.forget("m1"), "toast-1", "removing the entry says which toast to close");
  assert.equal(registry.canUndo(["m1"]), false, "its Undo can no longer delete it, or a copy put back with the same id");
  assert.equal(registry.forget("m1"), undefined);
  assert.equal(registry.canUndo([]), false);
  assert.equal(undoAddedMessage(1, "Ghee, clarified butter"), "Removed Ghee, clarified butter.");
  assert.equal(undoAddedMessage(0, "Ghee, clarified butter"), "Ghee, clarified butter was already removed.", "never a false \"Removed\"");
});

test("a removed food is put back exactly as it was, for this member", () => {
  assert.match(RESTORE_COLUMNS, /^id,date,meal,food_name,/);
  assert.match(RESTORE_COLUMNS, /,created_at$/, "its time too, so it goes back to its place in the meal");
  const row = { id: "m1", date: "2026-11-25", meal: "Breakfast", food_name: "Ghee, clarified butter", calories: 41, protein: 0, created_at: "2026-11-25T03:00:00Z" };
  assert.deepEqual(restoreRow({ row }, "user-1"), { ...row, user_id: "user-1" });
  assert.equal(removedText({ name: "Ghee, clarified butter" }), "Removed Ghee, clarified butter.");
  assert.match(removedText({ name: "Ghee", failed: true }), /couldn't be put back\. Try Undo again/);
  // Review a11y-copy (fix round 3a): Recent is built from logged entries, so a food logged once has left it once removed.
  assert.equal(removedText({ name: "Ghee", failed: true }), "Ghee couldn't be put back. Try Undo again, or search for it in Log food.");
  assert.doesNotMatch(removedText({ name: "Ghee", failed: true }), /Recent/, "never a list the food may no longer be in");
});

test("the page removes with a way back and keeps the focus, and the meal log shows the Undo in place", () => {
  const page = read("src/app/(dashboard)/nutrition/page.tsx");
  const remove = page.slice(page.indexOf("async function removeMeal("), page.indexOf("async function undoRemove("));
  assert.match(remove, /\.delete\(\)\.eq\("id", entry\.id\)\.eq\("user_id", userId\)\.select\(RESTORE_COLUMNS\)/, "the row is read back as it is deleted");
  assert.match(remove, /toast\.dismiss\(toastId\)/, "its Added toast closes");
  assert.match(remove, /pendingFocus\.current = \[`\[data-undo="\$\{entry\.id\}"\]`/, "focus moves to its Undo");
  const undoAdded = page.slice(page.indexOf("async function undoAdded("), page.indexOf("function announceAdded("));
  assert.match(undoAdded, /if \(!addedUndo\.current\.canUndo\(ids\)\)/);
  assert.match(undoAdded, /\.select\("id"\)/, "it reports only what it deleted");
  const log = read("src/components/nutrition/MealLog.tsx");
  assert.match(log, /data-undo=\{entry\.id\}/);
  assert.match(log, /const removed = removedFoods\.filter\(\(item\) => !entries\.some\(\(entry\) => entry\.id === item\.id\)\);/, "never the row and its Undo at once");
  assert.match(log, /aria-label=\{undoLabel\(entry\)\}/, "named \"Undo removing <food> from <meal>\" (fix round 3a)");
});
