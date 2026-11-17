// A reply sent from the Help page shows at once, from the reply route's answer, instead of only after the
// page's router.refresh(), which sometimes never committed (5 of 17 runs of e2e flow 09: the reply was saved
// but the thread kept saying "Waiting for your reply").
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sentReply, withSentReplies, type SupportMessageView } from "@/components/support/support-rules";

const ID = "9f1c2b3a-1111-4222-8333-444455556666";
const staff: SupportMessageView = { id: "1f1c2b3a-1111-4222-8333-444455556666", fromTeam: true, body: "Does it also stop with the screen on?", createdAt: "2026-11-17T03:00:00.000Z" };
const mine: SupportMessageView = { id: ID, fromTeam: false, body: "Only when the screen locks.", createdAt: "2026-11-17T03:01:00.000Z" };
const read = (file: string) => readFileSync(new URL(`../../src/${file}`, import.meta.url), "utf8");

test("the reply route's answer gives the saved reply, or nothing usable", () => {
  assert.deepEqual(sentReply({ id: ID, body: "Only when the screen locks.", createdAt: mine.createdAt }), mine);
  assert.equal(sentReply(null), null);
  assert.equal(sentReply({ id: "not-a-uuid", body: "x", createdAt: mine.createdAt }), null);
  assert.equal(sentReply({ id: ID, body: "", createdAt: mine.createdAt }), null);
  assert.equal(sentReply({ id: ID, body: "x" }), null);
});

test("a sent reply shows under the team's message and the thread reads as received, as the database now has it", () => {
  const waiting = { status: "waiting_on_user", messages: [staff] };
  assert.deepEqual(withSentReplies(waiting, [mine]), { status: "open", messages: [staff, mine] });
  assert.equal(withSentReplies({ status: "resolved", messages: [] }, [mine]).status, "open");
  // Other statuses stay what they were, like fitx_reply_support_request.
  assert.equal(withSentReplies({ status: "in_progress", messages: [] }, [mine]).status, "in_progress");
  assert.equal(withSentReplies(waiting, []).status, "waiting_on_user");
});

test("once the page's own copy has the reply, that copy is shown and nothing twice", () => {
  const server = { ...mine, createdAt: "2026-11-17T03:01:00.250Z" };
  const refreshed = { status: "waiting_on_user", messages: [staff, server] };
  // A newer team reply has set the status again: the page's copy wins.
  assert.deepEqual(withSentReplies(refreshed, [mine]), { status: "waiting_on_user", messages: [staff, server] });
});

test("the route returns the saved reply and the Help page shows it without waiting for its refresh", () => {
  const route = read("app/api/support/reply/route.ts");
  assert.match(route, /const \{ data, error \} = await supabase\.rpc\("fitx_reply_support_request"/);
  assert.match(route, /\{ id: data, body: checked\.value\.body, createdAt: new Date\(\)\.toISOString\(\) \}/);
  assert.match(route, /NextResponse\.json\(\{ ok: true, reply \}, \{ status: 201/);
  const threads = read("components/support/SupportThreads.tsx");
  assert.match(threads, /const reply = sentReply\(result\.reply\);\n\s+if \(reply\) onSent\(reply\);\n\s+router\.refresh\(\);/);
  assert.match(threads, /const \{ status, messages \} = withSentReplies\(thread, sent\);/);
  assert.match(threads, /\{messages\.map\(\(message\) =>/);
  assert.match(threads, /SUPPORT_STATUS_LABELS\[status\] \?\? status/);
  assert.doesNotMatch(threads, /thread\.messages\.map|SUPPORT_STATUS_LABELS\[thread\.status\]/);
});
