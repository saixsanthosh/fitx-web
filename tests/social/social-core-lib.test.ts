// Explore part 2 core, the app side: the rail and create menu data, the component slots (all empty until the
// integrator fills them), error keys, the new notification kinds, suspension wording, ages, video posters, the API
// arguments, and that the slot hosts render each slot only when it is filled (else today's UI).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createChoices, CREATE_OPTIONS, EXPLORE_RAIL, RAIL_BADGES, railEntries, railKeyFor, type CreateOption, type RailEntry } from "@/lib/social/rail";
import * as slots from "@/lib/social/slots";
import { SOCIAL_CLOSED_KEYS, socialErrorKey, socialErrorMessage, toSocialError } from "@/lib/social/errors";
import { notificationHref, notificationText } from "@/lib/social/text";
import { ageOn, suspensionText } from "@/lib/social/format";
import { postCoverPath, posterPath } from "@/lib/social/paths";
import { socialApi } from "@/lib/social/api";
import type { NotificationType, SocialNotification } from "@/lib/social/types";

const U = "aaaaaaaa-0000-4000-8000-0000000000a1";
const P = "bbbbbbbb-0000-4000-8000-0000000000b2";
const source = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");

test("the rail lists Feed, Discover, Videos, Community and Messages; only the shipped ones show", () => {
  assert.deepEqual(EXPLORE_RAIL.map((entry) => entry.label), ["Feed", "Discover", "Videos", "Community", "Messages"]);
  assert.deepEqual(EXPLORE_RAIL.filter((entry) => !entry.ready).map((entry) => entry.key), ["videos", "community", "messages"]);
  assert.deepEqual(railEntries().map((entry) => entry.key), ["feed", "discover"]);
  assert.deepEqual(RAIL_BADGES, {});
  const all: RailEntry[] = EXPLORE_RAIL.map((entry) => ({ ...entry, ready: true }));
  assert.equal(railEntries(all).length, 5);
  assert.equal(railKeyFor("/explore", all), "feed");
  assert.equal(railKeyFor("/explore/videos/new", all), "videos");
  assert.equal(railKeyFor("/explore/messages/abc", all), "messages");
  assert.equal(railKeyFor("/explore/discover?topic=x".split("?")[0], all), "discover");
  assert.equal(railKeyFor("/explore/notifications", all), null);
  assert.equal(railKeyFor("/explore/u/someone", all), null);
});

test("the create menu: Photo post now; Story and Video once shipped, Video only while videos are on", () => {
  assert.deepEqual(CREATE_OPTIONS.map((option) => [option.label, option.href]), [
    ["Photo post", "/explore/new"], ["Story", "/explore/stories/new"], ["Video", "/explore/videos/new"],
  ]);
  assert.deepEqual(createChoices(true).map((option) => option.key), ["photo"], "one choice: the pill goes straight to the composer");
  const shipped: CreateOption[] = CREATE_OPTIONS.map((option) => ({ ...option, ready: true }));
  assert.deepEqual(createChoices(false, shipped).map((option) => option.key), ["photo", "story"]);
  assert.deepEqual(createChoices(true, shipped).map((option) => option.key), ["photo", "story", "video"]);
});

test("every component slot is empty until the integrator fills it", () => {
  const names = ["FEED_TOP_SLOT", "POST_VIDEO", "DISCOVER_VIDEOS", "AVATAR_RING", "SHARE_TARGETS", "PROFILE_ACTIONS", "STORY_REPLY"] as const;
  for (const name of names) assert.equal(slots[name], null, name);
});

