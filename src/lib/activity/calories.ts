import type { Sport } from "./types";

/*
 * Estimated energy cost from MET values of the 2024 Adult Compendium of Physical Activities
 * (Herrmann et al., J Sport Health Sci 2024; pacompendium.com, for adults aged 19-59).
 * Each entry is the middle of the speed range a Compendium code describes; values between
 * entries are interpolated linearly and values outside the table are held at its ends.
 * Calories use the ACSM conversion: kcal/min = MET x 3.5 x body mass (kg) / 200.
 * Always shown to the user as an estimate, and never without a body weight.
 */

const MPH = 0.44704;

/** [speed m/s, MET]: walking, level firm surface (codes 17151-17231). */
const WALKING: ReadonlyArray<readonly [number, number]> = [
  [1.5 * MPH, 2.3], // 17151 less than 2.0 mph, strolling
  [2.2 * MPH, 2.8], // 17152 2.0-2.4 mph, slow
  [2.5 * MPH, 3.0], // 17170 2.5 mph
  [3.1 * MPH, 3.8], // 17190 2.8-3.4 mph, moderate
  [3.7 * MPH, 4.8], // 17200 3.5-3.9 mph, brisk
  [4.2 * MPH, 5.5], // 17220 4.0-4.4 mph, very brisk
  [4.7 * MPH, 7.0], // 17230 4.5-4.9 mph
  [5.25 * MPH, 8.5], // 17231 5.0-5.5 mph
];

/** Running (codes 12028-12135). Below 4 mph a "run" is costed as walking. */
const RUNNING: ReadonlyArray<readonly [number, number]> = [
  [4.1 * MPH, 6.5], // 12028 4-4.2 mph
  [4.55 * MPH, 7.8], // 12029 4.3-4.8 mph
  [5.1 * MPH, 8.5], // 12030 5.0-5.2 mph
  [5.65 * MPH, 9.0], // 12045 5.5-5.8 mph
  [6.15 * MPH, 9.3], // 12050 6-6.3 mph
  [6.7 * MPH, 10.5], // 12060
  [7 * MPH, 11.0], // 12070
  [7.5 * MPH, 11.8], // 12080
  [8 * MPH, 12.0], // 12090
  [8.6 * MPH, 12.5], // 12100
  [9 * MPH, 13.0], // 12110
  [9.45 * MPH, 14.8], // 12115 9.3-9.6 mph
  [10 * MPH, 14.8], // 12120
  [11 * MPH, 16.8], // 12130
  [12 * MPH, 18.5], // 12132
  [13 * MPH, 19.8], // 12134
  [14 * MPH, 23.0], // 12135
];
const RUNNING_MIN_SPEED = 4 * MPH;

/** Bicycling on the road (codes 01018-01060). */
const CYCLING: ReadonlyArray<readonly [number, number]> = [
  [5.5 * MPH, 3.5], // 01018 leisure 5.5 mph
  [9.4 * MPH, 5.8], // 01019 leisure 9.4 mph
  [10.95 * MPH, 6.8], // 01020 10-11.9 mph
  [12.95 * MPH, 8.0], // 01030 12-13.9 mph
  [14.95 * MPH, 10.0], // 01040 14-15.9 mph
  [17.5 * MPH, 12.0], // 01050 16-19 mph
  [21 * MPH, 16.8], // 01060 more than 20 mph
];

function interpolateTable(table: ReadonlyArray<readonly [number, number]>, speed: number): number {
  if (speed <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [s1, m1] = table[i];
    if (speed <= s1) {
      const [s0, m0] = table[i - 1];
      return m0 + ((m1 - m0) * (speed - s0)) / (s1 - s0);
    }
  }
  return table[table.length - 1][1];
}

/** MET for moving at `speedMps` in `sport`. */
export function metFor(sport: Sport, speedMps: number): number {
  const speed = Number.isFinite(speedMps) && speedMps > 0 ? speedMps : 0;
  if (sport === "ride") return interpolateTable(CYCLING, speed);
  if (sport === "run" && speed >= RUNNING_MIN_SPEED) return interpolateTable(RUNNING, speed);
  return interpolateTable(WALKING, speed);
}

/** A body weight the estimate can use (kg), or null. */
export function usableWeight(weightKg: unknown): number | null {
  const value = typeof weightKg === "string" ? Number(weightKg) : weightKg;
  return typeof value === "number" && Number.isFinite(value) && value >= 30 && value <= 500 ? value : null;
}

/** How the estimate was made; stored with each activity and shown after "Calories are an estimate:". */
export const KCAL_METHOD =
  "MET for your speed in each kilometre (2024 Adult Compendium of Physical Activities, adult values) × body weight × moving time.";

/**
 * Estimated kcal for parts of an activity (each kilometre split, plus the last part), or null
 * without a usable body weight. Stopped and paused time is not counted.
 */
export function estimateKcal(sport: Sport, parts: ReadonlyArray<{ distanceM: number; movingSeconds: number }>, weightKg: unknown): number | null {
  const weight = usableWeight(weightKg);
  if (weight === null) return null;
  let kcal = 0;
  for (const part of parts) {
    if (!(part.movingSeconds > 0)) continue;
    const met = metFor(sport, part.distanceM / part.movingSeconds);
    kcal += (met * 3.5 * weight / 200) * (part.movingSeconds / 60);
  }
  return Math.round(kcal);
}
