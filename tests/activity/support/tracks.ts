// Synthetic GPS tracks with a known true route, for testing the activity engine.
// Positions follow a path at a set speed; each fix gets Gaussian noise (seeded, so every run is
// identical). Helpers return fixes or full recording logs (start, fixes, controls, finish).
import { destination, haversine, interpolate, pathLength } from "@/lib/activity/geo";
import type { ControlEvent, Fix, LatLng, LogEntry, Sport } from "@/lib/activity/types";

export const ORIGIN: LatLng = { lat: 12.9716, lng: 77.5946 };
export const T0 = Date.UTC(2026, 10, 16, 1, 0, 0);

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gaussian = () => {
    const u = Math.max(1e-12, next());
    const v = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return { next, gaussian };
}

/** A path from `start` following legs of [bearing degrees, metres]. */
export function legs(start: LatLng, parts: Array<[number, number]>): LatLng[] {
  const points = [start];
  for (const [bearing, metres] of parts) points.push(destination(points[points.length - 1], bearing, metres));
  return points;
}

/** A 400 m running track: two 100 m straights joined by semicircles (radius 100/pi m). */
export function runningTrack(start: LatLng, laps: number): LatLng[] {
  const radius = 100 / Math.PI;
  const points: LatLng[] = [];
  const steps = 40;
  for (let lap = 0; lap < laps; lap++) {
    let p = lap === 0 ? start : points[points.length - 1];
    if (lap === 0) points.push(p);
    p = destination(p, 90, 100);
    points.push(p);
    // Semicircle turning left from east to west around a centre north of p.
    const centreA = destination(p, 0, radius);
    for (let i = 1; i <= steps; i++) points.push(destination(centreA, 180 - (180 * i) / steps, radius));
    p = points[points.length - 1];
    p = destination(p, 270, 100);
    points.push(p);
    const centreB = destination(p, 180, radius);
    for (let i = 1; i <= steps; i++) points.push(destination(centreB, 0 - (180 * i) / steps, radius));
  }
  return points;
}

/** The point `metres` along `path`. */
export function pointAt(path: readonly LatLng[], metres: number): LatLng {
  let remaining = metres;
  for (let i = 1; i < path.length; i++) {
    const step = haversine(path[i - 1], path[i]);
    if (remaining <= step) return interpolate(path[i - 1], path[i], step === 0 ? 0 : remaining / step);
    remaining -= step;
  }
  return path[path.length - 1];
}

/**
 * GPS error model. Phone GNSS error drifts slowly (multipath, atmosphere), so by default the
 * error is a first-order Gauss-Markov process with `correlationS` seconds of memory, plus a
 * little independent jitter. `correlationS: 0` gives independent (white) error every fix: a
 * harsher case than real phones, used as a stress test.
 */
export type Noise = {
  /** Standard deviation of the position error per axis, metres. */
  sigmaM: number;
  /** The accuracy the fake device reports, metres. */
  accuracyM: number;
  correlationS?: number;
  /** Independent jitter added on top, metres (per axis). */
  jitterM?: number;
  /** Device-reported speed (Doppler) with this much error, m/s; none when omitted. */
  speedSigma?: number;
};

export type GpsSimulator = { fix(point: LatLng, t: number, trueSpeed: number): Fix };

export function gps(noise: Noise, seed: number): GpsSimulator {
  const random = rng(seed);
  const correlation = noise.correlationS ?? 20;
  const jitter = noise.jitterM ?? (correlation > 0 ? 0.6 : 0);
  let ex = random.gaussian() * noise.sigmaM;
  let ey = random.gaussian() * noise.sigmaM;
  let lastT: number | null = null;
  return {
    fix(point, t, trueSpeed) {
      if (correlation > 0) {
        const dt = lastT === null ? 1 : Math.max(0, (t - lastT) / 1000);
        const rho = Math.exp(-dt / correlation);
        const spread = noise.sigmaM * Math.sqrt(1 - rho * rho);
        ex = rho * ex + spread * random.gaussian();
        ey = rho * ey + spread * random.gaussian();
      } else {
        ex = random.gaussian() * noise.sigmaM;
        ey = random.gaussian() * noise.sigmaM;
      }
      lastT = t;
      const dx = ex + random.gaussian() * jitter;
      const dy = ey + random.gaussian() * jitter;
      const moved = destination(destination(point, 90, dx), 0, dy);
      const speed = noise.speedSigma === undefined ? null : Math.max(0, trueSpeed + random.gaussian() * noise.speedSigma);
      return { t, lat: moved.lat, lng: moved.lng, acc: noise.accuracyM, alt: null, altAcc: null, speed };
    },
  };
}

/**
 * Fixes every `intervalMs` while moving along `path` from `fromM` to `toM` at `speedMps`,
 * starting at `startMs`. Returns the fixes and the time after the last one.
 */
export function moveAlong(path: readonly LatLng[], options: { fromM?: number; toM?: number; speedMps: number; startMs: number; intervalMs?: number; device: GpsSimulator }) {
  const from = options.fromM ?? 0;
  const to = options.toM ?? pathLength(path);
  const interval = options.intervalMs ?? 1000;
  const fixes: Fix[] = [];
  const duration = ((to - from) / options.speedMps) * 1000;
  let elapsed = 0;
  for (; elapsed <= duration; elapsed += interval) {
    const position = pointAt(path, from + (options.speedMps * elapsed) / 1000);
    fixes.push(options.device.fix(position, options.startMs + elapsed, options.speedMps));
  }
  return { fixes, endMs: options.startMs + elapsed };
}

/** Fixes every `intervalMs` for `seconds` while standing at `point`. */
export function standStill(point: LatLng, options: { seconds: number; startMs: number; intervalMs?: number; device: GpsSimulator }) {
  const interval = options.intervalMs ?? 1000;
  const fixes: Fix[] = [];
  let elapsed = 0;
  for (; elapsed < options.seconds * 1000; elapsed += interval) fixes.push(options.device.fix(point, options.startMs + elapsed, 0));
  return { fixes, endMs: options.startMs + elapsed };
}

export const fixEntries = (fixes: readonly Fix[]): LogEntry[] => fixes.map((fix) => ({ kind: "fix", fix }));
export const control = (event: ControlEvent): LogEntry => ({ kind: "control", event });

/** start + fixes + finish, the simplest complete recording. */
export function recording(sport: Sport, fixes: readonly Fix[], options: { startMs?: number; endMs?: number } = {}): LogEntry[] {
  const start = options.startMs ?? (fixes[0]?.t ?? T0);
  const end = options.endMs ?? (fixes[fixes.length - 1]?.t ?? start);
  return [control({ type: "start", t: start, sport }), ...fixEntries(fixes), control({ type: "finish", t: end })];
}

/** Relative error of `actual` against `expected`. */
export const relativeError = (actual: number, expected: number) => Math.abs(actual - expected) / expected;
