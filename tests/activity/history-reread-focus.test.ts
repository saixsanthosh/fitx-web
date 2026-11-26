// Release 3 fix round 3e (round 3d's open item 2, D5): the "online" reload, and Upload now and a sport page's figures'
// Try again, read Activity's history again from its first page and drew the list from its loading state, so focus on
// an entry, on "Show older activities" or on the strength sessions' Try again fell to the page, and every older page
// went for good. Now the list stays on screen while it is read again, as far back as it shows, and is swapped in at
// once, with what this device holds: what had focus is still there. What still goes with focus (an entry gone from the
// account, a button no longer needed, a list drawn from its loading state) hands focus on: to the same entry or the
// entry it became, the button, the first session the read brought, else the list heading. Choosing a sport, and
// Delete everything, still draw the list from its loading state.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { listFocusWitness, type FocusDocument, type ListControl } from "@/lib/activity/focus";
import type { ActivityView, DbResult } from "@/lib/activity/repository";
import type { StrengthSession } from "@/lib/activity/strength";
import { focusAfterReread, mergeTimeline, readListAgain, shownFloor, type TimelineEntry } from "@/lib/activity/timeline";

const read = (file: string) => readFileSync(file, "utf8");
const view = (startedAt: number, local = false): ActivityView => ({
  id: local ? null : `a-${startedAt}`, clientId: `c-${startedAt}`, sport: "walk", title: "Walk", startedAt, endedAt: startedAt + 1000, elapsedSeconds: 1, movingSeconds: 1, pausedSeconds: 0,
  distanceM: 10, avgSpeedMps: null, maxSpeedMps: null, avgPaceSecondsPerKm: null, elevationGainM: null, kcal: null, kcalMethod: null, weightKg: null, gapCount: 0, gapSeconds: 0,
  splits: [], gaps: [], timeline: [], routePolyline: "", sharePolyline: "", shareBbox: null, pointCount: 0, chunkCount: 0, local,
  source: "fitx_gps", sourceFormat: null, sourceDevice: null, importedAt: null,
});
const session = (startedAt: number): StrengthSession => ({ id: `s-${startedAt}`, name: "Push day", startedAt, completedAt: startedAt + 3600_000, trainingSeconds: 3000, volumeKg: 4200 });
const keys = (entries: readonly TimelineEntry[]) => entries.map((entry) => entry.key);

/** The database, newest first, read a page at a time as listActivities and listStrengthSessions do, with failures to order. */
function server<T extends { startedAt: number }>(all: T[], pageSize: number) {
  const failures = new Map<number, DbResult<T[]>>();
  let calls = 0;
  return {
    failOn: (call: number, result: DbResult<T[]>) => failures.set(call, result),
    get calls() { return calls; },
    read: async (before: number | null): Promise<DbResult<T[]>> => {
      calls += 1;
      return failures.get(calls) ?? { status: "ok", data: all.filter((item) => before === null || item.startedAt < before).slice(0, pageSize) };
    },
  };
}
const OFFLINE = { status: "error", message: "Failed to fetch", offline: true } as const;
const always = { maxPages: 50, stillWanted: () => true };
// A page is 3 here (20 in the app). Walks every 10, newest first.
const PAGE = 3;
const walks = [100, 90, 80, 70, 60, 50, 40, 30, 20].map((at) => view(at));