test("each slot host renders the slot only when it is filled, and today's UI otherwise", () => {
  const hosts: [string, string, RegExp][] = [
    ["src/components/social/FeedView.tsx", "FEED_TOP_SLOT", /FeedTop && <FeedTop \/>/],
    ["src/components/social/PostCard.tsx", "POST_VIDEO", /Player && !paused && item\.poster_path \? \([\s\S]*?<Player [\s\S]*?\) : \([\s\S]*?<SocialPhoto path=\{item\.poster_path\}/],
    ["src/components/social/PostCard.tsx", "SHARE_TARGETS", /if \(SHARE_TARGETS\) \{[\s\S]*?\}\s*await shareLink\(\);/],
    ["src/components/social/DiscoverView.tsx", "DISCOVER_VIDEOS", /return Videos \? <Videos limit=\{6\} \/> : null;/],
    ["src/components/social/Avatar.tsx", "AVATAR_RING", /if \(Ring && user\.id\) return <Ring userId=\{user\.id\} size=\{size\}>\{picture\}<\/Ring>;\s*return picture;/],
    ["src/components/social/ProfileView.tsx", "PROFILE_ACTIONS", /\{ProfileActions && <ProfileActions userId=\{profile\.id\} username=\{profile\.username\} \/>\}/],
  ];
  for (const [file, slot, rendering] of hosts) {
    const text = source(file);
    assert.match(text, new RegExp(`import \\{[^}]*\\b${slot}\\b[^}]*\\} from "@/lib/social/slots"`), `${file} imports ${slot}`);
    assert.match(text, rendering, `${file} renders ${slot} conditionally`);
  }
});

test("error keys: wave-2 codes have their own words, and a named key wins over PT429", () => {
  for (const key of ["social_suspended", "social_unavailable", "social_age_restricted", "social_dm_not_allowed", "social_video_cap",
    "social_storage_full", "social_story_expired", "social_link_budget", "social_not_member", "social_challenge_closed", "social_birth_date_set"]) {
    assert.equal(socialErrorKey({ message: key }), key);
    assert.doesNotMatch(socialErrorMessage({ message: key }), /did not work/, key);
  }
  assert.equal(socialErrorKey({ code: "PT429", message: "social_link_budget", hint: "project" }), "social_link_budget");
  assert.equal(socialErrorKey({ code: "PT429", message: "social_rate_limited", hint: "day" }), "rate_limited");
  assert.equal(socialErrorKey({ code: "PT429" }), "rate_limited");
  assert.match(socialErrorMessage({ message: "social_age_restricted", hint: "unknown" }), /Add your date of birth/);
  assert.match(socialErrorMessage({ message: "social_age_restricted", hint: "teen" }), /18 and over/);
  assert.equal(toSocialError({ message: "social_age_restricted", hint: "teen" }).hint, "teen");
  assert.deepEqual([...SOCIAL_CLOSED_KEYS], ["social_suspended", "social_unavailable"]);
});

test("every notification kind has words, and notices from FITX name nobody", () => {
  const kinds: NotificationType[] = ["follow", "follow_request", "follow_accepted", "like", "comment", "reply", "mention", "story_like", "story_reply",
    "challenge_invite", "challenge_badge", "community_request", "community_invite", "community_accepted", "message_request", "message", "report_reviewed"];
  for (const type of kinds) assert.ok(notificationText({ type, snippet: null }).endsWith("."), type);
  assert.equal(notificationText({ type: "community_invite", snippet: null, community: { slug: "run-club", name: "Run club" } }), "invited you to join Run club.");
  assert.equal(notificationText({ type: "challenge_badge", snippet: null, challenge: { title: "10k week" } }), "You earned a badge in 10k week.");
  assert.match(notificationText({ type: "report_reviewed", snippet: null }), /^FITX reviewed your report/);
  assert.match(notificationText({ type: "report_reviewed", snippet: null, community: { slug: "c", name: "Lifters" } }), /moderators of Lifters/);
  const base: SocialNotification = { id: "n", type: "like", created_at: "", read: false, actor: null, post_id: null, comment_id: null, thumb: null, snippet: null, following: "none" };
  assert.equal(notificationHref({ ...base, post_id: P, comment_id: U }, "me"), `/explore/p/${P}#comments`);
  assert.equal(notificationHref({ ...base, type: "story_like", story_id: U }, "me"), "/explore/stories/me");
  assert.equal(notificationHref({ ...base, type: "message", conversation_id: U }, "me"), `/explore/messages/${U}`);
  assert.equal(notificationHref({ ...base, type: "message_request" }, "me"), "/explore/messages?box=requests");
  assert.equal(notificationHref({ ...base, type: "community_accepted", community: { slug: "run-club", name: "Run club" } }, "me"), "/explore/c/run-club");
  assert.equal(notificationHref({ ...base, type: "report_reviewed" }, "me"), null);
});

test("suspension wording, ages and video posters", () => {
  assert.match(suspensionText(null), /until it reviews it/);
  assert.match(suspensionText("2026-12-01T10:00:00Z"), /until 1 December 2026\./);
  const today = new Date(2026, 10, 23);
  assert.equal(ageOn("2008-11-23", today), 18);
  assert.equal(ageOn("2008-11-24", today), 17);
  assert.equal(ageOn("2026-02-30", today), null);
  assert.equal(ageOn("nope", today), null);
  assert.equal(posterPath(U, P), `${U}/${P}/0p.webp`);
  assert.throws(() => posterPath("x", P));
  assert.equal(postCoverPath({ kind: "photo", media: [{ path: "a.webp", kind: "image" }] }), "a.webp");
  assert.equal(postCoverPath({ kind: "video", media: [{ path: "a.mp4", kind: "video", poster_path: "ap.webp" }] }), "ap.webp");
  assert.equal(postCoverPath({ kind: "video", media: [{ path: "a.mp4", kind: "video" }] }), null, "never the .mp4");
  assert.equal(postCoverPath({ kind: "text", media: [] }), null);
});

test("API arguments for the wave-2 calls, and the prefs save stays five-argument when the new keys are unknown", async () => {
  const calls: [string, Record<string, unknown>][] = [];
  const db = { rpc: async (fn: string, args: Record<string, unknown>) => { calls.push([fn, args]); return { data: null, error: null }; } } as never;
  await socialApi.saveNotificationPrefs(db, { follows: true, follow_requests: true, likes: false, comments: true, mentions: true });
  assert.deepEqual(Object.keys(calls[0][1]).sort(), ["p_comments", "p_follow_requests", "p_follows", "p_likes", "p_mentions"]);
  await socialApi.saveNotificationPrefs(db, { follows: true, follow_requests: true, likes: true, comments: true, mentions: true, stories: false });
  assert.equal(calls[1][1].p_stories, false);
  assert.equal("p_messages" in calls[1][1], false);
  await socialApi.setBirthDate(db, "1990-04-02");
  assert.deepEqual(calls[2], ["fitx_social_set_birth_date", { p_date: "1990-04-02" }]);
  await socialApi.createStory(db, { id: P, kind: "image", path: `${U}/${P}/0.webp`, posterPath: null, width: 1080, height: 1920, durationMs: null, caption: "" });
  assert.equal(calls[3][0], "fitx_social_create_story");
  assert.deepEqual(Object.keys(calls[3][1]), ["p_story_id", "p_kind", "p_path", "p_poster_path", "p_width", "p_height", "p_duration_ms", "p_caption"]);
  await socialApi.deleteAllContent(db);
  assert.equal(calls[4][0], "fitx_social_delete_all_content");
});
