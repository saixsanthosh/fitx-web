// Release 3 fix round 3c (open item from round 3a): in the Activity timeline, a page of strength sessions that failed
// to load stopped the sessions there without a word (deliberately, so older activities never wait on them). Older
// activities still don't wait, but the list now says so under it, with Try again. Try again reads on from the last
// session until the sessions reach the oldest entry already shown, so nothing on screen is held back again, and focus
// moves to the first entry it brought (D5).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ActivityView } from "@/lib/activity/repository";
import type { StrengthSession } from "@/lib/activity/strength";
import { focusAfterSessionsRetry, mergeTimeline, nextToLoad, readSessionsOn, sessionsBehind, shownFloor } from "@/lib/activity/timeline";

const read = (file: string) => readFileSync(file, "utf8");
const view = (startedAt: number): ActivityView => ({
  id: `a-${startedAt}`, clientId: `c-${startedAt}`, sport: "walk", title: "Walk", startedAt, endedAt: startedAt + 1000, elapsedSeconds: 1, movingSeconds: 1, pausedSeconds: 0,
  distanceM: 10, avgSpeedMps: null, maxSpeedMps: null, avgPaceSecondsPerKm: null, elevationGainM: null, kcal: null, kcalMethod: null, weightKg: null, gapCount: 0, gapSeconds: 0,
  splits: [], gaps: [], timeline: [], routePolyline: "", sharePolyline: "", shareBbox: null, pointCount: 0, chunkCount: 0, local: false,
  source: "fitx_gps", sourceFormat: null, sourceDevice: null, importedAt: null,
});
const session = (startedAt: number): StrengthSession => ({ id: `s-${startedAt}`, name: "Push day", startedAt, completedAt: startedAt + 3600_000, trainingSeconds: 3000, volumeKg: 4200 });
const keys = (timeline: ReturnType<typeof mergeTimeline>) => timeline.entries.map((entry) => entry.key);

/** The database's strength sessions, newest first, read as listStrengthSessions does (`before`, a page size), with failures to order. */
function sessionsServer(all: StrengthSession[], pageSize: number) {
  const failures = new Set<number>();
  let calls = 0;
  return {
    failOn: (call: number) => failures.add(call),
    get calls() { return calls; },
    read: async (before: number | null) => {
      calls += 1;
      if (failures.has(calls)) return null;
      return all.filter((item) => before === null || item.startedAt < before).slice(0, pageSize);
    },
  };
}
const always = { maxPages: 50, stillWanted: () => true };

describe("the rules", () => {
  test("the floor is the oldest entry shown; sessions are behind while they have more and are newer than it", () => {
    assert.equal(shownFloor([]), null);
    assert.equal(shownFloor([{ startedAt: 90 }, { startedAt: 40 }]), 40);
    assert.equal(sessionsBehind(true, 60, 40), true);
    assert.equal(sessionsBehind(true, 40, 40), false, "an entry at the floor stays shown");
    assert.equal(sessionsBehind(false, 60, 40), false, "no more sessions");
    assert.equal(sessionsBehind(true, 60, null), false, "nothing shown: one page will do");
  });

  test("after Try again: the first entry it brought, else Show older activities, else the last entry", () => {
    assert.equal(focusAfterSessionsRetry(["a", "b"], ["a", "s", "b"], true), "s");
    assert.equal(focusAfterSessionsRetry(["a", "b"], ["a", "b"], true), "older");
    assert.equal(focusAfterSessionsRetry(["a", "b"], ["a", "b"], false), "b");
    assert.equal(focusAfterSessionsRetry([], [], false), null);
  });
});

