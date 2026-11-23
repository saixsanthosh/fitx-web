// Encoder settings (BRIEF-2 3.2) and the settings the shipped cuts were made with (recovered for gate A from the
// encoder SEI strings and ffprobe; README.md lists them). Pure: these build ffmpeg argument lists, nothing runs here.

/** The colour tags every new file carries (today's cuts are untagged, except HEVC's range). */
export const BT709_TV = Object.freeze(["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv"]);

/** The 0.75× AVC 30 sizes per composition. */
export const AVC30_SIZES = Object.freeze({
  phone: { width: 720, height: 1440 },
  "tablet-p": { width: 900, height: 1200 },
  "tablet-l": { width: 1200, height: 900 },
  laptop: { width: 1440, height: 810 },
  desktop: { width: 1440, height: 720 },
});

/**
 * The new rungs. `hevc60` starts from the recovered crf 29 and is tuned to the byte budget by `crfForBudget`; keyint
 * 60 (one a second), VBV at HEVC level 4.1 high tier. BRIEF-2 3.2 asked for `--tune grain`; measured on gate A's master
 * (11.9 s, 1920×1080 dark) it doubles the bytes for a lower score: crf 29 5.79 MiB, crf 32 3.98 MiB (SSIM 0.967 to the
 * master), against 3.08 MiB (SSIM 0.972) with no tune at crf 29. So the default is no tune; `encode.mjs --tune=grain`
 * restores it if the coordinator wants it. `pools=4` on this 8-core Mac. `avc30` steps its CRF to the budget the same
 * way (crf 27 at 1440×810 made 2.52 MiB for the 11.9 s film, over the 1.6 MiB cap; crf 32 made 1.47 MiB).
 */
export const ENCODER = Object.freeze({
  hevc60: { codec: "libx265", preset: "slow", crf: 29, tune: "none", keyint: 60, level: "4.1", highTier: true, vbvMaxrate: 50000, vbvBufsize: 50000, pools: 4, tag: "hvc1", fps: 60 },
  avc30: { codec: "libx264", preset: "slow", crf: 27, profile: "high", keyint: 30, fps: 30, scale: 0.75 },
  poster: { tool: "cwebp", quality: 82, maxBytes: 50 * 1024 },
});

/** Byte budgets per file (film-manifest.test.ts holds the final numbers; A, retuned after gate A). */
export const BUDGET = Object.freeze({ hevc60: 3.4 * 1024 * 1024, avc30: 1.6 * 1024 * 1024, poster: 50 * 1024 });

/**
 * The shipped cuts' settings, exactly as their SEI strings say (x265 4.2 / x264 core 165, through ffmpeg's libavcodec
 * 62.28.101). Masters were converted from RGB without a colour matrix, so ffmpeg's default (BT.601, limited range)
 * applied, and nothing was tagged except HEVC's range.
 */
export const LEGACY = Object.freeze({
  hevc60: {
    codec: "libx265", preset: "medium", crf: 29, x265: "keyint=120:min-keyint=60:bframes=4:level-idc=4.1:high-tier=1:vbv-maxrate=50000:vbv-bufsize=50000:aq-mode=2:psy-rd=2.0:range=limited",
    tag: "hvc1", matrix: "bt601",
  },
  // x264's "slow" preset is exactly subme 8, ref 5 (capped by the level), trellis 2 and lookahead 50 with medium's hex
  // search and b-adapt 1: what all three strings show.
  h264_60: { codec: "libx264", preset: "slow", crf: 27, keyint: 120, level: "4.2", matrix: "bt601" },
  h264_30: { codec: "libx264", preset: "slow", crf: 29, keyint: 60, level: "3.0", width: 960, height: 540, matrix: "bt601" },
  // The landing reels (public/media/landing-film/reel-*.mp4): the same preset, ffmpeg's default keyint 250, level 3.1.
  reel: { codec: "libx264", preset: "slow", crf: { landscape: 29, portrait: 27 }, keyint: 250, level: "3.1", fps: 30 },
});