describe("the list on screen, read again as far back as it shows", () => {
  test("two pages shown, and a walk saved meanwhile: read down to the oldest entry shown, so nothing on screen goes", async () => {
    // The member pressed Show older activities once: 100-50 are shown, with more to come.
    const before = mergeTimeline({ items: walks.slice(0, 6), more: true }, { items: [], more: false });
    assert.equal(shownFloor(before.entries), 50);
    const db = server([view(110), ...walks], PAGE);
    const again = await readListAgain(db.read, shownFloor(before.entries), PAGE, always);
    assert.ok(again && again.status === "ok");
    assert.deepEqual(again.items.map((item) => item.startedAt), [110, 100, 90, 80, 70, 60, 50, 40, 30]);
    assert.deepEqual([again.more, again.olderFailed, db.calls], [true, false, 3]);
    const after = mergeTimeline({ items: again.items, more: again.more }, { items: [], more: false });
    for (const key of keys(before.entries)) assert.ok(keys(after.entries).includes(key), `${key} is still shown`);
    assert.equal(keys(after.entries)[0], "activity-a-110", "and the new walk is at the top");
    // What the reload did before: the first page only, so 80 to 50 went, and focus on any of them with them.
    const firstPageOnly = mergeTimeline({ items: [view(110), ...walks].slice(0, PAGE), more: true }, { items: [], more: false });
    assert.equal(keys(firstPageOnly.entries).includes("activity-a-60"), false);
  });

  test("one page when the list shows only its first; one page when it shows nothing yet", async () => {
    const db = server(walks, PAGE);
    const again = await readListAgain(db.read, 80, PAGE, always);
    assert.deepEqual([again?.status, db.calls], ["ok", 1]);
    const empty = server<ActivityView>([], PAGE);
    assert.deepEqual(await readListAgain(empty.read, null, PAGE, always), { status: "ok", items: [], more: false, olderFailed: false });
    assert.equal(empty.calls, 1);
  });

  test("the first page fails: the list couldn't be read, and says whether it was the connection", async () => {
    const db = server(walks, PAGE);
    db.failOn(1, OFFLINE);
    assert.deepEqual(await readListAgain(db.read, 50, PAGE, always), { status: "failed", result: OFFLINE });
    const missing = server(walks, PAGE);
    missing.failOn(1, { status: "unavailable" });
    assert.deepEqual(await readListAgain(missing.read, 50, PAGE, always), { status: "failed", result: { status: "unavailable" } });
  });

  test("a later page fails: what was read stays, with more to come (said beside Show older activities)", async () => {
    const db = server(walks, PAGE);
    db.failOn(2, OFFLINE);
    const again = await readListAgain(db.read, 50, PAGE, always);
    assert.ok(again && again.status === "ok");
    assert.deepEqual([again.items.length, again.more, again.olderFailed], [3, true, true]);
  });

  test("another reload, or a sport chosen, meanwhile: the read is dropped; a server that ignores `before` can't keep it reading", async () => {
    assert.equal(await readListAgain(server(walks, PAGE).read, 50, PAGE, { maxPages: 50, stillWanted: () => false }), null);
    let calls = 0;
    const same = async (): Promise<DbResult<ActivityView[]>> => { calls += 1; return { status: "ok", data: walks.slice(0, PAGE) }; };
    const again = await readListAgain(same, 0, PAGE, { maxPages: 4, stillWanted: () => true });
    assert.equal(calls, 4);
    assert.deepEqual([again?.status, again?.status === "ok" && again.more], ["ok", true]);
  });

  test("strength sessions that couldn't load are read again down to the oldest entry shown: back in place, nothing held back", async () => {
    // Older sessions failed (round 3c): they stopped holding the walks back, so walks down to 30 show without them.
    const strength = [95, 85, 75, 65, 55, 45, 35, 25].map(session);
    const shown = mergeTimeline({ items: walks.slice(0, 8), more: true }, { items: strength.slice(0, 3), more: false });
    assert.equal(shownFloor(shown.entries), 30);
    const [activities, sessions] = await Promise.all([
      readListAgain(server(walks, PAGE).read, 30, PAGE, always),
      readListAgain(server(strength, PAGE).read, 30, PAGE, always),
    ]);
    assert.ok(activities?.status === "ok" && sessions?.status === "ok");
    const after = mergeTimeline({ items: activities.items, more: activities.more }, { items: sessions.items, more: sessions.more });
    for (const key of keys(shown.entries)) assert.ok(keys(after.entries).includes(key), `${key} is still shown`);
    assert.ok(keys(after.entries).includes("strength-s-65"), "the sessions that were missing are back in place");
    // Their Try again had focus and went with the line: the first session the read brought takes it.
    assert.equal(focusAfterReread({ control: "sessions" }, { before: shown.entries, after: after.entries, more: after.more, sessionsShown: false }), "strength-s-65");
  });
});

