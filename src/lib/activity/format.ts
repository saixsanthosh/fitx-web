import type { Sport } from "./types";

/*
 * Display formatting for activity numbers. Fixed formats (not locale-dependent) so every screen,
 * share image and test shows the same text.
 */

/** "5.24" (kilometres with two decimals) for the big distance readouts. */
export function kmValue(metres: number): string {
  return (Math.max(0, metres) / 1000).toFixed(2);
}

/** "850 m" under a kilometre, otherwise "5.24 km". */
export function formatDistance(metres: number): string {
  const m = Math.max(0, metres);
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
}

/** "42:07" or "1:02:07". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mm = hours ? String(minutes).padStart(2, "0") : String(minutes);
  return `${hours ? `${hours}:` : ""}${mm}:${String(seconds).padStart(2, "0")}`;
}

/** "4 min" / "1 h 05 min" for short sentences. */
export function formatDurationWords(totalSeconds: number): string {
  const minutes = Math.round(Math.max(0, totalSeconds) / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

/** "5:32" (minutes:seconds per km), or "–" when unknown or slower than 60 min/km. */
export function paceValue(secondsPerKm: number | null | undefined): string {
  if (secondsPerKm === null || secondsPerKm === undefined || !Number.isFinite(secondsPerKm) || secondsPerKm <= 0 || secondsPerKm >= 3600) return "–";
  const rounded = Math.round(secondsPerKm);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

export function formatPace(secondsPerKm: number | null | undefined): string {
  const value = paceValue(secondsPerKm);
  return value === "–" ? value : `${value} /km`;
}

/** "24.6" (km/h with one decimal), or "–" when unknown. */
export function speedValue(metresPerSecond: number | null | undefined): string {
  if (metresPerSecond === null || metresPerSecond === undefined || !Number.isFinite(metresPerSecond) || metresPerSecond < 0) return "–";
  return (metresPerSecond * 3.6).toFixed(1);
}

export function formatSpeed(metresPerSecond: number | null | undefined): string {
  const value = speedValue(metresPerSecond);
  return value === "–" ? value : `${value} km/h`;
}

const SPORT_TITLE: Record<Sport, string> = { walk: "walk", run: "run", ride: "ride" };

/** "Morning run", "Evening ride"… from the local start hour. */
export function defaultTitle(sport: Sport, startedAt: Date): string {
  const hour = startedAt.getHours();
  const part = hour >= 5 && hour < 12 ? "Morning" : hour >= 12 && hour < 17 ? "Afternoon" : hour >= 17 && hour < 21 ? "Evening" : "Night";
  return `${part} ${SPORT_TITLE[sport]}`;
}

/** Trims and limits a user-entered title; falls back to the default. */
export function cleanTitle(value: string, fallback: string): string {
  const title = value.replace(/\s+/g, " ").trim().slice(0, 80);
  return title || fallback;
}

/** "2026-11-17": the calendar day in the viewer's time zone (for file names). */
export function localDateKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "Mon 16 Nov, 6:42 am" in the viewer's time zone. */
export function formatActivityDate(iso: string | number | Date): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const day = date.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  const time = date.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  return `${day}, ${time}`;
}
