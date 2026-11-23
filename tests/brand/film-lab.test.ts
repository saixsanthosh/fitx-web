import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { COMPOSITIONS } from "@/components/brand/films/compositions";
import { labEnabled } from "@/app/lab/film/lab-gate";
import {
  COMP_SIZES,
  JOBS,
  frameCount,
  framePlan,
  parseArgs,
  reelPlan,
  revHash,
  segmentsOf,
  stableJson,
} from "../../scripts/brand/films/lib/plan.mjs";
import {
  NEEDED_ENCODERS,
  NEEDED_FILTERS,
  parseDfFree,
  parseEncoderList,
  parseFfmpegVersion,
  parseFilterList,
  parseMuxerList,
  preflightProblems,
} from "../../scripts/brand/films/lib/preflight.mjs";
import { KEEPALIVE_MS, POLL_MS, STALE_MS, acquireLane, laneHandle, releaseHeavySlot, staleReason } from "../../scripts/brand/films/lane.mjs";
import { AVC30_SIZES, LEGACY, avc30Args, crfForBudget, hevc60Args, legacyHevcArgs, reelArgs } from "../../scripts/brand/films/lib/encoders.mjs";
import { gateA, mixProblems, moovFirst, parseDetect, parseEbur128, parsePsnrStats, parseSsimPsnr, probeProblems, topLevelBoxes, unexpectedIntervals } from "../../scripts/brand/films/lib/checks.mjs";

/** The intro's clock as `describeFilm` gives it (today's 11.9 s timeline). */
const INTRO = {
  id: "intro",
  duration: 11.9,
  shots: [
    ["0-set", 0, 1.3], ["1a-drive", 1.3, 2.35], ["1b-stride", 2.35, 3.5], ["2a-cadence", 3.5, 4.35], ["2b-wheel", 4.35, 5.1],
    ["3a-plate", 5.1, 5.5], ["3b-chalk", 5.5, 6.05], ["3c-pull", 6.05, 7.25], ["3d-drop", 7.25, 7.55], ["4a-table", 7.55, 8.3],
    ["4b-toast", 8.3, 9.2], ["5a-walk", 9.2, 10.15], ["5b-rise", 10.15, 10.6], ["6-brand", 10.6, 11.9],
  ].map(([id, start, end]) => ({ id: id as string, start: start as number, end: end as number })),
};

// ---------------------------------------------------------------------------------------------- the frame plan

test("frame counts: the duration times 60 (756 for the 12.6 s intro, 720 for the welcome film)", () => {
  assert.equal(frameCount(12.6), 756);
  assert.equal(frameCount(12.0), 720);
  assert.equal(frameCount(11.9), 714);
});

test("gate A's plan: frames 0 to 714 of today's film, one per 1/60 s, each in its own shot", () => {
  const plan = framePlan(INTRO, { frames: { first: 0, last: 714 } });
  assert.equal(plan.length, 715);
  assert.equal(plan[0].time, 0);
  assert.equal(plan[714].time, 11.9);
  assert.equal(plan[78].shot, "1a-drive", "frame 78 (1.3 s) opens 1a-drive");
  assert.equal(plan[77].shot, "0-set");
  for (const frame of plan) assert.deepEqual(frame.subs, [frame.time]);
  const segments = segmentsOf(plan);
  assert.deepEqual(segments.map((segment) => segment.shot), INTRO.shots.map((shot) => shot.id));
  assert.equal(segments.reduce((sum, segment) => sum + segment.frames.length, 0), 715);
  assert.equal(segments[0].name, "00-0-set-0-77");
});

