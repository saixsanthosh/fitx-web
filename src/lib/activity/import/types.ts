import type { ImportFormat, Sport } from "../types";

/** One position from an imported file. Times are epoch milliseconds; unknown values are null, never 0. */
export type ImportPoint = {
  t: number;
  lat: number;
  lng: number;
  /** Altitude in metres (GPS or barometric, as the device recorded it). */
  alt: number | null;
  /** Ground speed in m/s, when the file records it. */
  speed: number | null;
  /** The device's own distance so far, metres (FIT and TCX), when recorded. */
  distanceM: number | null;
  heartRate: number | null;
  /** Horizontal and vertical accuracy in metres (Apple Health route files), when recorded. */
  acc: number | null;
  altAcc: number | null;
};

/** What the file says about its sport, before the person confirms it. */
export type SportReading =
  | { kind: "known"; sport: Sport; label: string }
  | { kind: "unknown"; label: string | null }
  | { kind: "unsupported"; label: string };

/** Totals the device itself wrote into the file (FIT session, TCX laps). Shown for comparison only. */
export type DeviceTotals = {
  distanceM: number | null;
  timerSeconds: number | null;
  elapsedSeconds: number | null;
  ascentM: number | null;
  kcal: number | null;
};

/** A readable activity file, before it becomes a FITX activity. */
export type ParsedImport = {
  format: ImportFormat;
  /** The device or app the file names: FIT manufacturer and product name, TCX creator, GPX creator. Never guessed. */
  device: string | null;
  sport: SportReading;
  /** The activity's name in the file (GPX track name), if any. */
  name: string | null;
  /** Continuous stretches of points in time order (a GPX track segment break starts a new one). */
  segments: ImportPoint[][];
  /** Times the device's timer was stopped (FIT timer events), as [stop, start] pairs in epoch ms. */
  pauses: Array<{ start: number; end: number }>;
  /** True when a break between `segments` means the recording was paused (GPX segments). */
  segmentsArePauses: boolean;
  /** When the activity started and ended: the device's own times when it wrote them, else the first and last point. */
  startedAt: number;
  endedAt: number;
  totals: DeviceTotals | null;
  /** Points left out because their time or position was invalid. */
  skippedPoints: number;
};

/** Why a file can't be imported, in words for the person. */
export class ImportError extends Error {
  readonly code: ImportErrorCode;
  constructor(code: ImportErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export type ImportErrorCode =
  | "too-large"
  | "unknown-format"
  | "damaged"
  | "not-activity"
  | "no-points"
  | "no-times"
  | "too-long"
  | "too-far"
  | "unsupported-sport"
  /** The activity starts after now: the recording device's clock was wrong. */
  | "future-start";

/** Limits that keep a file's work bounded on a phone. */
export const IMPORT_LIMITS = {
  /** Largest file read, bytes (a 10-hour 1-second GPX is about 10 MB; FIT files are far smaller). */
  maxFileBytes: 30 * 1024 * 1024,
  /** Largest size a .gz file may unpack to, bytes. */
  maxUnpackedBytes: 60 * 1024 * 1024,
  /** Most points read from one file (two days at one a second, with room to spare). */
  maxPoints: 250_000,
  /** Most FIT messages read from one file. */
  maxFitMessages: 2_000_000,
  /** Files read at once on the import page. */
  maxFiles: 50,
} as const;

/**
 * The total of per-lap values, or null unless every lap has one: a lap without a value is unknown,
 * not 0, so adding the others would give a figure that looks complete but is too low.
 */
export function sumIfAllKnown(values: ReadonlyArray<number | null>): number | null {
  if (!values.length || values.some((value) => value === null)) return null;
  return values.reduce<number>((sum, value) => sum + (value as number), 0);
}