describe("where focus goes when what had it went with the list", () => {
  const list = mergeTimeline({ items: [view(100), view(90), view(80)], more: true }, { items: [session(85)], more: false });

  test("an entry: the same one; one kept on this device and uploaded meanwhile, as the saved entry it became; else the list heading", () => {
    assert.equal(focusAfterReread({ entry: "activity-a-90" }, { before: list.entries, after: list.entries, more: true, sessionsShown: false }), "activity-a-90", "drawn again from the loading state");
    const onDevice = mergeTimeline({ items: [view(100), view(90)], more: true }, { items: [], more: false }, [view(95, true)]);
    assert.equal(keys(onDevice.entries)[1], "local-c-95");
    const uploaded = mergeTimeline({ items: [view(100), view(95), view(90)], more: true }, { items: [], more: false });
    assert.equal(focusAfterReread({ entry: "local-c-95" }, { before: onDevice.entries, after: uploaded.entries, more: true, sessionsShown: false }), "activity-a-95");
    const deleted = mergeTimeline({ items: [view(100), view(80)], more: true }, { items: [session(85)], more: false });
    assert.equal(focusAfterReread({ entry: "activity-a-90" }, { before: list.entries, after: deleted.entries, more: true, sessionsShown: false }), "list", "deleted on another device");
    assert.equal(focusAfterReread({ entry: "strength-s-85" }, { before: list.entries, after: deleted.entries, more: true, sessionsShown: false }), "strength-s-85");
  });

  test("Show older activities: itself while it is shown, else the last entry, else the list heading", () => {
    assert.equal(focusAfterReread({ control: "older" }, { before: list.entries, after: list.entries, more: true, sessionsShown: false }), "older");
    assert.equal(focusAfterReread({ control: "older" }, { before: list.entries, after: list.entries, more: false, sessionsShown: false }), "activity-a-80");
    assert.equal(focusAfterReread({ control: "older" }, { before: list.entries, after: [], more: false, sessionsShown: false }), "list");
  });

  test("the sessions' Try again: itself while its line is shown; else the first session brought, never a new walk at the top", () => {
    const withoutSessions = mergeTimeline({ items: [view(100), view(90), view(80)], more: true }, { items: [], more: false });
    assert.equal(focusAfterReread({ control: "sessions" }, { before: withoutSessions.entries, after: withoutSessions.entries, more: true, sessionsShown: true }), "sessions", "still couldn't load");
    const brought = mergeTimeline({ items: [view(110), view(100), view(90), view(80)], more: true }, { items: [session(85)], more: false });
    assert.equal(focusAfterReread({ control: "sessions" }, { before: withoutSessions.entries, after: brought.entries, more: true, sessionsShown: false }), "strength-s-85");
    // None to bring (there are none): Show older activities, else the last entry.
    assert.equal(focusAfterReread({ control: "sessions" }, { before: withoutSessions.entries, after: withoutSessions.entries, more: true, sessionsShown: false }), "older");
    assert.equal(focusAfterReread({ control: "sessions" }, { before: withoutSessions.entries, after: withoutSessions.entries, more: false, sessionsShown: false }), "activity-a-80");
  });
});

describe("the witness: one ref for every entry and button in the list", () => {
  function page() {
    const body = { name: "the page" };
    const doc: FocusDocument = { activeElement: body, body };
    const control = (dataset: ListControl["dataset"]) => ({ ownerDocument: doc, isConnected: true, dataset });
    /** React takes the ref away while the control is still on the page and focused, then takes the control out. */
    const takeAway = (element: { isConnected: boolean }, cleanup: (() => void) | undefined) => {
      cleanup?.();
      element.isConnected = false;
      if (doc.activeElement === element) doc.activeElement = body;
    };
    return { doc, control, takeAway };
  }

  test("an entry that goes with focus is told once, by its key", () => {
    const { doc, control, takeAway } = page();
    const witness = listFocusWitness();
    const link = control({ feedEntry: "activity-a-90" });
    const cleanup = witness.ref(link);
    doc.activeElement = link;
    takeAway(link, cleanup);
    assert.deepEqual(witness.take(), { entry: "activity-a-90" });
    assert.equal(witness.take(), null, "said once, then forgotten");
  });

  test("the list's buttons say which they are", () => {
    for (const name of ["older", "sessions"] as const) {
      const { doc, control, takeAway } = page();
      const witness = listFocusWitness();
      const button = control({ feedControl: name });
      const cleanup = witness.ref(button);
      doc.activeElement = button;
      takeAway(button, cleanup);
      assert.deepEqual(witness.take(), { control: name });
    }
  });

  test("nothing is said for a control that went without focus, one still on the page (its ref given again), or one it doesn't know", () => {
    const { doc, control, takeAway } = page();
    const witness = listFocusWitness();
    const link = control({ feedEntry: "activity-a-90" });
    takeAway(link, witness.ref(link));
    assert.equal(witness.take(), null, "focus was on the page all along");
    // A link's ref is given again when its address changes: the ref goes and comes back, the link stays with focus.
    const kept = control({ feedEntry: "activity-a-80" });
    const cleanup = witness.ref(kept);
    doc.activeElement = kept;
    cleanup?.();
    witness.ref(kept);
    assert.equal(witness.take(), null);
    assert.equal(doc.activeElement, kept);
    const other = control({});
    const otherCleanup = witness.ref(other);
    doc.activeElement = other;
    takeAway(other, otherCleanup);
    assert.equal(witness.take(), null);
    assert.equal(witness.ref(null), undefined, "nothing to clean up for no control");
  });
});

