import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * "Download my data": every row FITX stores for the signed-in account, read in the browser with the
 * user's own session, so row-level security decides what is included (nothing of anyone else's can be).
 * Tables are read in pages, which keeps large food or workout logs complete. A table that does not
 * exist yet (a feature whose migration is not applied) is listed in `notes` instead of failing the
 * export; any other read error stops the export so a partial file is never presented as complete.
 *
 * New features that store per-user rows add their table to EXPORT_TABLES. tests/account/export-schema.test.ts
 * checks every entry against the migrations, and fails when a per-user table is neither exported nor
 * listed there as deliberately left out.
 */

/**
 * One table to include.
 * - `owner`: the column holding the account id ("id" when the row is the account itself).
 * - `order`: a column, or columns, unique among the owner's rows, so paging never skips or repeats a row.
 * - `columns`: the select list, for a table that lets members read only some columns (default "*").
 * A wrong name is a database error that stops the whole export.
 */
export type ExportTable = { table: string; label: string; owner: "user_id" | "id"; order: string | readonly string[]; columns?: string };

export const EXPORT_TABLES: readonly ExportTable[] = [
  { table: "profiles", label: "Profile", owner: "id", order: "id" },
  { table: "user_preferences", label: "Training and food preferences", owner: "user_id", order: "user_id" },
  { table: "body_metrics", label: "Weigh-ins and body measurements", owner: "user_id", order: "id" },
  { table: "meals", label: "Food log", owner: "user_id", order: "id" },
  { table: "custom_foods", label: "Custom foods", owner: "user_id", order: "id" },
  { table: "meal_templates", label: "Saved meals and routines", owner: "user_id", order: "id" },
  { table: "meal_template_items", label: "Foods in saved meals and routines", owner: "user_id", order: "id" },
  { table: "nutrition_targets", label: "Daily nutrition targets", owner: "user_id", order: "user_id" },
  { table: "water_logs", label: "Water log", owner: "user_id", order: "id" },
  { table: "user_equipment_profiles", label: "Home and gym equipment", owner: "user_id", order: "context" },
  { table: "programme_enrolments", label: "Training programmes you joined", owner: "user_id", order: "id" },
  { table: "workout_plans", label: "Workout plans", owner: "user_id", order: "id" },
  { table: "workout_plan_exercises", label: "Exercises in workout plans", owner: "user_id", order: "id" },
  { table: "workout_sessions", label: "Workout sessions", owner: "user_id", order: "id" },
  { table: "workout_session_exercises", label: "Exercises in workout sessions", owner: "user_id", order: "id" },
  { table: "workout_sets", label: "Logged sets", owner: "user_id", order: "id" },
  { table: "personal_records", label: "Personal records", owner: "user_id", order: "id" },
  { table: "exercise_notes", label: "Exercise notes", owner: "user_id", order: "exercise_id" },
  { table: "exercise_favorites", label: "Saved exercises", owner: "user_id", order: "exercise_id" },
  { table: "activities", label: "Activities (walks, runs, rides and more)", owner: "user_id", order: "id" },
  { table: "activity_track_chunks", label: "GPS points of your activities", owner: "user_id", order: ["activity_id", "seq"] },
  { table: "goals", label: "Goals", owner: "user_id", order: "id" },
  { table: "goal_progress_entries", label: "Goal progress", owner: "user_id", order: "id" },
  { table: "planner_events", label: "Planner events", owner: "user_id", order: "id" },
  { table: "ai_coach_consents", label: "AI coach consent", owner: "user_id", order: "user_id" },
  { table: "ai_coach_threads", label: "AI coach conversations", owner: "user_id", order: "id" },
  { table: "ai_coach_messages", label: "AI coach messages", owner: "user_id", order: "id" },
  { table: "ai_coach_actions", label: "AI coach suggestions", owner: "user_id", order: "id" },
  { table: "ai_coach_safety_notes", label: "AI coach safety notes", owner: "user_id", order: "id" },
  // Members may read only these columns of their requests; each request carries its messages.
  {
    table: "support_requests",
    label: "Help requests and replies",
    owner: "user_id",
    order: "id",
    columns: "id,user_id,category,subject,body,status,created_at,updated_at,last_message_at,support_messages(id,author_kind,body,created_at)",
  },
  { table: "announcement_dismissals", label: "Dismissed announcements", owner: "user_id", order: "announcement_id" },
  // Notices sent to this account from FITX Admin; members may read only these columns (not who sent them).
  {
    table: "member_notifications",
    label: "Notices sent to you",
    owner: "user_id",
    order: "id",
    columns: "id,user_id,title,body,tone,link_url,link_label,created_at,dismissed_at",
  },
  { table: "billing_subscriptions", label: "Subscriptions", owner: "user_id", order: "id" },
  { table: "billing_payments", label: "Payments", owner: "user_id", order: "id" },
  { table: "billing_refunds", label: "Refunds", owner: "user_id", order: "id" },
  { table: "workouts", label: "Workouts (earlier version of FITX)", owner: "user_id", order: "id" },
  { table: "tasks", label: "Tasks (earlier version of FITX)", owner: "user_id", order: "id" },
  { table: "habits", label: "Habits (earlier version of FITX)", owner: "user_id", order: "id" },
  { table: "daily_quote_history", label: "Quotes of the day you were shown", owner: "user_id", order: "local_date" },
  { table: "social_profiles", label: "Explore profile", owner: "user_id", order: "user_id" },
  { table: "social_follows", label: "Explore accounts you follow or asked to follow", owner: "user_id", order: "following_id" },
  { table: "social_posts", label: "Explore posts", owner: "user_id", order: "id" },
  { table: "social_post_media", label: "Photos in your Explore posts", owner: "user_id", order: "id" },
  { table: "social_likes", label: "Explore posts you liked", owner: "user_id", order: "post_id" },
  { table: "social_saves", label: "Explore posts you saved", owner: "user_id", order: "post_id" },
  { table: "social_comments", label: "Explore comments", owner: "user_id", order: "id" },
  { table: "social_blocks", label: "Explore accounts you blocked", owner: "user_id", order: "blocked_id" },
  { table: "social_restricts", label: "Explore accounts you restricted", owner: "user_id", order: "restricted_id" },
  { table: "social_reports", label: "Explore reports you made", owner: "user_id", order: "id" },
  { table: "social_notifications", label: "Explore notifications", owner: "user_id", order: "id" },
  { table: "social_notification_prefs", label: "Explore notification settings", owner: "user_id", order: "user_id" },
];

