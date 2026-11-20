import "server-only";
import { requireAdmin } from "@/lib/admin-auth";
import { isContentMigrationMissing } from "@/lib/content/errors";
import { catalogueImageUrl } from "@/lib/csp";
import { EXERCISE_MEDIA_BUCKET } from "@/lib/content/media-rules";
import { publicUrlFor } from "@/lib/content/storage";
import { EQUIPMENT_KEYS, EXERCISE_CATEGORIES, MUSCLE_GROUPS } from "@/lib/content/vocabulary";
import { logServerError } from "@/lib/log";
import { isMissingTable } from "@/lib/schema";
import { createAdminSupabase } from "@/lib/supabase/admin";

export const EXERCISE_PAGE_SIZE = 30;

export type DataState = "service_key_missing" | "migration_pending" | "query_failed";

export type ExerciseFilters = {
  q: string;
  group: string;
  category: string;
  equipment: string;
  visibility: "all" | "shown" | "hidden";
  page: number;
};

export type ExerciseRow = {
  id: string;
  name: string;
  primary_muscle: string;
  muscle_group: string | null;
  category: string | null;
  difficulty: string;
  required_equipment: string[];
  is_active: boolean;
  merged_into: string | null;
  prescription_type: string | null;
};

type Params = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (typeof value === "string" ? value : Array.isArray(value) ? (value[0] ?? "") : "");

export function parseExerciseFilters(params: Params): ExerciseFilters {
  const group = first(params.group);
  const category = first(params.category);
  const equipment = first(params.equipment);
  const visibility = first(params.visibility);
  const page = Number(first(params.page));
  return {
    q: first(params.q).trim().slice(0, 80),
    group: (MUSCLE_GROUPS as readonly string[]).includes(group) ? group : "",
    category: (EXERCISE_CATEGORIES as readonly string[]).includes(category) ? category : "",
    equipment: equipment === "none" || EQUIPMENT_KEYS.includes(equipment) ? equipment : "",
    visibility: visibility === "shown" || visibility === "hidden" ? visibility : "all",
    page: Number.isInteger(page) && page >= 1 && page <= 1000 ? page : 1,
  };
}

