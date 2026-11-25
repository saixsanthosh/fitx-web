// Bug 37: a date in another year shows its year ("Sun, 3 Mar 2024, 7:30 am"), on the activity page, personal bests,
// history, the import card and its overlap warning (all formatActivityDate), and on the other date labels of
// Activity, Progress and goals that left it out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatActivityDate, inOtherYear } from "@/lib/activity/format";
import { periodFor } from "@/components/progress/period";
import { periodLabel } from "@/lib/domain/goals";

const NOW = new Date(2026, 10, 25, 15, 0).getTime();

test("an activity from another year says the year; this year's dates stay short", () => {
  assert.equal(formatActivityDate(new Date(2024, 2, 3, 7, 30), NOW), "Sun, 3 Mar 2024, 7:30 am");
  assert.equal(formatActivityDate(new Date(2026, 10, 24, 7, 30), NOW), "Tue, 24 Nov, 7:30 am");
  assert.equal(formatActivityDate(new Date(2027, 0, 1, 6, 5), NOW), "Fri, 1 Jan 2027, 6:05 am", "next year too");
  assert.equal(formatActivityDate(new Date(2024, 2, 3, 7, 30).toISOString(), NOW), "Sun, 3 Mar 2024, 7:30 am", "from the database's ISO time");
  assert.equal(formatActivityDate("not a date", NOW), "");
});

test("the year is the viewer's calendar year", () => {
  assert.equal(inOtherYear(new Date(2026, 0, 1, 0, 1).getTime(), NOW), false);
  assert.equal(inOtherYear(new Date(2025, 11, 31, 23, 59).getTime(), NOW), true);
});

test("Progress's older weeks say the year when it isn't this one", () => {
  assert.equal(periodFor("week", "2026-01-14", -3).label, "22 – 28 Dec 2025");
  assert.equal(periodFor("week", "2026-01-14", -2).label, "29 Dec – 4 Jan", "a week ending this year needs no year");
  assert.equal(periodFor("week", "2026-11-18", -2).label, "2 – 8 Nov");
});

test("a goal due or ended in another year says the year", () => {
  const today = "2026-11-25";
  const due = periodLabel({ period: "long_term", startsOn: "2026-11-01", dueOn: "2027-03-31" }, today);
  assert.match(due, /^Due .*2027/);
  assert.match(periodLabel({ period: "long_term", startsOn: "2025-01-01", dueOn: "2025-12-31" }, today), /^Ended .*2025/);
  assert.doesNotMatch(periodLabel({ period: "long_term", startsOn: "2026-11-01", dueOn: "2026-12-31" }, today), /2026/);
  assert.match(periodLabel({ period: "long_term", startsOn: "2027-01-05", dueOn: null }, today), /^Starts .*2027/);
});
