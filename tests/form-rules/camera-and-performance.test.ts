import { test } from "node:test";
import assert from "node:assert/strict";
import { CameraError, cameraHelp, cameraProblemFromError, detectPlatform } from "@/lib/pose/camera";
import { FrameGovernor, initialProfile } from "@/lib/pose/performance";

const named = (name: string) => Object.assign(new Error(name), { name });

test("camera failures map to problems the user can act on", () => {
  assert.equal(cameraProblemFromError(named("NotAllowedError")), "denied");
  assert.equal(cameraProblemFromError(named("SecurityError")), "denied");
  assert.equal(cameraProblemFromError(named("NotFoundError")), "no-camera");
  assert.equal(cameraProblemFromError(named("NotReadableError")), "busy");
  assert.equal(cameraProblemFromError(named("OverconstrainedError")), "constraints");
  assert.equal(cameraProblemFromError(named("AbortError")), "interrupted");
  assert.equal(cameraProblemFromError(new CameraError("insecure")), "insecure");
  assert.equal(cameraProblemFromError("weird"), "unknown");
  assert.equal(cameraProblemFromError(null), "unknown");
});

test("denied-camera help is specific to the phone", () => {
  assert.match(cameraHelp("denied", "ios").body, /Website Settings/);
  assert.match(cameraHelp("denied", "android").body, /Permissions/);
  assert.match(cameraHelp("denied", "other").body, /address bar/);
  for (const problem of ["insecure", "unsupported", "no-camera", "busy", "constraints", "interrupted", "unknown"] as const) {
    const help = cameraHelp(problem, "other");
    assert.ok(help.title && help.body, problem);
  }
});

test("platform detection recognises iPhone, iPad (desktop mode) and Android", () => {
  assert.equal(detectPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X)"), "ios");
  assert.equal(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5), "ios");
  assert.equal(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0), "other");
  assert.equal(detectPlatform("Mozilla/5.0 (Linux; Android 15; Pixel 8)"), "android");
});

test("weak devices and data saver start light; everything else starts on the full model at the best native resolution", () => {
  assert.deepEqual(initialProfile({ mobile: true, cores: 2 }), { model: "lite", width: 640, height: 480, maxFps: 15 });
  assert.deepEqual(initialProfile({ mobile: true, memoryGb: 2, cores: 8 }), { model: "lite", width: 640, height: 480, maxFps: 15 });
  assert.deepEqual(initialProfile({ mobile: false, cores: 12, saveData: true }), { model: "lite", width: 640, height: 480, maxFps: 15 });
  // Phones: 1080p where they are capable, 720p otherwise, and fewer frames a second to keep them cool.
  assert.deepEqual(initialProfile({ mobile: true, cores: 8, memoryGb: 8 }), { model: "full", width: 1920, height: 1080, maxFps: 24 });
  assert.deepEqual(initialProfile({ mobile: true, cores: 8 }), { model: "full", width: 1920, height: 1080, maxFps: 24 });
  assert.deepEqual(initialProfile({ mobile: true, cores: 4 }), { model: "full", width: 1280, height: 720, maxFps: 24 });
  // Desktops and laptops: up to 4K where the camera has it (an ideal size never upscales; see capture.ts).
  assert.deepEqual(initialProfile({ mobile: false, cores: 10 }), { model: "full", width: 3840, height: 2160, maxFps: 30 });
  assert.deepEqual(initialProfile({ mobile: false, cores: 4 }), { model: "full", width: 1920, height: 1080, maxFps: 30 });
});

/** Feeds the governor frames every 16 ms (a 60 Hz camera) whose detection takes `inferenceMs`. */
function drive(governor: FrameGovernor, inferenceMs: number, fromMs: number, toMs: number, profile = initialProfile({ mobile: false, cores: 10 })) {
  const advice: string[] = [];
  for (let now = fromMs; now < toMs; now += 16) {
    if (!governor.due(now)) continue;
    governor.record(now, inferenceMs);
    const next = governor.advise(now + inferenceMs, profile);
    if (next) advice.push(next);
  }
  return advice;
}

test("frames are analysed no faster than the cap, nor faster than the device keeps up", () => {
  const quick = new FrameGovernor(30);
  drive(quick, 8, 0, 4000);
  assert.ok(Math.abs(quick.fps(4000) - 30) <= 3, `fast device runs at ${quick.fps(4000).toFixed(1)} fps`);
  const slow = new FrameGovernor(30);
  drive(slow, 60, 0, 4000);
  assert.ok(slow.fps(4000) <= 1000 / 90 + 1, `60 ms detections leave headroom (${slow.fps(4000).toFixed(1)} fps)`);
  assert.ok(slow.intervalMs() >= 89);
});

