// D5 (the cause of bug 84, found again elsewhere in Workouts): a button disabled while its action saves loses keyboard
// focus in Chrome. These stay focusable while busy (aria-disabled) and ignore a press meanwhile; a button that cannot
// be used for a reason the screen gives (no exercises, a paused workout) may still be disabled.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const cases: Array<[string, RegExp, RegExp]> = [
  ["src/app/(dashboard)/workouts/active/page.tsx", /<button type="button" onClick=\{\(\) => void abandonWorkout\(\)\} aria-disabled=\{saving \|\| clockSaving \|\| undefined\}/, /if \(!supabase \|\| !session \|\| saving \|\| clockSaving \|\| clock\?\.paused\) return;/],
  ["src/app/(dashboard)/workouts/active/page.tsx", /<button type="button" disabled=\{paused\} aria-disabled=\{saving \|\| clockSaving \|\| undefined\} onClick=\{\(\) => void finishWorkout\(\)\}/, /if \(!session \|\| saving \|\| clockSaving \|\| !window\.confirm\(/],
  ["src/components/workouts/PlanPreviewSheet.tsx", /onClick=\{\(\) => \{ if \(!starting\) void begin\(\); \}\} disabled=\{pausedDay \|\| !rows\.length\} aria-disabled=\{starting \|\| undefined\}/, /Begin workout/],
  ["src/components/workouts/TodayWorkout.tsx", /onClick=\{\(\) => \{ if \(!starting\) onStart\(\); \}\} disabled=\{start\.kind === "start" && !rows\?\.length\} aria-disabled=\{starting \|\| undefined\}/, /start\.label/],
  ["src/components/session/SessionRecordScreen.tsx", /onClick=\{\(\) => \{ if \(!repeating\) void repeat\(\); \}\} aria-disabled=\{repeating \|\| undefined\}/, /Repeat this workout/],
  ["src/components/workouts/WorkoutSetupFlow.tsx", /onClick=\{\(\) => \{ if \(!saving\) void save\(\); \}\} aria-disabled=\{saving \|\| undefined\}/, /Save setup/],
  ["src/app/(dashboard)/exercises/page.tsx", /onClick=\{\(\) => \{ if \(!savingList\) void saveHaveList\(\); \}\} aria-disabled=\{savingList \|\| undefined\}/, /Save as my/],
];

for (const [file, button, guard] of cases) {
  test(`${file.split("/").pop()}: ${button.source.slice(0, 60)}…`, () => {
    const source = readFileSync(file, "utf8");
    assert.match(source, button);
    assert.match(source, guard);
  });
}
