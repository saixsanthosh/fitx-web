// Customise Home says "Saved" only while the database holds what is on screen. Found by the e2e run
// (04-goals-todo): a change made after an earlier save left "Saved" showing through the short wait before
// its own save, so a reload in that wait lost the change behind a "Saved".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../src/components/widgets/useHomeData.ts", import.meta.url), "utf8");
const hook = source.slice(source.indexOf("export function useDashboardLayout"));

test("a change shows Saving… at once, unless this database cannot store the layout, and a flush always settles it", () => {
  assert.match(hook, /const act = useCallback\(\(action: LayoutAction\) => \{\s*if \(canSave\.current\) setSave\(\(current\) => \(current === "unavailable" \? current : "saving"\)\);\s*dispatch\(action\);\s*setTimeout\(\(\) => void flush\(\), 500\);/);
});

test("Saved follows a save only when nothing newer is waiting", () => {
  assert.match(hook, /saved\.current = next;\s*\/\/[^\n]*\n\s*if \(wanted\.current && sameLayout\(next, wanted\.current\)\) setSave\("saved"\);/);
  assert.doesNotMatch(hook, /saved\.current = next;\s*setSave\("saved"\);/);
});

test("a change undone before its save settles back to Saved without a request", () => {
  assert.match(hook, /if \(wanted\.current && saved\.current && sameLayout\(saved\.current, wanted\.current\)\) setSave\(\(current\) => \(current === "saving" \? "saved" : current\)\);/);
});
