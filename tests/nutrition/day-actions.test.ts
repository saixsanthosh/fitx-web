// Bug 53 (nutrition-13): on a past day the meal log still said "Copy yesterday" and "Save today as a routine" (and
// "Copy yesterday's meals" on an empty day), and "Nothing was logged the day before." stayed after moving to another
// day. The buttons now use the viewed day's words, the copy flow names the day it copies, and moving day clears it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { copyDayMessages, dayActionLabels } from "@/app/(dashboard)/nutrition/day-labels";
import { readableDate } from "@/lib/domain/dates";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("the day buttons say what they act on", () => {
  assert.deepEqual(dayActionLabels(true), { copy: "Copy yesterday", copyEmpty: "Copy yesterday's meals", saveDay: "Save today as a routine" });
  assert.deepEqual(dayActionLabels(false), { copy: "Copy the day before", copyEmpty: "Copy meals from the day before", saveDay: "Save this day as a routine" });
});

test("copying names the day it copies from", () => {
  const sunday = new Date(2026, 10, 22);
  const day = readableDate(sunday, { weekday: "long", day: "numeric", month: "long" });
  const says = copyDayMessages(sunday, false);
  assert.equal(says.nothing, `Nothing was logged on ${day}.`, "not \"the day before\" while the real yesterday has food");
  assert.equal(says.confirm(1, 8), `This day already has 1 entry. Add the 8 foods from ${day} too?`);
  assert.equal(says.copied(1), `Copied 1 food from ${day}.`);
  assert.match(says.readFailed, new RegExp(`^The meals of ${day} could not be read`));
  assert.match(copyDayMessages(sunday, true).readFailed, /^Yesterday's meals/, "on today, yesterday is the day before");
});

test("the meal log takes its words from the page, which clears its messages when the day changes", () => {
  const log = read("src/components/nutrition/MealLog.tsx");
  assert.match(log, /\{labels\.copy\}/);
  assert.match(log, /\{labels\.saveDay\}/);
  assert.match(log, /\{labels\.copyEmpty\}/);
  assert.doesNotMatch(log, />Copy yesterday</, "no fixed day words");
  assert.doesNotMatch(log, /Save today as a routine/);
  const page = read("src/app/(dashboard)/nutrition/page.tsx");
  assert.match(page, /<MealLog [^\n]*labels=\{actionLabels\}/);
  const shift = page.slice(page.indexOf("function shiftDate("), page.indexOf("function changeUnit("));
  assert.match(shift, /setNotice\(""\);/);
});
