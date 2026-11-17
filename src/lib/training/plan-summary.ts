/**
 * What a planned workout asks for, read from its rows before it starts: the plan preview, the builder's summary and
 * programme-day previews share these. Every figure comes from the plan's own sets, reps, time and rest; the session
 * length is an estimate (the generator's rule, slotMinutes) and is always shown as one.
 *
 * Pure: type-only imports apart from the generator's timing rule and the equipment order.
 */
import type { CatalogExercise } from "./catalog";
import { sortEquipmentKeys } from "./equipment";
import { slotMinutes } from "./generator";
import type { TrainingContext } from "./taxonomy";

/** The equipment list a plan's location uses: home (and outdoor) the home list, anything else the gym list. */
export function contextForLocation(location: string | null | undefined): TrainingContext {
  return location === "home" || location === "outdoor" ? "home" : "gym";
}

/** A plan row as stored (workout_plan_exercises) or built in the builder. Targets are absent on older databases. */
export type PlanRowInput = {
  target_sets: number;
  reps_min: number;
  reps_max: number;
  rest_seconds: number;
  target_weight_kg?: number | null;
  target_duration_seconds?: number | null;
};

const whole = (value: unknown) => (Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0);

/** A timed row: one with a target in seconds (sets.ts isTimedPrescription). */
export function isTimedRow(row: Pick<PlanRowInput, "target_duration_seconds">): boolean {
  return row.target_duration_seconds != null && Number(row.target_duration_seconds) > 0;
}

/** 45 → "45 s", 90 → "1 min 30 s", 600 → "10 min". */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, whole(seconds));
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

/** Sets and work: "4 × 8–10 reps", "3 × 12 reps", "3 × 40 s". */
export function setsAndWork(row: PlanRowInput): string {
  const sets = Math.max(1, whole(row.target_sets));
  if (isTimedRow(row)) return `${sets} × ${formatDuration(Number(row.target_duration_seconds))}`;
  const low = Math.max(1, whole(row.reps_min));
  const high = Math.max(low, whole(row.reps_max));
  return `${sets} × ${low === high ? low : `${low}–${high}`} reps`;
}

/** The target load ("60 kg", "12.5 kg"), or null when none is set. */
export function targetLoad(row: Pick<PlanRowInput, "target_weight_kg">): string | null {
  const kg = Number(row.target_weight_kg);
  if (row.target_weight_kg == null || !Number.isFinite(kg) || kg <= 0) return null;
  return `${Math.round(kg * 100) / 100} kg`;
}

/** One line for a row: "4 × 8–10 reps · 60 kg", "3 × 40 s". */
export function rowPrescription(row: PlanRowInput): string {
  const load = targetLoad(row);
  return load ? `${setsAndWork(row)} · ${load}` : setsAndWork(row);
}

/** "Rest 1 min 30 s"; null when no rest is set. */
export function restLabel(seconds: number | null | undefined): string | null {
  const value = whole(seconds);
  return value > 0 ? `Rest ${formatDuration(value)}` : null;
}

/** Minutes one row takes by the generator's rule: sets × (work + rest), work = time or reps at 3.5 s plus set-up. */
export function rowMinutes(row: PlanRowInput): number {
  const sets = Math.max(0, whole(row.target_sets));
  const low = Math.max(1, whole(row.reps_min));
  const high = Math.max(low, whole(row.reps_max));
  const seconds = isTimedRow(row) ? Math.max(1, whole(row.target_duration_seconds)) : undefined;
  return slotMinutes({ muscle: "full_body", sets, reps: [low, high], rest: Math.max(0, whole(row.rest_seconds)), seconds });
}

/**
 * An estimate of the session's length in minutes, from its rows (the rest after the last set included): whole
 * minutes under 10, else to the nearest 5. Null for an empty plan.
 */
export function planEstimateMinutes(rows: readonly PlanRowInput[]): number | null {
  if (!rows.length) return null;
  const minutes = rows.reduce((sum, row) => sum + rowMinutes(row), 0);
  if (minutes < 10) return Math.max(1, Math.round(minutes));
  return Math.max(10, Math.round(minutes / 5) * 5);
}

export type PlanSummary = {
  exercises: number;
  totalSets: number;
  /** An estimate; null for an empty plan. */
  estimateMinutes: number | null;
};

export function planSummary(rows: readonly PlanRowInput[]): PlanSummary {
  return {
    exercises: rows.length,
    totalSets: rows.reduce((sum, row) => sum + Math.max(0, whole(row.target_sets)), 0),
    estimateMinutes: planEstimateMinutes(rows),
  };
}

export type PlanEquipment = {
  /** Everything the plan's exercises need, in the catalogue's order. */
  keys: string[];
  /** Of those, what is not on the member's list (when one was given). */
  missing: string[];
  /** Rows whose exercise is no longer in the library: their equipment is unknown. */
  unknown: number;
  /** Every known exercise needs no equipment. */
  bodyWeightOnly: boolean;
};

/**
 * "You'll need": the equipment of the plan's exercises (null for a row whose exercise is not in the library),
 * and what is missing from `owned` (expanded, see expandOwnedEquipment).
 */
export function planEquipment(exercises: ReadonlyArray<Pick<CatalogExercise, "required_equipment"> | null>, owned?: ReadonlySet<string> | null): PlanEquipment {
  const keys = sortEquipmentKeys(exercises.flatMap((exercise) => exercise?.required_equipment ?? []));
  const unknown = exercises.filter((exercise) => !exercise).length;
  return {
    keys,
    missing: owned ? keys.filter((key) => !owned.has(key)) : [],
    unknown,
    bodyWeightOnly: !keys.length && unknown < exercises.length,
  };
}
