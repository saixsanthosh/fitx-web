import type { SupabaseClient } from "@supabase/supabase-js";
import { PROGRAMMES } from "@/data/programmes";
import { columnList, isMissingTableError, withOptionalColumns } from "@/lib/domain/schema-fallback";
import { CATALOG_BASE_COLUMNS, CATALOG_V2_COLUMNS, toCatalogExercise, type CatalogExercise, type CatalogRow } from "./catalog";
import { defaultEquipmentFor, expandOwnedEquipment, sortEquipmentKeys } from "./equipment";
import type { SlotSpec } from "./generator";
import type { Programme } from "./programmes";
import { EQUIPMENT, type TrainingContext } from "./taxonomy";

type Db = SupabaseClient;

/**
 * The active catalogue, light (no descriptions or instructions), for generating and swapping.
 * `curated` is false until the clean-up migration has run; the exercises are then estimated from the
 * older columns (see toCatalogExercise).
 */
export async function loadCatalog(supabase: Db): Promise<{ error: unknown; exercises: CatalogExercise[]; curated: boolean }> {
  const outcome = await withOptionalColumns(CATALOG_V2_COLUMNS, (include) =>
    supabase.from("exercise_library").select(columnList(CATALOG_BASE_COLUMNS, CATALOG_V2_COLUMNS, include)).eq("is_active", true).order("name").limit(1000));
  if (outcome.result.error) return { error: outcome.result.error, exercises: [], curated: false };
  const exercises = ((outcome.result.data ?? []) as unknown as CatalogRow[]).map(toCatalogExercise);
  return { error: null, exercises, curated: exercises.some((exercise) => exercise.curated) };
}

/** Saved Home and Gym lists; null means the user has not saved that list yet. */
export type EquipmentProfiles = { home: string[] | null; gym: string[] | null; available: boolean };

/** When each list was last saved (user_equipment_profiles.updated_at); null for a list never saved. */
export type EquipmentSavedAt = Record<TrainingContext, string | null>;

/**
 * `available` is false until the equipment migration exists; lists then cannot be saved yet. `savedAt` tells a
 * programme's days planned before the list changed from those saved since (bug 17: programme-replan.ts).
 */
export async function loadEquipmentProfiles(supabase: Db, userId: string): Promise<{ error: unknown; profiles: EquipmentProfiles; savedAt: EquipmentSavedAt }> {
  const savedAt: EquipmentSavedAt = { home: null, gym: null };
  const result = await supabase.from("user_equipment_profiles").select("context,equipment_keys,updated_at").eq("user_id", userId);
  if (result.error) {
    const missing = isMissingTableError(result.error);
    return { error: missing ? null : result.error, profiles: { home: null, gym: null, available: !missing }, savedAt };
  }
  const profiles: EquipmentProfiles = { home: null, gym: null, available: true };
  for (const row of (result.data ?? []) as Array<{ context: string; equipment_keys: string[] | null; updated_at?: string | null }>) {
    if (row.context !== "home" && row.context !== "gym") continue;
    profiles[row.context] = sortEquipmentKeys(row.equipment_keys ?? []);
    savedAt[row.context] = row.updated_at ?? null;
  }
  return { error: null, profiles, savedAt };
}

const HOME_FRIENDLY = new Set(EQUIPMENT.filter((item) => item.homeFriendly).map((item) => item.key));

/**
 * The equipment list for a context: the saved one, else a starting point (at home, the home-friendly
 * items from onboarding/Profile; at a gym, a full commercial gym).
 */
export function equipmentFor(profiles: EquipmentProfiles, context: TrainingContext, legacyWords?: readonly string[] | null): { keys: string[]; saved: boolean } {
  const saved = profiles[context];
  if (saved) return { keys: saved, saved: true };
  const keys = defaultEquipmentFor(context, legacyWords);
  return { keys: context === "home" ? keys.filter((key) => HOME_FRIENDLY.has(key)) : keys, saved: false };
}

/** What the user can use in a context, including what their items also serve as. */
export function ownedEquipmentSet(profiles: EquipmentProfiles, context: TrainingContext, legacyWords?: readonly string[] | null): Set<string> {
  return expandOwnedEquipment(equipmentFor(profiles, context, legacyWords).keys);
}

export async function saveEquipmentProfile(supabase: Db, userId: string, context: TrainingContext, keys: readonly string[]) {
  return supabase.from("user_equipment_profiles").upsert(
    { user_id: userId, context, equipment_keys: sortEquipmentKeys(keys), updated_at: new Date().toISOString() },
    { onConflict: "user_id,context" },
  );
}

type ProgrammeRow = {
  id: string; title: string; summary: string; context: TrainingContext; split: Programme["split"]; level: Programme["level"];
  days_per_week: number; default_weekdays: number[] | null; session_minutes: number; built_around: string[] | null;
  is_premium: boolean; source_notes: string;
  training_programme_days: Array<{ day_index: number; key: string; title: string; focus: string[] | null; slots: SlotSpec[] }> | null;
};

/**
 * Published programmes from the database. Until the programme migrations are applied (or if the
 * request fails) the authored copies are shown and `enrolAvailable` is false, because enrolling needs
 * the database tables. An empty list is an answer: Admin moved every programme to draft, so none is shown.
 */
export async function loadProgrammes(supabase: Db): Promise<{ programmes: Programme[]; enrolAvailable: boolean }> {
  const result = await supabase.from("training_programmes")
    .select("id,title,summary,context,split,level,days_per_week,default_weekdays,session_minutes,built_around,is_premium,source_notes,training_programme_days(day_index,key,title,focus,slots)");
  const rows = (result.data ?? []) as unknown as ProgrammeRow[];
  if (result.error) return { programmes: [...PROGRAMMES], enrolAvailable: false };
  const order = new Map(PROGRAMMES.map((programme, index) => [programme.id, index]));
  const programmes = rows.map((row): Programme => ({
    id: row.id, title: row.title, summary: row.summary, context: row.context, split: row.split, level: row.level,
    daysPerWeek: row.days_per_week, defaultWeekdays: row.default_weekdays ?? [], sessionMinutes: row.session_minutes,
    builtAround: row.built_around ?? [], isPremium: row.is_premium, sourceNotes: row.source_notes,
    days: [...(row.training_programme_days ?? [])].sort((a, b) => a.day_index - b.day_index)
      .map((day) => ({ key: day.key, title: day.title, focus: (day.focus ?? []) as Programme["days"][number]["focus"], slots: day.slots })),
  })).filter((programme) => programme.days.length > 0);
  programmes.sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99) || a.title.localeCompare(b.title));
  return { programmes, enrolAvailable: true };
}
