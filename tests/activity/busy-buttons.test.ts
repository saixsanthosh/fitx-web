// Review a11y-activity-busy-buttons-still-disabled (D5, the cause of bug 84): a button disabled while its action runs
// drops keyboard focus to the page in Chrome, and focus never comes back. Activity's buttons stay focusable while
// busy (aria-disabled) and ignore a press meanwhile; a control that goes once its action is done hands focus on.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ActivityView } from "@/lib/activity/repository";
import type { StrengthSession } from "@/lib/activity/strength";
import { focusDropped, mayHandFocus } from "@/lib/activity/focus";
import { focusAfterOlder, mergeTimeline, nextToLoad } from "@/lib/activity/timeline";

const read = (file: string) => readFileSync(file, "utf8");

const view = (startedAt: number): ActivityView => ({
  id: `a-${startedAt}`, clientId: `c-${startedAt}`, sport: "walk", title: "Walk", startedAt, endedAt: startedAt + 1000, elapsedSeconds: 1, movingSeconds: 1, pausedSeconds: 0,
  distanceM: 10, avgSpeedMps: null, maxSpeedMps: null, avgPaceSecondsPerKm: null, elevationGainM: null, kcal: null, kcalMethod: null, weightKg: null, gapCount: 0, gapSeconds: 0,
  splits: [], gaps: [], timeline: [], routePolyline: "", sharePolyline: "", shareBbox: null, pointCount: 0, chunkCount: 0, local: false,
  source: "fitx_gps", sourceFormat: null, sourceDevice: null, importedAt: null,
});
const session = (startedAt: number): StrengthSession => ({ id: `s-${startedAt}`, name: "Push day", startedAt, completedAt: startedAt + 3600_000, trainingSeconds: 3000, volumeKg: 4200 });
const keys = (timeline: ReturnType<typeof mergeTimeline>) => timeline.entries.map((entry) => entry.key);

describe("handing focus on (D5)", () => {
  test("only when focus was dropped to the page, or is still on the control that was pressed", () => {
    const body = { name: "body" };
    const pressed = { name: "Upload now" };
    const elsewhere = { name: "Share" };
    assert.equal(focusDropped({ activeElement: body, body }), true, "the focused control went");
    assert.equal(focusDropped({ activeElement: null, body }), true);
    assert.equal(focusDropped({ activeElement: pressed, body }), false);
    assert.equal(mayHandFocus({ activeElement: pressed, body }, pressed), true, "still on the button that was pressed");
    assert.equal(mayHandFocus({ activeElement: body, body }, null), true, "the button has gone");
    assert.equal(mayHandFocus({ activeElement: elsewhere, body }, pressed), false, "the member moved on meanwhile");
    assert.equal(mayHandFocus({ activeElement: elsewhere, body }, null), false);
  });
});

