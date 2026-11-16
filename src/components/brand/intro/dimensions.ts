/**
 * Physical dimensions shared by props (`sets/`) and animation (`motion/`), so hands land on
 * handlebars, feet on pedals and plates on the platform. Meters; +Y up; props face +Z.
 * Worker-safe data only.
 */

import type { Vec3Tuple } from "./types";

/** Road bike. Local origin: on the ground directly under the bottom bracket; the bike faces +Z. */
export const BIKE = {
  wheelRadius: 0.335,
  tireRadius: 0.014,
  rearAxle: [0, 0.335, -0.41] as Vec3Tuple,
  frontAxle: [0, 0.335, 0.58] as Vec3Tuple,
  crankCenter: [0, 0.27, 0] as Vec3Tuple,
  crankLength: 0.172,
  /** Pedal spindle centre distance from the bike's midplane. */
  pedalOffsetX: 0.105,
  saddleTop: [0, 0.955, -0.225] as Vec3Tuple,
  saddleLength: 0.27,
  /** Brake-hood hand positions (left, right). */
  hoods: [[0.2, 0.88, 0.58], [-0.2, 0.88, 0.58]] as [Vec3Tuple, Vec3Tuple],
  barCenter: [0, 0.855, 0.5] as Vec3Tuple,
  barHalfWidth: 0.21,
  headTubeTop: [0, 0.845, 0.39] as Vec3Tuple,
  /** Cruising speed for the ride shots and the matching wheel/crank rates. */
  speed: 11.4,
  cadenceRpm: 94,
} as const;

/** Olympic barbell + bumpers. Local origin: bar centre; the bar runs along X. */
export const BARBELL = {
  length: 2.2,
  shaftRadius: 0.014,
  sleeveRadius: 0.025,
  /** Inner collar distance from centre; sleeves run from here to `length / 2`. */
  sleeveStart: 0.655,
  /** Plates loaded per side, inside → outside. 4 × 20 kg + 1 × 10 kg per side = 200 kg with the bar. */
  plates: [
    { diameter: 0.45, thickness: 0.066, color: "coral" },
    { diameter: 0.45, thickness: 0.066, color: "coral" },
    { diameter: 0.45, thickness: 0.066, color: "coral" },
    { diameter: 0.45, thickness: 0.066, color: "coral" },
    { diameter: 0.45, thickness: 0.042, color: "graphite" },
  ],
  /** Hand centres for a conventional deadlift grip. */
  gripHalfWidth: 0.235,
  /** Bar centre height when the plates rest on the surface under them. */
  restHeight: 0.225,
} as const;

/** Wooden lifting platform the lifter and bar stand on. Local origin: floor under the centre. */
export const PLATFORM = { width: 2.6, depth: 2.4, height: 0.032 } as const;

/** Refuel table and chairs. Local origin: floor under the table centre; diners sit on ±X ends facing each other. */
export const TABLE = {
  height: 0.75,
  width: 1.3,
  depth: 0.78,
  topThickness: 0.035,
  seatHeight: 0.465,
  seatDepth: 0.42,
  /** Seat centres (front edge of the seat faces the table). */
  seats: [[-0.86, 0.465, 0], [0.86, 0.465, 0]] as [Vec3Tuple, Vec3Tuple],
  /** Place settings on the table top (bowl centre, glass centre) per diner. */
  places: [
    { bowl: [-0.34, 0.75, 0.04] as Vec3Tuple, glass: [-0.36, 0.75, 0.25] as Vec3Tuple },
    { bowl: [0.34, 0.75, -0.04] as Vec3Tuple, glass: [0.36, 0.75, -0.25] as Vec3Tuple },
  ],
  glassHeight: 0.15,
  glassRadius: 0.037,
  bowlRadius: 0.092,
  bowlHeight: 0.058,
} as const;

/** Athletics track plus the outer bike lane. Local origin: start line centre of lane 4; running direction +Z. */
export const TRACK = {
  laneWidth: 1.22,
  lineWidth: 0.05,
  lanes: 8,
  /** Bike lane runs parallel, outside lane 8, separated by a low curb. */
  bikeLaneOffsetX: 6.4,
  bikeLaneWidth: 2.2,
  straightLength: 120,
} as const;
