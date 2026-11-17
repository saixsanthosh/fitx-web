import { SPORT_CONFIG, type SportConfig } from "../config";
import type { EngineOptions } from "../engine";
import type { Sport } from "../types";

/*
 * Engine settings for imported files. Watches often record "smart" tracks with a point every few
 * seconds instead of every second, so a longer wait between points is not lost signal: up to two
 * minutes is read as a normal step (and still only counts as moving time when the position moved).
 * Everything else follows FITX's own rules. Imported activities are replayed with these settings on
 * their page too, so the route drawn there matches the saved numbers.
 */

/** The longest wait between two points that still joins them (ms). Longer gaps that moved far are lost signal. */
export const IMPORT_MAX_FIX_INTERVAL_MS = 120_000;
/** Accuracy assumed for a point when the file gives none, metres (watch tracks are already filtered). */
export const DEFAULT_IMPORT_ACCURACY_M = 5;

export function importConfig(sport: Sport): SportConfig {
  const base = SPORT_CONFIG[sport];
  return { ...base, maxFixIntervalMs: Math.max(base.maxFixIntervalMs, IMPORT_MAX_FIX_INTERVAL_MS) };
}

export const IMPORT_ENGINE: EngineOptions = { configFor: importConfig };