test("Next's Link hands a ref function's cleanup on, so the witness sees a card's link go", () => {
  // The cards are <Link>s: Link merges the member's ref with its own (use-merged-ref) and must keep the cleanup a ref
  // function returns, which runs while the link is still on the page (tests/activity/reload-focus.test.ts checks React).
  const merged = read("node_modules/next/dist/client/use-merged-ref.js");
  assert.match(merged, /const cleanup = refA\(current\);\s+if \(typeof cleanup === 'function'\) \{\s+return cleanup;/);
  assert.match(merged, /if \(current === null\) \{\s+const cleanupFnA = cleanupA\.current;[\s\S]*?cleanupFnB\(\);/);
  const link = read("node_modules/next/dist/client/app-dir/link.js");
  assert.match(link, /ref: forwardedRef/);
  assert.match(link, /useMergedRef\)\(observeLinkVisibilityOnMount, childRef\)/);
  assert.match(link, /const childRef = legacyBehavior \? [^:]+: forwardedRef;/);
});

describe("the screens' wiring", () => {
  const feed = read("src/components/activity/useActivityFeed.ts");
  const reread = feed.slice(feed.indexOf("const rereadHistory = useCallback"), feed.indexOf("const load = useCallback"));

  test("a reload reads the list on screen again in place; a list not shown yet, or Delete everything, from its loading state", () => {
    assert.match(feed, /const inPlace = keepList && shownFor\.current === which;\s+if \(!inPlace\) \{\s+setLocal\(recordings\);\s+setNow\(time\);\s+\}/);
    assert.match(feed, /inPlace \? rereadHistory\(uid, which, shownFloorRef\.current, \{ load: thisLoad, recordings, time \}\) : loadHistory\(uid, which\),/);
    assert.match(feed, /const load = useCallback\(async \(uid: string, keepList = true\) => \{/);
    // In place: never the loading state; both lists read down to the oldest entry shown.
    assert.ok(reread.length > 0);
    assert.doesNotMatch(reread, /status: "loading"/);
    assert.match(reread, /readListAgain\(\(before\) => listActivities\(supabase, uid, \{ limit: PAGE, before, sport \}\), floor, PAGE, options\)/);
    assert.match(reread, /readListAgain\(\(before\) => listStrengthSessions\(supabase, uid, \{ limit: PAGE, before \}\), floor, PAGE, options\)/);
    // What this device holds is shown with the list read again (only from the latest reload), so an uploaded activity
    // never leaves the list and comes back.
    assert.match(reread, /if \(held\.load === loads\.current\) \{\s+setLocal\(held\.recordings\);\s+setNow\(held\.time\);\s+\}/);
    assert.match(reread, /rereadingNow\.current = true;\s+setRereading\(true\);/);
    assert.match(reread, /if \(generation !== historyGeneration\.current\) return;\s+rereadingNow\.current = false;\s+setRereading\(false\);/);
    assert.match(feed, /const oldestShown = shownFloor\(timeline\.entries\);\s+useEffect\(\(\) => \{\s+shownFloorRef\.current = oldestShown;\s+\}, \[oldestShown\]\);/);
    // A list drawn from its loading state ends a reread, and is the one shown once read.
    assert.match(feed, /setHistory\(\{ status: "loading" \}\);\s+(\/\/[^\n]*\n\s+)*shownFor\.current = null;\s+rereadingNow\.current = false;\s+setRereading\(false\);/);
    assert.match(feed, /if \(list\.status === "ok"\) shownFor\.current = which;/);
    // Choosing a sport still draws the list from its loading state; back online reads in place.
    assert.match(feed, /window\.setTimeout\(\(\) => void loadHistory\(userId, filter\), 0\)/);
    assert.match(feed, /const retry = \(\) => void load\(userId\);/);
    // Show older activities and the sessions' Try again say Loading… and wait meanwhile.
    assert.match(feed, /loadingMore: loadingMore \|\| rereading,/);
    const home = read("src/components/activity/ActivityHome.tsx");
    assert.match(home, /\/\/ Read again from the loading state, not in place: what the list showed is gone\.\s+await feed\.reload\(userId, false\);/);
    assert.match(home, /async function syncNow\(from: "upload" \| "retry"\) \{[\s\S]*?await feed\.reload\(userId\);/);
    assert.match(read("src/components/activity/SportScreen.tsx"), /await feed\.reload\(userId\);/);
  });

  test("the list witnesses every entry and both buttons, and hands focus on once it is drawn again", () => {
    const list = read("src/components/activity/FeedList.tsx");
    assert.match(list, /const \[\{ ref: witnessRef, take: wentWithFocus \}\] = useState\(\(\) => listFocusWitness<HTMLElement>\(\)\);/);
    assert.equal((list.match(/listFocusWitness</g) ?? []).length, 1, "made once, so React attaches each ref once");
    assert.match(list, /<ActivityCard key=\{entry\.key\} entryKey=\{entry\.key\} activity=\{entry\.activity\} now=\{now\} linkRef=\{witnessRef\} \/>/);
    assert.match(list, /<StrengthRow key=\{entry\.key\} entryKey=\{entry\.key\} session=\{entry\.session\} linkRef=\{witnessRef\} \/>/);
    assert.match(list, /href=\{href\}\s+ref=\{linkRef\}\s+data-feed-entry=\{entryKey\}/);
    assert.match(read("src/components/activity/StrengthRow.tsx"), /ref=\{linkRef\} data-feed-entry=\{entryKey\}/);
    assert.match(list, /onClick=\{showOlder\} aria-disabled=\{loadingMore \|\| undefined\} ref=\{olderRef\} data-feed-control="older"/);
    assert.match(list, /onClick=\{onRetry\} aria-disabled=\{busy \|\| undefined\} ref=\{buttonRef\} data-feed-control="sessions"/);
    assert.match(list, /buttonRef=\{sessionsRef\}/);
    assert.match(list, /const olderRef = useCallback\(\(element: HTMLButtonElement \| null\) => \{\s+olderButton\.current = element;\s+const seen = witnessRef\(element\);/);
    assert.match(list, /useEffect\(\(\) => \{\s+if \(loading \|\| loadingMore\) return;\s+const went = wentWithFocus\(\);\s+const before = settled\.current;\s+settled\.current = entries;\s+if \(!went \|\| !focusDropped\(document\)\) return;\s+const target = focusAfterReread\(went, \{ before, after: entries, more, sessionsShown \}\);\s+if \(target === "list"\) headingRef\?\.current\?\.focus\(\);\s+else if \(target === "older"\) olderButton\.current\?\.focus\(\);\s+else if \(target === "sessions"\) sessionsButton\.current\?\.focus\(\);\s+else entryLink\(list\.current, target\)\?\.focus\(\);\s+\}\);/);
    assert.ok(list.indexOf("listFocusWitness<HTMLElement>()") < list.indexOf("if (loading) {"), "before the early returns");
  });

  test("each screen gives the list its heading to fall back to", () => {
    const home = read("src/components/activity/ActivityHome.tsx");
    assert.match(home, /onRetrySessions=\{feed\.retrySessions\}\s+headingRef=\{feedTitleRef\}/);
    assert.match(home, /<h2 id="feed-title" ref=\{feedTitleRef\} tabIndex=\{-1\}/);
    const sport = read("src/components/activity/SportScreen.tsx");
    assert.match(sport, /<h2 id="sport-history-title" ref=\{historyTitleRef\} tabIndex=\{-1\}/);
    assert.match(sport, /onLoadMore=\{feed\.loadMore\}\s+headingRef=\{historyTitleRef\}/);
    assert.ok(sport.indexOf("const historyTitleRef = useRef") < sport.indexOf('if (account.status === "loading")'));
  });
});
