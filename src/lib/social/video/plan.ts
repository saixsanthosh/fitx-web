/**
 * How a video is made small enough for Explore before it is uploaded (wave-2 brief 3.10). Pure: no browser APIs.
 * The bucket refuses files over 3 MB, so a feed video (at most 30 s) or a story (at most 15 s) is re-encoded at about
 * 600 kbps video and 64 kbps audio, aiming at 2.8 MB, with the long edge at 1,280 px up to 15 s and 960 px above.
 */
import type { Mp4Info } from "./mp4-sniff";

export type VideoTarget = "post" | "story";

export const VIDEO_LIMITS = {
  /** The longest clip each place takes (the database checks the same). */
  maxMs: { post: 30_000, story: 15_000 } as Record<VideoTarget, number>,
  /** Shorter than this is not worth a post (and the database needs at least 1 ms). */
  minMs: 1_000,
  /** Clips up to this length keep the larger long edge. */
  shortMs: 15_000,
  shortLongEdge: 1280,
  longLongEdge: 960,
  videoBitsPerSecond: 600_000,
  audioBitsPerSecond: 64_000,
  /** What a re-encode aims at, under the bucket's hard limit. */
  targetBytes: Math.round(2.8 * 1024 * 1024),
  fileBytes: 3 * 1024 * 1024,
  fps: 30,
  /** Container overhead on top of the bit rates (moov, fragments), measured generously. */
  overhead: 1.04,
  /** The one retry after a file came out too large uses this share of the video bit rate. */
  retryScale: 0.7,
  /** A file the member picks may be at most this large before it is shortened. */
  sourceBytes: 500 * 1024 * 1024,
} as const;

export type VideoSource = { durationMs: number; width: number; height: number };

export type VideoPlan = {
  target: VideoTarget;
  /** Where in the source the clip starts, and how long it is. */
  startMs: number;
  durationMs: number;
  /** The output frame: even numbers (H.264 needs them), never larger than the source. */
  width: number;
  height: number;
  videoBitsPerSecond: number;
  audioBitsPerSecond: number;
  fps: number;
  estimatedBytes: number;
  /** True when the source is longer than the clip (only part of it is used). */
  trimmed: boolean;
};

export type PlanResult = { ok: true; plan: VideoPlan } | { ok: false; reason: "no_size" | "no_duration" | "too_short" };

const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

export function estimateBytes(durationMs: number, videoBitsPerSecond: number, audioBitsPerSecond: number): number {
  return Math.ceil(((videoBitsPerSecond + audioBitsPerSecond) * (durationMs / 1000) / 8) * VIDEO_LIMITS.overhead);
}

/** The long edge a clip of this length is made at. */
export function longEdgeFor(durationMs: number): number {
  return durationMs <= VIDEO_LIMITS.shortMs ? VIDEO_LIMITS.shortLongEdge : VIDEO_LIMITS.longLongEdge;
}

/** The output size: the long edge at most `longEdge`, never enlarged, both sides even. */
export function frameSize(width: number, height: number, longEdge: number): { width: number; height: number } {
  const scale = Math.min(1, longEdge / Math.max(width, height));
  return { width: even(width * scale), height: even(height * scale) };
}

/** The latest start that still leaves a full-length clip (or 0 when the source is shorter than the clip). */
export function latestStart(durationMs: number, target: VideoTarget): number {
  return Math.max(0, Math.floor(durationMs - VIDEO_LIMITS.maxMs[target]));
}

