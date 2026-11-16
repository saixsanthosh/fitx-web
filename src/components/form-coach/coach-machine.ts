/**
 * The camera coach's runtime outside React: camera stream, pose engine, frame loop, rule session,
 * skeleton drawing, wake lock and voice. React only receives coarse state changes (stage, a
 * snapshot when something visible changes), so the camera loop never re-renders the page.
 */
import type { CoachSession, CoachSnapshot, CoachSummary } from "@/lib/form-rules/session";
import { createCoachSession } from "@/lib/form-rules/session";
import type { ExerciseRule } from "@/lib/form-rules/types";
import type { CameraProblem } from "@/lib/pose/camera";
import { cameraHelp, cameraPermission, cameraProblemFromError, detectPlatform, listCameras, openCamera, stopStream } from "@/lib/pose/camera";
import type { OverlayPalette } from "@/lib/pose/draw";
import { drawPose, readOverlayPalette } from "@/lib/pose/draw";
import type { EngineLease, EngineProblem, PoseEngine } from "@/lib/pose/engine";
import { acquirePoseEngine, discardPoseEngine, PoseEngineError } from "@/lib/pose/engine";
import type { PosePoint, Side } from "@/lib/pose/landmarks";
import { landmarkIndex } from "@/lib/pose/landmarks";
import type { CaptureProfile, ModelVariant, PerformanceAdvice } from "@/lib/pose/performance";
import { FrameGovernor, initialProfile, readDeviceHints } from "@/lib/pose/performance";
import { CoachVoice } from "./voice";

export type CoachStage =
  | { name: "idle" }
  | { name: "starting"; step: "camera" | "model"; progress: number }
  | { name: "running" }
  | { name: "paused"; reason: "hidden" | "camera-ended"; detail?: string }
  | { name: "camera-error"; problem: CameraProblem }
  | { name: "engine-error"; problem: EngineProblem }
  | { name: "finished"; summary: CoachSummary };

export interface FrameSize {
  width: number;
  height: number;
}

export interface CoachUi {
  setStage(stage: CoachStage): void;
  setSnapshot(snapshot: CoachSnapshot | null): void;
  setFrame(frame: FrameSize | null): void;
  setMirrored(mirrored: boolean): void;
  setCameraCount(count: number): void;
  setNotice(notice: string | null): void;
  announce(text: string): void;
  video(): HTMLVideoElement | null;
  canvas(): HTMLCanvasElement | null;
  meter(): HTMLElement | null;
}

type VideoWithFrames = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

interface Run {
  rule: ExerciseRule;
  session: CoachSession;
  profile: CaptureProfile;
  governor: FrameGovernor;
  stream: MediaStream | null;
  lease: EngineLease | null;
  engine: PoseEngine | null;
  delegate: "auto" | "CPU";
  focus: Set<number>;
  focusSide: Side | null;
  palette: OverlayPalette | null;
  lastTs: number;
  publishedKey: string;
  holdSpoken: number;
  wakeLock: WakeLockSentinel | null;
  deviceId: string | undefined;
  facing: "user" | "environment";
  looping: boolean;
  cancelFrame: (() => void) | null;
  swapping: boolean;
  /** Counting has run at least once, so this run holds counts worth keeping. */
  everRan: boolean;
}

const SLOW_DEVICE_NOTICE = "This device is analysing the camera slowly, so quick reps may be missed. Good light and closing other apps help.";

/** Landmarks the rule measures, drawn in the accent colour. */
function focusFor(rule: ExerciseRule, side: Side | null): Set<number> {
  const sides: Side[] = rule.view === "front" || side === null ? ["left", "right"] : [side];
  return new Set(rule.required.flatMap((joint) => sides.map((s) => landmarkIndex(joint, s))));
}

function waitForVideoSize(video: HTMLVideoElement, timeoutMs = 5000): Promise<void> {
  if (video.videoWidth > 0) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener("loadedmetadata", done);
      video.removeEventListener("resize", done);
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(done, timeoutMs);
    video.addEventListener("loadedmetadata", done);
    video.addEventListener("resize", done);
  });
}

