// Reports (BUGS.md "Reports that could not be reproduced", admin-10): "No completed workouts yet" stood beside 35
// completed workouts whenever none of them had exercise rows; the top exercises read "1 workouts · 3%"; and a 12-month
// range was labelled "27 Nov" to "26 Nov" with no years.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

const time = await importTypeScriptModule("src/lib/time.ts");

test("day labels carry the year when a range crosses one", () => {
  assert.equal(time.formatShortDay("2025-11-27"), "27 Nov");
  assert.equal(time.formatShortDay("2025-11-27", true), "27 Nov 2025");
  assert.equal(time.crossesYear("2025-11-27", "2026-11-26"), true);
  assert.equal(time.crossesYear("2026-08-29", "2026-11-26"), false);
  assert.equal(time.crossesYear(undefined, "2026-11-26"), false);
  assert.equal(time.crossesYear("", "2026-11-26"), false);
  assert.equal(time.formatDayRange("2025-11-27", "2026-11-26"), "27 Nov 2025 to 26 Nov 2026");
  assert.equal(time.formatDayRange("2026-10-28", "2026-11-26"), "28 Oct to 26 Nov 2026");
  assert.equal(time.formatShortDay("not a day"), "not a day");
});

test("the Reports page: every day label and the range know their year, the empty states tell workouts from exercises, plurals read right", async () => {
  const page = await readFile(new URL("../src/app/(control)/reports/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const withYear = \(report: Report\) => crossesYear\(report\.daily\[0\]\?\.day, report\.daily\.at\(-1\)\?\.day\);/);
  assert.doesNotMatch(page, /formatShortDay\(day\.day\)\)|weekLabel\(week\.week\)/, "no day label without the year rule");
  assert.match(page, /formatDayRange\(result\.report\.from, result\.report\.to\)/);
  assert.match(page, /\) : w\.completed > 0 \? \(\s*<Empty title="No exercises logged">/, "workouts without exercise rows are not 'no workouts'");
  assert.match(page, /<Empty title="No completed workouts yet" \/>/);
  assert.match(page, /const workoutsText = \(n: number\) => `\$\{n\.toLocaleString\("en-IN"\)\} \$\{n === 1 \? "workout" : "workouts"\}`;/);
  assert.match(page, /of="completed workouts" format=\{workoutsText\}/);
  const charts = await readFile(new URL("../src/components/content/charts.tsx", import.meta.url), "utf8");
  assert.match(charts, /\$\{Math\.round\(share \* 100\)\}%\$\{of \? ` of \$\{of\}` : ""\}/, "a share says what it is a share of");
});
