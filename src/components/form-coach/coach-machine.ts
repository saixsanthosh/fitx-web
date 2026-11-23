/**
 * The camera coach's runtime outside React: camera stream and its quality controls, pose engine, frame
 * loop, landmark clean-up, rule session, automatic framing, skeleton drawing, wake lock and voice. React
 * only receives coarse state changes (stage, a snapshot or view report when something visible changes),
 * so the camera loop never re-renders the page; the crop and the skeleton are written straight to the DOM.
 */
import type { CoachSession, CoachSnapshot, CoachSummary } from "@/lib/form-rules/session";
import { createCoachSession } from "@/lib/form-rules/session";
import type { ExerciseRule } from "@/lib/form-rules/types";
import type { CameraProblem } from "@/lib/pose/camera";
import { cameraHelp, cameraPermission, cameraProblemFromError, detectPlatform, listCameras, openCamera, stopStream } from "@/lib/pose/camera";
import type { OverlayPalette } from "@/lib/pose/draw";
import { drawPose, readOverlayPalette } from "@/lib/pose/draw";
import type { EngineLease, EngineProblem, PoseDetection, PoseEngine } from "@/lib/pose/engine";
import { acquirePoseEngine, discardPoseEngine, PoseEngineError } from "@/lib/pose/engine";
import type { PosePoint, Side } from "@/lib/pose/landmarks";
import { landmarkIndex } from "@/lib/pose/landmarks";
import type { CameraControls, LightLevel } from "@/lib/pose/capture";
import { automaticControls, displayFilter, exposureLift, lightLevel, meanLuma, pictureLabel, stepDown } from "@/lib/pose/capture";
import type { FramingAssessment, FramingSpec } from "@/lib/pose/framing";
import { AutoFramer, cropTransform, maxZoomFor, zoomOf } from "@/lib/pose/framing";
import { LandmarkStabiliser } from "@/lib/pose/tracking";
import type { CaptureProfile, ModelVariant, PerformanceAdvice } from "@/lib/pose/performance";
import { FrameGovernor, initialProfile, readDeviceHints } from "@/lib/pose/performance";
import type { FrameSize } from "./video-size";
import { videoSize, watchVideoSize } from "./video-size";
import { captionFor, isSpokenWait, SPEAK_WAITING_AFTER_MS } from "@/lib/home-workout/captions";
import type { VoiceGender } from "./voice";
import { CoachVoice } from "./voice";

export type { FrameSize } from "./video-size";

export type CoachStage =
  | { name: "idle" }
  | { name: "starting"; step: "camera" | "model"; progress: number }
  | { name: "running" }
  | { name: "paused"; reason: "hidden" | "camera-ended"; detail?: string }
  | { name: "camera-error"; problem: CameraProblem }
  | { name: "engine-error"; problem: EngineProblem }
  /** `endedEarly`: the pose model failed mid-set; the counts made until then are kept. */
  | { name: "finished"; summary: CoachSummary; endedEarly?: boolean };

/** How good the camera's view is, for the live view's chips, guide and warning. */
export interface LiveView {
  /** The picture the camera really delivers ("4K", "1080p"…), or null while unknown. */
  picture: string | null;
  light: LightLevel;
  framing: FramingAssessment | null;
  /** Whether the analysis can be relied on right now, and if not, why (shown plainly). */
  reliable: boolean;
  reason: string | null;
  /** The display is zoomed in on the member. */
  zoomed: boolean;
}

export const INITIAL_VIEW: LiveView = { picture: null, light: "ok", framing: null, reliable: true, reason: null, zoomed: false };

export interface CoachUi {
  setStage(stage: CoachStage): void;
  setView?(view: LiveView): void;
  setSnapshot(snapshot: CoachSnapshot | null): void;
  setFrame(frame: FrameSize | null): void;
  setMirrored(mirrored: boolean): void;
  setCameraCount(count: number): void;
  setNotice(notice: string | null): void;
  announce(text: string): void;
  video(): HTMLVideoElement | null;
  canvas(): HTMLCanvasElement | null;
  meter(): HTMLElement | null;
  /** The visible camera area, and the layer inside it holding the video and the skeleton (the crop moves it). */
  viewport?(): HTMLElement | null;
  layer?(): HTMLElement | null;
  /** True when the member asked for reduced motion: the crop jumps instead of gliding. */
  reducedMotion?(): boolean;
}

