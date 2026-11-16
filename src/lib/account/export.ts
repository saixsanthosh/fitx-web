import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * "Download my data": every row FITX stores for the signed-in account, read in the browser with the
 * user's own session, so row-level security decides what is included (nothing of anyone else's can be).
 * Tables are read in pages, which keeps large food or workout logs complete. A table that does not
 * exist yet (a feature whose migration is not applied) is listed in `notes` instead of failing the
 * export; any other read error stops the export so a partial file is never presented as complete.
 *
 * New features that store per-user rows add their table to EXPORT_TABLES.
 */

export type ExportTable = { table: string; label: string; owner: "user_id" | "id"; order: string };

export const EXPORT_TABLES: readonly ExportTable[] = [
  { table: "profiles", label: "Profile", owner: "id", order: "id" },
  { table: "user_preferences", label: "Training and food preferences", owner: "user_id", order: "user_id" },
  { table: "body_metrics", label: "Weigh-ins and body measurements", owner: "user_id", order: "id" },
  { table: "meals", label: "Food log", owner: "user_id", order: "id" },
  { table: "custom_foods", label: "Custom foods", owner: "user_id", order: "id" },
  { table: "water_logs", label: "Water log", owner: "user_id", order: "id" },
  { table: "workout_plans", label: "Workout plans", owner: "user_id", order: "id" },
  { table: "workout_plan_exercises", label: "Exercises in workout plans", owner: "user_id", order: "id" },
  { table: "workout_sessions", label: "Workout sessions", owner: "user_id", order: "id" },
  { table: "workout_session_exercises", label: "Exercises in workout sessions", owner: "user_id", order: "id" },
  { table: "workout_sets", label: "Logged sets", owner: "user_id", order: "id" },
  { table: "personal_records", label: "Personal records", owner: "user_id", order: "id" },
  { table: "goals", label: "Goals", owner: "user_id", order: "id" },
  { table: "goal_progress_entries", label: "Goal progress", owner: "user_id", order: "id" },
  { table: "planner_events", label: "Planner events", owner: "user_id", order: "id" },
  { table: "workouts", label: "Workouts (earlier version of FITX)", owner: "user_id", order: "id" },
  { table: "tasks", label: "Tasks (earlier version of FITX)", owner: "user_id", order: "id" },
  { table: "habits", label: "Habits (earlier version of FITX)", owner: "user_id", order: "id" },
];

export const MEDIA_BUCKET = "fitx-user-media";
export const EXPORT_PAGE_SIZE = 1000;

export type ExportedFile = { path: string; size: number | null; contentType: string | null; updatedAt: string | null };

export type AccountExport = {
  format: "fitx-account-export";
  version: 1;
  exported_at: string;
  account: { id: string; email: string | null; created_at: string | null; last_sign_in_at: string | null; sign_in_methods: string[] };
  tables: Record<string, Record<string, unknown>[]>;
  files: ExportedFile[];
  notes: string[];
};

export type ExportProgress = { done: number; total: number; label: string };

export class ExportError extends Error {
  readonly section: string;

  constructor(section: string, cause: unknown) {
    super(`Could not read ${section}`, { cause });
    this.name = "ExportError";
    this.section = section;
  }
}

type ErrorLike = { code?: unknown; message?: unknown } | null | undefined;

/** The table is not in the database yet: Postgres 42P01, PostgREST PGRST205. */
export function isMissingTable(error: unknown) {
  const code = (error as ErrorLike)?.code;
  return code === "42P01" || code === "PGRST205";
}

type AccountUser = {
  id: string;
  email?: string | null;
  created_at?: string | null;
  last_sign_in_at?: string | null;
  identities?: Array<{ provider?: string | null }> | null;
  app_metadata?: { provider?: unknown } | null;
};

async function readTable(supabase: SupabaseClient, spec: ExportTable, userId: string) {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += EXPORT_PAGE_SIZE) {
    const { data, error } = await supabase
      .from(spec.table)
      .select("*")
      .eq(spec.owner, userId)
      .order(spec.order, { ascending: true })
      .range(from, from + EXPORT_PAGE_SIZE - 1);
    if (error) return { rows, error };
    const page = (data ?? []) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < EXPORT_PAGE_SIZE) return { rows, error: null };
  }
}

/** Every file in the user's private media folder (subfolders included), without the file contents. */
export async function listUserFiles(
  supabase: Pick<SupabaseClient, "storage">,
  userId: string,
): Promise<{ files: ExportedFile[]; error: unknown }> {
  const files: ExportedFile[] = [];
  const folders = [userId];
  while (folders.length) {
    const folder = folders.shift()!;
    for (let offset = 0; ; offset += EXPORT_PAGE_SIZE) {
      const { data, error } = await supabase.storage.from(MEDIA_BUCKET).list(folder, { limit: EXPORT_PAGE_SIZE, offset, sortBy: { column: "name", order: "asc" } });
      if (error) return { files, error };
      const entries = data ?? [];
      for (const entry of entries) {
        const path = `${folder}/${entry.name}`;
        // Folders come back without an id (the type says string, the API sends null).
        if (!(entry as { id?: string | null }).id) folders.push(path);
        else {
          const metadata = (entry.metadata ?? {}) as { size?: unknown; mimetype?: unknown };
          files.push({
            path,
            size: typeof metadata.size === "number" ? metadata.size : null,
            contentType: typeof metadata.mimetype === "string" ? metadata.mimetype : null,
            updatedAt: entry.updated_at ?? null,
          });
        }
      }
      if (entries.length < EXPORT_PAGE_SIZE) break;
    }
  }
  return { files, error: null };
}

export async function exportAccountData(
  supabase: SupabaseClient,
  user: AccountUser,
  { onProgress, now = new Date() }: { onProgress?: (progress: ExportProgress) => void; now?: Date } = {},
): Promise<AccountExport> {
  const total = EXPORT_TABLES.length + 1;
  const tables: AccountExport["tables"] = {};
  const notes: string[] = [];
  let done = 0;
  for (const spec of EXPORT_TABLES) {
    onProgress?.({ done, total, label: spec.label });
    const { rows, error } = await readTable(supabase, spec, user.id);
    if (error && isMissingTable(error)) notes.push(`${spec.label} (${spec.table}) is not set up in this version of FITX, so there is nothing to include.`);
    else if (error) throw new ExportError(spec.label, error);
    else tables[spec.table] = rows;
    done += 1;
  }
  onProgress?.({ done, total, label: "Uploaded images" });
  const listed = await listUserFiles(supabase, user.id);
  if (listed.error) throw new ExportError("Uploaded images", listed.error);
  if (listed.files.length) notes.push("Uploaded images are listed by name only. Your profile photo can be downloaded from your Profile page.");

  const providers = (user.identities ?? []).map((identity) => identity.provider).filter((value): value is string => typeof value === "string" && Boolean(value));
  const fallback = typeof user.app_metadata?.provider === "string" ? [user.app_metadata.provider] : [];
  return {
    format: "fitx-account-export",
    version: 1,
    exported_at: now.toISOString(),
    account: {
      id: user.id,
      email: user.email ?? null,
      created_at: user.created_at ?? null,
      last_sign_in_at: user.last_sign_in_at ?? null,
      sign_in_methods: [...new Set(providers.length ? providers : fallback)],
    },
    tables,
    files: listed.files,
    notes,
  };
}

export function countRecords(data: AccountExport) {
  return Object.values(data.tables).reduce((sum, rows) => sum + rows.length, 0);
}

/** fitx-data-2026-11-16.json, dated in the user's own time zone. */
export function exportFileName(now = new Date()) {
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return `fitx-data-${date}.json`;
}
