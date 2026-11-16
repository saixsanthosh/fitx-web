import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingColumnError, isMissingTableError } from "@/lib/domain/schema-fallback";
import { CATALOG_BASE_COLUMNS, CATALOG_V2_COLUMNS, toCatalogExercise, type CatalogExercise, type CatalogRow } from "./catalog";
import { isDoableWith } from "./equipment";
import { EXERCISE_MEDIA_COLUMNS, groupMediaRows, resolveExerciseMedia, type ExerciseMediaRow } from "./media";
import {
  EQUIPMENT_KEYS,
  EXERCISE_CATEGORIES,
  LEVELS,
  levelRank,
  MUSCLE_GROUPS,
  TRAINING_CONTEXTS,
  type ExerciseCategory,
  type Level,
  type MuscleGroup,
  type TrainingContext,
} from "./taxonomy";

/**
 * Exercise library search: the query parameters of GET /api/exercises, the database queries behind
 * it, and the in-memory version used before the catalogue clean-up migration has run.
 *
 * Two database states are handled:
 *  - curated (some active row has catalog_version >= 1): every filter runs in Postgres and pages come
 *    from `range()` with an exact count;
 *  - not curated (the v2 columns are missing, or present but not filled yet): the light legacy rows
 *    are read, estimated with toCatalogExercise, then filtered, sorted and paged here. The response
 *    says `curated: false` so the page can say the filters are approximate.
 *
 * No Next.js imports, so `node --test` can load it.
 */

export const DEFAULT_PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 48;
export const MAX_PAGE = 500;
export const MAX_QUERY_LENGTH = 80;
export const MAX_SEARCH_WORDS = 6;
export const MAX_IDS = 100;
/** Keeps the ids (and the PostgREST URL built from them) well inside common 8 KB request-line limits. */
export const MAX_IDS_LENGTH = 4000;

export type CatalogSort = "name" | "difficulty";

export type CatalogSearchParams = {
  /** Name search, trimmed and single-spaced; every word must appear in the name. */
  q: string;
  muscleGroup: MuscleGroup | null;
  category: ExerciseCategory | null;
  difficulty: Level | null;
  /** "home" or "gym": the exercise's derived locations must include it. */
  location: TrainingContext | null;
  /** One equipment key the exercise must use. */
  equipment: string | null;
  /** Equipment the user has (already expanded). null: no filter; []: only exercises that need nothing. */
  doable: string[] | null;
  /** Only these exercise ids (saved or recently viewed ones), at most MAX_IDS. null: any exercise. */
  ids: string[] | null;
  sort: CatalogSort;
  /** 1-based. */
  page: number;
  pageSize: number;
};

export const DEFAULT_SEARCH_PARAMS: CatalogSearchParams = {
  q: "", muscleGroup: null, category: null, difficulty: null, location: null, equipment: null, doable: null, ids: null,
  sort: "name", page: 1, pageSize: DEFAULT_PAGE_SIZE,
};

const ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/;
const KNOWN_EQUIPMENT = new Set(EQUIPMENT_KEYS);

function oneOf<T extends string>(values: readonly T[], value: string | null): T | null {
  return value !== null && (values as readonly string[]).includes(value) ? (value as T) : null;
}

/** A whole number from a query value, clamped to [min, max]; `fallback` when it is missing or not a number. */
export function clampInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = value === null || value.trim() === "" ? Number.NaN : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** Comma-separated values, trimmed, de-duplicated, keeping only those `keep` accepts, in order. */
function listParam(value: string | null, keep: (item: string) => boolean, max: number, maxLength = Number.POSITIVE_INFINITY): string[] {
  const items: string[] = [];
  let length = 0;
  for (const item of new Set((value ?? "").split(",").map((part) => part.trim()))) {
    if (!item || !keep(item)) continue;
    if (items.length >= max || length + item.length + 1 > maxLength) break;
    items.push(item);
    length += item.length + 1;
  }
  return items;
}

/** Collapses whitespace and caps the length, so the same search always gives the same query. */
export function normalizeQuery(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH).trim();
}

/**
 * Reads GET /api/exercises parameters. Unknown keys are ignored, unknown values are dropped and
 * numbers are clamped, so a hand-edited URL never errors.
 */
