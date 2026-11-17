import type { SupabaseClient } from "@supabase/supabase-js";
import { columnList, withOptionalColumns } from "@/lib/domain/schema-fallback";
import { CATALOG_BASE_COLUMNS, CATALOG_V2_COLUMNS, toCatalogExercise, type CatalogExercise, type CatalogRow } from "@/lib/training/catalog";

type Db = Pick<SupabaseClient, "from">;

/** Rows per request (PostgREST's usual max-rows) and a ceiling far above the catalogue's size. */
export const CATALOGUE_BATCH = 1000;
export const CATALOGUE_MAX_ROWS = 5000;

export type LightCatalogue = {
  error: unknown | null;
  /** Active exercises, light (no descriptions or instructions), by name. */
  exercises: CatalogExercise[];
  /** False until the catalogue clean-up has run; the values are then estimated from the older columns. */
  curated: boolean;
};

/**
 * The whole active catalogue for the library pages, read once with the member's session (row-level security hides
 * merged duplicates). Read in pages, so it stays complete when the catalogue grows past one page; the clean-up's
 * columns are read when the database has them.
 */
export async function loadLightCatalogue(db: Db): Promise<LightCatalogue> {
  const rows: CatalogRow[] = [];
  let withV2: boolean | undefined;
  for (let from = 0; from < CATALOGUE_MAX_ROWS; from += CATALOGUE_BATCH) {
    const outcome = await withOptionalColumns(
      CATALOG_V2_COLUMNS,
      (include) => db.from("exercise_library").select(columnList(CATALOG_BASE_COLUMNS, CATALOG_V2_COLUMNS, include)).eq("is_active", true)
        .order("name").order("id").range(from, from + CATALOGUE_BATCH - 1),
      withV2 === false ? { includeOptional: false } : {},
    );
    if (outcome.result.error) return { error: outcome.result.error, exercises: [], curated: false };
    withV2 = outcome.includedOptional;
    const batch = (outcome.result.data ?? []) as unknown as CatalogRow[];
    rows.push(...batch);
    if (batch.length < CATALOGUE_BATCH) break;
  }
  const exercises = rows.map(toCatalogExercise);
  return { error: null, exercises, curated: exercises.some((exercise) => exercise.curated) };
}