/** ffmpeg arguments: a landing-reel master (30 fps, already at the reel's size) → the reel, H.264 High, tagged. */
export function reelArgs({ input, output, shape }) {
  const e = LEGACY.reel;
  const crf = e.crf[shape];
  if (crf === undefined) throw new Error(`unknown reel shape ${shape}`);
  return [
    "-hide_banner", "-loglevel", "error", "-y", "-i", input, "-an", "-vf", "format=yuv420p",
    "-c:v", e.codec, "-preset", e.preset, "-profile:v", "high", "-crf", String(crf), "-g", String(e.keyint),
    ...BT709_TV, "-movflags", "+faststart", output,
  ];
}

const even = (value) => Math.max(2, Math.round(value / 2) * 2);

/** ffmpeg arguments: master → hevc60 (the master is already bt709 tv-range YUV 4:4:4 10-bit). */
export function hevc60Args({ input, output, crf = ENCODER.hevc60.crf, frames = null, tune = ENCODER.hevc60.tune }) {
  const e = ENCODER.hevc60;
  const x265 = [
    `keyint=${e.keyint}`, `min-keyint=${e.keyint}`, `level-idc=${e.level}`, `high-tier=${e.highTier ? 1 : 0}`,
    `vbv-maxrate=${e.vbvMaxrate}`, `vbv-bufsize=${e.vbvBufsize}`, `pools=${e.pools}`,
    "colorprim=bt709", "transfer=bt709", "colormatrix=bt709", "range=limited", "log-level=error",
  ].join(":");
  return [
    "-hide_banner", "-loglevel", "error", "-y", "-i", input, ...(frames ? ["-frames:v", String(frames)] : []),
    "-an", "-vf", "format=yuv420p", "-c:v", e.codec, "-preset", e.preset, ...(tune && tune !== "none" ? ["-tune", tune] : []), "-crf", String(crf), "-x265-params", x265,
    "-tag:v", e.tag, ...BT709_TV, "-movflags", "+faststart", output,
  ];
}

/** ffmpeg arguments: master → avc30 (every other frame, 0.75× size, lanczos). */
export function avc30Args({ input, output, comp, crf = ENCODER.avc30.crf }) {
  const e = ENCODER.avc30;
  const size = AVC30_SIZES[comp];
  if (!size) throw new Error(`unknown composition ${comp}`);
  return [
    "-hide_banner", "-loglevel", "error", "-y", "-i", input, "-an",
    "-vf", `fps=${e.fps},scale=${even(size.width)}:${even(size.height)}:flags=lanczos,format=yuv420p`,
    "-c:v", e.codec, "-preset", e.preset, "-profile:v", e.profile, "-crf", String(crf), "-g", String(e.keyint), "-keyint_min", String(e.keyint),
    ...BT709_TV, "-movflags", "+faststart", output,
  ];
}

/** ffmpeg arguments: frame 0 of a master as a PNG for cwebp (bt709 → sRGB). */
export function posterPngArgs({ input, output, width = null, height = null, time = 0 }) {
  const scale = width && height ? `scale=${width}:${height}:flags=lanczos:in_color_matrix=bt709:in_range=tv,` : "scale=in_color_matrix=bt709:in_range=tv,";
  return ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(time), "-i", input, "-frames:v", "1", "-vf", `${scale}format=rgb24`, output];
}

/** cwebp arguments for a poster at a quality. */
export function cwebpArgs({ input, output, quality = ENCODER.poster.quality }) {
  return ["-quiet", "-q", String(quality), "-m", "6", "-sharp_yuv", input, "-o", output];
}

/** The legacy HEVC encode used by gate A on the new master (bt709 master → BT.601 YUV 4:2:0, as the old pipeline made). */
export function legacyHevcArgs({ input, output }) {
  const e = LEGACY.hevc60;
  return [
    "-hide_banner", "-loglevel", "error", "-y", "-i", input, "-an",
    "-vf", "scale=in_color_matrix=bt709:in_range=tv:out_color_matrix=bt601:out_range=tv,format=yuv420p",
    "-c:v", e.codec, "-preset", e.preset, "-crf", String(e.crf), "-x265-params", `${e.x265}:log-level=error`, "-tag:v", e.tag,
    "-movflags", "+faststart", output,
  ];
}

/**
 * The next CRF to try for a byte budget (whole steps): one up when over, one down when there is more than 15% room,
 * else the same (done). Bounded to 20..40.
 */
export function crfForBudget(crf, bytes, budget) {
  if (bytes > budget) return Math.min(40, crf + 1);
  if (bytes < budget * 0.85) return Math.max(20, crf - 1);
  return crf;
}