type VideoWithFrames = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: (now: number, metadata?: { presentedFrames?: number }) => void) => number;
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
  /** Stops following the current stream's picture size. */
  stopWatchingSize: (() => void) | null;
  swapping: boolean;
  /** Counting has run at least once, so this run holds counts worth keeping. */
  everRan: boolean;
  mirrored: boolean;
  /** The waiting instruction on screen, since when, and whether it has been said. */
  wait: { headline: string; since: number; spoken: boolean };
  stabiliser: LandmarkStabiliser;
  framer: AutoFramer;
  framing: FramingSpec;
  /** What the camera offers (focus, exposure…), read once per stream. */
  controls: CameraControls;
  light: LightLevel;
  lastLightCheck: number;
  /** A tiny canvas the picture is copied into to measure its brightness. */
  probe: HTMLCanvasElement | null;
  view: LiveView;
  viewKey: string;
  /** Since when the view has been poor or the member unclear, for the "not good enough" warning. */
  poorSince: number | null;
  lastLayout: string;
}

/** How long a poor view must last before the live view says the analysis can't be relied on. */
const UNRELIABLE_AFTER_MS = 1500;
/** Brightness is measured this often (it costs a tiny read-back of the picture). */
const LIGHT_EVERY_MS = 1000;

/** What the automatic framing needs to know about an exercise. */
export function framingSpecFor(rule: ExerciseRule): FramingSpec {
  return {
    headroom: rule.headroom ?? 0.12,
    needsFeet: rule.required.some((joint) => joint === "ankle" || joint === "heel" || joint === "foot"),
    facingCamera: rule.view === "front",
  };
}