test("slow detection advises a lighter model once, after warm-up and a sustained slump", () => {
  const governor = new FrameGovernor(30);
  assert.deepEqual(drive(governor, 10, 0, 6000), [], "a fast device gets no advice");
  const slow = new FrameGovernor(30);
  const advice = drive(slow, 90, 0, 12_000);
  assert.equal(advice[0], "use-lite");
  assert.equal(advice.filter((a) => a === "use-lite").length, 1);
  const lite = { ...initialProfile({ mobile: true, cores: 8 }), model: "lite" as const };
  const stuck = new FrameGovernor(24);
  const later = drive(stuck, 130, 0, 30_000, lite);
  assert.deepEqual(later, ["lower-resolution", "too-slow"]);
  stuck.restart();
  assert.equal(stuck.fps(31_000), 0);
});

test("a GPU path slower than any real GPU switches to the CPU first; CPU slowness never blames the GPU", () => {
  const profile = initialProfile({ mobile: false, cores: 10 });
  const run = (onGpu: boolean) => {
    const governor = new FrameGovernor(30);
    const advice: string[] = [];
    for (let now = 0; now < 20_000; now += 16) {
      if (!governor.due(now)) continue;
      governor.record(now, 400);
      const next = governor.advise(now + 400, profile, onGpu);
      if (next) advice.push(next);
    }
    return advice;
  };
  assert.equal(run(true)[0], "use-cpu");
  assert.ok(!run(false).includes("use-cpu"));
  assert.equal(run(false)[0], "use-lite");
});

/**
 * A camera sending `cameraFps` frames a second. Frames are analysed when due; while a detection
 * runs the page misses the camera's callbacks, but presentedFrames still counts those frames.
 */
function film(governor: FrameGovernor, options: { cameraFps: number; inferenceMs: number; seconds: number; onGpu?: boolean }) {
  const profile = initialProfile({ mobile: false, cores: 10 });
  const period = 1000 / options.cameraFps;
  const advice: string[] = [];
  let busyUntil = -Infinity;
  let presented = 0;
  for (let now = 0; now < options.seconds * 1000; now += period) {
    presented += 1;
    if (now < busyUntil) continue;
    governor.cameraFrame(now, presented);
    if (!governor.due(now)) continue;
    governor.record(now, options.inferenceMs);
    busyUntil = now + options.inferenceMs;
    const next = governor.advise(now + options.inferenceMs, profile, options.onGpu);
    if (next) advice.push(next);
  }
  return advice;
}

test("a camera slowed by a dim room is not taken for slow detection", () => {
  // Quick detection (20 ms on the GPU) behind a 9 fps camera: a lighter model, the CPU or a smaller
  // picture would not add a single frame, so nothing is switched and nothing is said.
  const dim = new FrameGovernor(30);
  assert.deepEqual(film(dim, { cameraFps: 9, inferenceMs: 20, seconds: 20, onGpu: true }), []);
  assert.ok(Math.abs((dim.cameraFps() ?? 0) - 9) < 0.5, `camera measured at ${dim.cameraFps()} fps`);
  // Below 8 frames a second quick reps can slip between frames, so the user is told; more light helps.
  const darker = new FrameGovernor(30);
  assert.deepEqual(film(darker, { cameraFps: 6, inferenceMs: 20, seconds: 20, onGpu: true }), ["slow-camera"]);
});

test("detection slower than the camera's frames still gets the lighter model", () => {
  const slow = new FrameGovernor(30);
  const advice = film(slow, { cameraFps: 30, inferenceMs: 90, seconds: 20 });
  assert.equal(advice[0], "use-lite");
  assert.ok(!advice.includes("slow-camera"));
  // A 15 fps camera with 60 ms detections: every second frame is skipped for detection.
  const mid = new FrameGovernor(30);
  assert.equal(film(mid, { cameraFps: 15, inferenceMs: 60, seconds: 20 })[0], "use-lite");
});

test("a device that slows down as it warms up is told to cool down once, long after its baseline", () => {
  const governor = new FrameGovernor(30);
  const profile = initialProfile({ mobile: true, cores: 8 });
  const advice: string[] = [];
  for (let now = 0; now < 90_000; now += 16) {
    if (!governor.due(now)) continue;
    // 14 ms while cool; from a minute in, 26 ms (still fast enough that no lighter model is advised).
    const inferenceMs = now < 60_000 ? 14 : 26;
    governor.record(now, inferenceMs);
    const next = governor.advise(now + inferenceMs, profile, true);
    if (next) advice.push(next);
  }
  assert.ok(Math.abs((governor.baselineMs() ?? 0) - 14) < 0.5, `baseline ${governor.baselineMs()}`);
  assert.deepEqual(advice, ["cool-down"]);
  const steady = new FrameGovernor(30);
  const calm: string[] = [];
  for (let now = 0; now < 90_000; now += 16) {
    if (!steady.due(now)) continue;
    steady.record(now, 14);
    const next = steady.advise(now + 14, profile, true);
    if (next) calm.push(next);
  }
  assert.deepEqual(calm, [], "a device that stays cool is left alone");
});
