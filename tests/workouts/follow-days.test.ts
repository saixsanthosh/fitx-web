// Bug 50 (workouts-8): with every training day unticked, the Follow form said "0 training days and 7 rest days a
// week", "Rest days are part of the plan" and "the programme cycles through its 3 days in order either way", while
// Start programme was disabled with no reason (and out of the Tab order).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { followDaysSummary } from "@/lib/training/programmes";

const ppl = { daysPerWeek: 3, dayCount: 3 };

describe("what the Follow form says about the days picked", () => {
  test("no day: the programme can't start, and the form says to pick one", () => {
    assert.deepEqual(followDaysSummary([], ppl), { canStart: false, summary: "Pick at least one training day to start the programme.", note: null });
  });

  test("the programme's own number of days: the week's pattern only", () => {
    assert.deepEqual(followDaysSummary([1, 3, 5], ppl), { canStart: true, summary: "3 training days and 4 rest days a week", note: null });
  });

  test("another number: the days still run in order (no 'either way')", () => {
    const one = followDaysSummary([2], ppl);
    assert.equal(one.summary, "1 training day and 6 rest days a week");
    assert.equal(one.note, "You picked 1 day; the programme works through its 3 days in order.");
    assert.doesNotMatch(one.note ?? "", /either way/);
    assert.equal(followDaysSummary([0, 1, 2, 3, 4, 5, 6], ppl).summary, "7 training days and 0 rest days a week");
  });
});

describe("the Follow form (JSX, read from the source)", () => {
  const browser = readFileSync("src/components/workouts/ProgrammeBrowser.tsx", "utf8");

  test("Start programme stays reachable, described by the reason, and does nothing until a day is picked", () => {
    const start = browser.match(/<button type="button" aria-disabled=\{blocked \|\| undefined\}[\s\S]*?Start programme/)?.[0] ?? "";
    assert.ok(start, "the button is found");
    assert.doesNotMatch(start, /\sdisabled=/);
    assert.match(start, /aria-describedby=\{days\.canStart \? undefined : summaryId\}/);
    assert.match(start, /if \(blocked\) return;/);
    assert.match(browser, /const blocked = busy \|\| !days\.canStart;/);
    assert.match(browser, /<p id=\{summaryId\} className="text-sm font-medium">\{days\.summary\}<\/p>/);
    assert.match(browser, /\{days\.canStart && <p className="mt-2 text-xs text-fitx-text-secondary">Rest days are part of the plan/);
  });
});
