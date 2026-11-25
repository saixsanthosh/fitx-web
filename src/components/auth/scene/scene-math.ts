/**
 * Pure helpers for the sign-in scene (src/components/auth/scene/login-scene.ts): the deadlift loop's clock,
 * how device tilt and the pointer become a look direction, the camera's damped follow, and whether a device
 * gets the live scene at all. No three.js and no DOM, so tests run them directly.
 */

const clamp = (value: number, min: number, max: number) => (Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min);
const smooth = (u: number) => {
  const t = clamp(u, 0, 1);
  return t * t * (3 - 2 * t);
};

/** Driver times of the film's deadlift (poseLift in src/components/brand/intro/motion/lift.ts). */
export const LIFT_TIMES = { clapEnd: 0.55, braced: 1.36, liftOff: 1.42, lockout: 2.2, held: 2.24 } as const;

type Segment = { seconds: number; from: number; to: number; ease: boolean };

/**
 * One set of the loop, in wall seconds: brace, a slow heavy pull, a held lockout, a controlled lower, the
 * step back, and a breath standing tall before the next rep. The very first rep opens with the chalk clap.
 * The hands never let go of the bar while it is off the floor (the film's drop at 2.27 never plays here).
 */
const LOOP: readonly Segment[] = [
  { seconds: 1.5, from: LIFT_TIMES.clapEnd, to: LIFT_TIMES.braced, ease: true },
  { seconds: 0.55, from: LIFT_TIMES.braced, to: LIFT_TIMES.liftOff, ease: true },
  { seconds: 1.6, from: LIFT_TIMES.liftOff, to: LIFT_TIMES.lockout, ease: true },
  { seconds: 1.3, from: LIFT_TIMES.lockout, to: LIFT_TIMES.held, ease: true },
  { seconds: 1.7, from: LIFT_TIMES.held, to: LIFT_TIMES.liftOff - 0.02, ease: true },
  { seconds: 1.4, from: LIFT_TIMES.liftOff - 0.02, to: LIFT_TIMES.clapEnd + 0.05, ease: true },
  { seconds: 2.2, from: LIFT_TIMES.clapEnd + 0.05, to: LIFT_TIMES.clapEnd, ease: true },
];
/** The opening chalk clap, played once before the loop. */
const OPENING: Segment = { seconds: 0.75, from: 0, to: LIFT_TIMES.clapEnd, ease: false };

export const LOOP_SECONDS = LOOP.reduce((sum, segment) => sum + segment.seconds, 0);

/**
 * The moment the still frames in public/media/login/ show (the held lockout, looking at you). The live scene starts
 * here, so its fade-in over the still is seamless.
 */
export const STILL_SECONDS = 5;

/** The lift driver's time for `elapsed` wall seconds since the scene started. */
export function liftTimeAt(elapsed: number): number {
  let t = Math.max(0, Number.isFinite(elapsed) ? elapsed : 0);
  if (t < OPENING.seconds) return OPENING.from + (OPENING.to - OPENING.from) * (t / OPENING.seconds);
  t = (t - OPENING.seconds) % LOOP_SECONDS;
  for (const segment of LOOP) {
    if (t <= segment.seconds) {
      const u = t / segment.seconds;
      return segment.from + (segment.to - segment.from) * (segment.ease ? smooth(u) : u);
    }
    t -= segment.seconds;
  }
  return LIFT_TIMES.clapEnd;
}

/**
 * How much the lifter may look at the viewer at this point of the lift (0 to 1): freely while standing and
 * at the held lockout, hardly at all while he braces and pulls (eyes on the floor ahead, neck neutral).
 */
export function lookWeightAt(liftTime: number): number {
  const t = clamp(liftTime, 0, 3);
  if (t <= LIFT_TIMES.clapEnd + 0.06) return 0.85;
  if (t < LIFT_TIMES.braced) return 0.85 * (1 - smooth((t - LIFT_TIMES.clapEnd - 0.06) / 0.5));
  if (t < LIFT_TIMES.lockout - 0.1) return 0.05;
  return 0.05 + 0.6 * smooth((t - (LIFT_TIMES.lockout - 0.1)) / 0.12);
}

/** A look direction: x to the right, y up, both -1 to 1. */
export type Look = { x: number; y: number };

/** The pointer's position over the stage as a look direction (centre is 0, 0; up is positive). */
export function pointerLook(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): Look {
  if (!(rect.width > 0) || !(rect.height > 0)) return { x: 0, y: 0 };
  return {
    x: clamp(((clientX - rect.left) / rect.width) * 2 - 1, -1, 1),
    y: clamp(1 - ((clientY - rect.top) / rect.height) * 2, -1, 1),
  };
}

/** Degrees of tilt that reach the edge of the look range. */
export const TILT_RANGE_DEGREES = 24;

/**
 * Device tilt as a look direction, relative to how the phone was held when the scene started (`rest`), and
 * turned for the screen's orientation (0, 90, -90 or 180 degrees). beta is front-back tilt, gamma left-right.
 */
