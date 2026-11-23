// The pure parts of messages, communities and challenges (src/lib/social/{messages,communities,challenges}.ts): what
// the member reads, how values and windows are written, and the request rule that keeps links in requests plain.
import { test } from "node:test";
import assert from "node:assert/strict";
import { draftState, groupByDay, linkParts, mergeNewest, messageErrorText, previewText, type DirectMessage } from "../../src/lib/social/messages.ts";
import { joinLabel, memberCountText } from "../../src/lib/social/communities.ts";
import { challengePhase, countingNote, formatValue, metricText, ordinal, progressShare, targetText, timeLeftText, windowText } from "../../src/lib/social/challenges.ts";
import { SocialError } from "../../src/lib/social/errors.ts";

const message = (id: string, at: string, extra: Partial<DirectMessage> = {}): DirectMessage => ({
  id, mine: false, body: id, unsent: false, created_at: at, post: null, post_unavailable: false, story: null, ...extra,
});

test("message failures say what happened in plain words", () => {
  assert.equal(messageErrorText(new SocialError("social_suspended", "x", "dm")), "FITX has paused your messages for now.");
  assert.equal(messageErrorText(new SocialError("social_dm_not_allowed", "x", "pending")), "Your message request is waiting for an answer.");
  assert.equal(messageErrorText({ message: "social_dm_not_allowed", code: "P0001", hint: "policy" }), "This member does not take messages from you.");
  assert.equal(messageErrorText({ message: "social_age_restricted", code: "P0001", hint: "unknown" }),
    "Add your date of birth in Explore settings to use this. It is for members aged 18 and over.");
});

test("inbox previews, drafts and link parts", () => {
  assert.equal(previewText({ mine: true, kind: "text", body: "On my way", created_at: "" }), "You: On my way");
  assert.equal(previewText({ mine: false, kind: "post", body: "", created_at: "" }), "Shared a post");
  assert.equal(previewText({ mine: false, kind: "unsent", body: "", created_at: "" }), "Message unsent");
  assert.equal(previewText(null), "");
  assert.deepEqual(draftState("   "), { ok: false, over: 0 });
  assert.deepEqual(draftState("", true), { ok: true, over: 0 }, "a shared post may go without text");
  assert.deepEqual(draftState("x".repeat(2003)), { ok: false, over: 3 });
  assert.deepEqual(linkParts("See https://fitx.app/x, then reply."), [
    { text: "See ", href: null }, { text: "https://fitx.app/x", href: "https://fitx.app/x" }, { text: ", then reply.", href: null },
  ]);
  assert.deepEqual(linkParts("no links here"), [{ text: "no links here", href: null }]);
  assert.deepEqual(linkParts("javascript:alert(1)"), [{ text: "javascript:alert(1)", href: null }], "only web links");
});

test("messages are grouped by day, oldest first, and a fresh page merges without duplicates", () => {
  const newestFirst = [message("c", "2026-11-24T10:00:00.000Z"), message("b", "2026-11-24T09:00:00.000Z"), message("a", "2026-11-22T09:00:00.000Z")];
  const days = groupByDay(newestFirst);
  assert.equal(days.length, 2);
  assert.deepEqual(days[0].items.map((m) => m.id), ["a"]);
  assert.deepEqual(days[1].items.map((m) => m.id), ["b", "c"]);
  const merged = mergeNewest(newestFirst, [message("d", "2026-11-24T11:00:00.000Z"), message("c", "2026-11-24T10:00:00.000Z", { unsent: true, body: "" })]);
  assert.deepEqual(merged.map((m) => m.id), ["d", "c", "b", "a"]);
  assert.equal(merged[1].unsent, true, "the fresh copy wins");
});

test("community labels", () => {
  assert.equal(memberCountText(1), "1 member");
  assert.equal(memberCountText(1204), "1,204 members");
  assert.deepEqual(joinLabel({ visibility: "public", my_status: "none" }), { label: "Join", action: "join" });
  assert.deepEqual(joinLabel({ visibility: "private", my_status: "none" }), { label: "Ask to join", action: "join" });
  assert.deepEqual(joinLabel({ visibility: "private", my_status: "pending" }), { label: "Withdraw request", action: "withdraw" });
  assert.deepEqual(joinLabel({ visibility: "public", my_status: "accepted" }), { label: "Leave", action: "leave" });
});

test("challenge values, targets and progress are written from the computed value only", () => {
  assert.equal(formatValue("workouts", 1), "1 workout");
  assert.equal(formatValue("workouts", 3), "3 workouts");
  assert.equal(formatValue("distance_km", 12.46), "12.5 km");
  assert.equal(formatValue("active_minutes", 150), "150 active minutes");
  assert.equal(formatValue("active_days", 1), "1 active day");
  assert.equal(targetText({ metric: "workouts", target: null }), null, "no target: most wins");
  assert.equal(targetText({ metric: "distance_km", target: 25 }), "25 km");
  assert.equal(progressShare(3, 4), 0.75);
  assert.equal(progressShare(9, 4), 1);
  assert.equal(progressShare(3, null), null);
  assert.equal(progressShare(null, 4), null, "unknown is never shown as 0");
  assert.equal(metricText("distance_km", "run"), "Run distance");
  assert.equal(metricText("active_days", null), "Days with a workout or activity");
  assert.equal(ordinal(1), "1st");
  assert.equal(ordinal(2), "2nd");
  assert.equal(ordinal(3), "3rd");
  assert.equal(ordinal(11), "11th");
  assert.equal(ordinal(22), "22nd");
});

test("challenge phases and windows", () => {
  const week = { starts_at: "2026-11-23T00:00:00+05:30", ends_at: "2026-11-30T00:00:00+05:30", closed_at: null };
  assert.equal(challengePhase(week, new Date("2026-11-22T12:00:00Z")), "upcoming");
  assert.equal(challengePhase(week, new Date("2026-11-25T12:00:00Z")), "open");
  assert.equal(challengePhase(week, new Date("2026-11-29T19:00:00Z")), "closing");
  assert.equal(challengePhase({ ...week, closed_at: "2026-11-30T02:00:00+05:30" }), "closed");
  assert.equal(windowText(week, "Asia/Kolkata"), "Mon 23 Nov to Sun 29 Nov");
  assert.equal(timeLeftText(week, new Date("2026-11-28T18:30:00Z")), "Ends in 24 h");
  assert.equal(timeLeftText(week, new Date("2026-11-24T18:30:00Z")), "Ends in 5 days");
  assert.equal(timeLeftText(week, new Date("2026-11-29T19:00:00Z")), "Final count soon");
  assert.match(countingNote({ kind: "weekly" }), /Monday to Monday/);
});