describe("Show older activities", () => {
  test("focus stays on the button while older entries remain; once it goes, the first entry it brought", () => {
    // Twenty walks a page in the app; three here. The first page, then the older page that completes the list.
    const first = { items: [view(100), view(90), view(80)], more: true };
    const sessions = { items: [session(85)], more: false };
    const before = mergeTimeline(first, sessions);
    assert.deepEqual(keys(before), ["activity-a-100", "activity-a-90", "strength-s-85", "activity-a-80"]);
    assert.equal(nextToLoad(first, sessions), "activities");
    // A page that still leaves more: the button stays and keeps focus.
    const middle = { items: [...first.items, view(70), view(60)], more: true };
    assert.equal(focusAfterOlder(keys(before), keys(mergeTimeline(middle, sessions)), true), null);
    // The last page: the button goes, and the first walk it brought takes focus (the newest of the older ones).
    const last = { items: [...middle.items, view(50)], more: false };
    assert.equal(focusAfterOlder(keys(mergeTimeline(middle, sessions)), keys(mergeTimeline(last, sessions)), false), "activity-a-50");
    // A last page that brought nothing new: the last entry shown; nothing shown at all: nowhere.
    assert.equal(focusAfterOlder(keys(before), keys(before), false), "activity-a-80");
    assert.equal(focusAfterOlder([], [], false), null);
    // Strength sessions held back by the activities' boundary show with the page, in time order: the newest of them
    // is the first entry the press brought.
    const held = mergeTimeline({ items: [view(100)], more: true }, { items: [session(95), session(40)], more: false });
    assert.deepEqual(keys(held), ["activity-a-100"]);
    const released = mergeTimeline({ items: [view(100), view(60)], more: false }, { items: [session(95), session(40)], more: false });
    assert.deepEqual(keys(released), ["activity-a-100", "strength-s-95", "activity-a-60", "strength-s-40"]);
    assert.equal(focusAfterOlder(keys(held), keys(released), false), "strength-s-95");
  });

  test("the button says aria-disabled while it loads, ignores a press, and the list moves focus with the entries' keys", () => {
    const list = read("src/components/activity/FeedList.tsx");
    assert.match(list, /<button type="button" onClick=\{showOlder\} aria-disabled=\{loadingMore \|\| undefined\}/);
    assert.doesNotMatch(list, /disabled=\{loadingMore\}/);
    assert.match(list, /function showOlder\(\) \{\s+if \(loadingMore\) return;\s+const shown = keys \? keys\.split\("\\n"\) : \[\];\s+if \(onLoadMore\(\)\) pressed\.current = \{ shown, from: "older" \};/);
    // Round 3c: the strength sessions' Try again shares the hand-off (tests/activity/older-strength-sessions.test.ts).
    assert.match(list, /const target = press\.from === "sessions" \? focusAfterSessionsRetry\(press\.shown, next, more\) : focusAfterOlder\(press\.shown, next, more\);\s+if \(!target \|\| !focusDropped\(document\)\) return;\s+if \(target === "older"\) olderButton\.current\?\.focus\(\);\s+else entryLink\(list\.current, target\)\?\.focus\(\);/);
    assert.match(list, /<ActivityCard key=\{entry\.key\} entryKey=\{entry\.key\}/);
    assert.match(list, /<StrengthRow key=\{entry\.key\} entryKey=\{entry\.key\}/);
    assert.match(list, /data-feed-entry=\{entryKey\}/);
    assert.match(read("src/components/activity/StrengthRow.tsx"), /data-feed-entry=\{entryKey\}/);
    // A failed page is said beside the button, where focus is.
    assert.match(list, /\{moreFailed && <p role="alert" className="mt-2 text-sm text-fitx-danger">Older activities couldn’t load\. Check your connection and try again\.<\/p>\}/);
  });

  test("the feed reads one older page at a time, drops a page read before a reload, and says when one fails", () => {
    const feed = read("src/components/activity/useActivityFeed.ts");
    assert.match(feed, /const loadMore = useCallback\(\(\): boolean => \{\s+if \(loadingMoreNow\.current \|\| !userId \|\| history\.status !== "ready"\) return false;/);
    assert.match(feed, /loadingMoreNow\.current = true;\s+const generation = historyGeneration\.current;/);
    assert.equal((feed.match(/if \(generation !== historyGeneration\.current\) return;/g) ?? []).length, 2);
    assert.match(feed, /else setMoreFailed\(true\);/);
    assert.match(feed, /\} finally \{\s+loadingMoreNow\.current = false;\s+setLoadingMore\(false\);/);
    assert.match(feed, /historyGeneration\.current \+= 1;\s+setMoreFailed\(false\);\s+setHistory\(\{ status: "loading" \}\);/);
    for (const screen of ["src/components/activity/ActivityHome.tsx", "src/components/activity/SportScreen.tsx"]) {
      const source = read(screen);
      assert.match(source, /moreFailed=\{feed\.moreFailed\}\s+onLoadMore=\{feed\.loadMore\}/, screen);
    }
  });
});

describe("the activity page: Save name, Upload now and Delete", () => {
  const page = read("src/components/activity/ActivityDetailScreen.tsx");

  test("each says aria-disabled while it saves, and a press meanwhile does nothing", () => {
    assert.match(page, /<button type="submit" aria-disabled=\{busy === "rename" \|\| undefined\}[^>]*aria-label="Save name"/);
    assert.match(page, /onClick=\{\(\) => void upload\(\)\} aria-disabled=\{busy === "upload" \|\| undefined\}/);
    assert.match(page, /onClick=\{\(\) => void remove\(\)\} aria-disabled=\{busy === "delete" \|\| undefined\}/);
    assert.match(page, /onClick=\{keep\} aria-disabled=\{busy === "delete" \|\| undefined\}/);
    assert.doesNotMatch(page, /(?<!aria-)disabled=\{busy/);
    assert.match(page, /if \(!view \|\| !userId \|\| view\.local \|\| busy === "rename"\) return;/);
    assert.match(page, /if \(!view \|\| !userId \|\| busy === "delete"\) return;\s+setBusy\("delete"\);/);
    assert.match(page, /function keep\(\) \{\s+if \(busy === "delete"\) return;/);
    // Uploading is marked before the device copy is read, so a quick second press can't start a second upload.
    assert.match(page, /if \(!view \|\| !userId \|\| busy === "upload"\) return;\s+setBusy\("upload"\);\s+const store = await recordingStore\(\);/);
  });

  test("a failed delete is said in its confirmation, beside Delete; a refused upload hands focus to the note that says why", () => {
    const confirmation = page.slice(page.indexOf('role="alertdialog" aria-labelledby="delete-question"'), page.indexOf("Delete activity</button>"));
    assert.match(confirmation, /\{deleteError && <p role="alert" className="text-sm text-fitx-danger">\{deleteError\}<\/p>\}/);
    assert.equal((page.match(/return setDeleteError\("This activity couldn’t be deleted/g) ?? []).length, 2);
    assert.doesNotMatch(page, /setMessage\("This activity couldn’t be deleted/);
    assert.match(page, /<p ref=\{deviceNoteRef\} tabIndex=\{-1\} className="flex gap-2">/);
    assert.match(page, /rejected: true \} : previous\)\);\s+setMessage\(""\);\s+\/\/ [^\n]*\n\s+window\.setTimeout\(\(\) => \{ if \(mayHandFocus\(document, uploadButtonRef\.current\)\) deviceNoteRef\.current\?\.focus\(\); \}, 0\);/);
    assert.match(page, /ref=\{uploadButtonRef\} onClick=\{\(\) => void upload\(\)\}/);
  });
});

// The same mistake elsewhere in the stream's files: each button stays focusable while it works (aria-disabled), with
// the guard that ignores a press meanwhile.
const cases: Array<[string, RegExp, RegExp]> = [
  ["src/components/activity/ActivityHome.tsx", /ref=\{uploadNowRef\} aria-disabled=\{syncing \|\| undefined\} onClick=\{\(\) => void syncNow\("upload"\)\}/, /async function syncNow\(from: "upload" \| "retry"\) \{\s+if \(!userId \|\| syncing\) return;/],
  ["src/components/activity/ActivityHome.tsx", /ref=\{retryRef\} onClick=\{\(\) => void syncNow\("retry"\)\} aria-disabled=\{syncing \|\| undefined\}/, /async function syncNow\(from: "upload" \| "retry"\) \{\s+if \(!userId \|\| syncing\) return;/],
  ["src/components/activity/ActivityHome.tsx", /onClick=\{\(\) => void deleteAll\(\)\} aria-disabled=\{deletingAll \|\| undefined\}[^>]*>.*\{deletingAll \? "Deleting…" : "Delete everything"\}/, /async function deleteAll\(\) \{\s+if \(!userId \|\| deletingAll\) return;/],
  ["src/components/activity/ActivityHome.tsx", /onClick=\{keepData\} aria-disabled=\{deletingAll \|\| undefined\}/, /function keepData\(\) \{\s+if \(deletingAll\) return;/],
  ["src/components/activity/FinishedResult.tsx", /onClick=\{\(\) => retry\.current\(\)\} aria-disabled=\{state\.busy \|\| undefined\}/, /if \(uploading\.current\) return;/],
  ["src/components/activity/ActivityRecorderScreen.tsx", /disabled=\{blocking \|\| !recorder \|\| snapshot\.elsewhere\} aria-disabled=\{starting \|\| undefined\} onClick=\{\(\) => void start\(\)\}/, /if \(!recorder \|\| account\.status !== "ready" \|\| starting\) return;/],
  ["src/components/activity/ActivityRecorderScreen.tsx", /aria-disabled=\{saving \|\| undefined\} onClick=\{\(\) => void finishRestored\(\)\}/, /async function finishRestored\(\) \{\s+if \(!recorder \|\| account\.status !== "ready" \|\| saving\) return;/],
  ["src/components/activity/ActivityRecorderScreen.tsx", /ref=\{retryUnsavedRef\} onClick=\{\(\) => void retryUnsaved\(\)\} aria-disabled=\{saving \|\| undefined\}/, /async function retryUnsaved\(\) \{\s+if \(!unsaved \|\| saving\) return;/],
  ["src/components/activity/ActivityRecorderScreen.tsx", /onClick=\{\(\) => void finish\(\)\} aria-disabled=\{saving \|\| undefined\}/, /async function finish\(\) \{\s+if \(!recorder \|\| account\.status !== "ready" \|\| saving\) return;/],
  ["src/components/activity/ActivityImportScreen.tsx", /onClick=\{\(\) => void importAll\(\)\} aria-disabled=\{importing \|\| reading \|\| toImport\.length === 0 \|\| undefined\}/, /if \(!userId \|\| importing \|\| reading \|\| lookupFailed \|\| toImport\.length === 0\) return;/],
  ["src/components/activity/ActivityImportScreen.tsx", /onChange=\{onPick\} aria-disabled=\{reading \|\| importing \|\| undefined\} onClick=\{\(event\) => \{ if \(reading \|\| importing\) event\.preventDefault\(\); \}\}/, /if \(!files\.length \|\| reading \|\| importing\) return;/],
  ["src/app/(dashboard)/progress/BodySection.tsx", /aria-disabled=\{syncing \|\| undefined\} onClick=\{\(\) => void retrySync\(\)\}/, /if \(unsyncedKg === null \|\| syncing\) return;/],
  ["src/app/(dashboard)/progress/BodySection.tsx", /<button aria-disabled=\{saving \|\| undefined\}[^>]*>\{saving \? "Saving…" : "Save"\}/, /if \(savingNow\.current\) return;[\s\S]*?savingNow\.current = true;\s+setSaving\(true\);/],
  ["src/components/home/GoalEditor.tsx", /form="goal-editor-form"[^>]*aria-disabled=\{saving \|\| undefined\}/, /if \(!draft \|\| savingNow\.current\) return;[\s\S]*?savingNow\.current = true;\s+setSaving\(true\);/],
  // Not busy, but disabled in the member's hand all the same: the arrow that reaches the newest or the oldest period.
  ["src/components/progress/ProgressAnalytics.tsx", /onClick=\{\(\) => \{ if \(!atOldest\) setOffset\(\(value\) => Math\.max\(-MAX_BACK\[kind\], value - 1\)\); \}\} aria-disabled=\{atOldest \|\| undefined\} aria-label=\{`Previous \$\{kind\}`\}/, /const atOldest = offset <= -MAX_BACK\[kind\];/],
  ["src/components/progress/ProgressAnalytics.tsx", /onClick=\{\(\) => \{ if \(!atNewest\) setOffset\(\(value\) => Math\.min\(0, value \+ 1\)\); \}\} aria-disabled=\{atNewest \|\| undefined\} aria-label=\{`Next \$\{kind\}`\}/, /const atNewest = offset >= 0;/],
];

describe("the same mistake elsewhere in the stream's files", () => {
  for (const [file, button, guard] of cases) {
    test(`${file.split("/").pop()}: ${button.source.slice(0, 70)}…`, () => {
      const source = read(file);
      assert.match(source, button);
      assert.match(source, guard);
    });
  }

  test("a control that goes once it has done its job hands focus on", () => {
    const home = read("src/components/activity/ActivityHome.tsx");
    // Upload now's banner and Try again's alert are drawn again while the history reloads: back to the button if it is
    // still there, else the list it led to. Round 3d: the same once either went with focus by itself (the "online"
    // reload); bannerFocusAfterReload decides (tests/activity/reload-focus.test.ts).
    assert.match(home, /const target = bannerFocusAfterReload\(document, \{\s+pressed,[\s\S]*?\}\);\s+if \(target\) \(target === "list" \? feedTitleRef\.current : target === "upload" \? uploadNowButton\(\) : retryButton\(\)\)\?\.focus\(\);/);
    assert.match(home, /<h2 id="feed-title" ref=\{feedTitleRef\} tabIndex=\{-1\}/);
    // Delete everything: a failure in the confirmation, the result under the button that opened it, which takes focus.
    const confirmation = home.slice(home.indexOf('aria-labelledby="delete-all-question"'), home.indexOf("Delete all activity data</button>"));
    assert.match(confirmation, /\{deleteAllError && <p role="alert" className="mt-2 text-sm text-fitx-danger">\{deleteAllError\}<\/p>\}/);
    assert.match(home, /setDeleteAllError\("Your activities couldn’t be deleted\. Check your connection and try again\."\);/);
    assert.doesNotMatch(home, /setNotice\("Your activities couldn’t be deleted/, "a failure is never shown as a success");
    assert.match(home, /Delete all activity data<\/button>\s+\)\}\s+\{\/\*[^*]*\*\/\}\s+<p role="status" className=\{notice \? "fitx-alert fitx-alert-success mt-3" : "sr-only"\}>\{notice\}<\/p>/);
    assert.match(home, /refocusDeleteAll\.current = true;\s+setConfirmDeleteAll\(false\);\s+setNotice\(result\.status === "unavailable"/);
    assert.match(home, /function keepData\(\) \{\s+if \(deletingAll\) return;\s+refocusDeleteAll\.current = true;\s+setConfirmDeleteAll\(false\);/);
    assert.match(home, /if \(confirmDeleteAll \|\| !refocusDeleteAll\.current\) return;\s+refocusDeleteAll\.current = false;\s+if \(focusDropped\(document\)\) deleteAllTriggerRef\.current\?\.focus\(\);/);
    // The Record screen: Start and Resume hand focus to the recording controls, a finish that couldn't be saved to its
    // Try again, and a finish that failed back to Finish.
    const recorder = read("src/components/activity/ActivityRecorderScreen.tsx");
    assert.match(recorder, /const controlsShown = \(phase === "recording" \|\| phase === "paused"\) && stats !== null;\s+useEffect\(\(\) => \{\s+if \(!controlsShown \|\| !focusControls\.current\) return;\s+focusControls\.current = false;\s+if \(focusDropped\(document\)\) mainControlRef\.current\?\.focus\(\);/);
    assert.match(recorder, /setError\(""\);\s+focusControls\.current = true;\s+try \{\s+await recorder\.start\(/);
    assert.match(recorder, /focusControls\.current = true;\s+await recorder\.resumeRestored\(/);
    assert.match(recorder, /label="Pause"[^\n]*buttonRef=\{mainControlRef\}/);
    assert.match(recorder, /label="Resume"[^\n]*buttonRef=\{mainControlRef\}/);
    assert.match(recorder, /if \(unsaved && focusDropped\(document\)\) retryUnsavedRef\.current\?\.focus\(\);/);
    assert.match(recorder, /setError\("This activity could not be finished\. Try again\."\);\s+\/\/[^\n]*\n\s+window\.setTimeout\(\(\) => \{ if \(focusDropped\(document\)\) finishTriggerRef\.current\?\.focus\(\); \}, 0\);/);
    // A finished activity's own page: a refused upload hands focus to the note that says why; a try that didn't
    // upload is read out while focus stays on Upload now. Round 3d: a refused try that came by itself (back online)
    // does so too when Upload now had focus.
    const finished = read("src/components/activity/FinishedResult.tsx");
    assert.match(finished, /const handOn = next === "rejected" && \(manual \|\| hasFocus\(document, uploadButtonRef\.current\)\);\s+setState\(\{ reason: next, busy: false, note: manual \? "Not uploaded yet\." : "" \}\);\s+if \(handOn\) window\.setTimeout\(\(\) => \{ if \(mayHandFocus\(document, uploadButtonRef\.current\)\) noteRef\.current\?\.focus\(\); \}, 0\);/);
    assert.match(finished, /ref=\{uploadButtonRef\} onClick=\{\(\) => retry\.current\(\)\}/);
    assert.match(finished, /<p ref=\{noteRef\} tabIndex=\{-1\} role="status"/);
    // Progress > Weight: once the profile weight is saved, the notice goes and the card's heading takes focus.
    const body = read("src/app/(dashboard)/progress/BodySection.tsx");
    assert.match(body, /notifyUserContextChanged\(\);\s+\/\/[^\n]*\n\s+window\.setTimeout\(\(\) => \{ if \(mayHandFocus\(document, retryRef\.current\)\) titleRef\.current\?\.focus\(\); \}, 0\);/);
    assert.match(body, /<button type="button" ref=\{retryRef\}/);
    assert.match(body, /<h2 id="body-title" ref=\{titleRef\} tabIndex=\{-1\}/);
    // The period arrows are styled by aria-disabled now, not :disabled.
    const css = read("src/components/progress/Progress.module.css");
    assert.match(css, /\.periodButton\[aria-disabled="true"\] \{ color: var\(--fitx-text-disabled\); cursor: not-allowed; \}/);
    assert.doesNotMatch(css, /\.periodButton:disabled/);
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
  const roots = ["src/app/(dashboard)/activity", "src/components/activity", "src/app/(dashboard)/progress", "src/components/progress", "src/app/(dashboard)/goals"];
  const goalFiles = ["src/components/home/GoalsPanel.tsx", "src/components/home/GoalEditor.tsx"];
  const busyDisabled = /(?<!aria-)disabled=\{[^}]*\b(saving|busy|loading\w*|starting|syncing|importing|reading|deleting\w*|uploading|pending|submitting)\b[^}]*\}/;
  const found = [...roots.flatMap(files), ...goalFiles].flatMap((file) => read(file).split("\n").flatMap((line, index) => (busyDisabled.test(line) ? [`${file}:${index + 1}`] : [])));
  assert.deepEqual(found, []);
});
