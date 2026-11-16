/**
 * Keeps pose detection within what the device can sustain. It picks a starting model, camera
 * resolution and frame rate from coarse device hints, then measures real detection times: frames
 * are only analysed as often as the device keeps up with (leaving the page responsive), and it
 * advises a lighter model or a smaller picture when detection stays slow. A camera that itself
 * sends few frames (cameras slow down in dim rooms) is told apart from slow detection, because a
 * lighter model or a smaller picture would not help there.
 */

export type ModelVariant = "lite" | "full";

export interface DeviceHints {
  /** Logical CPU cores (navigator.hardwareConcurrency). */
  cores?: number;
  /** Approximate RAM in GB (navigator.deviceMemory, Chromium only). */
  memoryGb?: number;
  /** A phone or tablet. */
  mobile: boolean;
  /** The user asked the browser to save data. */
  saveData?: boolean;
}

export interface CaptureProfile {
  model: ModelVariant;
  width: number;
  height: number;
  maxFps: number;
}

/**
 * - "use-cpu", "use-lite", "lower-resolution": detection can't keep up; switch to something lighter
 * - "too-slow": detection is still slow with everything light; tell the user
 * - "slow-camera": detection keeps up, but the camera sends few frames; tell the user (more light helps)
 */
export type PerformanceAdvice = "use-cpu" | "use-lite" | "lower-resolution" | "too-slow" | "slow-camera";

/** A real GPU runs this model in well under this; slower means the GPU path is emulated or broken. */
const SLOW_GPU_MS = 200;

export function initialProfile(hints: DeviceHints): CaptureProfile {
  const weak = (hints.cores !== undefined && hints.cores <= 2) || (hints.memoryGb !== undefined && hints.memoryGb <= 2);
  if (hints.saveData || weak) return { model: "lite", width: 480, height: 360, maxFps: 15 };
  if (hints.mobile) return { model: "lite", width: 640, height: 480, maxFps: 24 };
  if ((hints.cores ?? 0) >= 8) return { model: "full", width: 640, height: 480, maxFps: 30 };
  return { model: "lite", width: 640, height: 480, maxFps: 30 };
}

/** Reads device hints in the browser. */
export function readDeviceHints(): DeviceHints {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    userAgentData?: { mobile?: boolean };
    connection?: { saveData?: boolean };
  };
  const mobile = nav.userAgentData?.mobile
    ?? (/Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent) || (/Macintosh/i.test(nav.userAgent) && nav.maxTouchPoints > 1));
  return { cores: nav.hardwareConcurrency || undefined, memoryGb: nav.deviceMemory, mobile, saveData: nav.connection?.saveData };
}

/** The first frames after start-up or a switch may still be settling and are not judged. */
const WARM_UP_MS = 2000;
/** Slowness must last this long before advice is given. */
const SUSTAIN_MS = 2500;
const WINDOW_MS = 2000;

export class FrameGovernor {
  private maxFps: number;
  private averageMs = 0;
  private lastStart = -Infinity;
  private readonly analysed: number[] = [];
  /** Frames the camera delivered: [time, running frame count]. */
  private readonly delivered: Array<[number, number]> = [];
  private deliveredCount = 0;
  private startedAt: number | null = null;
  private slowSince: number | null = null;
  private readonly given = new Set<PerformanceAdvice>();

  constructor(maxFps: number) {
    this.maxFps = maxFps;
  }

  setMaxFps(maxFps: number): void {
    this.maxFps = maxFps;
  }

  /** Average detection time in ms. */
  get inferenceMs(): number {
    return this.averageMs;
  }

  /** Frames analysed per second over the last two seconds. */
  fps(now: number): number {
    while (this.analysed.length && now - this.analysed[0] > WINDOW_MS) this.analysed.shift();
    if (this.startedAt === null) return 0;
    const span = Math.min(WINDOW_MS, now - this.startedAt);
    return span > 0 ? (this.analysed.length * 1000) / span : 0;
  }

