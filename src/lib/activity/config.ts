import type { Sport } from "./types";

/**
 * Tracking thresholds per sport. Every value here is a tuning knob for real-device field tests;
 * the engine reads nothing else. The current values were tuned on synthetic tracks with slowly
 * drifting (realistic) and independent (harsh) GPS error: see tests/activity/engine.test.ts.
 */
export type SportConfig = {
  /** Fixes less accurate than this (metres) are not used for the route. */
  maxAccuracyM: number;
  /** Faster than this between two fixes (m/s, beyond their combined accuracy) is a GPS jump. */
  maxSpeedMps: number;
  /** Process noise of the position smoother: how sharply speed and direction change, m/s². */
  accelerationNoise: number;
  /** Smallest step added to the route while moving, metres (raised for poor accuracy). */
  minStepM: number;
  /** Largest step threshold, metres. */
  maxStepM: number;
  /** The step also grows with the fix's reported accuracy: accuracy x this factor. */
  stepPerAccuracy: number;
  /** A usual moving speed (m/s): with large steps, a stop is only assumed after 1.5 steps' time at it. */
  typicalSpeedMps: number;
  /** No step for this long (ms) means the person has stopped (position-only tracking). */
  stopAfterMs: number;
  /** Once stopped, moving again needs this distance from the stop, metres (raised for poor accuracy). */
  exitRadiusM: number;
  /** A longer wait between fixes that also moved far is an interruption, not a stop (ms). */
  maxFixIntervalMs: number;
  /** Window for the live pace or speed shown while recording (ms). */
  liveWindowMs: number;
  /** Speed below which a person counts as stopped (m/s); with device speeds, moving needs this. */
  minMovingSpeedMps: number;
};

const WALK: SportConfig = {
  maxAccuracyM: 30,
  maxSpeedMps: 7,
  accelerationNoise: 0.3,
  minStepM: 5,
  maxStepM: 25,
  stepPerAccuracy: 2,
  typicalSpeedMps: 1.3,
  stopAfterMs: 10_000,
  exitRadiusM: 10,
  maxFixIntervalMs: 30_000,
  liveWindowMs: 30_000,
  minMovingSpeedMps: 0.4,
};
const RUN: SportConfig = {
  maxAccuracyM: 30,
  maxSpeedMps: 12,
  accelerationNoise: 0.5,
  minStepM: 5,
  maxStepM: 25,
  stepPerAccuracy: 2,
  typicalSpeedMps: 2.8,
  stopAfterMs: 8_000,
  exitRadiusM: 10,
  maxFixIntervalMs: 30_000,
  liveWindowMs: 30_000,
  minMovingSpeedMps: 0.6,
};
const RIDE: SportConfig = {
  maxAccuracyM: 30,
  maxSpeedMps: 35,
  accelerationNoise: 1,
  minStepM: 8,
  maxStepM: 30,
  stepPerAccuracy: 2,
  typicalSpeedMps: 5.5,
  stopAfterMs: 6_000,
  exitRadiusM: 15,
  maxFixIntervalMs: 20_000,
  liveWindowMs: 10_000,
  minMovingSpeedMps: 1,
};

/**
 * The newer sports start from the closest original one and change only what their movement changes: hikes and
 * trail runs are slower with longer stops on climbs, mountain bikes slower than road bikes with tighter turns,
 * wheelchairs, inline skates and paddling between walking and cycling speeds. Untested in the field so far.
 */
export const SPORT_CONFIG: Record<Sport, SportConfig> = {
  walk: WALK,
  run: RUN,
  ride: RIDE,
  hike: { ...WALK, typicalSpeedMps: 1.1, stopAfterMs: 15_000, maxSpeedMps: 6 },
  trail_run: { ...RUN, typicalSpeedMps: 2.3, stopAfterMs: 10_000 },
  mtb: { ...RIDE, maxSpeedMps: 25, accelerationNoise: 1.2, minStepM: 6, typicalSpeedMps: 3.5, stopAfterMs: 8_000 },
  ebike: { ...RIDE, typicalSpeedMps: 6 },
  wheelchair: { ...WALK, maxSpeedMps: 12, accelerationNoise: 0.5, typicalSpeedMps: 1.4, minMovingSpeedMps: 0.4 },
  skate: { ...RIDE, maxSpeedMps: 18, accelerationNoise: 0.8, minStepM: 6, typicalSpeedMps: 3.8, stopAfterMs: 6_000, exitRadiusM: 12, minMovingSpeedMps: 0.8 },
  paddle: { ...WALK, maxSpeedMps: 8, accelerationNoise: 0.25, minStepM: 6, typicalSpeedMps: 1.6, stopAfterMs: 15_000, exitRadiusM: 12, liveWindowMs: 30_000, minMovingSpeedMps: 0.3 },
};

