// Bug 93: screen readers heard "829 mthis week", "0days" and "0of 4" because the gap on screen came only from a
// margin. Each number and the word after it now has a real space (a no-break space between a number and its
// unit), and the rings' description counts "1 training day". Components can't be rendered under `node --test`,
// so their source is checked, as tests/ui/touch-targets.test.ts does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { periodFor, ringsLabel } from "@/components/progress/period";

const source = (file: string) => readFileSync(file, "utf8");
const css = (file: string) => source(file).replace(/\/\*[\s\S]*?\*\//g, "");

test("the sport cards say 'Walk 829 m this week' at every width", () => {
  const home = source("src/components/activity/ActivityHome.tsx");
  assert.match(home, /\{formatDistance\(sportWeek\[sport\]\)\}\{" "\}<span className="block sm:inline">this week<\/span>/);
  assert.doesNotMatch(home, /sm:ml-1/);
});

test("Progress's rings legend reads '0 days', '0 of 4' and '3 of 4 days'", () => {
  const view = source("src/components/progress/ProgressAnalytics.tsx");
  for (const value of ["activeDays", "loggedDays", "trainingDays"]) assert.match(view, new RegExp(`\\{view\\.current\\.${value}\\} <small>`), value);
  assert.doesNotMatch(css("src/components/progress/Progress.module.css"), /\.legend strong small \{[^}]*margin-left/);
});

test("the rings' description says '1 training day', and days in the singular when there is one", () => {
  const week = periodFor("week", "2026-11-25");
  assert.equal(ringsLabel({ activeDays: 1, days: 3, loggedDays: 0, trainingDays: 1 }, 4, week), "1 active of 3 days, food logged on 0 days, 1 training day of 4 planned");
  assert.equal(ringsLabel({ activeDays: 3, days: 7, loggedDays: 1, trainingDays: 2 }, 4, week), "3 active of 7 days, food logged on 1 day, 2 training days of 4 planned");
  assert.equal(ringsLabel({ activeDays: 0, days: 1, loggedDays: 0, trainingDays: 0 }, null, week), "0 active of 1 day, food logged on 0 days");
});

test("numbers and units elsewhere on these screens are spaced in the text, not by a margin", () => {
  const spaced: Array<[string, RegExp]> = [
    ["src/components/progress/ProgressAnalytics.tsx", /className=\{styles\.statUnit\}>\{`\\u00a0\$\{unit\}`\}/],
    ["src/components/progress/ProgressAnalytics.tsx", /\{num\(average\)\}<small>\{`\\u00a0\$\{unit\} a day`\}<\/small>/],
    ["src/app/(dashboard)/progress/BodySection.tsx", /<small>\{`\\u00a0\$\{unit\}`\}<\/small>/],
    ["src/components/activity/ActivityStats.tsx", /\{kmValue\(totals\.distanceM\)\}<span[^>]*>\{"\\u00a0km"\}<\/span>/],
    ["src/components/activity/ActivitySummaryParts.tsx", /\{kmValue\(view\.distanceM\)\}<span[^>]*>\{"\\u00a0km"\}<\/span>/],
    ["src/components/activity/FeedList.tsx", /\{value\}\{unit && value !== "–" && <span[^>]*>\{`\\u00a0\$\{unit\}`\}<\/span>\}/],
    ["src/components/activity/StrengthRow.tsx", /<span[^>]*>\{"\\u00a0kg"\}<\/span>/],
    ["src/components/activity/ActivityRecorderScreen.tsx", /\{`\\u00a0\$\{unit\}`\}<\/span>/],
  ];
  for (const [file, pattern] of spaced) assert.match(source(file), pattern, file);
  const styles = css("src/components/progress/Progress.module.css");
  for (const rule of [".statUnit", ".weightNow small", ".pair dd small", ".statEstimate"]) {
    const body = styles.match(new RegExp(`${rule.replace(/[.]/g, "\\.")} \\{([^}]*)\\}`))?.[1] ?? "";
    assert.ok(body, `${rule} is styled`);
    assert.doesNotMatch(body, /margin-left/, `${rule}: the text carries the space now`);
  }
});
