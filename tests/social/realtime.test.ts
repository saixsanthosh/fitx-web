// The Explore inbox channel and the unread poller (src/lib/social/realtime.ts), with a fake Realtime client, document
// and clock: private topic per member, ids-only pings, the 60-second idle close and reopen, no retry loop after a
// failed join, polling on visibility and on a timer, and unknown counts as null (never 0).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createUnreadPoller, inboxTopic, parsePing, shareInbox, subscribeInbox, unreadLabel, type RealtimeLike } from "../../src/lib/social/realtime.ts";
import { GROUP_LIMITS } from "../../src/lib/social/group-limits.ts";

type Listener = () => void;
function fakeDocument() {
  const listeners = new Set<Listener>();
  const doc = {
    visibilityState: "visible" as DocumentVisibilityState,
    addEventListener: (_: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_: string, listener: Listener) => listeners.delete(listener),
  };
  return {
    doc: doc as unknown as Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">,
    set(state: DocumentVisibilityState) { doc.visibilityState = state; for (const listener of [...listeners]) listener(); },
    count: () => listeners.size,
  };
}

function fakeClient() {
  const opened: { name: string; options: unknown; onPing?: (m: { payload?: unknown }) => void; onStatus?: (s: string) => void }[] = [];
  let removed = 0;
  const client: RealtimeLike = {
    channel(name, options) {
      const record: (typeof opened)[number] = { name, options };
      opened.push(record);
      const channel = {
        on(_type: "broadcast", _filter: { event: string }, callback: (m: { payload?: unknown }) => void) { record.onPing = callback; return channel; },
        subscribe(callback?: (status: string) => void) { record.onStatus = callback; return channel; },
      };
      return channel;
    },
    removeChannel() { removed += 1; return Promise.resolve("ok"); },
  };
  return { client, opened, removed: () => removed };
}

function fakeTimers() {
  let next = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();
  let now = 0;
  return {
    setTimer: (callback: () => void, ms: number) => { const id = next++; timers.set(id, { at: now + ms, callback }); return id; },
    clearTimer: (handle: unknown) => { timers.delete(handle as number); },
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
    },
    pending: () => timers.size,
  };
}

test("the inbox is a private topic per member, and pings carry a kind and an id only", () => {
  assert.equal(inboxTopic("u1"), "social:inbox:u1");
  assert.deepEqual(parsePing({ kind: "message", id: "abc" }), { kind: "message", id: "abc" });
  assert.equal(parsePing({ kind: "message" }), null);
  assert.equal(parsePing({ kind: "<script>", id: "x" }), null);
  assert.equal(parsePing("message"), null);
  assert.equal(parsePing(null), null);
});

test("subscribeInbox joins the private channel, passes pings on, and stops cleanly", () => {
  const { client, opened, removed } = fakeClient();
  const page = fakeDocument();
  const pings: unknown[] = [];
  const live: boolean[] = [];
  const stop = subscribeInbox("u1", (ping) => pings.push(ping), { client, doc: page.doc, onLive: (value) => live.push(value) });
  assert.equal(opened.length, 1);
  assert.equal(opened[0].name, "social:inbox:u1");
  assert.deepEqual(opened[0].options, { config: { private: true } });
  opened[0].onStatus?.("SUBSCRIBED");
  opened[0].onPing?.({ payload: { kind: "message", id: "c1" } });
  opened[0].onPing?.({ payload: { body: "never content" } });
  assert.deepEqual(pings, [{ kind: "message", id: "c1" }]);
  stop();
  assert.equal(removed(), 1);
  assert.equal(page.count(), 0, "the visibility listener is removed");
  assert.deepEqual(live, [true, false]);
});

