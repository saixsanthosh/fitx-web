// Stories, the pure parts (wave-2 brief 3.6 and 3.9): file paths as create_story expects them, how long each story
// shows, moving through several accounts' stories, where the viewer starts, the ring, the owner's labels, and that
// the slot components are exported with the props social-core fixed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  firstUnseen, markTraySeen, ringFor, seenByLabel, stepStory, storyFilePath, storyPlayMs, STORY_PHOTO_MS, timeLeft, viewerOrder,
} from "@/lib/social/stories";
import type { StoryTrayEntry } from "@/lib/social/types";

const U = "aaaaaaaa-0000-4000-8000-0000000000a1";
const S = "bbbbbbbb-0000-4000-8000-0000000000b2";
const source = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");

test("a story's file is <uid>/<story id>/0.(webp|jpg|mp4)", () => {
  assert.equal(storyFilePath(U, S, "image", "image/webp"), `${U}/${S}/0.webp`);
  assert.equal(storyFilePath(U, S, "image", "image/jpeg"), `${U}/${S}/0.jpg`);
  assert.equal(storyFilePath(U, S, "video"), `${U}/${S}/0.mp4`);
  assert.throws(() => storyFilePath("me", S, "video"));
  assert.throws(() => storyFilePath(U, S, "image"));
});

test("a photo shows for 5 s; a video for its own length, at most 15 s", () => {
  assert.equal(storyPlayMs({ kind: "image", duration_ms: null }), STORY_PHOTO_MS);
  assert.equal(storyPlayMs({ kind: "video", duration_ms: 8_200 }), 8_200);
  assert.equal(storyPlayMs({ kind: "video", duration_ms: 40_000 }), 15_000);
  assert.equal(storyPlayMs({ kind: "video", duration_ms: null }), STORY_PHOTO_MS);
});

test("next and previous run through each account's stories, then on to the next account", () => {
  const counts = [2, 0, 1];
  assert.deepEqual(stepStory(counts, { user: 0, story: 0 }, 1), { user: 0, story: 1 });
  assert.deepEqual(stepStory(counts, { user: 0, story: 1 }, 1), { user: 2, story: 0 }, "an account with none is skipped");
  assert.equal(stepStory(counts, { user: 2, story: 0 }, 1), null, "past the last story the viewer closes");
  assert.deepEqual(stepStory(counts, { user: 2, story: 0 }, -1), { user: 0, story: 1 });
  assert.deepEqual(stepStory(counts, { user: 0, story: 0 }, -1), { user: 0, story: 0 }, "back from the first stays");
  assert.equal(stepStory([], { user: 0, story: 0 }, 1), null);
});

test("the viewer starts at the first unseen story", () => {
  assert.equal(firstUnseen([{ seen: true }, { seen: false }, { seen: false }]), 1);
  assert.equal(firstUnseen([{ seen: true }, { seen: true }]), 0);
  assert.equal(firstUnseen([]), 0);
});

const entry = (id: string, unseen: boolean, count = 1): StoryTrayEntry => ({
  user: { id, username: `user_${id}`, display_name: id, avatar_path: null, is_private: false }, count, latest_at: "2026-11-23T10:00:00Z", unseen, mine: false,
});

test("the ring: unseen, seen or none; seeing an account's stories turns its ring to seen", () => {
  const tray = [entry("a", true), entry("b", false), entry("c", true, 0)];
  assert.equal(ringFor(tray, "a"), "unseen");
  assert.equal(ringFor(tray, "b"), "seen");
  assert.equal(ringFor(tray, "c"), null);
  assert.equal(ringFor(tray, "zz"), null);
  assert.equal(ringFor(null, "a"), null);
  const after = markTraySeen(tray, "a");
  assert.equal(ringFor(after, "a"), "seen");
  assert.equal(after[1], tray[1], "other entries are kept as they are");
});

test("the viewer opened on one account walks on through the tray after it", () => {
  const tray = [entry("me", false), entry("a", true), entry("b", true), entry("c", false)];
  assert.deepEqual(viewerOrder(tray, "user_a"), ["user_a", "user_b", "user_c"]);
  assert.deepEqual(viewerOrder(tray, "user_c"), ["user_c"]);
  assert.deepEqual(viewerOrder(tray, "someone_else"), ["someone_else"], "an account outside the tray (a profile) is viewed alone");
  assert.deepEqual(viewerOrder(null, "x"), ["x"]);
});

test("the owner's labels: time left and how many have seen it (unknown is never shown as 0)", () => {
  const now = Date.parse("2026-11-23T10:00:00Z");
  assert.equal(timeLeft("2026-11-24T09:30:00Z", now), "23 h left");
  assert.equal(timeLeft("2026-11-23T10:40:00Z", now), "40 min left");
  assert.equal(timeLeft("2026-11-23T10:00:30Z", now), "Ending now");
  assert.equal(seenByLabel(3), "Seen by 3");
  assert.equal(seenByLabel(0), "Seen by 0");
  assert.equal(seenByLabel(null), null);
  assert.equal(seenByLabel(undefined), null);
});

test("each slot component is exported from its own folder with social-core's props", () => {
  const exports: [string, string, string][] = [
    ["src/components/social/stories/StoryTray.tsx", "StoryTray", "FeedTopProps"],
    ["src/components/social/stories/StoryRing.tsx", "StoryRing", "AvatarRingProps"],
    ["src/components/social/videos/PostVideo.tsx", "PostVideo", "PostVideoProps"],
    ["src/components/social/videos/DiscoverVideos.tsx", "DiscoverVideos", "DiscoverVideosProps"],
  ];
  for (const [file, name, props] of exports) {
    const text = source(file);
    assert.match(text, new RegExp(`export function ${name}\\(`), `${file} exports ${name}`);
    assert.match(text, new RegExp(`\\b${props}\\b`), `${name} takes ${props}`);
    assert.match(text, /from "@\/lib\/social\/slots"/, `${name} imports its props from slots.ts`);
  }
  // The viewer renders social-groups' reply box through the slot, only when it is filled.
  const viewer = source("src/components/social/stories/StoryViewer.tsx");
  assert.match(viewer, /STORY_REPLY/);
  assert.match(viewer, /const Reply = STORY_REPLY;/);
  // The filling stream never flips a slot: slots.ts still holds null for every one of them.
  const slots = source("src/lib/social/slots.ts");
  for (const slot of ["FEED_TOP_SLOT", "POST_VIDEO", "DISCOVER_VIDEOS", "AVATAR_RING", "STORY_REPLY"]) {
    assert.match(slots, new RegExp(`export const ${slot}: ComponentType<\\w+> \\| null = null;`));
  }
});

test("video controls never render while explore_video is off (no dead controls)", () => {
  const composer = source("src/components/social/stories/StoryComposer.tsx");
  assert.match(composer, /me\.videos === true/, "the story composer offers video only while videos are on");
  const videos = source("src/components/social/videos/VideoFeed.tsx");
  assert.match(videos, /Videos are paused by FITX/);
  const player = source("src/components/social/videos/PostVideo.tsx");
  assert.match(player, /"Play video"/);
  assert.match(player, /preload="none"/, "the player fetches nothing until tapped");
});
