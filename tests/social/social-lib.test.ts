import { test } from "node:test";
import assert from "node:assert/strict";
import { hashtagsIn, mentionsIn, textRuns } from "@/lib/social/text";
import { normaliseUsername, suggestUsername, usernameProblem } from "@/lib/social/username";
import { isTopic, matchTopics, topicLabel, TOPICS } from "@/lib/social/topics";
import { compactCount, plural, relativeTime } from "@/lib/social/format";
import { socialErrorKey, socialErrorMessage, toSocialError } from "@/lib/social/errors";
import { avatarPath, postPhotoPath } from "@/lib/social/paths";
import { QUALITY_STEPS, targetSize } from "@/lib/social/compress";
import { nextCursor, socialApi } from "@/lib/social/api";
import { SOCIAL_LIMITS } from "@/lib/social/limits";
import { removeSocialMediaFiles, SOCIAL_MEDIA_BUCKET } from "@/lib/account/deletion";

const U = "aaaaaaaa-0000-4000-8000-0000000000a1";
const P = "bbbbbbbb-0000-4000-8000-0000000000b2";

test("captions split into text, hashtags and mentions as the database parses them", () => {
  assert.deepEqual(textRuns("Leg day #LegDay with @asha.lifts."), [
    { kind: "text", text: "Leg day " },
    { kind: "tag", text: "#LegDay", tag: "legday" },
    { kind: "text", text: " with " },
    { kind: "mention", text: "@asha.lifts", username: "asha.lifts" },
    { kind: "text", text: "." },
  ]);
  assert.deepEqual(textRuns("mail me@x.com and a&#39;b"), [{ kind: "text", text: "mail me@x.com and a&#39;b" }], "e-mail addresses and entities are text");
  assert.deepEqual(textRuns("@ab is short"), [{ kind: "text", text: "@ab is short" }]);
  assert.deepEqual(hashtagsIn("#Push #push #pull"), ["push", "pull"]);
  assert.deepEqual(mentionsIn("@Chen.Runs and @chen.runs"), ["chen.runs"]);
  const runs = textRuns("#a".repeat(1));
  assert.equal(runs[0].kind, "tag");
});

test("usernames: the database's rules, said in plain words", () => {
  assert.equal(normaliseUsername("  @Asha.Lifts "), "asha.lifts");
  assert.equal(usernameProblem("ab"), "short");
  assert.equal(usernameProblem("a".repeat(31)), "long");
  assert.equal(usernameProblem("has space"), "characters");
  assert.equal(usernameProblem(".asha"), "edges");
  assert.equal(usernameProblem("a..b"), "dots");
  assert.equal(usernameProblem("admin"), "reserved");
  assert.equal(usernameProblem("new"), "reserved", "/explore/stories/new is the story composer, never a member's stories");
  assert.equal(usernameProblem("New"), "reserved");
  assert.equal(usernameProblem("new.lifts"), null);
  assert.equal(usernameProblem("asha_rao.21"), null);
  assert.equal(suggestUsername("Asha Rao"), "asha.rao");
  assert.equal(suggestUsername("Zoë  O’Brien"), "zoe.o.brien");
  assert.equal(suggestUsername("A"), "", "no suggestion that would be refused");
  assert.equal(suggestUsername(null), "");
});

test("topics: seven filters, labels and search", () => {
  assert.equal(TOPICS.length, 7);
  assert.ok(isTopic("weight_loss") && !isTopic("crypto"));
  assert.equal(topicLabel("home_workouts"), "Home workouts");
  assert.deepEqual(matchTopics("loss"), ["weight_loss"]);
  assert.deepEqual(matchTopics("#nutri"), ["nutrition"]);
  assert.deepEqual(matchTopics(""), []);
});

test("times and counts", () => {
  const now = new Date("2026-11-23T12:00:00Z");
  assert.equal(relativeTime("2026-11-23T11:59:30Z", now), "now");
  assert.equal(relativeTime("2026-11-23T11:55:00Z", now), "5 min");
  assert.equal(relativeTime("2026-11-23T09:00:00Z", now), "3 h");
  assert.equal(relativeTime("2026-11-21T12:00:00Z", now), "2 d");
  assert.equal(relativeTime("2026-10-02T12:00:00Z", now), "2 Oct");
  assert.equal(relativeTime("2025-10-02T12:00:00Z", now), "2 Oct 2025");
  assert.equal(compactCount(1234), "1,234");
  assert.equal(compactCount(12_480), "12.4k");
  assert.equal(compactCount(1_250_000), "1.2m");
  assert.equal(plural(1, "like"), "1 like");
  assert.equal(plural(0, "like"), "0 likes");
  assert.equal(plural(2, "reply", "replies"), "2 replies");
});