describe("a failed page of strength sessions, then Try again", () => {
  // A page is 3 here (20 in the app). Walks every 10, sessions every 10 in between, newest first.
  const PAGE = 3;
  const walks = [100, 90, 80, 70, 60, 50, 40, 30, 20].map(view);
  const strength = [95, 85, 75, 65, 55, 45, 35, 25, 15].map(session);

  test("older activities still show without waiting; Try again brings the missing sessions back in place, nothing shown goes", async () => {
    const activities = { items: walks.slice(0, 3), more: true };
    const first = { items: strength.slice(0, 3), more: true };
    // The walks' and sessions' first pages: down to 80 (the 75 session waits for the walks' next page, 80 ≥ 75).
    assert.deepEqual(keys(mergeTimeline(activities, first)), ["activity-a-100", "strength-s-95", "activity-a-90", "strength-s-85", "activity-a-80"]);
    assert.equal(nextToLoad(activities, first), "activities");
    const moreWalks = { items: walks.slice(0, 6), more: true };
    assert.equal(nextToLoad(moreWalks, first), "sessions", "the sessions hold the timeline back now");
    // That page of sessions fails: they stop holding older entries back (more: false), and the list says so.
    const stopped = { items: first.items, more: false };
    const shown = keys(mergeTimeline(moreWalks, stopped));
    assert.deepEqual(shown, ["activity-a-100", "strength-s-95", "activity-a-90", "strength-s-85", "activity-a-80", "strength-s-75", "activity-a-70", "activity-a-60", "activity-a-50"]);
    // The member goes on with Show older activities meanwhile.
    const evenMore = { items: walks.slice(0, 8), more: true };
    const before = mergeTimeline(evenMore, stopped);
    assert.equal(nextToLoad(evenMore, stopped), "activities");
    assert.equal(shownFloor(before.entries), 30);

    // Try again: page after page until the sessions reach the oldest walk shown (30).
    const server = sessionsServer(strength, PAGE);
    const result = await readSessionsOn(stopped.items, shownFloor(before.entries), PAGE, server.read, always);
    assert.ok(result && !result.failed);
    assert.deepEqual(result.items.map((item) => item.startedAt), [95, 85, 75, 65, 55, 45, 35, 25, 15]);
    assert.equal(server.calls, 2, "two pages: 65-45, then 35-15 (past the floor)");
    const after = mergeTimeline(evenMore, { items: result.items, more: result.more });
    for (const key of keys(before)) assert.ok(keys(after).includes(key), `${key} is still shown`);
    assert.deepEqual(keys(after).slice(0, 13), ["activity-a-100", "strength-s-95", "activity-a-90", "strength-s-85", "activity-a-80", "strength-s-75", "activity-a-70", "strength-s-65", "activity-a-60", "strength-s-55", "activity-a-50", "strength-s-45", "activity-a-40"]);
    // Focus goes to the first session it brought (the newest of them), where the list was missing them.
    assert.equal(focusAfterSessionsRetry(keys(before), keys(after), after.more), "strength-s-65");
  });

  test("one page is enough when it already reaches the oldest entry shown", async () => {
    const server = sessionsServer(strength, PAGE);
    const result = await readSessionsOn(strength.slice(0, 3), 70, PAGE, server.read, always);
    assert.deepEqual([result?.items.length, result?.more, server.calls], [6, true, 1]);
  });

  test("the first page failed: Try again reads from the newest session", async () => {
    const server = sessionsServer(strength, PAGE);
    const result = await readSessionsOn([], 80, PAGE, server.read, always);
    assert.deepEqual(result?.items.map((item) => item.startedAt), [95, 85, 75]);
    assert.equal(result?.failed, false);
  });

  test("a page that fails again keeps what was read and says so; a list read again meanwhile drops the result", async () => {
    const server = sessionsServer(strength, PAGE);
    server.failOn(2);
    const partial = await readSessionsOn(strength.slice(0, 3), 20, PAGE, server.read, always);
    assert.deepEqual([partial?.items.length, partial?.more, partial?.failed], [6, false, true]);
    const dropped = await readSessionsOn(strength.slice(0, 3), 20, PAGE, sessionsServer(strength, PAGE).read, { maxPages: 50, stillWanted: () => false });
    assert.equal(dropped, null);
  });

  test("a server that ignores `before` can't keep Try again reading for ever", async () => {
    let calls = 0;
    const same = async () => { calls += 1; return strength.slice(0, 3); };
    const result = await readSessionsOn([session(500)], 0, 3, same, { maxPages: 4, stillWanted: () => true });
    assert.equal(calls, 4);
    assert.equal(result?.failed, false);
  });
});

describe("the screens", () => {
  test("the feed says which page failed and reads again with Try again", () => {
    const feed = read("src/components/activity/useActivityFeed.ts");
    assert.match(feed, /else setSessions\(\{ \.\.\.sessions, more: false, failed: \{ kind: "older", attempt: 0 \} \}\);/);
    assert.match(feed, /else setSessions\(\{ status: "ready", items: \[\], more: false, failed: \{ kind: "first", attempt: 0 \} \}\);/);
    assert.match(feed, /if \(!strength \|\| strength\.status === "unavailable"\) setSessions\(NO_SESSIONS\);/, "no sessions table: nothing is missing");
    assert.match(feed, /const retrySessions = \(\): boolean => \{\s+const failed = sessions\.failed;\s+if \(!failed \|\| loadingMoreNow\.current \|\| !userId \|\| history\.status !== "ready"\) return false;/);
    assert.match(feed, /const floor = shownFloor\(timeline\.entries\);/);
    assert.match(feed, /readSessionsOn\(sessions\.items, floor, PAGE, read, \{ maxPages: MAX_RETRY_PAGES, stillWanted: \(\) => generation === historyGeneration\.current \}\)/);
    assert.match(feed, /failed: \{ kind: result\.items\.length \? "older" : "first", attempt: failed\.attempt \+ 1 \}/);
    assert.match(feed, /sessionsFailed: sessions\.failed, retrySessions,/);
  });

  test("the list says so under it, with Try again that stays focusable while it reads", () => {
    const list = read("src/components/activity/FeedList.tsx");
    assert.match(list, /\{failed\.kind === "first" \? "Strength sessions couldn’t load here\. They’re in Workouts\." : "Older strength sessions couldn’t load\. They’re in Workouts\."\}/);
    assert.match(list, /<p key=\{failed\.attempt\} role=\{failed\.kind === "older" \|\| failed\.attempt > 0 \? "alert" : undefined\}/);
    assert.match(list, /<button type="button" onClick=\{onRetry\} aria-disabled=\{busy \|\| undefined\}[^\n]*Try again<\/button>/);
    assert.match(list, /if \(onRetrySessions\(\)\) pressed\.current = \{ shown, from: "sessions" \};/);
    // Under the list in both of its states: with entries, and with none yet.
    assert.equal((list.match(/\{sessionsLine\}/g) ?? []).length, 2);
    const home = read("src/components/activity/ActivityHome.tsx");
    assert.match(home, /sessionsFailed=\{feed\.sessionsFailed\}\s+onRetrySessions=\{feed\.retrySessions\}/);
    assert.doesNotMatch(home, /Strength sessions couldn’t load here/, "said by the list itself now");
  });
});