/** The plan for one source clip. `startMs` is clamped so the clip never runs past the end. */
export function planVideo(source: VideoSource, target: VideoTarget, startMs = 0): PlanResult {
  if (!(source.width > 0 && source.height > 0)) return { ok: false, reason: "no_size" };
  if (!(Number.isFinite(source.durationMs) && source.durationMs > 0)) return { ok: false, reason: "no_duration" };
  if (source.durationMs < VIDEO_LIMITS.minMs) return { ok: false, reason: "too_short" };
  const max = VIDEO_LIMITS.maxMs[target];
  const start = Math.min(Math.max(0, Math.round(startMs) || 0), latestStart(source.durationMs, target));
  const durationMs = Math.min(max, Math.floor(source.durationMs - start));
  const size = frameSize(source.width, source.height, longEdgeFor(durationMs));
  const audio = VIDEO_LIMITS.audioBitsPerSecond;
  let video: number = VIDEO_LIMITS.videoBitsPerSecond;
  // Long clips at the full rate would pass the target: lower the video rate to fit (never below a watchable floor).
  const budget = Math.floor((VIDEO_LIMITS.targetBytes / VIDEO_LIMITS.overhead) * 8 / (durationMs / 1000)) - audio;
  if (budget < video) video = Math.max(250_000, budget);
  return {
    ok: true,
    plan: {
      target, startMs: start, durationMs, width: size.width, height: size.height, videoBitsPerSecond: video, audioBitsPerSecond: audio,
      fps: VIDEO_LIMITS.fps, estimatedBytes: estimateBytes(durationMs, video, audio), trimmed: durationMs < Math.floor(source.durationMs),
    },
  };
}

/** The one retry after a re-encode came out over the bucket limit: the same clip at a lower video rate. */
export function retryPlan(plan: VideoPlan): VideoPlan {
  const video = Math.round(plan.videoBitsPerSecond * VIDEO_LIMITS.retryScale);
  return { ...plan, videoBitsPerSecond: video, estimatedBytes: estimateBytes(plan.durationMs, video, plan.audioBitsPerSecond) };
}

export type PassThrough = { ok: true } | { ok: false; reason: "too_large" | "too_long" | "too_short" | "codec" | "frame" };

/**
 * Whether a picked MP4 can be uploaded as it is (O2 a: a browser that cannot shorten video may still post an MP4 that
 * already fits): H.264 video, AAC or no audio, within the length and the bucket limit, long edge at most 1,280 px.
 */
export function passThroughOk(info: Mp4Info, bytes: number, target: VideoTarget): PassThrough {
  if (bytes > VIDEO_LIMITS.fileBytes) return { ok: false, reason: "too_large" };
  if (!info.video || !/^avc[13]$/.test(info.video.codec)) return { ok: false, reason: "codec" };
  if (info.audio && info.audio.codec !== "mp4a") return { ok: false, reason: "codec" };
  if (info.durationMs === null || info.durationMs > VIDEO_LIMITS.maxMs[target] + 100) return { ok: false, reason: "too_long" };
  if (info.durationMs < VIDEO_LIMITS.minMs) return { ok: false, reason: "too_short" };
  if (Math.max(info.video.width, info.video.height) > VIDEO_LIMITS.shortLongEdge) return { ok: false, reason: "frame" };
  return { ok: true };
}

/** The length stored with the post or story: whole milliseconds, within the place's limit. */
export function storedDuration(durationMs: number, target: VideoTarget): number {
  return Math.min(VIDEO_LIMITS.maxMs[target], Math.max(1, Math.round(durationMs)));
}

/** "0:12" for a length in milliseconds. */
export function clock(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** What the member reads when a video cannot be used. */
export function videoProblem(reason: string, target: VideoTarget): string {
  const max = VIDEO_LIMITS.maxMs[target] / 1000;
  switch (reason) {
    case "too_short": return "That video is too short. Use one of at least 1 second.";
    case "too_long": return `Videos here are up to ${max} seconds.`;
    case "too_large": return "That video is over 3 MB and this browser cannot shorten it.";
    case "source_too_large": return "That video is over 500 MB. Pick a shorter one.";
    case "codec": case "frame": case "no_recorder": return "Video posts need Chrome, Edge or Safari to shorten.";
    case "no_size": case "no_duration": case "not_mp4": case "unreadable": return "This video could not be opened. Try an MP4 or MOV file.";
    case "camera": return "The camera did not start. Check that FITX may use it.";
    default: return "That video could not be prepared. Try again.";
  }
}
