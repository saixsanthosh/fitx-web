/**
 * Today's Home workout sets, kept on this device until the member saves them to workout history.
 * Only counts and cue labels are kept: no video, images or body positions.
 */
import type { CoachSummary } from "@/lib/form-rules/session";
import type { ExerciseId } from "@/lib/form-rules/types";

export interface LoggedSet {
  id: string;
  exerciseId: ExerciseId;
  exerciseName: string;
  kind: "reps" | "hold";
  reps: number;
  cleanReps: number;
  holdSeconds: number;
  /** Form per rep: clean, or the cue ids raised during it. */
  repLog: Array<{ clean: boolean; cues: string[] }>;
  /** Cue texts by id, for the reps that had one. */
  cueTexts: Record<string, string>;
  /** Epoch milliseconds. */
  startedAt: number;
  endedAt: number;
}

/** A finished camera set worth keeping: something was counted. */
export function setFromSummary(summary: CoachSummary, exerciseName: string, endedAt: number, id: string): LoggedSet | null {
  const counted = summary.kind === "hold" ? summary.holdSeconds > 0 : summary.reps > 0;
  if (!counted) return null;
  const seconds = summary.kind === "hold" ? summary.positionSeconds : summary.activeSeconds;
  return {
    id,
    exerciseId: summary.exerciseId,
    exerciseName,
    kind: summary.kind,
    reps: summary.kind === "reps" ? summary.reps : 0,
    cleanReps: summary.kind === "reps" ? summary.cleanReps : 0,
    holdSeconds: summary.kind === "hold" ? summary.holdSeconds : 0,
    repLog: summary.repLog.map((rep) => ({ clean: rep.clean, cues: [...rep.cues] })),
    cueTexts: Object.fromEntries(summary.cues.map((cue) => [cue.id, cue.text])),
    startedAt: endedAt - Math.max(0, seconds) * 1000,
    endedAt,
  };
}

const STORAGE_KEY = "fitx:home-workout:today";

/** The local calendar day of an epoch time, "YYYY-MM-DD". */
export function localDay(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Only today's sets survive: yesterday's unsaved sets are not carried into today's workout. */
export function todaysSets(value: unknown, now: number): LoggedSet[] {
  if (!value || typeof value !== "object") return [];
  const stored = value as { day?: unknown; sets?: unknown };
  if (stored.day !== localDay(now) || !Array.isArray(stored.sets)) return [];
  return stored.sets.filter(isLoggedSet);
}

function isLoggedSet(value: unknown): value is LoggedSet {
  if (!value || typeof value !== "object") return false;
  const set = value as Partial<LoggedSet>;
  return typeof set.id === "string" && typeof set.exerciseId === "string" && typeof set.exerciseName === "string"
    && (set.kind === "reps" || set.kind === "hold") && Number.isFinite(set.reps) && Number.isFinite(set.holdSeconds)
    && Number.isFinite(set.startedAt) && Number.isFinite(set.endedAt) && Array.isArray(set.repLog);
}

/** Reads today's sets from this tab's storage (empty when storage is blocked or holds another day). */
export function readSets(storage: Pick<Storage, "getItem"> | null, now: number): LoggedSet[] {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    return raw ? todaysSets(JSON.parse(raw), now) : [];
  } catch {
    return [];
  }
}

export function writeSets(storage: Pick<Storage, "setItem" | "removeItem"> | null, sets: readonly LoggedSet[], now: number): void {
  try {
    if (!storage) return;
    if (sets.length === 0) storage.removeItem(STORAGE_KEY);
    else storage.setItem(STORAGE_KEY, JSON.stringify({ day: localDay(now), sets }));
  } catch {
    // Blocked or full storage: the sets still live on this page until it closes.
  }
}

/** "12 reps" or "0:45", for a set. */
export function setResult(set: Pick<LoggedSet, "kind" | "reps" | "holdSeconds">): string {
  if (set.kind === "hold") {
    const seconds = Math.max(0, Math.floor(set.holdSeconds));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }
  return `${set.reps} ${set.reps === 1 ? "rep" : "reps"}`;
}