  /** The gap between analysed frames: the frame-rate cap, or 1.5× the detection time so the page keeps a third of its time. */
  intervalMs(): number {
    return Math.max(1000 / this.maxFps, this.averageMs * 1.5);
  }

  /** Whether a frame arriving at `now` should be analysed. */
  due(now: number): boolean {
    return now - this.lastStart >= this.intervalMs() - 2;
  }

  /** Records one analysed frame that started at `startedAt` and took `inferenceMs`. */
  record(startedAt: number, inferenceMs: number): void {
    this.startedAt ??= startedAt;
    this.lastStart = startedAt;
    this.averageMs = this.averageMs === 0 ? inferenceMs : this.averageMs * 0.9 + inferenceMs * 0.1;
    this.analysed.push(startedAt);
  }

  /**
   * Records a frame the camera delivered, analysed or not. `presentedFrames` (from
   * requestVideoFrameCallback) also counts frames that arrived while the page was busy detecting.
   */
  cameraFrame(now: number, presentedFrames?: number): void {
    if (presentedFrames !== undefined && presentedFrames < this.deliveredCount) this.delivered.length = 0;
    this.deliveredCount = presentedFrames ?? this.deliveredCount + 1;
    this.delivered.push([now, this.deliveredCount]);
    while (this.delivered.length > 2 && now - this.delivered[0][0] > WINDOW_MS) this.delivered.shift();
  }

  /** Frames per second the camera delivers, or null while that isn't measured. */
  cameraFps(): number | null {
    if (this.delivered.length < 2) return null;
    const [firstAt, firstCount] = this.delivered[0];
    const [lastAt, lastCount] = this.delivered[this.delivered.length - 1];
    return lastAt - firstAt >= 500 ? ((lastCount - firstCount) * 1000) / (lastAt - firstAt) : null;
  }

  /** Restarts the measurements (after a pause, a model switch or a camera change). */
  restart(): void {
    this.analysed.length = 0;
    this.delivered.length = 0;
    this.deliveredCount = 0;
    this.startedAt = null;
    this.slowSince = null;
    this.lastStart = -Infinity;
    this.averageMs = 0;
  }

  /**
   * One piece of advice at most once each, after detection has been slow for several seconds.
   * `onGpu`: the engine runs on the GPU delegate (a very slow GPU path is worse than the CPU one).
   */
  advise(now: number, profile: CaptureProfile, onGpu = false): PerformanceAdvice | null {
    if (this.startedAt === null || now - this.startedAt < WARM_UP_MS) return null;
    const fps = this.fps(now);
    const cameraFps = this.cameraFps();
    // A low analysed rate is detection's doing only when frames the camera offers (within the cap)
    // go unanalysed because detection takes longer than the gap between them.
    const offeredFps = Math.max(1, Math.min(this.maxFps, cameraFps ?? this.maxFps));
    const detectionBound = this.intervalMs() > 1000 / offeredFps;
    let advice: PerformanceAdvice | null = null;
    if (onGpu && (this.averageMs > SLOW_GPU_MS || (detectionBound && fps < 10)) && !this.given.has("use-cpu")) advice = "use-cpu";
    else if (detectionBound && profile.model === "full" && fps < 15 && !this.given.has("use-lite")) advice = "use-lite";
    else if (detectionBound && profile.width > 480 && fps < 12 && !this.given.has("lower-resolution")) advice = "lower-resolution";
    else if (detectionBound && fps < 8 && !this.given.has("too-slow")) advice = "too-slow";
    else if (!detectionBound && cameraFps !== null && cameraFps < 8 && !this.given.has("slow-camera")) advice = "slow-camera";
    if (!advice) {
      this.slowSince = null;
      return null;
    }
    this.slowSince ??= now;
    if (now - this.slowSince < SUSTAIN_MS) return null;
    this.slowSince = null;
    this.given.add(advice);
    return advice;
  }
}
