// Review a11y-activity-busy-buttons-still-disabled (D5, the cause of bug 84): a button disabled while its action runs
// drops keyboard focus to the page in Chrome, and focus never comes back. Activity's buttons stay focusable while
// busy (aria-disabled) and ignore a press meanwhile; a control that goes once its action is done hands focus on.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ActivityView } from "@/lib/activity/repository";
import type { StrengthSession } from "@/lib/activity/strength";
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
    assert.match(list, /function showOlder\(\) \{\s+if \(loadingMore\) return;\s+const shown = keys \? keys\.split\("\\n"\) : \[\];\s+if \(onLoadMore\(\)\) pressed\.current = \{ shown \};/);
    assert.match(list, /const target = focusAfterOlder\(press\.shown, keys \? keys\.split\("\\n"\) : \[\], more\);\s+if \(target\) entryLink\(list\.current, target\)\?\.focus\(\);/);
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
    assert.match(page, /rejected: true \} : previous\)\);\s+setMessage\(""\);\s+\/\/ [^\n]*\n\s+window\.setTimeout\(\(\) => deviceNoteRef\.current\?\.focus\(\), 0\);/);
  });
});
