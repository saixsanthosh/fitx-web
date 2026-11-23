// Pure checks for verify.mjs (BRIEF-2 3.2): what an encoded cut, a mix and a comparison must show. Each takes the
// parsed tool output and returns a list of problems (empty when it passes) or the measured numbers.

/** HEVC and H.264 level numbers as ffprobe reports them (HEVC: level × 30; H.264: level × 10). */
export const LEVELS = Object.freeze({ hevc: { "4.1": 123 }, h264: { "3.0": 30, "3.1": 31, "4.0": 40, "4.1": 41, "4.2": 42 } });

/** Frames each film's 60 fps cut has (BRIEF-2 3.2), and its 30 fps light cut. */
export const FILM_FRAMES = Object.freeze({ intro: 756, welcome: 720 });

/**
 * Problems with one encoded cut, from `ffprobe -show_streams -show_format -count_frames -of json`.
 * `expect`: { codec: "hevc"|"h264", width, height, fps, frames, maxLevel, profile?, sha256?, actualSha256? }.
 */
export function probeProblems(probe, expect) {
  const problems = [];
  const video = (probe.streams ?? []).find((stream) => stream.codec_type === "video");
  if (!video) return ["no video stream"];
  if (video.codec_name !== expect.codec) problems.push(`codec ${video.codec_name}, expected ${expect.codec}`);
  if (expect.profile && video.profile !== expect.profile) problems.push(`profile ${video.profile}, expected ${expect.profile}`);
  if (expect.width && (video.width !== expect.width || video.height !== expect.height)) problems.push(`size ${video.width}x${video.height}, expected ${expect.width}x${expect.height}`);
  const [num, den] = String(video.r_frame_rate ?? "0/1").split("/").map(Number);
  if (expect.fps && Math.abs(num / den - expect.fps) > 1e-6) problems.push(`frame rate ${video.r_frame_rate}, expected ${expect.fps}`);
  const frames = Number(video.nb_read_frames ?? video.nb_frames);
  if (expect.frames && frames !== expect.frames) problems.push(`${frames} frames, expected ${expect.frames}`);
  if (expect.maxLevel && !(Number(video.level) <= expect.maxLevel)) problems.push(`level ${video.level} is above ${expect.maxLevel}`);
  for (const [key, want] of [["color_primaries", "bt709"], ["color_transfer", "bt709"], ["color_space", "bt709"], ["color_range", "tv"]]) {
    if (video[key] !== want) problems.push(`${key} is ${video[key] ?? "untagged"}, expected ${want}`);
  }
  if (video.pix_fmt !== "yuv420p") problems.push(`pixel format ${video.pix_fmt}, expected yuv420p`);
  if (expect.codec === "hevc" && video.codec_tag_string !== "hvc1") problems.push(`HEVC tag ${video.codec_tag_string}, expected hvc1 (Safari needs it)`);
  if (expect.sha256 && expect.actualSha256 && expect.sha256 !== expect.actualSha256) problems.push("SHA-256 differs from the manifest");
  return problems;
}

/** Top-level MP4 box names in order, from the first bytes of a file (enough to see whether moov precedes mdat). */
export function topLevelBoxes(buffer) {
  const boxes = [];
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    if (size === 1 && offset + 16 <= buffer.length) size = Number(buffer.readBigUInt64BE(offset + 8));
    boxes.push(type);
    if (size < 8) break;
    offset += size;
  }
  return boxes;
}

export function moovFirst(boxes) {
  const moov = boxes.indexOf("moov");
  const mdat = boxes.indexOf("mdat");
  return moov !== -1 && (mdat === -1 || moov < mdat);
}