test("previews, shot filters and sub-frames", () => {
  const preview = framePlan(INTRO, { step: 30 });
  assert.deepEqual(preview.map((frame) => frame.index).slice(0, 4), [0, 30, 60, 90]);
  assert.equal(preview.length, Math.ceil(714 / 30));
  const one = framePlan(INTRO, { shots: ["3a-plate"] });
  assert.ok(one.every((frame) => frame.shot === "3a-plate"));
  assert.equal(one.length, 24, "5.1 to 5.5 s at 60 fps");
  assert.throws(() => framePlan(INTRO, { shots: ["nope"] }), /not a shot of intro/);
  const blurred = framePlan(INTRO, { subframes: 2 });
  assert.deepEqual(blurred[1].subs, [1 / 60, 1 / 60 + 1 / 120]);
  // The last frame of a shot never samples past its cut.
  const lastOfSet = blurred.find((frame) => frame.index === 77)!;
  for (const sub of lastOfSet.subs) assert.ok(sub < 1.3, `sub-frame ${sub} stays in 0-set`);
});

test("out-of-order picks keep their order and split into one segment per run", () => {
  const plan = framePlan(INTRO, { pick: [700, 12, 13, 355] });
  assert.deepEqual(plan.map((frame) => frame.index), [700, 12, 13, 355]);
  assert.deepEqual(segmentsOf(plan).map((segment) => [segment.first, segment.last]), [[700, 700], [12, 13], [355, 355]]);
});

test("the landing reel: film time 1.3 to 10.6 at 30 fps is 279 frames, as shipped", () => {
  const plan = reelPlan(JOBS["landing-reel"]);
  assert.equal(plan.length, 279);
  assert.equal(plan[0].time, 1.3);
  assert.ok(Math.abs(plan[278].time - (1.3 + 278 / 30)) < 1e-9);
  // The reel's portrait shape is served by the phone composition, its landscape by laptop.
  assert.equal(JOBS["landing-reel"].shapes.portrait.comp, "phone");
  assert.equal(JOBS["landing-reel"].shapes.landscape.comp, "laptop");
  assert.deepEqual(Object.values(JOBS["landing-reel"].stills).map((still) => [still.time, still.width, still.height]), [[2.05, 1600, 900], [2.05, 720, 1280], [9.9, 1600, 900]]);
  assert.equal(JOBS["landing-reel"].stillQuality, 60);
  assert.equal(JOBS["login-stills"].quality, 70);
  assert.deepEqual(JOBS["login-stills"].frames, { wide: { width: 1600, height: 800 }, tall: { width: 1000, height: 1100 } });
});

test("render sizes match the composition table", () => {
  for (const band of COMPOSITIONS) assert.deepEqual(COMP_SIZES[band.id as keyof typeof COMP_SIZES], { width: band.width, height: band.height }, band.id);
  for (const [comp, size] of Object.entries(AVC30_SIZES)) {
    const full = COMP_SIZES[comp as keyof typeof COMP_SIZES];
    assert.deepEqual(size, { width: full.width * 0.75, height: full.height * 0.75 }, comp);
  }
});

// ------------------------------------------------------------------------------------------- job arguments

test("job arguments: defaults, lists, ranges and refusals", () => {
  const plain = parseArgs(["--job=intro", "--comp=laptop", "--theme=dark", "--frames=0-714"]);
  assert.equal(plain.job, "intro");
  assert.deepEqual(plain.comps, ["laptop"]);
  assert.deepEqual(plain.themes, ["dark"]);
  assert.deepEqual(plain.frames, { first: 0, last: 714 });
  assert.equal(plain.ss, 1);
  assert.equal(plain.subframes, 1);
  assert.equal(plain.port, 3790);
  const all = parseArgs(["--job=welcome"]);
  assert.deepEqual(all.comps, ["phone", "tablet-p", "tablet-l", "laptop", "desktop"]);
  assert.deepEqual(all.themes, ["dark", "light"]);
  assert.equal(parseArgs(["--job=landing-reel"]).ss, 2, "the reel supersamples by default");
  assert.deepEqual(parseArgs(["--job=landing-reel", "--comp=portrait"]).comps, ["portrait"]);
  assert.deepEqual(parseArgs(["--job=login-stills"]).comps, ["wide", "tall"]);
  assert.equal(parseArgs(["--preflight"]).preflight, true);
  assert.deepEqual(parseArgs(["--pick=700,12"]).pick, [700, 12]);
  assert.throws(() => parseArgs(["--job=trailer"]), /--job must be one of/);
  assert.throws(() => parseArgs(["--comp=square"]), /--comp=square is not one of/);
  assert.throws(() => parseArgs(["--frames=10-2"]), /--frames must be a range/);
  assert.throws(() => parseArgs(["--step=0"]), /whole number/);
  assert.throws(() => parseArgs(["--ss=4"]), /at most 3/);
  assert.throws(() => parseArgs(["--subframes=8"]), /at most 4/);
  assert.throws(() => parseArgs(["--colour=red"]), /unknown flag/);
  assert.throws(() => parseArgs(["laptop"]), /unknown argument/);
});