export function parseCatalogSearchParams(input: URLSearchParams): CatalogSearchParams {
  return {
    q: normalizeQuery(input.get("q")),
    muscleGroup: oneOf(MUSCLE_GROUPS, input.get("muscle_group")),
    category: oneOf(EXERCISE_CATEGORIES, input.get("category")),
    difficulty: oneOf(LEVELS, input.get("difficulty")),
    location: oneOf(TRAINING_CONTEXTS, input.get("location")),
    equipment: oneOf(EQUIPMENT_KEYS, input.get("equipment")),
    // Present but empty means "I have no equipment"; unknown keys cannot satisfy anything, so they drop out.
    doable: input.has("doable") ? listParam(input.get("doable"), (key) => KNOWN_EQUIPMENT.has(key), KNOWN_EQUIPMENT.size) : null,
    ids: input.has("ids") ? listParam(input.get("ids"), (id) => ID_PATTERN.test(id), MAX_IDS, MAX_IDS_LENGTH) : null,
    sort: input.get("sort") === "difficulty" ? "difficulty" : "name",
    page: clampInt(input.get("page"), 1, 1, MAX_PAGE),
    pageSize: clampInt(input.get("pageSize"), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE),
  };
}

/** The query string for GET /api/exercises; parseCatalogSearchParams reads it back unchanged. */
export function catalogSearchQuery(params: Partial<CatalogSearchParams>): URLSearchParams {
  const query = new URLSearchParams();
  const q = normalizeQuery(params.q);
  if (q) query.set("q", q);
  if (params.muscleGroup) query.set("muscle_group", params.muscleGroup);
  if (params.category) query.set("category", params.category);
  if (params.difficulty) query.set("difficulty", params.difficulty);
  if (params.location) query.set("location", params.location);
  if (params.equipment) query.set("equipment", params.equipment);
  if (params.doable) query.set("doable", [...params.doable].sort().join(","));
  if (params.ids) query.set("ids", params.ids.join(","));
  if (params.sort === "difficulty") query.set("sort", "difficulty");
  if (params.page && params.page > 1) query.set("page", String(params.page));
  if (params.pageSize && params.pageSize !== DEFAULT_PAGE_SIZE) query.set("pageSize", String(params.pageSize));
  return query;
}

// ---------------------------------------------------------------- name search

/**
 * The words of a name search, lower-case. Each must appear in the name, in any order, so
 * "press dumbbell" finds "Dumbbell Bench Press" and "push up" finds both "Push-Up" and "Pushups".
 * Punctuation at the edges of a word is dropped ("rowing," -> "rowing"); `*` is removed because
 * PostgREST reads it as a wildcard in like patterns.
 */
export function searchWords(q: string): string[] {
  // Non-ASCII characters count as letters, so accented words keep their edges.
  const words = normalizeQuery(q).toLowerCase().replace(/\*/g, " ").split(" ")
    .map((word) => word.replace(/^[^a-z0-9À-￿]+|[^a-z0-9À-￿]+$/g, ""))
    .filter(Boolean);
  return [...new Set(words)].slice(0, MAX_SEARCH_WORDS);
}

/** Escapes LIKE/ILIKE wildcards (`%`, `_`) and the escape character itself, so they match literally. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** An ILIKE pattern matching names that contain `word`. */
export function containsPattern(word: string): string {
  return `%${escapeLike(word)}%`;
}

// ---------------------------------------------------------------- in-memory search (before the clean-up)

/** A matcher for the same filters the database applies, over estimated or curated exercises. */
export function catalogMatcher(params: CatalogSearchParams): (exercise: CatalogExercise) => boolean {
  const words = searchWords(params.q);
  const owned = params.doable ? new Set(params.doable) : null;
  const ids = params.ids ? new Set(params.ids) : null;
  return (exercise) => {
    const name = exercise.name.toLowerCase();
    if (!words.every((word) => name.includes(word))) return false;
    if (params.muscleGroup && exercise.muscle_group !== params.muscleGroup) return false;
    if (params.category && exercise.category !== params.category) return false;
    if (params.difficulty && exercise.difficulty !== params.difficulty) return false;
    if (params.location && !exercise.locations.includes(params.location)) return false;
    if (params.equipment && !exercise.required_equipment.includes(params.equipment)) return false;
    if (owned && !isDoableWith(exercise.required_equipment, owned)) return false;
    if (ids && !ids.has(exercise.id)) return false;
    return true;
  };
}

export function filterCatalog(exercises: readonly CatalogExercise[], params: CatalogSearchParams): CatalogExercise[] {
  return exercises.filter(catalogMatcher(params));
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "en");

/** A sorted copy: by name, or by difficulty (beginner first) and then name. */
export function sortCatalog<T extends { name: string; difficulty: string }>(exercises: readonly T[], sort: CatalogSort): T[] {
  return [...exercises].sort(sort === "difficulty" ? (a, b) => levelRank(a.difficulty) - levelRank(b.difficulty) || byName(a, b) : byName);
}