export const SLOW_DEVICE_NOTICE = "This device is analysing the camera slowly, so quick reps may be missed. Good light and closing other apps help.";
const SLOW_CAMERA_NOTICE = "The camera is sending few pictures a second, which often means the room is dim, so quick reps may be missed. More light helps.";

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

  async start(rule: ExerciseRule, voice: boolean, gender: VoiceGender = this.voice.gender): Promise<void> {
    this.stopAll();
    const generation = ++this.generation;
    this.voice.enabled = voice;
    this.voice.gender = gender;
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
      stopWatchingSize: null,
      swapping: false,
      everRan: false,
      mirrored: true,
      wait: { headline: "", since: 0, spoken: false },
      stabiliser: new LandmarkStabiliser(),
      framer: new AutoFramer(),
      framing: framingSpecFor(rule),
      controls: {},
      light: "ok",
      lastLightCheck: -Infinity,
      probe: null,
      view: INITIAL_VIEW,
      viewKey: "",
      poorSince: null,
      lastLayout: "",
    };
    this.run = run;
    this.ui.setSnapshot(null);
    this.ui.setNotice(null);
    this.ui.setView?.(INITIAL_VIEW);
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
    run.stabiliser.reset();
    run.framer.reset();
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
    this.ui.setView?.(INITIAL_VIEW);
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
    await this.tuneTrack(run, track);
    if (!this.isCurrent(generation)) return false;
    const settings = track?.getSettings();
    if (settings?.deviceId) run.deviceId = settings.deviceId;
    if (settings?.facingMode === "environment" || settings?.facingMode === "user") run.facing = settings.facingMode;
    // Selfie cameras (and desktop webcams, which report no facing) are shown mirrored, like a mirror.
    run.mirrored = settings?.facingMode !== "environment";
    this.ui.setMirrored(run.mirrored);
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
    this.ui.setFrame(videoSize(video));
    this.publishView(run, { picture: pictureLabel({ width: video.videoWidth, height: video.videoHeight }) });
    // Turning the phone (auto-rotate on) or a smaller camera picture changes the size mid-stream.
    run.stopWatchingSize?.();
    run.stopWatchingSize = watchVideoSize(video, (size) => {
      if (this.run !== run || run.stream !== stream) return;
      this.ui.setFrame(size);
      this.publishView(run, { picture: pictureLabel(size) });
      run.framer.reset();
    });
    void listCameras().then((cameras) => {
      if (this.isCurrent(generation)) this.ui.setCameraCount(cameras.length);
    });
    return true;
  }

  /** Continuous focus, exposure and white balance where the camera offers them. Never fails the start. */
  private async tuneTrack(run: Run, track: MediaStreamTrack | undefined) {
    if (!track) return;
    try {
      run.controls = (track.getCapabilities?.() ?? {}) as CameraControls;
    } catch {
      run.controls = {};
    }
    const sets = automaticControls(run.controls);
    if (!sets.length) return;
    try {
      await track.applyConstraints({ advanced: sets });
    } catch {
      // Some cameras list a mode they then refuse; their own defaults stay in place.
    }
  }

  /** Measures the picture's brightness now and then; a dim room gets a little more exposure and a display lift. */
  private checkLight(run: Run, video: HTMLVideoElement, now: number) {
    if (now - run.lastLightCheck < LIGHT_EVERY_MS) return;
    run.lastLightCheck = now;
    try {
      run.probe ??= document.createElement("canvas");
      run.probe.width = 32;
      run.probe.height = 18;
      const context = run.probe.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      context.drawImage(video, 0, 0, 32, 18);
      const level = lightLevel(meanLuma(context.getImageData(0, 0, 32, 18).data), run.light);
      if (level === run.light) return;
      run.light = level;
      // Display only: the pose model keeps reading the camera's own frames.
      video.style.filter = displayFilter(level) === "none" ? "" : displayFilter(level);
      const track = run.stream?.getVideoTracks()[0];
      const current = (track?.getSettings() as { exposureCompensation?: number } | undefined)?.exposureCompensation;
      const lift = exposureLift(run.controls, current, level);
      if (track && lift) void track.applyConstraints({ advanced: [lift] }).catch(() => undefined);
      this.publishView(run, { light: level });
    } catch {
      // A picture that can't be read back (rare) is simply not measured.
    }
  }

  private publishView(run: Run, patch: Partial<LiveView>) {
    const view = { ...run.view, ...patch };
    const key = [view.picture, view.light, view.framing?.issue, view.framing?.quality, view.framing?.move, view.reliable, view.reason, view.zoomed].join("|");
    run.view = view;
    if (key === run.viewKey) return;
    run.viewKey = key;
    this.ui.setView?.(view);
  }

  /**
   * Sizes the layer to the whole picture fitted inside the viewport, then moves it so the framing crop
   * fills the viewport. Writes only a transform (and the layer's size when the viewport changes).
   */
  private applyCrop(run: Run, video: HTMLVideoElement, crop: { x: number; y: number; w: number; h: number }) {
    const viewport = this.ui.viewport?.();
    const layer = this.ui.layer?.();
    if (!viewport || !layer || !video.videoWidth) return;
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    if (!vw || !vh) return;
    const fit = Math.min(vw / video.videoWidth, vh / video.videoHeight);
    const bw = video.videoWidth * fit;
    const bh = video.videoHeight * fit;
    const layout = `${bw.toFixed(1)}x${bh.toFixed(1)}`;
    if (layout !== run.lastLayout) {
      run.lastLayout = layout;
      layer.style.width = `${bw}px`;
      layer.style.height = `${bh}px`;
      run.framer.setMaxZoom(maxZoomFor(video.videoHeight, bh * (window.devicePixelRatio || 1)));
    }
    // The layer shows the picture mirrored for selfie cameras, so the crop is mirrored with it.
    const shown = run.mirrored ? { ...crop, x: 1 - crop.x - crop.w } : crop;
    layer.style.transform = cropTransform(shown, bw, bh, vw, vh);
  }

  /** Combines framing, light, tracking and speed into one honest verdict on the view. */
  private judgeView(run: Run, snapshot: CoachSnapshot, framing: FramingAssessment, zoom: number, now: number) {
    let reason: string | null = null;
    // Nobody in view yet is not a fault of the view: the caption already says "Step into view".
    if (framing.issue === "no-body" || snapshot.status === "searching") reason = null;
    else if (framing.quality === "poor" && framing.hint) reason = framing.hint;
    else if (snapshot.status === "unclear") reason = snapshot.guidance;
    else if (run.light === "dim" && snapshot.status !== "active") reason = "The room is too dark for the camera to see you clearly. Turn on a light or face a window.";
    if (reason) run.poorSince ??= now;
    else run.poorSince = null;
    const unreliable = run.poorSince !== null && now - run.poorSince >= UNRELIABLE_AFTER_MS;
    this.publishView(run, { framing, reliable: !unreliable, reason: unreliable ? reason : null, zoomed: zoom > 1.08 });
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
      if (this.isCurrent(generation)) this.engineFailed(run, error instanceof PoseEngineError ? error.problem : "start");
      return false;
    }
  }

  /**
   * The pose model can't go on. Counts already made are kept: the set ends with its summary, as if
   * Finish was pressed (like a camera that won't come back). With nothing counted, the error shows.
   */
  private engineFailed(run: Run, problem: EngineProblem) {
    if (this.run !== run) return;
    const summary = run.session.summary();
    if (run.everRan && (summary.reps > 0 || summary.holdSeconds > 0)) {
      this.stopAll();
      this.setStage({ name: "finished", summary, endedEarly: true });
    } else {
      this.fail({ name: "engine-error", problem });
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
    run.framer.setEase(this.ui.reducedMotion?.() ? 0 : 520);
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
        const handle = video.requestVideoFrameCallback((_now, metadata) => {
          // Every camera frame is counted, analysed or not, so a slow camera isn't taken for slow detection.
          if (run.looping) run.governor.cameraFrame(performance.now(), metadata?.presentedFrames);
          step();
        });
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
    let detection: PoseDetection | null;
    try {
      detection = run.engine.detect(video, timestamp);
    } catch (error) {
      void this.recoverEngine(run, error);
      return;
    }
    const done = performance.now();
    run.governor.record(now, done - now);
    const aspect = video.videoWidth / video.videoHeight;
    // Glitches and left/right swaps are cleaned out before anything is counted; the smoothed copy is drawn.
    const cleaned = detection ? run.stabiliser.stabilise(detection.points, aspect, timestamp) : null;
    if (!detection) run.stabiliser.reset();
    const snapshot = run.session.update({ t: timestamp, points: cleaned?.points ?? null, aspect, world: detection?.world ?? null });
    this.draw(run, video, cleaned?.smooth ?? null, snapshot.side);
    const viewport = this.ui.viewport?.();
    const viewAspect = viewport && viewport.clientHeight ? viewport.clientWidth / viewport.clientHeight : aspect;
    const { crop, assessment } = run.framer.update(cleaned?.smooth ?? null, timestamp, aspect, viewAspect, run.framing, run.mirrored);
    this.applyCrop(run, video, crop);
    this.checkLight(run, video, done);
    this.judgeView(run, snapshot, assessment, zoomOf(crop, aspect, viewAspect), done);
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
      } else if (event.type === "calibrated") {
        this.voice.cue("Ready");
        this.ui.announce("Start position set. Ready.");
      } else if (event.type === "partial" || event.type === "cue") {
        this.voice.cue(event.cue.speech);
        this.ui.announce(event.cue.text);
      } else if (event.type === "lost") {
        this.voice.cue("Rep not counted");
        this.ui.announce("Lost sight of you, so that rep wasn't counted.");
      }
    }
    // Waiting instructions ("Step into view", "Move back") are said once they have lasted a moment,
    // so the voice says what the caption shows.
    const caption = captionFor(snapshot);
    if (isSpokenWait(caption)) {
      if (caption.headline !== run.wait.headline) run.wait = { headline: caption.headline, since: snapshot.t, spoken: false };
      else if (!run.wait.spoken && snapshot.t - run.wait.since >= SPEAK_WAITING_AFTER_MS) {
        run.wait.spoken = true;
        this.voice.cue(caption.headline);
      }
    } else {
      run.wait = { headline: "", since: snapshot.t, spoken: false };
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
    if (advice === "too-slow" || advice === "slow-camera") {
      this.ui.setNotice(advice === "too-slow" ? SLOW_DEVICE_NOTICE : SLOW_CAMERA_NOTICE);
      return;
    }
    if (advice === "lower-resolution" || advice === "cool-down") {
      if (advice === "cool-down") {
        // Fewer frames a second is the biggest saving; a smaller picture follows.
        run.profile = { ...run.profile, maxFps: Math.max(12, Math.round((run.profile.maxFps * 2) / 3)) };
        run.governor.setMaxFps(run.profile.maxFps);
      }
      const track = run.stream?.getVideoTracks()[0];
      const smaller = stepDown(run.profile);
      if (!track || !smaller) return;
      try {
        await track.applyConstraints({ width: { ideal: smaller.width }, height: { ideal: smaller.height } });
        run.profile = { ...run.profile, width: smaller.width, height: smaller.height };
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
      this.engineFailed(run, "runtime");
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
    run.stopWatchingSize?.();
    run.stopWatchingSize = null;
    stopStream(run.stream);
    run.stream = null;
    const video = this.ui.video();
    if (video) {
      video.pause();
      video.srcObject = null;
    }
    const canvas = this.ui.canvas();
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    run.stabiliser.reset();
    run.framer.reset();
    run.lastLayout = "";
    const layer = this.ui.layer?.();
    if (layer) layer.style.transform = "";
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
