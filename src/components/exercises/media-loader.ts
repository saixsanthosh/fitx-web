import type { SupabaseClient } from "@supabase/supabase-js";
import { columnList, withOptionalColumns } from "@/lib/domain/schema-fallback";
import { EXERCISE_MEDIA_COLUMNS, EXERCISE_MEDIA_OPTIONAL_COLUMNS, FREE_EXERCISE_DB_ID_PREFIX, type ExerciseMediaRow } from "@/lib/training/media";

type Db = Pick<SupabaseClient, "from">;

/** One exercise's exercise_media rows, in position order (RLS hides rows of inactive exercises). */
export function exerciseMediaQuery(supabase: Db, exerciseId: string, includeOptional = false) {
  return supabase.from("exercise_media").select(columnList(EXERCISE_MEDIA_COLUMNS, EXERCISE_MEDIA_OPTIONAL_COLUMNS, includeOptional)).eq("exercise_id", exerciseId).order("position");
}

/** One exercise's media rows with the model and caption columns once 20261123100020 is applied (without them before). */
export async function exerciseMediaResult(supabase: Db, exerciseId: string) {
  return (await withOptionalColumns(EXERCISE_MEDIA_OPTIONAL_COLUMNS, (include) => exerciseMediaQuery(supabase, exerciseId, include))).result;
}

/** Rows from an exerciseMediaQuery answer: null when the table could not be read (not migrated yet). */
export function mediaRowsFrom(result: { data: unknown; error: unknown }): ExerciseMediaRow[] | null {
  return result.error ? null : ((result.data ?? []) as ExerciseMediaRow[]);
}

/**
 * The media rows of one exercise and, for ids without the Free Exercise DB prefix, its `source_ref`
 * (set by the catalogue clean-up), which the pinned-photo fallback needs. Never throws: anything that
 * cannot be read comes back as null and the caller falls back.
 */
export async function loadExerciseMediaRows(supabase: Db | null, exerciseId: string): Promise<{ rows: ExerciseMediaRow[] | null; sourceRef: string | null }> {
  if (!supabase) return { rows: null, sourceRef: null };
  try {
    const [media, library] = await Promise.all([
      exerciseMediaResult(supabase, exerciseId),
      exerciseId.startsWith(FREE_EXERCISE_DB_ID_PREFIX) ? null : supabase.from("exercise_library").select("source_ref").eq("id", exerciseId).maybeSingle(),
    ]);
    const sourceRef = library && !library.error ? (library.data as { source_ref?: string | null } | null)?.source_ref ?? null : null;
    return { rows: mediaRowsFrom(media), sourceRef };
  } catch {
    return { rows: null, sourceRef: null };
  }
}
