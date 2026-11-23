// Explore videos in the browser (wave-2 brief 3.10): the shortening plan (length, frame, rates, the 3 MB bucket
// limit), the pass-through rule for MP4s that already fit (O2 a), the MediaRecorder type choice, and the video feed
// pager that keeps only video posts from the feed and Discover reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clock, estimateBytes, frameSize, latestStart, longEdgeFor, passThroughOk, planVideo, retryPlan, storedDuration, VIDEO_LIMITS, videoProblem,
} from "@/lib/social/video/plan";
import { mp4RecordingType, MP4_RECORDING_TYPES } from "@/lib/social/video/probe";
import { createVideoPager, newestFirst } from "@/lib/social/video/feed";
import type { Mp4Info } from "@/lib/social/video/mp4-sniff";
import type { Cursor, SocialPost } from "@/lib/social/types";

test("up to 15 s keeps a 1,280 px long edge; longer clips use 960 px", () => {
  assert.equal(longEdgeFor(15_000), 1280);
  assert.equal(longEdgeFor(15_001), 960);
  const short = planVideo({ durationMs: 12_000, width: 1920, height: 1080 }, "post");
  assert.ok(short.ok);
  assert.deepEqual([short.plan.width, short.plan.height], [1280, 720]);
  const long = planVideo({ durationMs: 28_000, width: 1080, height: 1920 }, "post");
  assert.ok(long.ok);
  assert.deepEqual([long.plan.width, long.plan.height], [540, 960]);
});

test("frames are never enlarged and both sides are even (H.264)", () => {
  assert.deepEqual(frameSize(640, 360, 1280), { width: 640, height: 360 });
  assert.deepEqual(frameSize(1001, 563, 1280), { width: 1002, height: 564 });
  const plan = planVideo({ durationMs: 5000, width: 3000, height: 1999 }, "story");
  assert.ok(plan.ok);
  assert.equal(plan.plan.width % 2, 0);
  assert.equal(plan.plan.height % 2, 0);
  assert.equal(Math.max(plan.plan.width, plan.plan.height), 1280);
});

test("600 kbps video and 64 kbps audio, aiming under 2.8 MB, for every allowed length", () => {
  for (const target of ["post", "story"] as const) {
    const result = planVideo({ durationMs: 600_000, width: 1280, height: 720 }, target);
    assert.ok(result.ok);
    assert.equal(result.plan.durationMs, VIDEO_LIMITS.maxMs[target]);
    assert.equal(result.plan.trimmed, true);
    assert.equal(result.plan.videoBitsPerSecond, 600_000);
    assert.equal(result.plan.audioBitsPerSecond, 64_000);
    assert.ok(result.plan.estimatedBytes <= VIDEO_LIMITS.targetBytes, `${target}: ${result.plan.estimatedBytes}`);
    assert.ok(VIDEO_LIMITS.targetBytes < VIDEO_LIMITS.fileBytes);
  }
  // 30 s at the full rates: about 2.6 MB with overhead.
  assert.ok(estimateBytes(30_000, 600_000, 64_000) < 2.8 * 1024 * 1024);
});

test("feed videos are at most 30 s and stories at most 15 s; the start is clamped so the clip fits", () => {
  assert.equal(VIDEO_LIMITS.maxMs.post, 30_000);
  assert.equal(VIDEO_LIMITS.maxMs.story, 15_000);
  assert.equal(latestStart(40_000, "post"), 10_000);
  assert.equal(latestStart(10_000, "story"), 0);
  const late = planVideo({ durationMs: 40_000, width: 1280, height: 720 }, "post", 25_000);
  assert.ok(late.ok);
  assert.equal(late.plan.startMs, 10_000);
  assert.equal(late.plan.durationMs, 30_000);
  const whole = planVideo({ durationMs: 9_000, width: 1280, height: 720 }, "story", 4_000);
  assert.ok(whole.ok);
  assert.deepEqual([whole.plan.startMs, whole.plan.durationMs, whole.plan.trimmed], [0, 9_000, false]);
});

test("unusable sources are refused with a reason", () => {
  assert.deepEqual(planVideo({ durationMs: 500, width: 100, height: 100 }, "post"), { ok: false, reason: "too_short" });
  assert.deepEqual(planVideo({ durationMs: Number.POSITIVE_INFINITY, width: 100, height: 100 }, "post"), { ok: false, reason: "no_duration" });
  assert.deepEqual(planVideo({ durationMs: 5000, width: 0, height: 100 }, "post"), { ok: false, reason: "no_size" });
});

test("one retry at a lower video rate when the first file came out too large", () => {
  const result = planVideo({ durationMs: 20_000, width: 1280, height: 720 }, "post");
  assert.ok(result.ok);
  const retry = retryPlan(result.plan);
  assert.equal(retry.videoBitsPerSecond, Math.round(result.plan.videoBitsPerSecond * 0.7));
  assert.ok(retry.estimatedBytes < result.plan.estimatedBytes);
  assert.equal(retry.durationMs, result.plan.durationMs);
});

const mp4 = (over: Partial<Mp4Info> = {}): Mp4Info => ({
  brand: "isom", compatible: ["isom", "avc1"], durationMs: 8000, fragmented: false, moovFirst: true,
  video: { codec: "avc1", width: 1280, height: 720 }, audio: { codec: "mp4a" }, tracks: [], ...over,
});