/** PostgREST ilike pattern for a typed search: % and _ are matched literally. */
export function likePattern(term: string): string {
  return `%${term.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

const LIST_COLUMNS = "id,name,primary_muscle,muscle_group,category,difficulty,required_equipment,is_active,merged_into,prescription_type";

export async function listExercises(filters: ExerciseFilters) {
  await requireAdmin("content.manage");
  const supabase = createAdminSupabase();
  if (!supabase) return { state: "service_key_missing" as const };
  let query = supabase.from("exercise_library").select(LIST_COLUMNS, { count: "exact" }).order("name");
  if (filters.q) query = query.ilike("name", likePattern(filters.q));
  if (filters.group) query = query.eq("muscle_group", filters.group);
  if (filters.category) query = query.eq("category", filters.category);
  if (filters.equipment === "none") query = query.eq("required_equipment", "{}");
  else if (filters.equipment) query = query.contains("required_equipment", [filters.equipment]);
  if (filters.visibility !== "all") query = query.eq("is_active", filters.visibility === "shown");
  const from = (filters.page - 1) * EXERCISE_PAGE_SIZE;
  const { data, error, count } = await query.range(from, from + EXERCISE_PAGE_SIZE - 1);
  if (error) {
    logServerError("data.list_exercises", error);
    return { state: isMissingTable(error) ? ("migration_pending" as const) : ("query_failed" as const) };
  }
  const rows = (data ?? []) as unknown as ExerciseRow[];
  const thumbs = await firstStills(rows.map((row) => row.id));
  return { state: "ready" as const, rows, total: count ?? rows.length, thumbs };
}

/** The first self-hosted photo of each exercise (Admin's pages only load images from this project). */
async function firstStills(ids: string[]): Promise<Record<string, string>> {
  const supabase = createAdminSupabase();
  if (!supabase || !ids.length) return {};
  const { data, error } = await supabase
    .from("exercise_media")
    .select("exercise_id,storage_path,mirrored_at,position")
    .in("exercise_id", ids)
    .eq("kind", "still")
    .not("mirrored_at", "is", null)
    .order("position");
  if (error) {
    logServerError("data.exercise_thumbs", error);
    return {};
  }
  const result: Record<string, string> = {};
  for (const row of (data ?? []) as Array<{ exercise_id: string; storage_path: string | null }>) {
    if (result[row.exercise_id] || !row.storage_path) continue;
    const url = publicUrlFor(EXERCISE_MEDIA_BUCKET, row.storage_path);
    if (url) result[row.exercise_id] = url;
  }
  return result;
}

export type ExerciseDetail = ExerciseRow & {
  description: string;
  secondary_muscles: string[];
  equipment: string[];
  locations: string[];
  movement_pattern: string;
  instructions: string[];
  recommended_sets: number;
  reps_min: number;
  reps_max: number;
  rest_seconds: number;
  mechanic: string | null;
  default_duration_seconds: number | null;
  attribution: string;
  source_ref: string | null;
  created_at: string;
};

export type ExerciseMediaItem = {
  id: string;
  kind: "still" | "video_loop";
  position: number;
  url: string | null;
  /** Where the file is when Admin cannot show it (an original that has not been copied to FITX storage). */
  sourceUrl: string | null;
  /** What Admin shows: the FITX Storage copy, else a catalogue photo's original on GitHub (allowed by the CSP). */
  previewUrl: string | null;
  uploaded: boolean;
  alt: string;
  attribution: string;
  license: string;
  width: number | null;
  height: number | null;
};

const DETAIL_COLUMNS = `${LIST_COLUMNS},description,secondary_muscles,equipment,locations,movement_pattern,instructions,recommended_sets,reps_min,reps_max,rest_seconds,mechanic,default_duration_seconds,attribution,source_ref,created_at`;

export async function getExercise(id: string) {
  await requireAdmin("content.manage");
  const supabase = createAdminSupabase();
  if (!supabase) return { state: "service_key_missing" as const };
  const [exercise, media] = await Promise.all([
    supabase.from("exercise_library").select(DETAIL_COLUMNS).eq("id", id).maybeSingle(),
    supabase
      .from("exercise_media")
      .select("id,kind,position,storage_path,source_url,mirrored_at,alt,attribution,license,width,height")
      .eq("exercise_id", id)
      .order("kind")
      .order("position"),
  ]);
  if (exercise.error) {
    logServerError("data.get_exercise", exercise.error);
    return { state: isMissingTable(exercise.error) ? ("migration_pending" as const) : ("query_failed" as const) };
  }
  if (!exercise.data) return { state: "not_found" as const };
  if (media.error) logServerError("data.exercise_media", media.error);
  const items: ExerciseMediaItem[] = ((media.data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const path = typeof row.storage_path === "string" ? row.storage_path : null;
    const mirrored = typeof row.mirrored_at === "string" && Boolean(path);
    return {
      id: String(row.id),
      kind: row.kind === "video_loop" ? "video_loop" : "still",
      position: Number(row.position) || 0,
      url: mirrored && path ? publicUrlFor(EXERCISE_MEDIA_BUCKET, path) : null,
      sourceUrl: typeof row.source_url === "string" ? row.source_url : null,
      previewUrl: mirrored && path ? publicUrlFor(EXERCISE_MEDIA_BUCKET, path) : row.kind === "video_loop" ? null : catalogueImageUrl(row.source_url),
      uploaded: Boolean(path?.startsWith("admin/")),
      alt: typeof row.alt === "string" ? row.alt : "",
      attribution: typeof row.attribution === "string" ? row.attribution : "",
      license: typeof row.license === "string" ? row.license : "",
      width: typeof row.width === "number" ? row.width : null,
      height: typeof row.height === "number" ? row.height : null,
    };
  });
  return { state: "ready" as const, exercise: exercise.data as unknown as ExerciseDetail, media: items, mediaReadable: !media.error };
}

export type TrainingCounts = {
  exercises: { total: number; active: number; admin_made: number; merged: number };
  muscle_groups: Record<string, { total: number; active: number }>;
  categories: Record<string, { total: number; active: number }>;
  equipment: Record<string, { total: number; active: number }>;
  media: { stills: number; videos: number; uploaded: number; exercises_with_video: number };
  enrolments: Record<string, number>;
};

export async function getTrainingCounts() {
  const operator = await requireAdmin("content.manage");
  const supabase = createAdminSupabase();
  if (!supabase) return { state: "service_key_missing" as const };
  const { data, error } = await supabase.rpc("fitx_admin_op_training_counts", { p_operator_id: operator.id });
  if (error) {
    if (!isContentMigrationMissing(error)) logServerError("data.training_counts", error);
    return { state: isContentMigrationMissing(error) ? ("migration_pending" as const) : ("query_failed" as const) };
  }
  return { state: "ready" as const, counts: data as TrainingCounts };
}
