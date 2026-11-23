import { SPORT_INFO, usesPace } from "./config";
import type { Split, Sport } from "./types";

/*
 * Spoken updates while recording (Strava's "audio cues"): a line at each split, and when the recording pauses or
 * resumes. Read with an on-device voice only (components/coach/voice.ts pickVoice), so nothing leaves the phone.
 * Plain functions here; the recorder screen speaks them.
 */

/** Pace sports speak every kilometre; speed sports every 5 km (a cue a minute on a bike would be noise). */
export function cueEveryKm(sport: Sport): number {
  return usesPace(sport) ? 1 : 5;
}

function minutesAndSeconds(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  const parts = [];
  if (minutes) parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
  if (seconds || !minutes) parts.push(`${seconds} ${seconds === 1 ? "second" : "seconds"}`);
  return parts.join(" ");
}

function hoursMinutes(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(s / 3600);
  if (!hours) return minutesAndSeconds(s);
  const minutes = Math.floor((s % 3600) / 60);
  return `${hours} ${hours === 1 ? "hour" : "hours"}${minutes ? ` ${minutes} ${minutes === 1 ? "minute" : "minutes"}` : ""}`;
}

/**
 * The line for a whole-kilometre split, or null when this kilometre is not a cue point (or its numbers are not
 * known). `splits` are the completed whole kilometres so far; the last one just closed.
 */
export function splitCue(sport: Sport, splits: readonly Split[], totals: { movingSeconds: number; distanceM: number }): string | null {
  const split = splits[splits.length - 1];
  if (!split || split.distanceM < 990) return null;
  const every = cueEveryKm(sport);
  if (split.index % every !== 0) return null;
  const recent = splits.slice(-every);
  const recentSeconds = recent.reduce((sum, item) => sum + item.movingSeconds, 0);
  const recentMetres = recent.reduce((sum, item) => sum + item.distanceM, 0);
  if (!(recentSeconds > 0) || !(totals.movingSeconds > 0)) return null;
  const distance = `${split.index} ${split.index === 1 ? "kilometre" : "kilometres"}`;
  const time = `Time ${hoursMinutes(totals.movingSeconds)}`;
  if (usesPace(sport)) {
    const pace = (recentSeconds / recentMetres) * 1000;
    const average = (totals.movingSeconds / totals.distanceM) * 1000;
    return `${distance}. ${time}. Last kilometre ${minutesAndSeconds(pace)}. Average pace ${minutesAndSeconds(average)} per kilometre.`;
  }
  const speed = (recentMetres / recentSeconds) * 3.6;
  const average = (totals.distanceM / totals.movingSeconds) * 3.6;
  return `${distance}. ${time}. Last ${every} kilometres at ${speed.toFixed(1)} kilometres an hour. Average ${average.toFixed(1)}.`;
}

export type StateCue = "started" | "paused" | "resumed" | "auto-paused" | "auto-resumed";

export function stateCue(sport: Sport, cue: StateCue): string {
  const noun = SPORT_INFO[sport].noun;
  switch (cue) {
    case "started":
      return `${noun.charAt(0).toUpperCase()}${noun.slice(1)} started.`;
    case "paused":
      return "Paused.";
    case "resumed":
      return "Recording.";
    case "auto-paused":
      return "Auto-paused.";
    case "auto-resumed":
      return "Moving again.";
  }
}
