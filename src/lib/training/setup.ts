/**
 * The Workouts first-time setup (brief 3.4): where the member trains, their equipment, experience, training days,
 * limitations and which demonstration model to show. It reuses user_preferences (workout_location, equipment,
 * fitness_level, workouts_per_week, limitations) and user_equipment_profiles; migration 20261123100020 adds
 * user_preferences.workout_setup_at and demo_model. Every read and write works before that migration: the two
 * columns are then left out and setup counts as done once the member has a saved equipment list.
 *
 * Setup never blocks a page: Workouts shows it inline on a first visit, members can choose Later, and change
 * their answers at any time from Workouts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { columnList, withOptionalColumns } from "@/lib/domain/schema-fallback";
import { loadEquipmentProfiles, saveEquipmentProfile, type EquipmentProfiles } from "./data";
import { sortEquipmentKeys } from "./equipment";
import { LEVELS, type Level, type TrainingContext } from "./taxonomy";

type Db = SupabaseClient;

export const WORKOUT_LOCATIONS = ["home", "gym", "both"] as const;
export type WorkoutLocation = (typeof WORKOUT_LOCATIONS)[number];
export const LOCATION_LABELS: Readonly<Record<WorkoutLocation, string>> = { home: "Home", gym: "Gym", both: "Both" };

export const DEMO_MODELS = ["male", "female"] as const;
export type DemoModel = (typeof DEMO_MODELS)[number];
export const DEMO_MODEL_LABELS: Readonly<Record<DemoModel, string>> = { male: "Male", female: "Female" };

/** Added by 20261123100020; left out of reads and writes until it is applied. */
export const SETUP_OPTIONAL_COLUMNS = ["workout_setup_at", "demo_model"] as const;
export const SETUP_BASE_COLUMNS = ["workout_location", "fitness_level", "workouts_per_week", "limitations", "equipment"] as const;

export const MIN_DAYS = 1;
export const MAX_DAYS = 7;

export type WorkoutSetup = {
  location: WorkoutLocation;
  level: Level;
  daysPerWeek: number;
  limitations: string[];
  /** The member's own choice; null follows their profile's gender (see resolveDemoModel). */
  demoModel: DemoModel | null;
  /** profiles.gender as stored, or null. */
  gender: string | null;
  setupAt: string | null;
  profiles: EquipmentProfiles;
  /** False until 20261123100020 is applied: the setup time and demo model are then not stored. */
  columnsAvailable: boolean;
  /** True when a user_preferences row exists (the values above are otherwise defaults). */
  stored: boolean;
  done: boolean;
};

export function isWorkoutLocation(value: unknown): value is WorkoutLocation {
  return typeof value === "string" && (WORKOUT_LOCATIONS as readonly string[]).includes(value);
}

/** A stored location as one of the three answers; the old "outdoor" value reads as home (no gym needed). */
export function asWorkoutLocation(value: unknown): WorkoutLocation {
  if (isWorkoutLocation(value)) return value;
  return value === "outdoor" ? "home" : "gym";
}

export function asDemoModel(value: unknown): DemoModel | null {
  return typeof value === "string" && (DEMO_MODELS as readonly string[]).includes(value) ? (value as DemoModel) : null;
}

/** The demonstration model to show: the member's choice, else their profile's gender when male or female, else null. */
export function resolveDemoModel(choice: unknown, gender: unknown): DemoModel | null {
  const chosen = asDemoModel(choice);
  if (chosen) return chosen;
  const word = typeof gender === "string" ? gender.trim().toLowerCase() : "";
  if (word === "male" || word === "man") return "male";
  if (word === "female" || word === "woman") return "female";
  return null;
}

/** Whether the setup should ask the member to pick a model (their profile does not say male or female). */
export function needsDemoModelChoice(gender: unknown): boolean {
  return resolveDemoModel(null, gender) === null;
}

/** Setup is done once it has been saved, or (before the migration, or for accounts it did not backfill) once a list is saved. */
export function isWorkoutSetupDone(input: { setupAt: string | null | undefined; hasEquipmentList: boolean }): boolean {
  return Boolean(input.setupAt) || input.hasEquipmentList;
}

export function hasEquipmentList(profiles: EquipmentProfiles): boolean {
  return profiles.home !== null || profiles.gym !== null;
}

/** The equipment lists a location needs: home, gym or both. */
export function contextsFor(location: WorkoutLocation): TrainingContext[] {
  return location === "both" ? ["home", "gym"] : [location];
}

/** The Workouts mode a location opens on: Home for home, Gym for gym and both. */
export function modeForLocation(location: WorkoutLocation): TrainingContext {
  return location === "home" ? "home" : "gym";
}