export function tiltLook(
  reading: { beta: number | null; gamma: number | null },
  rest: { beta: number; gamma: number },
  screenAngle: number,
): Look | null {
  if (reading.beta === null || reading.gamma === null || !Number.isFinite(reading.beta) || !Number.isFinite(reading.gamma)) return null;
  // Wrap the front-back difference so holding the phone past vertical does not jump.
  const wrap = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180;
  const dBeta = wrap(reading.beta - rest.beta);
  const dGamma = wrap(reading.gamma - rest.gamma);
  const angle = (((Math.round(screenAngle / 90) * 90) % 360) + 360) % 360;
  let x = dGamma;
  let y = -dBeta;
  if (angle === 90) [x, y] = [-dBeta, -dGamma];
  else if (angle === 180) [x, y] = [-dGamma, dBeta];
  else if (angle === 270) [x, y] = [dBeta, dGamma];
  // `+ 0` turns a negative zero into zero.
  return { x: clamp(x / TILT_RANGE_DEGREES, -1, 1) + 0, y: clamp(y / TILT_RANGE_DEGREES, -1, 1) + 0 };
}

/**
 * Frame-rate independent exponential follow: moves `current` toward `target` so that half the distance is
 * covered every `halfLife` seconds.
 */
export function follow(current: number, target: number, dt: number, halfLife: number): number {
  if (!(dt > 0)) return current;
  if (!(halfLife > 0)) return target;
  return target + (current - target) * Math.pow(2, -dt / halfLife);
}

/** A slow figure-of-eight drift so the camera breathes when nobody is moving the phone or the pointer. */
export function idleDrift(seconds: number): Look {
  return { x: 0.32 * Math.sin(seconds * 0.21), y: 0.16 * Math.sin(seconds * 0.42 + 0.6) };
}

/** How far the still frame moves at the edge of the look range, in percent of its own size (x, then y). */
export const STILL_SWING = { x: 1.6, y: 1.2 } as const;

/** One loop of the still frame's idle drift, in seconds: the figure of eight's slower side repeats every 2π / 0.21. */
export const STILL_DRIFT_SECONDS = (2 * Math.PI) / 0.21;

/**
 * The still frame's idle drift as Web Animations keyframes (one loop of idleDrift, `steps` straight pieces), so the
 * compositor runs it and no script runs per frame. The last keyframe is the first, so the loop has no seam.
 */
export function stillDriftKeyframes(steps = 24): { offset: number; transform: string }[] {
  const count = Math.max(4, Math.round(steps));
  return Array.from({ length: count + 1 }, (_, index) => {
    const drift = idleDrift((index / count) * STILL_DRIFT_SECONDS);
    const x = (-drift.x * STILL_SWING.x).toFixed(3);
    const y = (drift.y * STILL_SWING.y).toFixed(3);
    return { offset: index / count, transform: `translate3d(${x}%, ${y}%, 0)` };
  });
}

/**
 * Where the still frame sits for a look (a CSS `translate`, eased by a transition the compositor runs), in steps of
 * 0.1% so a phone's sensor noise or a small pointer move writes nothing. No look puts it back in the middle.
 */
export function stillShift(look: Look | null): string {
  if (!look) return "0% 0%";
  // `+ 0` turns a negative zero into zero.
  const tenths = (percent: number) => Math.round(percent * 10) / 10 + 0;
  return `${tenths(-clamp(look.x, -1, 1) * STILL_SWING.x)}% ${tenths(clamp(look.y, -1, 1) * STILL_SWING.y)}%`;
}

/** The address's query asks for the live scene: `?scene=live` (the films' still render and anyone checking the scene). */
export function liveSceneRequested(search: string): boolean {
  return new URLSearchParams(search).get("scene") === "live";
}

export type SceneDevice = {
  /**
   * The live scene was asked for (liveSceneRequested). It is off by default: on Edge with its JIT off and on slow GPUs
   * it held the main thread for seconds, so typing in the form froze. Without it the still frame is the whole stage.
   */
  enabled: boolean;
  reducedMotion: boolean;
  saveData?: boolean;
  /** navigator.hardwareConcurrency (iOS reports 2 whatever the chip). */
  cores?: number;
  /** navigator.deviceMemory in GB, where the browser reports it. */
  memory?: number;
  appleMobile?: boolean;
  /** Module workers are available (the athlete is generated in one). */
  workers: boolean;
};

export type SceneVerdict = "live" | "disabled" | "reduced-motion" | "save-data" | "low-end" | "no-workers";

/**
 * Whether the live scene may start, or why the still frame stays: first of all, whether it was asked for at all
 * ("disabled" unless `enabled`). The renderer's own checks (WebGL2, float targets, software rasterisers, the GPU
 * class) follow in detectQuality, and a sustained low frame rate stops it.
 */
export function sceneVerdict(device: SceneDevice): SceneVerdict {
  if (!device.enabled) return "disabled";
  if (device.reducedMotion) return "reduced-motion";
  if (device.saveData) return "save-data";
  if (!device.workers) return "no-workers";
  if (typeof device.memory === "number" && device.memory > 0 && device.memory < 4) return "low-end";
  if (!device.appleMobile && typeof device.cores === "number" && device.cores > 0 && device.cores < 4) return "low-end";
  return "live";
}

/** Median of the last frame times, in seconds (0 when there are none). */
export function medianFrame(samples: readonly number[]): number {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Frame times that make the scene step down once, then give way to the still frame. */
export const SLOW_FRAME = { downgrade: 1 / 28, stop: 1 / 22 } as const;