async function waitForElement<T>(get: () => T | null, timeoutMs = 1500): Promise<T | null> {
  const started = performance.now();
  for (;;) {
    const element = get();
    if (element || performance.now() - started > timeoutMs) return element;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
}

export class CoachMachine {
  readonly voice: CoachVoice;
  private readonly ui: CoachUi;
  private run: Run | null = null;
  /** Bumped by every start, stop and switch; async steps from an older generation stop quietly. */
  private generation = 0;
  private stage: CoachStage["name"] = "idle";

  constructor(ui: CoachUi) {
    this.ui = ui;
    this.voice = new CoachVoice(false);
  }

  async start(rule: ExerciseRule, voice: boolean): Promise<void> {
    this.stopAll();
    const generation = ++this.generation;
    this.voice.enabled = voice;
    this.voice.prime();
    const profile = initialProfile(readDeviceHints());
    const run: Run = {
      rule,
      session: createCoachSession(rule),
      profile,
      governor: new FrameGovernor(profile.maxFps),
      stream: null,
      lease: null,
      engine: null,
      delegate: "auto",
      focus: focusFor(rule, null),
      focusSide: null,
      palette: null,
      lastTs: 0,
      publishedKey: "",
      holdSpoken: 0,
      wakeLock: null,
      deviceId: undefined,
      facing: "user",
      looping: false,
      cancelFrame: null,
      swapping: false,
      everRan: false,
    };
    this.run = run;
    this.ui.setSnapshot(null);
    this.ui.setNotice(null);
    this.setStage({ name: "starting", step: "camera", progress: 0 });
    if ((await cameraPermission()) === "denied") {
      if (this.isCurrent(generation)) this.fail({ name: "camera-error", problem: "denied" });
      return;
    }
    if (!this.isCurrent(generation) || !(await this.openStream(run, generation))) return;
    this.setStage({ name: "starting", step: "model", progress: 0 });
    if (!(await this.loadEngine(run, generation))) return;
    await this.begin(run, generation);
  }

  /** Restarts the camera after a pause; the counts so far are kept. */
  async resume(): Promise<void> {
    const run = this.run;
    if (!run) return;
    const generation = ++this.generation;
    this.voice.prime();
    this.setStage({ name: "starting", step: "camera", progress: 0 });
    if (!(await this.openStream(run, generation))) return;
    if (!run.engine) {
      this.setStage({ name: "starting", step: "model", progress: 0 });
      if (!(await this.loadEngine(run, generation))) return;
    }
    await this.begin(run, generation);
  }

  /** Stops the camera and shows the summary. */
  finish(): void {
    const run = this.run;
    if (!run) return;
    const summary = run.session.summary();
    this.stopAll();
    this.setStage({ name: "finished", summary });
  }

  /** The page went to the background: stop the camera (its light goes off) and wait for Resume. */
  backgrounded(): void {
    const run = this.run;
    if (!run) return;
    if (this.stage === "starting") {
      // A fresh start is simply cancelled; a restart after a pause keeps the counts so far.
      if (run.everRan) this.pause(run, "hidden");
      else this.reset();
      return;
    }
    if (this.stage === "running") this.pause(run, "hidden");
  }

  async switchCamera(): Promise<void> {
    const run = this.run;
    if (!run?.stream) return;
    const cameras = await listCameras();
    if (cameras.length < 2 || this.run !== run) return;
    const index = cameras.findIndex((camera) => camera.deviceId === run.deviceId);
    const next = cameras[(index + 1) % cameras.length];
    const generation = ++this.generation;
    this.stopLoop(run);
    this.stopCamera(run);
    run.session.pause();
    run.deviceId = next.deviceId || undefined;
    if (!run.deviceId) run.facing = run.facing === "user" ? "environment" : "user";
    this.setStage({ name: "starting", step: "camera", progress: 0 });
    if (!(await this.openStream(run, generation))) return;
    await this.begin(run, generation);
  }

  reset(): void {
    this.stopAll();
    this.ui.setSnapshot(null);
    this.ui.setNotice(null);
    this.setStage({ name: "idle" });
  }

  dispose(): void {
    this.stopAll();
  }

  // -------------------------------------------------------------------------------------------

  private setStage(stage: CoachStage) {
    this.stage = stage.name;
    this.ui.setStage(stage);
  }

  private isCurrent(generation: number) {
    return generation === this.generation;
  }

  private fail(stage: CoachStage) {
    const run = this.run;
    if (run) {
      this.stopLoop(run);
      this.stopCamera(run);
      this.releaseWakeLock(run);
      run.lease?.release();
      run.lease = null;
      run.engine = null;
    }
    this.run = null;
    this.generation += 1;
    this.voice.stop();
    this.setStage(stage);
  }

  private async openStream(run: Run, generation: number): Promise<boolean> {
    const video = await waitForElement(() => this.ui.video());
    if (!this.isCurrent(generation)) return false;
    if (!video) {
      this.fail({ name: "camera-error", problem: "unknown" });
      return false;
    }
    let stream: MediaStream;
    try {
      stream = await openCamera({ facing: run.facing, width: run.profile.width, height: run.profile.height, frameRate: Math.min(30, run.profile.maxFps + 6), deviceId: run.deviceId });
    } catch (error) {
      if (!this.isCurrent(generation)) return false;
      const problem = cameraProblemFromError(error);
      if (run.everRan) {
        // Keep the set's counts: stay paused and say why the camera didn't come back.
        const help = cameraHelp(problem, detectPlatform(navigator.userAgent, navigator.maxTouchPoints));
        this.pause(run, "camera-ended", `${help.title}. ${help.body}`);
      } else {
        this.fail({ name: "camera-error", problem });
      }
      return false;
    }
    if (!this.isCurrent(generation)) {
      stopStream(stream);
      return false;
    }
    run.stream = stream;
    const track = stream.getVideoTracks()[0];
    const settings = track?.getSettings();
    if (settings?.deviceId) run.deviceId = settings.deviceId;
    if (settings?.facingMode === "environment" || settings?.facingMode === "user") run.facing = settings.facingMode;
    // Selfie cameras (and desktop webcams, which report no facing) are shown mirrored, like a mirror.
    this.ui.setMirrored(settings?.facingMode !== "environment");
    track?.addEventListener("ended", () => {
      if (this.run === run && run.stream === stream && this.stage === "running") this.pause(run, "camera-ended");
    });
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      // play() can reject if the element is reset meanwhile; the frame loop checks readiness itself.
    }
    await waitForVideoSize(video);
    if (!this.isCurrent(generation)) return false;
    this.ui.setFrame(video.videoWidth > 0 ? { width: video.videoWidth, height: video.videoHeight } : null);
    void listCameras().then((cameras) => {
      if (this.isCurrent(generation)) this.ui.setCameraCount(cameras.length);
    });
    return true;
  }

  private async loadEngine(run: Run, generation: number): Promise<boolean> {
    run.lease?.release();
    let shown = -1;
    const lease = acquirePoseEngine(run.profile.model, run.delegate, (progress) => {
      const percent = Math.floor(progress * 100);
      if (percent === shown || !this.isCurrent(generation) || run.engine) return;
      shown = percent;
      this.setStage({ name: "starting", step: "model", progress });
    });
    run.lease = lease;
    try {
      const engine = await lease.ready;
      if (!this.isCurrent(generation) || this.run !== run) return false;
      run.engine = engine;
      return true;
    } catch (error) {
      if (this.isCurrent(generation)) this.fail({ name: "engine-error", problem: error instanceof PoseEngineError ? error.problem : "start" });
      return false;
    }
  }

  private async begin(run: Run, generation: number) {
    if (!this.isCurrent(generation) || this.run !== run) return;
    const video = this.ui.video();
    if (run.engine && video && !run.engine.warmed) {
      // The first detection compiles the model's GPU programs and can take seconds: do it behind the
      // "preparing" screen, so counting starts at full speed and the governor judges real frames.
      this.setStage({ name: "starting", step: "model", progress: 1 });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (!this.isCurrent(generation) || this.run !== run || !run.engine) return;
      const timestamp = Math.max(performance.now(), run.lastTs + 1);
      run.lastTs = timestamp;
      try {
        run.engine.detect(video, timestamp);
      } catch {
        // A broken engine is handled by the frame loop's recovery.
      }
      if (!this.isCurrent(generation) || this.run !== run) return;
    }
    const canvas = this.ui.canvas();
    run.palette = readOverlayPalette(canvas ?? document.documentElement);
    run.governor.restart();
    run.publishedKey = "";
    run.everRan = true;
    this.setStage({ name: "running" });
    void this.holdWakeLock(run);
    this.loop(run, generation);
  }

  private loop(run: Run, generation: number) {
    const video = this.ui.video() as VideoWithFrames | null;
    if (!video) return;
    run.looping = true;
    const step = () => {
      if (!run.looping || !this.isCurrent(generation)) return;
      this.analyse(run, video);
      schedule();
    };
    const schedule = () => {
      if (!run.looping) return;
      if (typeof video.requestVideoFrameCallback === "function") {
        const handle = video.requestVideoFrameCallback(step);
        run.cancelFrame = () => video.cancelVideoFrameCallback?.(handle);
      } else {
        const handle = requestAnimationFrame(step);
        run.cancelFrame = () => cancelAnimationFrame(handle);
      }
    };
    schedule();
  }

  private analyse(run: Run, video: HTMLVideoElement) {
    if (!run.engine || video.readyState < 2 || video.videoWidth === 0) return;
    const now = performance.now();
    if (!run.governor.due(now)) return;
    const timestamp = Math.max(now, run.lastTs + 1);
    run.lastTs = timestamp;
    let points: PosePoint[] | null;
    try {
      points = run.engine.detect(video, timestamp);
    } catch (error) {
      void this.recoverEngine(run, error);
      return;
    }
    const done = performance.now();
    run.governor.record(now, done - now);
    const snapshot = run.session.update({ t: timestamp, points, aspect: video.videoWidth / video.videoHeight });
    this.draw(run, video, points, snapshot.side);
    const meter = this.ui.meter();
    if (meter) meter.style.transform = `scaleY(${snapshot.progress ?? 0})`;
    this.react(run, snapshot);
    const advice = run.governor.advise(done, run.profile, run.engine?.delegate === "GPU");
    if (advice) void this.applyAdvice(run, advice);
  }

  private draw(run: Run, video: HTMLVideoElement, points: PosePoint[] | null, side: Side | null) {
    const canvas = this.ui.canvas();
    if (!canvas || !run.palette) return;
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    if (side !== run.focusSide) {
      run.focusSide = side;
      run.focus = focusFor(run.rule, side);
    }
    drawPose(context, points, { palette: run.palette, focus: run.focus, minVisibility: run.rule.minVisibility });
  }

  private react(run: Run, snapshot: CoachSnapshot) {
    for (const event of snapshot.events) {
      if (event.type === "rep") {
        this.voice.count(String(event.reps));
        this.ui.announce(`${event.reps} ${event.reps === 1 ? "rep" : "reps"}`);
      } else if (event.type === "partial" || event.type === "cue") {
        this.voice.cue(event.cue.speech);
        this.ui.announce(event.cue.text);
      } else if (event.type === "lost") {
        this.voice.cue("Rep not counted");
        this.ui.announce("Lost sight of you, so that rep wasn't counted.");
      }
    }
    if (run.rule.motion.kind === "hold") {
      const tens = Math.floor(snapshot.holdMs / 10_000);
      if (tens > run.holdSpoken) {
        run.holdSpoken = tens;
        this.voice.count(`${tens * 10} seconds`);
      }
    }
    const key = [snapshot.status, snapshot.guidance, snapshot.phase, snapshot.reps, snapshot.partials, snapshot.cleanReps, Math.floor(snapshot.holdMs / 1000), snapshot.cue?.id ?? "", snapshot.side ?? ""].join("|");
    if (key !== run.publishedKey) {
      run.publishedKey = key;
      this.ui.setSnapshot(snapshot);
    }
  }

  private async applyAdvice(run: Run, advice: PerformanceAdvice) {
    if (advice === "too-slow") {
      this.ui.setNotice(SLOW_DEVICE_NOTICE);
      return;
    }
    if (advice === "lower-resolution") {
      const track = run.stream?.getVideoTracks()[0];
      try {
        await track?.applyConstraints({ width: { ideal: 480 }, height: { ideal: 360 } });
        run.profile = { ...run.profile, width: 480, height: 360 };
      } catch {
        // Some cameras only offer one size; the slower frame rate still applies.
      }
      return;
    }
    if (advice === "use-cpu" && run.engine?.delegate === "GPU") await this.swapEngine(run, run.profile.model, "CPU");
    else if (advice === "use-lite" && run.profile.model === "full") await this.swapEngine(run, "lite", run.delegate);
  }

  /** Loads another model or delegate in the background and switches over once it is ready. */
  private async swapEngine(run: Run, model: ModelVariant, delegate: "auto" | "CPU") {
    if (run.swapping) return;
    run.swapping = true;
    const lease = acquirePoseEngine(model, delegate);
    try {
      const engine = await lease.ready;
      if (this.run !== run) {
        lease.release();
        return;
      }
      run.lease?.release();
      run.lease = lease;
      run.engine = engine;
      run.delegate = delegate;
      run.profile = { ...run.profile, model };
      run.governor.restart();
    } catch {
      lease.release();
    } finally {
      run.swapping = false;
    }
  }

  /** A failing GPU (lost WebGL context, driver bug) falls back to the CPU instead of ending the set. */
  private async recoverEngine(run: Run, error: unknown) {
    if (run.swapping) return;
    run.swapping = true;
    const broken = run.engine;
    run.engine = null;
    if (broken) discardPoseEngine(broken);
    run.lease?.release();
    run.lease = null;
    run.session.pause();
    const alreadyCpu = run.delegate === "CPU";
    run.delegate = "CPU";
    const lease = alreadyCpu ? null : acquirePoseEngine(run.profile.model, "CPU");
    try {
      if (!lease) throw error;
      const engine = await lease.ready;
      if (this.run !== run) {
        lease.release();
        return;
      }
      run.lease = lease;
      run.engine = engine;
      run.governor.restart();
    } catch {
      lease?.release();
      if (this.run === run) this.fail({ name: "engine-error", problem: "runtime" });
    } finally {
      run.swapping = false;
    }
  }

  private pause(run: Run, reason: "hidden" | "camera-ended", detail?: string) {
    this.generation += 1;
    this.stopLoop(run);
    this.stopCamera(run);
    this.releaseWakeLock(run);
    this.voice.stop();
    run.session.pause();
    this.setStage({ name: "paused", reason, detail });
  }

  private stopAll() {
    this.generation += 1;
    const run = this.run;
    this.run = null;
    this.voice.stop();
    if (!run) return;
    this.stopLoop(run);
    this.stopCamera(run);
    this.releaseWakeLock(run);
    run.lease?.release();
    run.lease = null;
    run.engine = null;
  }

  private stopLoop(run: Run) {
    run.looping = false;
    run.cancelFrame?.();
    run.cancelFrame = null;
  }

  private stopCamera(run: Run) {
    stopStream(run.stream);
    run.stream = null;
    const video = this.ui.video();
    if (video) {
      video.pause();
      video.srcObject = null;
    }
    const canvas = this.ui.canvas();
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  }

  private async holdWakeLock(run: Run) {
    if (run.wakeLock && !run.wakeLock.released) return;
    try {
      const lock = await navigator.wakeLock?.request("screen");
      if (this.run === run && run.looping) run.wakeLock = lock ?? null;
      else void lock?.release();
    } catch {
      // Not supported, or refused (low battery): the screen may dim, counting still works.
    }
  }

  private releaseWakeLock(run: Run) {
    const lock = run.wakeLock;
    run.wakeLock = null;
    void lock?.release().catch(() => undefined);
  }
}
