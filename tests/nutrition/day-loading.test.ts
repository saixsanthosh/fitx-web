// Bug 9 (nutrition-3): while the day loaded, the summary said "0 kcal eaten", "Set a target to see what's left.", "No
// protein target yet." and "Set a water goal" (also in the page as first sent), and Previous day showed the new date
// over the old day's figures. The page now knows which day its figures belong to and shows a loading (or failed)
// state until the day asked for is in: no figures, no "no target", and water can't be added before the total is known.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dayLoadState, dayStatusText, mealsStatusText } from "@/lib/domain/nutrition-day";

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

test("until the day is in, the overview shows no number, no missing target and no water buttons that work", () => {
  const overview = read("src/components/nutrition/DayOverview.tsx");
  const waiting = overview.slice(overview.indexOf('if (state !== "ready") {'), overview.indexOf("return <LoadedOverview"));
  assert.ok(waiting.length > 200, "a separate state for a day that is not in yet");
  for (const claim of ["Set a target", "No protein target yet", "kcal eaten", "Set a water goal", "Edit targets", "Your targets", "toLocaleString", "totals."]) {
    assert.ok(!waiting.includes(claim), `nothing like "${claim}" while the day loads`);
  }
  assert.match(waiting, /aria-busy=\{state === "loading" \|\| undefined\}/);
  assert.match(waiting, /<p role="status" className=\{styles\.noTarget\}>\{status\}<\/p>/);
  assert.match(waiting, /\+\{ml\} ml<\/button>/);
  assert.ok(!/onClick/.test(waiting), "nothing in it acts while the day loads");
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
