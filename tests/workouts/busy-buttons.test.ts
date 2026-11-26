// D5 (the cause of bug 84, found again elsewhere in Workouts): a button disabled while its action saves loses keyboard
// focus in Chrome. These stay focusable while busy (aria-disabled) and ignore a press meanwhile; a button that cannot
// be used for a reason the screen gives (no exercises, a paused workout) may still be disabled. The review round
// (workouts-r4) found more, and the sweep at the end keeps any from coming back in the stream's files.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { addedIds, focusAfterShowMore } from "@/lib/workouts/show-more";

const cases: Array<[string, RegExp, RegExp]> = [
  ["src/app/(dashboard)/workouts/active/page.tsx", /<button type="button" onClick=\{\(\) => void abandonWorkout\(\)\} aria-disabled=\{saving \|\| clockSaving \|\| undefined\}/, /if \(!supabase \|\| !session \|\| saving \|\| clockSaving \|\| clock\?\.paused\) return;/],
  ["src/app/(dashboard)/workouts/active/page.tsx", /<button type="button" disabled=\{paused\} aria-disabled=\{saving \|\| clockSaving \|\| undefined\} onClick=\{\(\) => void finishWorkout\(\)\}/, /if \(!session \|\| saving \|\| clockSaving \|\| !window\.confirm\(/],
  ["src/components/workouts/PlanPreviewSheet.tsx", /onClick=\{\(\) => \{ if \(!starting\) void begin\(\); \}\} disabled=\{pausedDay \|\| !rows\.length\} aria-disabled=\{starting \|\| undefined\}/, /Begin workout/],
  ["src/components/workouts/TodayWorkout.tsx", /onClick=\{\(\) => \{ if \(!starting\) onStart\(\); \}\} disabled=\{start\.kind === "start" && !rows\?\.length\} aria-disabled=\{starting \|\| undefined\}/, /start\.label/],
  ["src/components/session/SessionRecordScreen.tsx", /onClick=\{\(\) => \{ if \(!repeating\) void repeat\(\); \}\} aria-disabled=\{repeating \|\| undefined\}/, /Repeat this workout/],
  ["src/components/workouts/WorkoutSetupFlow.tsx", /onClick=\{\(\) => \{ if \(!saving\) void save\(\); \}\} aria-disabled=\{saving \|\| undefined\}/, /Save setup/],
  ["src/app/(dashboard)/exercises/page.tsx", /onClick=\{\(\) => \{ if \(!savingList\) void saveHaveList\(\); \}\} aria-disabled=\{savingList \|\| undefined\}/, /Save as my/],
  // Review round (workouts-r4).
  ["src/app/(dashboard)/workouts/page.tsx", /onClick=\{\(\) => void loadMorePlans\(\)\} aria-disabled=\{loadingMorePlans \|\| undefined\}/, /if \(!supabase \|\| !userId \|\| !planCursor \|\| loadingMorePlans\) return;/],
  ["src/app/(dashboard)/workouts/page.tsx", /<button type="button" aria-disabled=\{saving \|\| undefined\} onClick=\{\(\) => void repeatSession\(session\)\}/, /if \(!supabase \|\| !userId \|\| saving\) return;/],
  ["src/app/(dashboard)/workouts/page.tsx", /data-plan-start aria-haspopup="dialog" aria-disabled=\{Boolean\(starting\) \|\| undefined\}/, /onClick=\{\(\) => \{ if \(starting\) return; if \(event\?\.startHref\)/],
  ["src/app/(dashboard)/workouts/page.tsx", /onClick=\{\(\) => void leave\(\)\} aria-disabled=\{programmeBusy \|\| undefined\}/, /if \(!supabase \|\| !userId \|\| !enrolment \|\| planningAhead \|\| programmeBusy\) return;/],
  ["src/app/(dashboard)/workouts/programme/page.tsx", /onClick=\{\(\) => void showEarlier\(\)\} aria-disabled=\{loadingEarlier \|\| undefined\}/, /if \(!loaded \|\| loadingEarlier\) return;/],
  ["src/components/session/WorkoutHistoryScreen.tsx", /onClick=\{\(\) => void loadMore\(\)\} aria-disabled=\{loadingMore \|\| undefined\}/, /state\.nextOffset === null \|\| loadingMore\) return;/],
  ["src/components/session/SessionRecordScreen.tsx", /<button type="submit" aria-disabled=\{!changed \|\| state === "saving" \|\| undefined\}/, /if \(!supabase \|\| state === "saving" \|\| !changed\) return;/],
  ["src/components/exercises/detail/HistoryPanel.tsx", /onClick=\{showOlder\} aria-disabled=\{history\.loadingMore \|\| undefined\}/, /if \(history\.status !== "ready" \|\| history\.loadingMore\) return;/],
  ["src/components/exercises/detail/ExerciseNote.tsx", /onClick=\{\(\) => void remove\(\)\} aria-disabled=\{busy !== null \|\| undefined\}/, /if \(!supabase \|\| busy\) return;/],
  ["src/components/exercises/detail/ExerciseNote.tsx", /<button type="submit" disabled=\{over \|\| unchanged\} aria-disabled=\{busy !== null \|\| undefined\}/, /function stopEditing\(\) \{\s+if \(busy\) return;/],
  ["src/app/(dashboard)/workouts/form-check/TodaySets.tsx", /onClick=\{\(\) => \{ if \(save\.status !== "saving"\) onSave\(\); \}\} aria-disabled=\{save\.status === "saving" \|\| undefined\}/, /Save workout/],
  ["src/components/workouts/ProgrammeDayDetails.tsx", /aria-disabled=\{busy \|\| undefined\} onClick=\{\(\) => \{ if \(!busy\) onPreview\(day\.planId!\); \}\}/, /Preview workout/],
  ["src/components/workouts/ProgrammeBrowser.tsx", /disabled=\{!enrolAvailable\} aria-disabled=\{busy \|\| undefined\} onClick=\{\(\) => \{ if \(!busy\) setEnrolling\(programme\); \}\}/, /Follow/],
  // Not busy, but disabled in the member's hand all the same: Next onto the last exercise, a move to the top or bottom.
  ["src/app/(dashboard)/workouts/active/page.tsx", /onClick=\{\(\) => \{ if \(!atLast\) showExercise\(\(index\) => Math\.min\(exercises\.length - 1, index \+ 1\)\); \}\} aria-disabled=\{atLast \|\| undefined\} aria-label="Next exercise"/, /aria-disabled=\{atFirst \|\| undefined\} aria-label="Previous exercise"/],
  ["src/components/workouts/BuilderRow.tsx", /onClick=\{\(\) => \{ if \(index > 0\) onMove\(-1\); \}\} aria-disabled=\{index === 0 \|\| undefined\} data-builder-control="earlier"/, /onClick=\{\(\) => \{ if \(index < count - 1\) onMove\(1\); \}\} aria-disabled=\{index === count - 1 \|\| undefined\} data-builder-control="later"/],
];

for (const [file, button, guard] of cases) {
  test(`${file.split("/").pop()}: ${button.source.slice(0, 60)}…`, () => {
    const source = readFileSync(file, "utf8");
    assert.match(source, button);
    assert.match(source, guard);
  });
}

describe("a button that goes once it has shown everything hands focus on", () => {
  test("it keeps focus while there is more; then the first item it brought, else the last one shown", () => {
    assert.equal(focusAfterShowMore({ more: true, shown: ["a"], added: ["b"] }), "button");
    assert.equal(focusAfterShowMore({ more: false, shown: ["a", "b"], added: ["c", "d"] }), "c");
    assert.equal(focusAfterShowMore({ more: false, shown: ["a", "b"], added: [] }), "b");
    assert.equal(focusAfterShowMore({ more: false, shown: [], added: [] }), null);
    assert.deepEqual(addedIds(["a", "b"], ["a", "c", "b", "d"]), ["c", "d"]);
  });

  test("Show more plans, Show 20 more, Show earlier weeks, Show older sessions, Save workout and Save as my list use it", () => {
    const page = readFileSync("src/app/(dashboard)/workouts/page.tsx", "utf8");
    assert.match(page, /const target = focusAfterShowMore\(\{ more: Boolean\(page\.next\), shown, added: addedIds\(shown, page\.rows\.map\(\(plan\) => plan\.id\)\) \}\);\s+if \(target !== "button"\) setPlanFocus/);
    const history = readFileSync("src/components/session/WorkoutHistoryScreen.tsx", "utf8");
    assert.match(history, /focusAfterShowMore\(\{ more: page\.page\.nextOffset !== null,/);
    assert.match(history, /data-history-row=\{row\.id\}/);
    const programme = readFileSync("src/app/(dashboard)/workouts/programme/page.tsx", "utf8");
    assert.match(programme, /document\.querySelector<HTMLElement>\(`\[data-journey-week="\$\{target\}"\] h2`\)/);
    assert.match(readFileSync("src/components/workouts/ProgrammeJourney.tsx", "utf8"), /data-journey-week=\{week\.weekStart\}/);
    const panel = readFileSync("src/components/exercises/detail/HistoryPanel.tsx", "utf8");
    assert.equal((panel.match(/Show older sessions/g) ?? []).length, 2, "one button for both, with its label and the loaded state's");
    assert.match(panel, /\[data-history-session="\$\{target\}"\] a/);
    const today = readFileSync("src/app/(dashboard)/workouts/form-check/TodaySets.tsx", "utf8");
    assert.match(today, /if \(wasSaving\.current && save\.status === "saved"\) viewWorkout\.current\?\.focus\(\);/);
    const library = readFileSync("src/app/(dashboard)/exercises/page.tsx", "utf8");
    assert.match(library, /navigate\(\{ \.\.\.state, have: null \}\);\s+setListSaved\(\(value\) => value \+ 1\);/);
    assert.match(library, /<Link ref=\{editListLink\}/);
  });

  test("following, leaving or finishing a programme hands focus to the Programme heading, under which the result is said", () => {
    const page = readFileSync("src/app/(dashboard)/workouts/page.tsx", "utf8");
    assert.match(page, /const heading = programmeFocus \? document\.getElementById\("programme-title"\) : null;/);
    // Leave and Finish programme; Follow since fix round 3c (tests/workouts/follow-setup-focus.test.ts).
    assert.equal((page.match(/setProgrammeFocus\(\(value\) => value \+ 1\);/g) ?? []).length, 3);
  });
});

/** The stream's own component files. */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".tsx") ? [path] : [];
  });
}

test("sweep: no button in the stream's files is disabled while it works", () => {
  const roots = ["src/app/(dashboard)/workouts", "src/app/(dashboard)/exercises", "src/app/(dashboard)/home-workout", "src/components/workouts", "src/components/exercises", "src/components/session", "src/components/training", "src/components/equipment", "src/components/anatomy"];
  const busyDisabled = /(?<!aria-)disabled=\{[^}]*\b(saving|busy|loading\w*|starting|pending|submitting|opening)\b[^}]*\}/;
  const found = roots.flatMap(files).flatMap((file) => readFileSync(file, "utf8").split("\n").flatMap((line, index) => (busyDisabled.test(line) ? [`${file}:${index + 1}`] : [])));
  assert.deepEqual(found, []);
});
