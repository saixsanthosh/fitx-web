/**
 * Exercise photos and video loops: which file to show, where it is served from, and its credit.
 * Pure (no imports, no I/O), so the API, the pages and node tests share it.
 *
 * Sources, in order:
 *  1. `exercise_media` rows (migration 20261118130020): the self-hosted copy in the public
 *     `exercise-media` bucket once it has been mirrored (`mirrored_at` set), else the row's `source_url`;
 *  2. when the table is missing or has no usable rows for the exercise: the two Free Exercise DB photos
 *     at the pinned revision, found from `source_ref` or the `free-exercise-db-` id prefix.
 * Nothing is invented: an exercise with neither has no media. Today every file is a still photo;
 * `video_loop` rows arrive later with licensed or FITX-produced demonstrations.
 */

export const FREE_EXERCISE_DB_REVISION = "f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5";
export const FREE_EXERCISE_DB_ID_PREFIX = "free-exercise-db-";
/** Free Exercise DB has two photos per exercise, 0.jpg and 1.jpg. */
export const FREE_EXERCISE_DB_PHOTO_COUNT = 2;
export const FREE_EXERCISE_DB_ATTRIBUTION = "Free Exercise DB (github.com/yuhonas/free-exercise-db)";
export const FREE_EXERCISE_DB_LICENSE = "Unlicense (public domain dedication)";
export const FREE_EXERCISE_DB_SOURCE_URL = `https://github.com/yuhonas/free-exercise-db/tree/${FREE_EXERCISE_DB_REVISION}`;
/** Matches the next/image remote pattern in next.config.ts. */
export const PINNED_PHOTO_BASE = `https://raw.githubusercontent.com/yuhonas/free-exercise-db/${FREE_EXERCISE_DB_REVISION}/exercises/`;
export const EXERCISE_MEDIA_BUCKET = "exercise-media";
export const EXERCISE_MEDIA_COLUMNS = ["exercise_id", "kind", "position", "storage_path", "source_url", "mirrored_at", "alt", "attribution", "license"] as const;

export type ExerciseMediaKind = "still" | "video_loop";

/** An exercise_media row as PostgREST returns it. */
export type ExerciseMediaRow = {
  exercise_id: string;
  kind: string;
  position?: number | null;
  storage_path?: string | null;
  source_url?: string | null;
  mirrored_at?: string | null;
  alt?: string | null;
  attribution?: string | null;
  license?: string | null;
};

export type MediaItem = {
  kind: ExerciseMediaKind;
  url: string;
  alt: string;
  position: number;
  /** Served from FITX's own storage copy rather than the original source. */
  selfHosted: boolean;
  attribution: string;
  license: string;
};

export type ExerciseMedia = {
  /** Photos in position order. */
  stills: MediaItem[];
  /** Muted demonstration loops in position order (none exist yet). */
  videos: MediaItem[];
  /** "table": exercise_media rows; "pinned": the Free Exercise DB fallback; "none": nothing to show. */
  origin: "table" | "pinned" | "none";
};

const SOURCE_REF = /^[A-Za-z0-9_-]{1,160}$/;
const STORAGE_PATH = /^[A-Za-z0-9_./-]{1,512}$/;

/** The Free Exercise DB id for an exercise: its `source_ref`, else the `free-exercise-db-` id suffix. */
export function freeExerciseDbRef(exerciseId: string, sourceRef?: string | null): string | null {
  if (sourceRef && SOURCE_REF.test(sourceRef)) return sourceRef;
  const suffix = exerciseId.startsWith(FREE_EXERCISE_DB_ID_PREFIX) ? exerciseId.slice(FREE_EXERCISE_DB_ID_PREFIX.length) : "";
  return SOURCE_REF.test(suffix) ? suffix : null;
}

/** A pinned Free Exercise DB photo (`position` 0 or 1). */
export function pinnedPhotoUrl(sourceRef: string, position: number): string {
  return `${PINNED_PHOTO_BASE}${encodeURIComponent(sourceRef)}/${position}.jpg`;
}