test("after a minute hidden the channel closes; showing the tab opens it again", () => {
  const { client, opened, removed } = fakeClient();
  const page = fakeDocument();
  const clock = fakeTimers();
  const stop = subscribeInbox("u1", () => undefined, { client, doc: page.doc, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  page.set("hidden");
  clock.advance(GROUP_LIMITS.channelIdleMs - 1);
  assert.equal(removed(), 0, "a short switch away keeps it");
  page.set("visible");
  assert.equal(clock.pending(), 0, "the idle timer is cancelled");
  assert.equal(opened.length, 1);
  page.set("hidden");
  clock.advance(GROUP_LIMITS.channelIdleMs);
  assert.equal(removed(), 1);
  page.set("visible");
  assert.equal(opened.length, 2, "a new channel when the tab is shown");
  stop();
});

test("a channel that cannot join is dropped once, without a retry loop, and the caller is told to poll", () => {
  const { client, opened, removed } = fakeClient();
  const page = fakeDocument();
  const live: boolean[] = [];
  const stop = subscribeInbox("u1", () => undefined, { client, doc: page.doc, onLive: (value) => live.push(value) });
  opened[0].onStatus?.("CHANNEL_ERROR");
  assert.equal(removed(), 1);
  page.set("hidden");
  page.set("visible");
  assert.equal(opened.length, 1, "no new channel after a failure");
  assert.deepEqual(live, [false]);
  stop();
});

test("without a client (no Supabase in this environment) it only reports that it is not live", () => {
  const live: boolean[] = [];
  const stop = subscribeInbox("u1", () => undefined, { client: null, onLive: (value) => live.push(value) });
  stop();
  assert.deepEqual(live, [false]);
});

test("the unread poller reads now, on showing the tab and on its timer; failures read as unknown", async () => {
  const page = fakeDocument();
  let interval: (() => void) | null = null;
  let stopped = false;
  const answers = [
    { messages: 2, requests: 1, notifications: 0 },
    { messages: 3, requests: 1, notifications: 0 },
  ];
  let calls = 0;
  const seen: unknown[] = [];
  const poller = createUnreadPoller(async () => {
    calls += 1;
    const answer = answers.shift();
    if (!answer) throw new Error("offline");
    return answer;
  }, (counts) => seen.push(counts), {
    doc: page.doc,
    everyMs: 120_000,
    setInterval: (callback, ms) => { assert.equal(ms, 120_000); interval = callback; return 1; },
    clearInterval: () => { stopped = true; },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(seen, [{ messages: 2, requests: 1, notifications: 0 }]);
  page.set("hidden");
  interval!();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1, "a hidden tab is not polled");
  page.set("visible");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(seen[1], { messages: 3, requests: 1, notifications: 0 });
  interval!();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(seen[2], { messages: null, requests: null, notifications: null }, "unknown is null, never 0");
  poller.stop();
  assert.equal(stopped, true);
  assert.equal(page.count(), 0);
});

test("the badge names itself", () => {
  assert.equal(unreadLabel(1), "1 unread message");
  assert.equal(unreadLabel(4), "4 unread messages");
});

test("shareInbox: one channel per member for the page; pings reach every listener; the last one out closes it", () => {
  const { client, opened, removed } = fakeClient();
  const page = fakeDocument();
  const bell: unknown[] = [];
  const inbox: unknown[] = [];
  const bellLive: boolean[] = [];
  const inboxLive: boolean[] = [];
  const stopBell = shareInbox("u7", (ping) => bell.push(ping), (live) => bellLive.push(live), { client, doc: page.doc });
  assert.equal(opened.length, 1);
  opened[0].onStatus?.("SUBSCRIBED");
  const stopInbox = shareInbox("u7", (ping) => inbox.push(ping), (live) => inboxLive.push(live), { client, doc: page.doc });
  assert.equal(opened.length, 1, "a second listener for the same member shares the channel");
  assert.deepEqual(inboxLive, [true], "a later listener learns at once that the channel is live");
  opened[0].onPing?.({ payload: { kind: "message", id: "c9" } });
  assert.deepEqual(bell, [{ kind: "message", id: "c9" }]);
  assert.deepEqual(inbox, [{ kind: "message", id: "c9" }]);
  stopInbox();
  stopInbox();
  assert.equal(removed(), 0, "the bell still listens, so the channel stays open");
  opened[0].onPing?.({ payload: { kind: "notification", id: "n1" } });
  assert.equal(inbox.length, 1, "a stopped listener hears nothing more");
  assert.equal(bell.length, 2);
  stopBell();
  assert.equal(removed(), 1, "the last listener out closes the channel");
  assert.deepEqual(bellLive, [true], "a listener that stopped is not called again, not even to say the channel closed");
  const again = shareInbox("u7", () => undefined, undefined, { client, doc: page.doc });
  assert.equal(opened.length, 2, "after the last stop a new listener opens a fresh channel");
  again();
  const live: boolean[] = [];
  const none = shareInbox("", () => undefined, (value) => live.push(value), { client, doc: page.doc });
  assert.deepEqual(live, [false], "no member: nothing opens, and the caller polls");
  none();
});