test("errors: database keys become plain messages; limits and missing functions are recognised", () => {
  assert.equal(socialErrorKey({ code: "P0001", message: "social_username_taken" }), "social_username_taken");
  assert.equal(socialErrorMessage({ code: "23505", message: "social_username_taken" }), "That username is taken.");
  assert.equal(socialErrorKey({ code: "PT429", message: "social_rate_limited", hint: "hour" }), "rate_limited");
  assert.match(socialErrorMessage({ code: "PT429", message: "social_rate_limited", hint: "day" }), /tomorrow/);
  assert.equal(socialErrorKey({ code: "PGRST202", message: "Could not find the function" }), "unavailable");
  assert.equal(socialErrorMessage({ code: "PGRST202" }), "Explore needs the next FITX update.");
  assert.equal(toSocialError(new Error("network")).key, "failed");
});

test("storage paths follow the bucket's policy", () => {
  assert.equal(postPhotoPath(U, P, 0, "image/webp"), `${U}/${P}/0.webp`);
  assert.equal(postPhotoPath(U, P, 9, "image/jpeg"), `${U}/${P}/9.jpg`);
  assert.throws(() => postPhotoPath(U, P, 10, "image/webp"));
  assert.throws(() => postPhotoPath("../x", P, 0, "image/webp"));
  assert.match(avatarPath(U, "image/webp", 1_700_000_000_000), new RegExp(`^${U}/profile/a-[a-z0-9]+\\.webp$`));
});

test("compression: the long edge is at most 1,600 px, never enlarged", () => {
  assert.deepEqual(targetSize(4032, 3024), { width: 1600, height: 1200 });
  assert.deepEqual(targetSize(3024, 4032), { width: 1200, height: 1600 });
  assert.deepEqual(targetSize(800, 600), { width: 800, height: 600 });
  assert.throws(() => targetSize(0, 100));
  assert.ok(QUALITY_STEPS.every((q, i) => i === 0 || QUALITY_STEPS[i - 1] > q));
  assert.equal(SOCIAL_LIMITS.fileBytes, 3 * 1024 * 1024, "matches the bucket's file_size_limit");
});

test("the API sends the member's choices to the right functions and turns errors into messages", async () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const db = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push([fn, args]);
      if (fn === "fitx_social_follow") return Promise.resolve({ data: null, error: { code: "P0001", message: "social_not_found" } });
      return Promise.resolve({ data: [], error: null });
    },
  } as unknown as Parameters<typeof socialApi.feed>[0];
  await socialApi.feed(db, { at: "2026-11-23T10:00:00+00:00", id: P }, 8);
  assert.deepEqual(calls[0], ["fitx_social_feed", { p_before_at: "2026-11-23T10:00:00+00:00", p_before_id: P, p_limit: 8 }]);
  await socialApi.browse(db, { tag: "legday" }, null);
  assert.equal(calls[1][1].p_tag, "legday");
  assert.equal(calls[1][1].p_user, null);
  await assert.rejects(() => socialApi.follow(db, U), (error: Error) => error.message === "That is no longer available.");
  assert.equal(nextCursor([{ created_at: "t1", id: "a" }, { created_at: "t2", id: "b" }], 2)?.id, "b");
  assert.equal(nextCursor([{ created_at: "t1", id: "a" }], 2), null, "a short page is the last");
});

test("account deletion removes every Explore photo, folder by folder", async () => {
  const files: Record<string, string[]> = { [U]: ["profile", P], [`${U}/profile`]: ["a-1.webp"], [`${U}/${P}`]: ["0.webp", "1.webp"] };
  const removed: string[][] = [];
  const admin = {
    storage: {
      from(bucket: string) {
        assert.equal(bucket, SOCIAL_MEDIA_BUCKET);
        return {
          list: async (prefix: string) => ({
            data: (files[prefix] ?? []).map((name) => ({ name, id: name.includes(".") ? `id-${name}` : null })),
            error: null,
          }),
          remove: async (paths: string[]) => {
            removed.push(paths);
            return { error: null };
          },
        };
      },
    },
  };
  const result = await removeSocialMediaFiles(admin, U);
  assert.deepEqual(result, { removed: 3, error: null });
  assert.deepEqual(removed.flat().sort(), [`${U}/${P}/0.webp`, `${U}/${P}/1.webp`, `${U}/profile/a-1.webp`].sort());

  const missing = { storage: { from: () => ({ list: async () => ({ data: null, error: { message: "Bucket not found" } }), remove: async () => ({ error: null }) }) } };
  assert.deepEqual(await removeSocialMediaFiles(missing, U), { removed: 0, error: null });
});