/** The Supabase project URL without a trailing slash, or null when it is not an http(s) URL. */
function projectBase(supabaseUrl: string | null | undefined): string | null {
  if (!supabaseUrl) return null;
  try {
    const url = new URL(supabaseUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** Relative, no empty, "." or ".." segments: a path that stays inside the bucket. */
function isSafeStoragePath(path: string): boolean {
  return STORAGE_PATH.test(path) && path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

/** The public URL of a file in the `exercise-media` bucket, or null for an unsafe path or no project URL. */
export function storagePublicUrl(storagePath: string, supabaseUrl: string | null | undefined): string | null {
  const base = projectBase(supabaseUrl);
  if (!base || !isSafeStoragePath(storagePath)) return null;
  return `${base}/storage/v1/object/public/${EXERCISE_MEDIA_BUCKET}/${storagePath.split("/").map(encodeURIComponent).join("/")}`;
}

function httpsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Where a row's file is served from: the mirrored copy when there is one, else the original. */
export function mediaRowUrl(row: ExerciseMediaRow, supabaseUrl: string | null | undefined): { url: string; selfHosted: boolean } | null {
  if (row.mirrored_at && row.storage_path) {
    const url = storagePublicUrl(row.storage_path, supabaseUrl);
    if (url) return { url, selfHosted: true };
  }
  const source = row.source_url ? httpsUrl(row.source_url) : null;
  return source ? { url: source, selfHosted: false } : null;
}

/** True when next/image may optimise the URL (the pinned GitHub path or this project's storage). */
export function isOptimizableImageUrl(url: string, supabaseUrl: string | null | undefined): boolean {
  if (url.startsWith(PINNED_PHOTO_BASE)) return true;
  const base = projectBase(supabaseUrl);
  if (!base) return false;
  try {
    return new URL(url).host === new URL(base).host && new URL(url).pathname.startsWith("/storage/v1/object/");
  } catch {
    return false;
  }
}

/** Rows grouped by exercise id. */
export function groupMediaRows(rows: readonly ExerciseMediaRow[]): Map<string, ExerciseMediaRow[]> {
  const groups = new Map<string, ExerciseMediaRow[]>();
  for (const row of rows) {
    const group = groups.get(row.exercise_id);
    if (group) group.push(row);
    else groups.set(row.exercise_id, [row]);
  }
  return groups;
}

function pinnedStills(exerciseId: string, name: string, sourceRef: string | null | undefined): MediaItem[] {
  const ref = freeExerciseDbRef(exerciseId, sourceRef);
  if (!ref) return [];
  return Array.from({ length: FREE_EXERCISE_DB_PHOTO_COUNT }, (_, position) => ({
    kind: "still" as const,
    url: pinnedPhotoUrl(ref, position),
    alt: `${name}, photo ${position + 1} of ${FREE_EXERCISE_DB_PHOTO_COUNT}`,
    position,
    selfHosted: false,
    attribution: FREE_EXERCISE_DB_ATTRIBUTION,
    license: FREE_EXERCISE_DB_LICENSE,
  }));
}

/**
 * An exercise's media. `rows` are its exercise_media rows; pass null when the table could not be
 * read (not migrated yet) and [] when it has none. Either way the pinned photos are the fallback.
 * Video rows without stills keep the pinned photos as posters.
 */
export function resolveExerciseMedia(input: {
  exerciseId: string;
  name: string;
  sourceRef?: string | null;
  rows?: readonly ExerciseMediaRow[] | null;
  supabaseUrl?: string | null;
}): ExerciseMedia {
  const items: MediaItem[] = [];
  for (const row of input.rows ?? []) {
    if (row.exercise_id !== input.exerciseId || (row.kind !== "still" && row.kind !== "video_loop")) continue;
    const served = mediaRowUrl(row, input.supabaseUrl);
    if (!served) continue;
    const position = Number.isFinite(Number(row.position)) ? Number(row.position) : 0;
    items.push({
      kind: row.kind,
      url: served.url,
      alt: row.alt?.trim() || `${input.name}, ${row.kind === "still" ? "photo" : "video"} ${position + 1}`,
      position,
      selfHosted: served.selfHosted,
      attribution: row.attribution?.trim() || FREE_EXERCISE_DB_ATTRIBUTION,
      license: row.license?.trim() || FREE_EXERCISE_DB_LICENSE,
    });
  }
  items.sort((a, b) => a.position - b.position);
  const stills = items.filter((item) => item.kind === "still");
  const videos = items.filter((item) => item.kind === "video_loop");
  if (items.length) return { stills: stills.length ? stills : pinnedStills(input.exerciseId, input.name, input.sourceRef), videos, origin: "table" };
  const pinned = pinnedStills(input.exerciseId, input.name, input.sourceRef);
  return { stills: pinned, videos: [], origin: pinned.length ? "pinned" : "none" };
}

/**
 * Credit lines for the items shown, one per distinct source and licence, e.g.
 * "Photos: Free Exercise DB (github.com/yuhonas/free-exercise-db). Licence: Unlicense (public domain dedication)."
 */
export function mediaCreditLines(items: readonly MediaItem[]): string[] {
  const lines = new Map<string, string>();
  for (const item of items) {
    const key = `${item.attribution}\u0000${item.license}`;
    if (lines.has(key)) continue;
    const sameSource = items.filter((other) => other.attribution === item.attribution && other.license === item.license);
    const noun = sameSource.every((other) => other.kind === "still") ? (sameSource.length === 1 ? "Photo" : "Photos") : sameSource.every((other) => other.kind === "video_loop") ? "Video" : "Media";
    lines.set(key, `${noun}: ${item.attribution}. Licence: ${item.license}.`);
  }
  return [...lines.values()];
}