export const MEDIA_BUCKET = "fitx-user-media";
export const EXPORT_PAGE_SIZE = 1000;

export type ExportedFile = { path: string; size: number | null; contentType: string | null; updatedAt: string | null };

export type AccountExport = {
  format: "fitx-account-export";
  version: 1;
  exported_at: string;
  account: {
    id: string;
    email: string | null;
    created_at: string | null;
    last_sign_in_at: string | null;
    sign_in_methods: string[];
    /** What the sign-in provider gave FITX (for Google: name, picture, email, the Google account id). */
    profile_from_sign_in: Record<string, unknown>;
    /** Each linked sign-in, with the details the provider shared. No tokens are stored here. */
    identities: Array<{ provider: string | null; details: Record<string, unknown>; created_at: string | null; last_sign_in_at: string | null }>;
  };
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
  identities?: Array<{ provider?: string | null; identity_data?: Record<string, unknown> | null; created_at?: string | null; last_sign_in_at?: string | null }> | null;
  app_metadata?: { provider?: unknown } | null;
  user_metadata?: Record<string, unknown> | null;
};

const plainObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? JSON.parse(JSON.stringify(value)) as Record<string, unknown> : {};

async function readTable(supabase: SupabaseClient, spec: ExportTable, userId: string) {
  const rows: Record<string, unknown>[] = [];
  const order = typeof spec.order === "string" ? [spec.order] : spec.order;
  for (let from = 0; ; from += EXPORT_PAGE_SIZE) {
    let query = supabase.from(spec.table).select(spec.columns ?? "*").eq(spec.owner, userId);
    for (const column of order) query = query.order(column, { ascending: true });
    const { data, error } = await query.range(from, from + EXPORT_PAGE_SIZE - 1);
    if (error) return { rows, error };
    // The select list is a runtime string, so supabase-js cannot type the rows; they are plain JSON.
    const page = (data ?? []) as unknown as Record<string, unknown>[];
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
      profile_from_sign_in: plainObject(user.user_metadata),
      identities: (user.identities ?? []).map((identity) => ({
        provider: typeof identity.provider === "string" ? identity.provider : null,
        details: plainObject(identity.identity_data),
        created_at: identity.created_at ?? null,
        last_sign_in_at: identity.last_sign_in_at ?? null,
      })),
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
