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

export const SPORT_CONFIG: Record<Sport, SportConfig> = {
  walk: {
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
  },
  run: {
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
  },
  ride: {
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
  },
};

/** Accuracy (metres) at or below which a fix counts as a good GPS signal before starting. */
export const GOOD_ACCURACY_M = 20;
/** Accuracy (metres) above which the phone is almost certainly sharing approximate location only. */
export const COARSE_ACCURACY_M = 100;

export const SPORT_LABEL: Record<Sport, string> = { walk: "Walk", run: "Run", ride: "Ride" };
export const SPORT_NOUN: Record<Sport, string> = { walk: "walk", run: "run", ride: "ride" };

/** Walks and runs show pace (time per km); rides show speed. */
export function usesPace(sport: Sport): boolean {
  return sport !== "ride";
}
