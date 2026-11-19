// The nutrition page is prerendered at build time ("use client" under a static layout), so its HTML must not name
// a day: the build machine's day and locale are not the viewer's, and a different text there is React's
// hydration error #418 on every load (found by the signed-in e2e run, flow 03).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nutritionDayLabels } from "../../src/app/(dashboard)/nutrition/day-labels.ts";
import { readableDate } from "@/lib/domain/dates";

const page = readFileSync(new URL("../../src/app/(dashboard)/nutrition/page.tsx", import.meta.url), "utf8");

test("before hydration the day picker, heading and summary say Today, whatever the clock or locale", () => {
  assert.deepEqual(nutritionDayLabels(null), { picker: "Today", heading: "Today", summary: "Today's nutrition summary", diary: "Today" });
});

test("after hydration they name the chosen day in the viewer's own format", () => {
  const day = new Date(2026, 10, 17);
  assert.deepEqual(nutritionDayLabels(day), {
    picker: readableDate(day, { weekday: "short", month: "short", day: "numeric", year: "numeric" }),
    heading: readableDate(day, { weekday: "long", month: "long", day: "numeric" }),
    summary: `Nutrition summary for ${readableDate(day)}`,
    diary: readableDate(day, { weekday: "short", month: "short", day: "numeric" }),
  });
});

test("the page names the day only once it has hydrated", () => {
  assert.match(page, /const hydrated = useHydrated\(\);/);
  assert.match(page, /const dayLabels = nutritionDayLabels\(hydrated \? date : null\);/);
  assert.match(page, /\{dayLabels\.picker\}/);
  assert.match(page, /summaryLabel=\{dayLabels\.summary\} heading=\{dayLabels\.heading\}/);
  // The day's meals are what the page opens on, so their title comes from the labels too.
  assert.match(page, /useState<Tab>\("meals"\)/);
  assert.match(page, /<MealLog entries=\{entries\} title=\{dayLabels\.diary\}/);
  // Elsewhere the chosen day is formatted only in event handlers and in tabs that open after a tap, never in what
  // the server renders.
  const renderUses = page.split("\n").filter((line) => /readableDate\(date\b/.test(line)).map((line) => line.trim().slice(0, 32));
  assert.deepEqual(renderUses, [
    "setNotice(`Added ${template.item",
    "onSaveDay={() => setNamePrompt({",
    "{tab === \"routines\" && <Routines",
  ]);
});