// ----------------------------------------------------------------------------------------------- rev hashing

test("rev hashing: stable, and changed by any source, argument or encoder setting", () => {
  const files = { "a.ts": Buffer.from("one"), "b.ts": Buffer.from("two") };
  const base = revHash({ files, args: { job: "intro", ss: 1 }, encoder: { crf: 29 } });
  assert.match(base, /^[0-9a-f]{64}$/);
  assert.equal(revHash({ files: { "b.ts": Buffer.from("two"), "a.ts": Buffer.from("one") }, args: { ss: 1, job: "intro" }, encoder: { crf: 29 } }), base, "order does not matter");
  assert.notEqual(revHash({ files: { ...files, "a.ts": Buffer.from("one!") }, args: { job: "intro", ss: 1 }, encoder: { crf: 29 } }), base);
  assert.notEqual(revHash({ files: { "c.ts": Buffer.from("one"), "b.ts": Buffer.from("two") }, args: { job: "intro", ss: 1 }, encoder: { crf: 29 } }), base, "a rename counts");
  assert.notEqual(revHash({ files, args: { job: "intro", ss: 2 }, encoder: { crf: 29 } }), base);
  assert.notEqual(revHash({ files, args: { job: "intro", ss: 1 }, encoder: { crf: 30 } }), base);
  assert.equal(stableJson({ b: [1, { d: 1, c: 2 }], a: null }), '{"a":null,"b":[1,{"c":2,"d":1}]}');
});

// --------------------------------------------------------------------------------------------- preflight parsing

const FILTERS = ` TS ssim              VV->V      Calculate the SSIM between two video streams.
 T. vflip             V->V       Flip the input video vertically.
 TSC scale            V->V       Scale the input video size and/or convert the image format.
 .. setparams         V->V       Force field, or color property for the output video frame.
 TS tmix              V->V       Mix successive video frames.
 TS psnr              VV->V      Calculate the PSNR between two video streams.
 .. ebur128           A->N       EBU R128 scanner.
 .. loudnorm          A->A       EBU R128 loudness normalization
 .. freezedetect      V->V       Detects frozen video input.
 .. blackdetect       V->V       Detect video intervals that are (almost) black.
 .. zscale            V->V       (not on this Mac)`;

test("preflight parsing: ffmpeg's version, filters, encoders, muxers and df", () => {
  assert.deepEqual(parseFfmpegVersion("ffmpeg version 8.1.1 Copyright (c) 2000-2026 the FFmpeg developers\nbuilt with"), { line: "ffmpeg version 8.1.1 Copyright (c) 2000-2026 the FFmpeg developers", version: "8.1.1" });
  const filters = parseFilterList(FILTERS);
  for (const name of ["ssim", "vflip", "scale", "setparams", "tmix", "psnr", "ebur128", "loudnorm", "freezedetect", "blackdetect"]) assert.ok(filters.has(name), name);
  assert.deepEqual([...parseEncoderList(" V....D libx265              libx265 H.265 / HEVC (codec hevc)\n V.S..D ffv1                 FFmpeg video codec #1\n A....D aac   AAC")].sort(), ["aac", "ffv1", "libx265"]);
  assert.ok(parseMuxerList("  E  framemd5        Per-frame MD5 testing\n DE matroska,webm   Matroska").has("framemd5"));
  const df = "Filesystem   1024-blocks      Used Available Capacity iused      ifree %iused  Mounted on\n/dev/disk3s5   971350180 356105688 575494904    39% 7795601 5754949040    0%   /System/Volumes/Data";
  assert.equal(parseDfFree(df), 575494904 * 1024);
});

