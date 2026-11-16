/**
 * Shared types for FITX activity tracking (walk, run, ride).
 *
 * Everything in src/lib/activity is plain TypeScript with erasable syntax only, so the engine,
 * codecs and maths run unchanged in the browser and under `node --test`.
 */

export type Sport = "walk" | "run" | "ride";
export const SPORTS: readonly Sport[] = ["walk", "run", "ride"];

export function isSport(value: unknown): value is Sport {
  return value === "walk" || value === "run" || value === "ride";
}

/** A latitude/longitude pair in degrees. */
export type LatLng = { lat: number; lng: number };

/** One position report from the browser, normalised. Times are epoch milliseconds. */
export type Fix = {
  t: number;
  lat: number;
  lng: number;
  /** Horizontal accuracy in metres, as reported by the device. */
  acc: number;
  /** Altitude in metres, when the device reports it. */
  alt: number | null;
  altAcc: number | null;
  /** Ground speed in m/s, when the device reports it (Doppler; often more precise than positions). */
  speed: number | null;
};

/** Recorder controls and page-lifecycle changes, in the order they happened. */
export type ControlEvent =
  | { type: "start"; t: number; sport: Sport }
  | { type: "pause"; t: number }
  | { type: "resume"; t: number }
  | { type: "hidden"; t: number }
  | { type: "visible"; t: number }
  | { type: "finish"; t: number };

/** One entry of the recording log: everything the engine needs to rebuild a recording exactly. */
export type LogEntry = { kind: "fix"; fix: Fix } | { kind: "control"; event: ControlEvent };

/** A point of the smoothed, jitter-filtered route the engine commits to. */
export type RoutePoint = {
  t: number;
  lat: number;
  lng: number;
  /** Distance travelled up to this point, metres. */
  d: number;
};

/**
 * Why part of a recording is left out: the page was hidden (screen locked, another app), the
 * GPS signal was lost, or the position jumped implausibly far (GPS error, or travel by vehicle).
 */
export type GapKind = "hidden" | "signal" | "jump";

/** A stretch of a recording without position data. Its distance is never added to the total. */
export type Gap = {
  kind: GapKind;
  /** Epoch ms. */
  start: number;
  end: number;
  /**
   * Straight-line distance between the last position before and the first after, metres; null
   * when tracking ended (pause or finish) before a new position arrived. Shown, never added.
   */
  straightLineM: number | null;
};

/** A completed kilometre (or the final part of one). */
export type Split = {
  index: number;
  distanceM: number;
  movingSeconds: number;
  elapsedSeconds: number;
};