/** Row offsets for a 1-based page, as `range(from, to)` takes them (inclusive). */
export function pageRange(page: number, pageSize: number): { from: number; to: number } {
  const from = (Math.max(1, page) - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

/** One page of `items` and the total; a page past the end is empty. */
export function paginate<T>(items: readonly T[], page: number, pageSize: number): { items: T[]; total: number } {
  const { from, to } = pageRange(page, pageSize);
  return { items: items.slice(from, to + 1), total: items.length };
}

/**
 * For a difficulty-sorted page: which rows to read from each level, given how many match per level.
 * Postgres sorts the text values alphabetically (advanced first), so each level is read on its own,
 * by name, and the page is stitched together in beginner, intermediate, advanced order.
 */
export function difficultyWindows(counts: ReadonlyArray<{ level: Level; count: number }>, from: number, to: number): Array<{ level: Level; from: number; to: number }> {
  const windows: Array<{ level: Level; from: number; to: number }> = [];
  let offset = 0;
  for (const { level, count } of [...counts].sort((a, b) => levelRank(a.level) - levelRank(b.level))) {
    const start = Math.max(from, offset);
    const end = Math.min(to, offset + count - 1);
    if (count > 0 && start <= end) windows.push({ level, from: start - offset, to: end - offset });
    offset += count;
  }
  return windows;
}

// ---------------------------------------------------------------- database

type Db = Pick<SupabaseClient, "from">;

export type CatalogSearchOutcome =
  | { error: null; exercises: CatalogExercise[]; total: number; curated: boolean }
  | { error: unknown; exercises: []; total: 0; curated: false };

const TABLE = "exercise_library";
const CURATED_SELECT = [...CATALOG_BASE_COLUMNS, ...CATALOG_V2_COLUMNS].join(",");
const LEGACY_SELECT = CATALOG_BASE_COLUMNS.join(",");
/** Rows per request when reading the whole catalogue (PostgREST's usual max-rows). */
const LEGACY_BATCH = 1000;
const LEGACY_MAX_ROWS = 5000;
/** PostgREST: the requested offset is past the last row (HTTP 416). */
const RANGE_NOT_SATISFIABLE = "PGRST103";

function failed(error: unknown): CatalogSearchOutcome {
  return { error, exercises: [], total: 0, curated: false };
}

function errorCode(error: unknown): string | null {
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : null;
  return typeof code === "string" ? code : null;
}

/** True when some active exercise has been through the catalogue clean-up. */
async function probeCurated(db: Db): Promise<{ error: unknown; curated: boolean }> {
  const result = await db.from(TABLE).select("id").eq("is_active", true).gte("catalog_version", 1).limit(1);
  if (result.error) return { error: result.error, curated: false };
  return { error: null, curated: (result.data ?? []).length > 0 };
}

/** Every filter in Postgres; pages by name, or by difficulty level then name. */
async function curatedSearch(db: Db, params: CatalogSearchParams, words: readonly string[]): Promise<CatalogSearchOutcome> {
  // Rows the clean-up has not reached keep empty v2 values (no equipment, legacy locations); they are
  // left out of filters that read those values instead of matching by accident.
  const curatedOnly = Boolean(params.muscleGroup || params.category || params.location || params.equipment || params.doable);
  const filtered = (columns: string, options?: { count: "exact"; head?: boolean }) => {
    let query = db.from(TABLE).select(columns, options).eq("is_active", true);
    for (const word of words) query = query.ilike("name", containsPattern(word));
    if (params.muscleGroup) query = query.eq("muscle_group", params.muscleGroup);
    if (params.category) query = query.eq("category", params.category);
    if (params.location) query = query.contains("locations", [params.location]);
    if (params.equipment) query = query.contains("required_equipment", [params.equipment]);
    if (params.doable) query = query.containedBy("required_equipment", params.doable);
    if (params.ids) query = query.in("id", params.ids);
    if (curatedOnly) query = query.gte("catalog_version", 1);
    return query;
  };
  const { from, to } = pageRange(params.page, params.pageSize);
  const toExercises = (rows: unknown) => ((rows ?? []) as CatalogRow[]).map(toCatalogExercise);

  if (params.sort === "name" || params.difficulty) {
    const level = (query: ReturnType<typeof filtered>) => (params.difficulty ? query.eq("difficulty", params.difficulty) : query);
    const result = await level(filtered(CURATED_SELECT, { count: "exact" })).order("name").range(from, to);
    if (result.error && errorCode(result.error) === RANGE_NOT_SATISFIABLE) {
      const counted = await level(filtered("id", { count: "exact", head: true }));
      if (counted.error) return failed(counted.error);
      return { error: null, exercises: [], total: counted.count ?? 0, curated: true };
    }
    if (result.error) return failed(result.error);
    const exercises = toExercises(result.data);
    return { error: null, exercises, total: result.count ?? from + exercises.length, curated: true };
  }

  const counted = await Promise.all(LEVELS.map((level) => filtered("id", { count: "exact", head: true }).eq("difficulty", level)));
  const countError = counted.find((result) => result.error)?.error;
  if (countError) return failed(countError);
  const counts = LEVELS.map((level, index) => ({ level, count: counted[index].count ?? 0 }));
  const pages = await Promise.all(difficultyWindows(counts, from, to)
    .map((window) => filtered(CURATED_SELECT).eq("difficulty", window.level).order("name").range(window.from, window.to)));
  const pageError = pages.find((result) => result.error)?.error;
  if (pageError) return failed(pageError);
  return {
    error: null,
    exercises: pages.flatMap((result) => toExercises(result.data)),
    total: counts.reduce((sum, item) => sum + item.count, 0),
    curated: true,
  };
}

/** Before the clean-up: exact filters (name, difficulty, ids) in Postgres, the estimated ones here. */
async function legacySearch(db: Db, params: CatalogSearchParams, words: readonly string[]): Promise<CatalogSearchOutcome> {
  const rows: CatalogRow[] = [];
  for (let from = 0; from < LEGACY_MAX_ROWS; from += LEGACY_BATCH) {
    let query = db.from(TABLE).select(LEGACY_SELECT).eq("is_active", true);
    for (const word of words) query = query.ilike("name", containsPattern(word));
    if (params.difficulty) query = query.eq("difficulty", params.difficulty);
    if (params.ids) query = query.in("id", params.ids);
    const result = await query.order("name").range(from, from + LEGACY_BATCH - 1);
    if (result.error) return failed(result.error);
    const batch = (result.data ?? []) as unknown as CatalogRow[];
    rows.push(...batch);
    if (batch.length < LEGACY_BATCH) break;
  }
  const matches = sortCatalog(filterCatalog(rows.map(toCatalogExercise), params), params.sort);
  const page = paginate(matches, params.page, params.pageSize);
  return { error: null, exercises: page.items, total: page.total, curated: false };
}

/**
 * One page of the library for `params`, read with the caller's client (so row-level security
 * applies: merged duplicates are inactive and never returned).
 */
export async function searchCatalog(db: Db, params: CatalogSearchParams): Promise<CatalogSearchOutcome> {
  const words = searchWords(params.q);
  // The probe and the curated query run together; the curated answer is used only if the probe agrees.
  const [probe, curated] = await Promise.all([probeCurated(db), curatedSearch(db, params, words)]);
  if (probe.error && !isMissingColumnError(probe.error, CATALOG_V2_COLUMNS)) return failed(probe.error);
  if (probe.curated) return curated;
  return legacySearch(db, params, words);
}

/**
 * The first still for each exercise: the exercise_media rows (self-hosted copy first), else the
 * pinned Free Exercise DB photo. A missing table (media migration not applied) is not an error;
 * any other failure is returned for logging, with the pinned photos still filled in.
 */
export async function loadCatalogThumbnails(db: Db, exercises: readonly CatalogExercise[], supabaseUrl: string | null | undefined): Promise<{ error: unknown; thumbnails: Map<string, string | null> }> {
  const thumbnails = new Map<string, string | null>();
  if (!exercises.length) return { error: null, thumbnails };
  const result = await db.from("exercise_media").select(EXERCISE_MEDIA_COLUMNS.join(","))
    .in("exercise_id", exercises.map((exercise) => exercise.id)).eq("kind", "still").order("position");
  const rows = result.error ? null : ((result.data ?? []) as unknown as ExerciseMediaRow[]);
  const grouped = groupMediaRows(rows ?? []);
  for (const exercise of exercises) {
    const media = resolveExerciseMedia({ exerciseId: exercise.id, name: exercise.name, sourceRef: exercise.source_ref, rows: rows ? grouped.get(exercise.id) ?? [] : null, supabaseUrl });
    thumbnails.set(exercise.id, media.stills[0]?.url ?? null);
  }
  return { error: result.error && !isMissingTableError(result.error) ? result.error : null, thumbnails };
}