export function clampDays(value: unknown): number {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.min(MAX_DAYS, Math.max(MIN_DAYS, number)) : 3;
}

function asLevel(value: unknown): Level {
  return typeof value === "string" && (LEVELS as readonly string[]).includes(value) ? (value as Level) : "beginner";
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

type PreferenceRow = Partial<Record<(typeof SETUP_BASE_COLUMNS)[number] | (typeof SETUP_OPTIONAL_COLUMNS)[number], unknown>>;

/** Builds the setup state from the rows read (pure, for tests). */
export function setupFromRows(input: { preferences: PreferenceRow | null; gender: string | null; profiles: EquipmentProfiles; columnsAvailable: boolean }): WorkoutSetup {
  const row = input.preferences ?? {};
  const setupAt = typeof row.workout_setup_at === "string" && row.workout_setup_at ? row.workout_setup_at : null;
  return {
    location: asWorkoutLocation(row.workout_location),
    level: asLevel(row.fitness_level),
    daysPerWeek: row.workouts_per_week === undefined || row.workouts_per_week === null ? 3 : clampDays(row.workouts_per_week),
    limitations: stringList(row.limitations),
    demoModel: asDemoModel(row.demo_model),
    gender: input.gender,
    setupAt,
    profiles: input.profiles,
    columnsAvailable: input.columnsAvailable,
    stored: input.preferences !== null,
    done: isWorkoutSetupDone({ setupAt, hasEquipmentList: hasEquipmentList(input.profiles) }),
  };
}

/** Reads the member's setup. `error` is set only when the answers could not be read (never for a missing column). */
export async function loadWorkoutSetup(db: Db, userId: string): Promise<{ error: unknown; setup: WorkoutSetup | null }> {
  const [preferences, profile, lists] = await Promise.all([
    withOptionalColumns(SETUP_OPTIONAL_COLUMNS, (include) =>
      db.from("user_preferences").select(columnList(SETUP_BASE_COLUMNS, SETUP_OPTIONAL_COLUMNS, include)).eq("user_id", userId).maybeSingle()),
    db.from("profiles").select("gender").eq("id", userId).maybeSingle(),
    loadEquipmentProfiles(db, userId),
  ]);
  const error = preferences.result.error || lists.error;
  if (error) return { error, setup: null };
  return {
    error: null,
    setup: setupFromRows({
      preferences: (preferences.result.data ?? null) as PreferenceRow | null,
      gender: profile.error ? null : ((profile.data as { gender?: string | null } | null)?.gender ?? null),
      profiles: lists.profiles,
      columnsAvailable: preferences.includedOptional,
    }),
  };
}

export type SetupAnswers = {
  location: WorkoutLocation;
  level: Level;
  daysPerWeek: number;
  limitations: readonly string[];
  demoModel: DemoModel | null;
  /** The lists to save; a context left out (or null) keeps whatever is saved for it. */
  home?: readonly string[] | null;
  gym?: readonly string[] | null;
};

/** The user_preferences row the setup writes (pure, for tests). The legacy `equipment` words follow the home list. */
export function setupPreferenceRow(userId: string, answers: SetupAnswers, now: Date): Record<string, unknown> {
  const row: Record<string, unknown> = {
    user_id: userId,
    workout_location: answers.location,
    fitness_level: answers.level,
    workouts_per_week: clampDays(answers.daysPerWeek),
    limitations: [...new Set(answers.limitations.map((item) => item.trim()).filter(Boolean))].slice(0, 20),
    demo_model: answers.demoModel,
    workout_setup_at: now.toISOString(),
  };
  if (answers.home) row.equipment = sortEquipmentKeys(answers.home);
  return row;
}

/**
 * Saves the answers: the equipment lists first (so a failed list never marks setup done), then the preferences.
 * Returns which optional columns were stored (false before the migration).
 */
export async function saveWorkoutSetup(db: Db, userId: string, answers: SetupAnswers, now = new Date()): Promise<{ error: unknown; storedSetupTime: boolean }> {
  for (const context of ["home", "gym"] as const) {
    const keys = answers[context];
    if (!keys) continue;
    const { error } = await saveEquipmentProfile(db, userId, context, keys);
    if (error) return { error, storedSetupTime: false };
  }
  const row = setupPreferenceRow(userId, answers, now);
  const outcome = await withOptionalColumns(SETUP_OPTIONAL_COLUMNS, (include) => {
    const payload = { ...row };
    if (!include) for (const column of SETUP_OPTIONAL_COLUMNS) delete payload[column];
    return db.from("user_preferences").upsert(payload, { onConflict: "user_id" });
  });
  return { error: outcome.result.error, storedSetupTime: outcome.includedOptional && !outcome.result.error };
}
