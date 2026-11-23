/**
 * The data behind an exercise's page (/exercises/[id]), loaded with the browser's Supabase client: the
 * catalogue row with its text and media, the catalogue's related movements, the member's Home and Gym
 * equipment lists, and their recent completed sessions with it (exercise-history.ts). Each loader takes the
 * client, so the page, an info sheet in the builder or the live session can share them.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { exerciseMediaResult, mediaRowsFrom } from "@/components/exercises/media-loader";
import { columnList, withOptionalColumns } from "@/lib/domain/schema-fallback";
import { CATALOG_BASE_COLUMNS, CATALOG_V2_COLUMNS, toCatalogExercise, type CatalogExercise, type CatalogRow } from "./catalog";
import { loadEquipmentProfiles, type EquipmentProfiles } from "./data";
import { bestSet, formatBestSet, loadExerciseHistory, type ExerciseSession } from "./exercise-history";
import { survivingExerciseId } from "./exercise-merges";
import { resolveExerciseMedia, type DemoModelKey, type ExerciseMedia } from "./media";

type Db = Pick<SupabaseClient, "from">;

export type ExerciseDetail = {
  exercise: CatalogExercise;
  /** The catalogue description, trimmed ("" when there is none). */
  description: string;
  /** The catalogue's written steps, trimmed, empty ones left out. */
  instructions: string[];
  /** Where the exercise text comes from, when the row says. */
  attribution: string | null;
  media: ExerciseMedia;
};

export type ExerciseDetailResult =
  | { status: "found"; detail: ExerciseDetail }
  /** No active row with this id (removed, or merged into another exercise). */
  | { status: "missing" }
  /** The request failed (connection, server). */
  | { status: "error"; error: unknown };

type DetailRow = CatalogRow & { description?: string | null; instructions?: string[] | null; attribution?: string | null };

export const DETAIL_COLUMNS: readonly string[] = [...CATALOG_BASE_COLUMNS, "description", "instructions", "attribution"];

/** One active exercise with its text and media (the media table may not exist yet: the pinned photos are used). */
export async function loadExerciseDetail(db: Db, id: string, supabaseUrl: string | null | undefined, model: DemoModelKey | null = null): Promise<ExerciseDetailResult> {
  const [row, media] = await Promise.all([
    withOptionalColumns(CATALOG_V2_COLUMNS, (include) =>
      db.from("exercise_library").select(columnList(DETAIL_COLUMNS, CATALOG_V2_COLUMNS, include)).eq("id", id).eq("is_active", true).maybeSingle()),
    exerciseMediaResult(db, id),
  ]);
  if (row.result.error) return { status: "error", error: row.result.error };
  const data = row.result.data as unknown as DetailRow | null;
  if (!data) return { status: "missing" };
  const exercise = toCatalogExercise(data);
  return {
    status: "found",
    detail: {
      exercise,
      description: data.description?.trim() ?? "",
      instructions: (data.instructions ?? []).map((step) => step.trim()).filter(Boolean),
      attribution: data.attribution?.trim() || null,
      media: resolveExerciseMedia({ exerciseId: exercise.id, name: exercise.name, sourceRef: exercise.source_ref, rows: mediaRowsFrom(media), supabaseUrl, model }),
    },
  };
}

export type RelatedExercise = { id: string; name: string; primary_muscle: string };

/** The catalogue's linked movements (`alternatives`) that are still active, at most 8; [] when they cannot be read. */
export async function loadRelatedExercises(db: Db, ids: readonly string[]): Promise<RelatedExercise[]> {
  if (!ids.length) return [];
  const related = await db.from("exercise_library").select("id,name,primary_muscle").in("id", [...ids]).eq("is_active", true).limit(8);
  return (related.data || []) as RelatedExercise[];
}

export type EquipmentState = { profiles: EquipmentProfiles; legacyWords: string[]; failed: boolean };

/** The member's saved Home and Gym lists, plus the older equipment words from onboarding or Profile. */
export async function loadEquipmentState(db: Db, userId: string): Promise<EquipmentState> {
  const [lists, preferences] = await Promise.all([
    loadEquipmentProfiles(db as SupabaseClient, userId),
    db.from("user_preferences").select("equipment").eq("user_id", userId).maybeSingle(),
  ]);
  const words = (preferences.data as { equipment?: string[] | null } | null)?.equipment;
  return { profiles: lists.profiles, legacyWords: Array.isArray(words) ? words : [], failed: Boolean(lists.error) };
}

/** A row of "Your recent sessions": the session date, its completed sets and its top set. */
export type RecentSession = { id: string; started_at: string; completedSets: number; topSet: string };

/** Recent-session rows from an exercise's history; sessions without a top set are left out. */
export function recentSessionRows(sessions: readonly ExerciseSession[]): RecentSession[] {
  return sessions.flatMap((session) => {
    const best = bestSet(session.sets, session.timed);
    return best ? [{ id: session.sessionId, started_at: session.startedAt, completedSets: session.sets.length, topSet: formatBestSet(best) }] : [];
  });
}

/** The member's latest completed sessions with an exercise (newest first, at most `limit`); [] when they cannot be read. */
export async function loadRecentSessions(db: Db, userId: string, exerciseId: string, limit = 8): Promise<RecentSession[]> {
  const history = await loadExerciseHistory(db, userId, exerciseId, { sessions: limit });
  if (history.error) return [];
  return recentSessionRows(history.byExercise.get(survivingExerciseId(exerciseId)) ?? []);
}
