// Review finding (fix round 3a, a11y-copy): bug 53 named the Meals tab's day buttons after the day being viewed
// ("Save this day as a routine" on any day but today), but the Routines tab, which works on that same day, still said
// "Use “Save today as a routine” on the Meals tab.", a button that isn't there on other days. Its "database update"
// note said "copy yesterday's meals" the same way. Both now say what the Meals tab shows for the day viewed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dayActionLabels, noRoutinesText } from "@/app/(dashboard)/nutrition/day-labels";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("the empty routines line names the button the Meals tab shows for that day", () => {
  assert.equal(noRoutinesText(dayActionLabels(true)), "No routines yet. Use “Save today as a routine” on the Meals tab.");
  assert.equal(noRoutinesText(dayActionLabels(false)), "No routines yet. Use “Save this day as a routine” on the Meals tab.");
  for (const isToday of [true, false]) assert.ok(noRoutinesText(dayActionLabels(isToday)).includes(`“${dayActionLabels(isToday).saveDay}”`));
});

test("Routines gets the day's labels from the page and quotes no fixed button name", () => {
  const routines = read("src/components/nutrition/Routines.tsx");
  assert.match(routines, /noRoutinesText\(labels\)/);
  assert.doesNotMatch(routines, /Save today as a routine|yesterday/, "no label of today's buttons on another day");
  assert.match(routines, /copy the meals of the day before from the Meals tab/);
  assert.match(read("src/app/(dashboard)/nutrition/page.tsx"), /<Routines [^\n]*labels=\{actionLabels\}/);
});