/** `[freezedetect]`/`[blackdetect]` intervals from ffmpeg's log. */
export function parseDetect(log) {
  const freezes = [];
  let open = null;
  for (const line of String(log).split("\n")) {
    const start = /freeze_start: ([\d.]+)/.exec(line);
    const end = /freeze_end: ([\d.]+)/.exec(line);
    if (start) open = Number(start[1]);
    if (end && open !== null) {
      freezes.push({ start: open, end: Number(end[1]) });
      open = null;
    }
  }
  if (open !== null) freezes.push({ start: open, end: Infinity });
  const blacks = [];
  for (const match of String(log).matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)) blacks.push({ start: Number(match[1]), end: Number(match[2]) });
  return { freezes, blacks };
}

/** Detected intervals that are not inside an authored fade or hold (`allowed`: [{ start, end }], seconds). */
export function unexpectedIntervals(intervals, allowed, slack = 0.02) {
  return intervals.filter((interval) => !allowed.some((fade) => interval.start >= fade.start - slack && interval.end <= fade.end + slack));
}

/** The `Summary:` block of ffmpeg's ebur128 filter → { integrated, truePeak, lra }. */
export function parseEbur128(log) {
  const text = String(log);
  const tail = text.slice(text.lastIndexOf("Summary:"));
  const number = (pattern) => {
    const match = pattern.exec(tail);
    return match ? Number(match[1]) : null;
  };
  return { integrated: number(/I:\s+(-?[\d.]+) LUFS/), truePeak: number(/Peak:\s+(-?[\d.]+) dBFS/), lra: number(/LRA:\s+(-?[\d.]+) LU/) };
}

/** Problems with a film mix (I −16 ± 1 LUFS, TP ≤ −1 dBTP, length ± 10 ms) or the sting (TP and length only). */
export function mixProblems(loudness, { duration, expected, sting = false }) {
  const problems = [];
  if (!sting && (loudness.integrated === null || Math.abs(loudness.integrated + 16) > 1)) problems.push(`integrated loudness ${loudness.integrated} LUFS, expected -16 ± 1`);
  if (loudness.truePeak === null || loudness.truePeak > -1) problems.push(`true peak ${loudness.truePeak} dBTP, expected at most -1`);
  if (Math.abs(duration - expected) > 0.01) problems.push(`length ${duration.toFixed(3)} s, expected ${expected} ± 0.010`);
  return problems;
}

/** `SSIM ... All:0.97 (15.2)` and `PSNR ... average:41.3` from ffmpeg's ssim and psnr filters. */
export function parseSsimPsnr(log) {
  const text = String(log);
  const ssim = /SSIM .*All:([\d.]+)/.exec(text);
  const psnr = /PSNR .*average:(inf|[\d.]+)/.exec(text);
  return { ssim: ssim ? Number(ssim[1]) : null, psnr: psnr ? (psnr[1] === "inf" ? Infinity : Number(psnr[1])) : null };
}

/** Per-frame PSNR lines from `psnr=stats_file=-` → numbers (Infinity for identical frames). */
export function parsePsnrStats(text) {
  return String(text).split("\n").filter((line) => line.includes("psnr_avg")).map((line) => {
    const match = /psnr_avg:(inf|[\d.]+)/.exec(line);
    return match ? (match[1] === "inf" ? Infinity : Number(match[1])) : null;
  });
}

/** Gate A (BRIEF-2 1.2): pass on SSIM ≥ 0.97; the A′ fallback needs a deterministic lab (every frame ≥ 55 dB). */
export function gateA({ ssim, determinismPsnr }) {
  if (ssim !== null && ssim >= 0.97) return { pass: true, route: "A", reason: `SSIM ${ssim.toFixed(4)} >= 0.97` };
  const deterministic = determinismPsnr.length > 0 && determinismPsnr.every((value) => value !== null && value >= 55);
  if (deterministic) return { pass: "pending-owner", route: "A'", reason: `SSIM ${ssim?.toFixed(4)} < 0.97; the lab is deterministic (min ${Math.min(...determinismPsnr)} dB), so the owner's side-by-side decides` };
  return { pass: false, route: "fail", reason: `SSIM ${ssim?.toFixed(4)} < 0.97 and the lab is not deterministic` };
}