test("preflight problems: nothing missing passes; zscale is never needed; software GPUs and full disks fail", () => {
  const good = {
    playwright: true, chrome: true, cwebp: true, ffmpeg: { version: "8.1.1", line: "" }, freeBytes: 500 * 1024 ** 3,
    filters: [...NEEDED_FILTERS], encoders: [...NEEDED_ENCODERS], gpu: "ANGLE (Apple, ANGLE Metal Renderer: Apple M3, Unspecified Version)",
  };
  assert.deepEqual(preflightProblems(good), []);
  assert.ok(!NEEDED_FILTERS.includes("zscale"));
  assert.match(preflightProblems({ ...good, gpu: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)" }).join(), /software renderer/);
  assert.match(preflightProblems({ ...good, gpu: null }).join(), /no WebGL2/);
  assert.match(preflightProblems({ ...good, freeBytes: 3 * 1024 ** 3 }).join(), /3\.0 GB free/);
  assert.match(preflightProblems({ ...good, filters: good.filters.filter((name) => name !== "tmix") }).join(), /lacks tmix/);
  assert.match(preflightProblems({ ...good, encoders: ["libx264", "ffv1"] }).join(), /libx265 encoder/);
  assert.deepEqual(preflightProblems({ ...good, gpu: null }, { needGpu: false }), []);
});

// ---------------------------------------------------------------------------------------------------- the lock

/** A fake clock and an in-memory view of a real temporary directory (the lock is a real mkdir). */
function laneFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "fitx-lane-"));
  const dir = path.join(root, ".e2e-lock");
  let clock = Date.parse("2026-11-23T10:00:00Z");
  const now = () => clock;
  const sleeps: number[] = [];
  const sleep = async (ms: number) => {
    sleeps.push(ms);
    clock += ms;
  };
  const age = (ms: number) => {
    const at = new Date(clock - ms);
    utimesSync(dir, at, at);
  };
  return { root, dir, now, sleep, sleeps, age, advance: (ms: number) => (clock += ms), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("the lock: slot release gives back only our own heavy.sh slot", () => {
  const root = mkdtempSync(path.join(tmpdir(), "fitx-slot-"));
  try {
    const slot = path.join(root, ".heavy-slot-1");
    mkdirSync(slot);
    writeFileSync(path.join(slot, "pid"), "4242\n");
    const foreign = { FITX_HEAVY_SLOT: slot } as Record<string, string | undefined>;
    assert.equal(releaseHeavySlot({ env: foreign, ppid: 1111 }), null, "another process's slot stays");
    assert.ok(existsSync(slot));
    assert.equal(foreign.FITX_HEAVY_SLOT, slot);
    const ours = { FITX_HEAVY_SLOT: slot } as Record<string, string | undefined>;
    assert.equal(releaseHeavySlot({ env: ours, ppid: 4242 }), slot);
    assert.ok(!existsSync(slot), "our parent's slot is removed");
    assert.equal(ours.FITX_HEAVY_SLOT, undefined, "and the variable unset");
    assert.equal(releaseHeavySlot({ env: {}, ppid: 4242 }), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the lock: a free lane is taken at once with pid and job written", async () => {
  const lane = laneFixture();
  try {
    const handle = await acquireLane({ kind: "render:intro", label: "gate A", dir: lane.dir, now: lane.now, sleep: lane.sleep, pid: 777, log: () => {} });
    assert.equal(readFileSync(path.join(lane.dir, "pid"), "utf8").trim(), "777");
    const job = JSON.parse(readFileSync(path.join(lane.dir, "job"), "utf8"));
    assert.deepEqual(job, { kind: "render:intro", label: "gate A", start: "2026-11-23T10:00:00.000Z" });
    assert.deepEqual(lane.sleeps, []);
    assert.ok(handle.ours());
    handle.release();
    assert.ok(!existsSync(lane.dir));
  } finally {
    lane.cleanup();
  }
});

test("the lock: a live owner is waited for (15 s polls); an exited owner or a lock older than 120 minutes is taken over", async () => {
  const lane = laneFixture();
  try {
    mkdirSync(lane.dir);
    writeFileSync(path.join(lane.dir, "pid"), "5000\n");
    lane.age(0);
    let alive = true;
    // The owner lives for three polls, then exits.
    const sleep = async (ms: number) => {
      await lane.sleep(ms);
      if (lane.sleeps.length === 3) alive = false;
    };
    await acquireLane({ kind: "encode", label: "x", dir: lane.dir, now: lane.now, sleep, alive: () => alive, pid: 6000, log: () => {} });
    assert.deepEqual(lane.sleeps, [POLL_MS, POLL_MS, POLL_MS]);
    assert.equal(readFileSync(path.join(lane.dir, "pid"), "utf8").trim(), "6000");
    rmSync(lane.dir, { recursive: true });

    // Old: the owner still runs (or its PID was reused) but nobody touched the lock for over two hours.
    mkdirSync(lane.dir);
    writeFileSync(path.join(lane.dir, "pid"), "5000\n");
    lane.age(STALE_MS + 1000);
    assert.equal(staleReason(lane.dir, { now: lane.now, alive: () => true }), "old");
    lane.age(STALE_MS - 1000);
    assert.equal(staleReason(lane.dir, { now: lane.now, alive: () => true }), null);
    assert.equal(staleReason(lane.dir, { now: lane.now, alive: () => false }), "exited");
    // No pid yet (between mkdir and the write): never "exited", only "old".
    rmSync(path.join(lane.dir, "pid"));
    assert.equal(staleReason(lane.dir, { now: lane.now, alive: () => false }), null);
  } finally {
    lane.cleanup();
  }
});

test("the lock: keep-alive touches at least every 10 minutes, so a 2.5 h job never turns stale", async () => {
  const lane = laneFixture();
  try {
    const handle = await acquireLane({ kind: "render:intro", label: "overnight", dir: lane.dir, now: lane.now, sleep: lane.sleep, pid: 1, log: () => {} });
    assert.ok(KEEPALIVE_MS <= 10 * 60 * 1000);
    // A fake timer: the callback runs each "minute" of a 150-minute job.
    let tick: () => void = () => {};
    handle.startKeepAlive(((fn: () => void) => {
      tick = fn;
      return 1;
    }) as unknown as typeof setInterval, (() => {}) as unknown as typeof clearInterval);
    let longestGap = 0;
    let lastTouch = handle.lastTouch;
    for (let minute = 1; minute <= 150; minute += 1) {
      lane.advance(60 * 1000);
      tick();
      if (handle.lastTouch !== lastTouch) {
        longestGap = Math.max(longestGap, handle.lastTouch - lastTouch);
        lastTouch = handle.lastTouch;
      }
      assert.equal(staleReason(lane.dir, { now: lane.now, alive: () => true }), null, `fresh at minute ${minute}`);
    }
    assert.ok(longestGap <= 10 * 60 * 1000, `longest gap ${longestGap / 60000} min`);
    assert.ok(Math.abs(statSync(lane.dir).mtimeMs - lastTouch) < 1000, "the directory's own time moved");
    // A segment finishing touches at once.
    lane.advance(30 * 1000);
    assert.equal(handle.touch(), lane.now());
    handle.release();
  } finally {
    lane.cleanup();
  }
});

test("the lock: release removes only a lock that is still ours", () => {
  const lane = laneFixture();
  try {
    mkdirSync(lane.dir);
    writeFileSync(path.join(lane.dir, "pid"), "999\n");
    laneHandle({ dir: lane.dir, now: lane.now, pid: 1 }).release();
    assert.ok(existsSync(lane.dir), "someone else's lock stays");
    laneHandle({ dir: lane.dir, now: lane.now, pid: 999 }).release();
    assert.ok(!existsSync(lane.dir));
  } finally {
    lane.cleanup();
  }
});

// ------------------------------------------------------------------------------------- encoders and checks

test("encoders: the new rungs carry bt709 tv tags and faststart; the legacy HEVC repeats the shipped settings", () => {
  const hevc = hevc60Args({ input: "m.mkv", output: "o.mp4" }).join(" ");
  assert.match(hevc, /-c:v libx265 -preset slow -crf 29/);
  assert.match(hevc60Args({ input: "m.mkv", output: "o.mp4", tune: "grain" }).join(" "), /-preset slow -tune grain -crf 29/);
  assert.match(hevc, /keyint=60:min-keyint=60:level-idc=4\.1:high-tier=1:vbv-maxrate=50000:vbv-bufsize=50000:pools=4/);
  assert.match(hevc, /-tag:v hvc1 -color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv -movflags \+faststart/);
  const avc = avc30Args({ input: "m.mkv", output: "o.mp4", comp: "phone" }).join(" ");
  assert.match(avc, /fps=30,scale=720:1440:flags=lanczos/);
  assert.match(avc, /-g 30 -keyint_min 30/);
  const legacy = legacyHevcArgs({ input: "m.mkv", output: "o.mp4" }).join(" ");
  assert.match(legacy, /out_color_matrix=bt601/);
  assert.match(legacy, /-preset medium -crf 29 -x265-params keyint=120:min-keyint=60:bframes=4/);
  assert.equal(LEGACY.h264_30.width, 960);
  assert.equal(LEGACY.h264_60.preset, "slow");
  assert.match(reelArgs({ input: "m.mkv", output: "r.mp4", shape: "portrait" }).join(" "), /-preset slow -profile:v high -crf 27 -g 250 -color_primaries bt709/);
  assert.match(reelArgs({ input: "m.mkv", output: "r.mp4", shape: "landscape" }).join(" "), /-crf 29/);
  assert.throws(() => reelArgs({ input: "m.mkv", output: "r.mp4", shape: "square" }), /unknown reel shape/);
  assert.equal(crfForBudget(29, 4e6, 3.4 * 1024 * 1024), 30);
  assert.equal(crfForBudget(29, 1e6, 3.4 * 1024 * 1024), 28);
  assert.equal(crfForBudget(29, 3.3 * 1024 * 1024, 3.4 * 1024 * 1024), 29);
});

test("checks: a cut's probe, its boxes, detectors, loudness and comparisons", () => {
  const probe = {
    streams: [{ codec_type: "video", codec_name: "hevc", profile: "Main", width: 1920, height: 1080, r_frame_rate: "60/1", nb_read_frames: "756", level: 123, color_primaries: "bt709", color_transfer: "bt709", color_space: "bt709", color_range: "tv", pix_fmt: "yuv420p", codec_tag_string: "hvc1" }],
  };
  const expect = { codec: "hevc", profile: "Main", width: 1920, height: 1080, fps: 60, frames: 756, maxLevel: 123 };
  assert.deepEqual(probeProblems(probe, expect), []);
  const shipped = { streams: [{ ...probe.streams[0], nb_read_frames: "715", color_primaries: undefined, color_transfer: undefined, color_space: undefined }] };
  assert.deepEqual(probeProblems(shipped, expect), ["715 frames, expected 756", "color_primaries is untagged, expected bt709", "color_transfer is untagged, expected bt709", "color_space is untagged, expected bt709"]);

  const box = (type: string, size: number) => {
    const buffer = Buffer.alloc(size);
    buffer.writeUInt32BE(size, 0);
    buffer.write(type, 4, "latin1");
    return buffer;
  };
  assert.ok(moovFirst(topLevelBoxes(Buffer.concat([box("ftyp", 24), box("moov", 40), box("mdat", 16)]))));
  assert.ok(!moovFirst(topLevelBoxes(Buffer.concat([box("ftyp", 24), box("mdat", 16), box("moov", 40)]))));

  const detect = parseDetect("[freezedetect @ 0x1] lavfi.freezedetect.freeze_start: 10.95\n[freezedetect @ 0x1] lavfi.freezedetect.freeze_end: 11.9\n[blackdetect @ 0x2] black_start:7.3 black_end:7.4 black_duration:0.1");
  assert.deepEqual(detect.freezes, [{ start: 10.95, end: 11.9 }]);
  assert.deepEqual(detect.blacks, [{ start: 7.3, end: 7.4 }]);
  assert.deepEqual(unexpectedIntervals(detect.freezes, [{ start: 10.9, end: 12.6 }]), []);
  assert.equal(unexpectedIntervals(detect.blacks, [{ start: 10.9, end: 12.6 }]).length, 1);

  const loud = parseEbur128("...\nSummary:\n\n  Integrated loudness:\n    I:         -16.2 LUFS\n    Threshold: -26.3 LUFS\n\n  Loudness range:\n    LRA:         4.1 LU\n\n  True peak:\n    Peak:       -1.4 dBFS");
  assert.deepEqual(loud, { integrated: -16.2, truePeak: -1.4, lra: 4.1 });
  assert.deepEqual(mixProblems(loud, { duration: 12.605, expected: 12.6 }), []);
  assert.equal(mixProblems({ ...loud, integrated: -20 }, { duration: 1.2, expected: 1.2, sting: true }).length, 0, "the sting has no integrated target");
  assert.match(mixProblems({ ...loud, truePeak: -0.5 }, { duration: 12.63, expected: 12.6 }).join(), /true peak -0\.5.*length 12\.630/);

  assert.deepEqual(parseSsimPsnr("[Parsed_ssim_4 @ 0x] SSIM Y:0.98 (17) U:0.99 (20) V:0.99 (20) All:0.983 (17.7)\n[Parsed_psnr_5 @ 0x] PSNR y:44 u:48 v:48 average:45.12 min:40 max:50"), { ssim: 0.983, psnr: 45.12 });
  assert.deepEqual(parsePsnrStats("n:1 mse_avg:0.00 psnr_avg:inf\nn:2 mse_avg:0.01 psnr_avg:68.20"), [Infinity, 68.2]);
});

test("gate A: SSIM 0.97 passes; below it only a deterministic lab reaches the owner's side-by-side", () => {
  assert.equal(gateA({ ssim: 0.975, determinismPsnr: [] }).route, "A");
  assert.equal(gateA({ ssim: 0.95, determinismPsnr: [Infinity, 60, 58] }).route, "A'");
  assert.equal(gateA({ ssim: 0.95, determinismPsnr: [Infinity, 50] }).route, "fail");
  assert.equal(gateA({ ssim: 0.95, determinismPsnr: [] }).route, "fail");
});

// --------------------------------------------------------------------------------------------- the lab page

test("the lab opens only in development with FITX_LAB=1, is noindex, and loads films only through FILM_DEFS", () => {
  assert.equal(labEnabled({ NODE_ENV: "development", FITX_LAB: "1" }), true);
  assert.equal(labEnabled({ NODE_ENV: "production", FITX_LAB: "1" }), false);
  assert.equal(labEnabled({ NODE_ENV: "development" }), false);
  assert.equal(labEnabled({ NODE_ENV: "test", FITX_LAB: "0" }), false);
  const root = new URL("../../", import.meta.url);
  const page = readFileSync(new URL("src/app/lab/film/page.tsx", root), "utf8");
  assert.match(page, /robots: \{ index: false, follow: false \}/);
  assert.match(page, /if \(!labEnabled\(process\.env\)\) notFound\(\);/);
  const lab = readFileSync(new URL("src/app/lab/film/FilmLab.tsx", root), "utf8");
  assert.doesNotMatch(lab, /films\/welcome|intro-def|director\/shots/, "no film module is imported directly");
  assert.match(lab, /FILM_DEFS\[args\.film\]\(\)/);
  assert.match(lab, /quality: LAB_QUALITY/);
  assert.match(lab, /gl\.readPixels\(/);
});