test("an MP4 that already fits is uploaded as it is (O2 a); anything else needs shortening", () => {
  assert.deepEqual(passThroughOk(mp4(), 2_000_000, "post"), { ok: true });
  assert.deepEqual(passThroughOk(mp4({ audio: null }), 2_000_000, "story"), { ok: true });
  assert.deepEqual(passThroughOk(mp4(), 3 * 1024 * 1024 + 1, "post"), { ok: false, reason: "too_large" });
  assert.deepEqual(passThroughOk(mp4({ video: { codec: "hvc1", width: 1280, height: 720 } }), 1_000_000, "post"), { ok: false, reason: "codec" });
  assert.deepEqual(passThroughOk(mp4({ audio: { codec: "Opus" } }), 1_000_000, "post"), { ok: false, reason: "codec" });
  assert.deepEqual(passThroughOk(mp4({ durationMs: 20_000 }), 1_000_000, "story"), { ok: false, reason: "too_long" });
  assert.deepEqual(passThroughOk(mp4({ durationMs: null }), 1_000_000, "post"), { ok: false, reason: "too_long" });
  assert.deepEqual(passThroughOk(mp4({ video: { codec: "avc1", width: 1920, height: 1080 } }), 1_000_000, "post"), { ok: false, reason: "frame" });
  assert.equal(videoProblem("codec", "post"), "Video posts need Chrome, Edge or Safari to shorten.");
  assert.equal(videoProblem("too_long", "story"), "Videos here are up to 15 seconds.");
});

test("stored lengths are whole milliseconds inside the limit; clock() reads m:ss", () => {
  assert.equal(storedDuration(15_040.6, "story"), 15_000);
  assert.equal(storedDuration(0.2, "post"), 1);
  assert.equal(clock(12_400), "0:12");
  assert.equal(clock(30_000), "0:30");
});

test("the recorder type is the first MP4 type MediaRecorder accepts, or none (Firefox)", () => {
  assert.equal(mp4RecordingType((type) => type === "video/mp4"), "video/mp4");
  assert.equal(mp4RecordingType(() => true), MP4_RECORDING_TYPES[0]);
  assert.equal(mp4RecordingType((type) => type.startsWith("video/webm")), null);
  assert.equal(mp4RecordingType(() => { throw new Error("bad type"); }), null);
  assert.equal(mp4RecordingType(undefined), null);
});

let serial = 0;
function post(kind: SocialPost["kind"], at: string): SocialPost {
  serial += 1;
  const id = `00000000-0000-4000-8000-${String(serial).padStart(12, "0")}`;
  return {
    id, kind, caption: "", location: null, topics: [], comment_policy: "everyone", created_at: at, edited_at: null,
    author: { id: "a", username: "a", display_name: "A", avatar_path: null, is_private: false },
    media: kind === "text" ? [] : [{ path: `u/${id}/0.${kind === "video" ? "mp4" : "webp"}`, width: 9, height: 16, kind: kind === "video" ? "video" : "image", alt: null }],
    like_count: 0, comment_count: 0, liked: false, saved: false, mine: false, can_comment: true,
  };
}

/** A paged source over `all` (newest first), recording each read's cursor. */
function source(all: SocialPost[], log: Cursor[]) {
  return async (cursor: Cursor, limit: number) => {
    log.push(cursor);
    const sorted = [...all].sort(newestFirst);
    const from = cursor ? sorted.findIndex((item) => item.created_at < cursor.at || (item.created_at === cursor.at && item.id < cursor.id)) : 0;
    return from < 0 ? [] : sorted.slice(from, from + limit);
  };
}

test("the video feed keeps only video posts, from both sources, without repeats, newest first", async () => {
  const shared = post("video", "2026-11-20T10:00:00Z");
  const feed = [post("photo", "2026-11-23T10:00:00Z"), post("video", "2026-11-22T10:00:00Z"), shared, post("text", "2026-11-19T10:00:00Z")];
  const discover = [post("video", "2026-11-21T10:00:00Z"), shared, post("photo", "2026-11-18T10:00:00Z")];
  const pager = createVideoPager([source(feed, []), source(discover, [])], { readLimit: 2 });
  const first = await pager.next(2);
  assert.deepEqual(first.items.map((item) => item.created_at), ["2026-11-22T10:00:00Z", "2026-11-21T10:00:00Z"]);
  const rest = await pager.next(10);
  assert.deepEqual(rest.items.map((item) => item.id), [shared.id]);
  assert.equal(rest.done, true);
  assert.ok([...first.items, ...rest.items].every((item) => item.kind === "video"));
});

test("the pager stops after a few reads per call when videos are rare, and resumes from its cursors", async () => {
  const photos = Array.from({ length: 40 }, (_, index) => post("photo", `2026-11-${String(23 - Math.floor(index / 10)).padStart(2, "0")}T${String(10 + (index % 10)).padStart(2, "0")}:00:00Z`));
  const log: Cursor[] = [];
  const pager = createVideoPager([source(photos, log)], { readLimit: 5, readsPerCall: 3 });
  const page = await pager.next(6);
  assert.deepEqual(page.items, []);
  assert.equal(page.done, false);
  assert.equal(log.length, 3);
  assert.equal(log[0], null);
  assert.ok(log[1] && log[2] && log[1].at > log[2].at, "each read continues after the last");
});