/** Accuracy (metres) at or below which a fix counts as a good GPS signal before starting. */
export const GOOD_ACCURACY_M = 20;
/** Accuracy (metres) above which the phone is almost certainly sharing approximate location only. */
export const COARSE_ACCURACY_M = 100;

/**
 * The original sport each sport looks and behaves like: its colour, how its share image orders figures, and the
 * figures its page leads with. Walk: walking, hiking, wheelchair. Run: running and trail running. Ride: cycling,
 * inline skating and paddling (speed sports).
 */
export type SportFamily = "walk" | "run" | "ride";
export type SportGroupId = "foot" | "cycle" | "other";

type SportInfo = {
  label: string;
  noun: string;
  plural: string;
  family: SportFamily;
  group: SportGroupId;
  /** Shown as pace (time per km) rather than speed. */
  pace: boolean;
  /** Path segment of the sport's own page (/activity/<slug>). */
  slug: string;
  /** Altitude matters here: live climb and current altitude lead while recording (as Strava does for hikes, trail runs and bikes). */
  climbs: boolean;
};

export const SPORT_INFO: Record<Sport, SportInfo> = {
  walk: { label: "Walk", noun: "walk", plural: "Walks", family: "walk", group: "foot", pace: true, slug: "walk", climbs: false },
  run: { label: "Run", noun: "run", plural: "Runs", family: "run", group: "foot", pace: true, slug: "run", climbs: false },
  ride: { label: "Ride", noun: "ride", plural: "Rides", family: "ride", group: "cycle", pace: false, slug: "ride", climbs: true },
  hike: { label: "Hike", noun: "hike", plural: "Hikes", family: "walk", group: "foot", pace: true, slug: "hike", climbs: true },
  trail_run: { label: "Trail run", noun: "trail run", plural: "Trail runs", family: "run", group: "foot", pace: true, slug: "trail-run", climbs: true },
  mtb: { label: "Mountain bike", noun: "mountain bike ride", plural: "Mountain bike rides", family: "ride", group: "cycle", pace: false, slug: "mountain-bike", climbs: true },
  ebike: { label: "E-bike", noun: "e-bike ride", plural: "E-bike rides", family: "ride", group: "cycle", pace: false, slug: "e-bike", climbs: true },
  wheelchair: { label: "Wheelchair", noun: "wheelchair push", plural: "Wheelchair pushes", family: "walk", group: "foot", pace: true, slug: "wheelchair", climbs: false },
  skate: { label: "Inline skate", noun: "skate", plural: "Skates", family: "ride", group: "other", pace: false, slug: "inline-skate", climbs: false },
  paddle: { label: "Paddle", noun: "paddle", plural: "Paddles", family: "ride", group: "other", pace: false, slug: "paddle", climbs: false },
};

/** The sport chooser's groups, in Strava's order: foot sports, cycle sports, then the rest. */
export const SPORT_GROUPS: ReadonlyArray<{ id: SportGroupId; label: string; sports: readonly Sport[] }> = [
  { id: "foot", label: "Foot and wheelchair", sports: ["run", "trail_run", "walk", "hike", "wheelchair"] },
  { id: "cycle", label: "Cycling", sports: ["ride", "mtb", "ebike"] },
  { id: "other", label: "Wheels and water", sports: ["skate", "paddle"] },
];

export const SPORT_LABEL: Record<Sport, string> = mapSports((sport) => SPORT_INFO[sport].label);
export const SPORT_NOUN: Record<Sport, string> = mapSports((sport) => SPORT_INFO[sport].noun);

function mapSports<T>(pick: (sport: Sport) => T): Record<Sport, T> {
  return Object.fromEntries((Object.keys(SPORT_INFO) as Sport[]).map((sport) => [sport, pick(sport)])) as Record<Sport, T>;
}

export function sportFamily(sport: Sport): SportFamily {
  return SPORT_INFO[sport].family;
}

/** Walking, running, hiking and wheelchair sports show pace (time per km); the rest show speed. */
export function usesPace(sport: Sport): boolean {
  return SPORT_INFO[sport].pace;
}

/** The sport whose page is /activity/<slug>, or null. */
export function sportFromSlug(slug: string): Sport | null {
  return (Object.keys(SPORT_INFO) as Sport[]).find((sport) => SPORT_INFO[sport].slug === slug) ?? null;
}
