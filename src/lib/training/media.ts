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
 *
 * FITX's own demonstrations (wave 2, decision D6) ship inside the site, not in the table: AI images made from the
 * Free Exercise DB photo of the same movement, one male and one female model, a start and an end frame each, at
 * `public/media/demos/<model>/<exercise_id>/<0|1>.webp` and listed in `public/media/demos/index.json`
 * (scripts/media/demos/emit-index.mjs). `withDemoMedia` merges an index entry in as stills at positions 2 and 3
 * (male) or 4 and 5 (female), and `forModel` then shows one person only.
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
/** exercise_media.model (20261123100020): which demonstration model a photo or video shows. */
export type DemoModelKey = "male" | "female";
/** Read when 20261123100020 is applied; left out of the select until then. */
export const EXERCISE_MEDIA_OPTIONAL_COLUMNS = ["model", "caption"] as const;

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
  /** Added by 20261123100020 (wave-2 media): 'male', 'female' or null. */
  model?: string | null;
  caption?: string | null;
};

export type MediaItem = {
  kind: ExerciseMediaKind;
  /** A short caption shown with the media (exercise_media.caption, or a stand-in's note), else absent. */
  caption?: string;
  /** The demonstration model shown (exercise_media.model), when the row names one. */
  model?: DemoModelKey;
  url: string;
  alt: string;
  position: number;
  /** Served from FITX's own storage copy rather than the original source. */
  selfHosted: boolean;
  attribution: string;
  license: string;
  /** A FITX demonstration (an AI image made from a real photo of the movement), labelled as such wherever it shows. */
  aiDemo?: boolean;
};

export type ExerciseMedia = {
  /** Photos in position order. */
  stills: MediaItem[];
  /** Muted demonstration loops in position order (none exist yet). */
  videos: MediaItem[];
  /** "table": exercise_media rows; "pinned": the Free Exercise DB fallback; "none": nothing to show. */
  origin: "table" | "pinned" | "none";
  /** Set when the photos show a closely related variation (PHOTO_STAND_INS): what they show, said plainly. */
  standIn?: string;
};

/**
 * The image audit (phase 12): seven FITX starter exercises have no Free Exercise DB entry of their own. Six of them
 * show the public-domain photos of the same movement done a slightly different way, always with a note saying what
 * the photos show. Each was chosen from the upstream instructions, which describe the same joint actions:
 *  - cable_fly: the Cable Crossover is the standing cable fly from high pulleys;
 *  - split_squat: the same split squat holding dumbbells (Free Exercise DB's "Split Squats" is a jump, so not used);
 *  - dumbbell_rdl: the stiff-legged dumbbell deadlift, a hip hinge with soft knees and the same dumbbells;
 *  - step_up: the same step-up holding dumbbells;
 *  - band_row: the seated cable row, the same horizontal pull against a cable instead of a band;
 *  - calf_raise: the same standing calf raise holding dumbbells on a low board.
 * jumping_jack has none: no public-domain photo shows it (Star Jump is a different movement, and the generated
 * home-workout image has the feet together with the arms overhead, which is wrong), so it shows no photo.
 */
export const PHOTO_STAND_INS: Readonly<Record<string, { ref: string; note: string }>> = {
  cable_fly: { ref: "Cable_Crossover", note: "Photos show the cable crossover: the same fly from high pulleys." },
  split_squat: { ref: "Split_Squat_with_Dumbbells", note: "Photos show the same split squat holding dumbbells." },
  dumbbell_rdl: { ref: "Stiff-Legged_Dumbbell_Deadlift", note: "Photos show the stiff-legged dumbbell deadlift, a near-identical hip hinge." },
  step_up: { ref: "Dumbbell_Step_Ups", note: "Photos show the same step-up holding dumbbells." },
  band_row: { ref: "Seated_Cable_Rows", note: "Photos show the seated cable row: the same pull on a cable machine." },
  calf_raise: { ref: "Standing_Dumbbell_Calf_Raise", note: "Photos show the same calf raise holding dumbbells on a low step." },
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
  // Demonstrations are already sized WebP files; served as they are, they never use Vercel's image transformations.
  if (isDemoMediaUrl(url)) return false;
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
  const standIn = freeExerciseDbRef(exerciseId, sourceRef) ? null : PHOTO_STAND_INS[exerciseId] ?? null;
  const ref = freeExerciseDbRef(exerciseId, sourceRef) ?? standIn?.ref ?? null;
  if (!ref) return [];
  return Array.from({ length: FREE_EXERCISE_DB_PHOTO_COUNT }, (_, position) => ({
    kind: "still" as const,
    url: pinnedPhotoUrl(ref, position),
    alt: `${name}, photo ${position + 1} of ${FREE_EXERCISE_DB_PHOTO_COUNT}${standIn ? " (a closely related variation)" : ""}`,
    position,
    ...(standIn ? { caption: standIn.note } : {}),
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
  /** The member's demonstration model (resolveDemoModel); rows for the other model are left out when theirs exist. */
  model?: DemoModelKey | null;
}): ExerciseMedia {
  const items: MediaItem[] = [];
  for (const row of input.rows ?? []) {
    if (row.exercise_id !== input.exerciseId || (row.kind !== "still" && row.kind !== "video_loop")) continue;
    const served = mediaRowUrl(row, input.supabaseUrl);
    if (!served) continue;
    const position = Number.isFinite(Number(row.position)) ? Number(row.position) : 0;
    const caption = typeof row.caption === "string" ? row.caption.trim().slice(0, 280) : "";
    const model = row.model === "male" || row.model === "female" ? row.model : null;
    items.push({
      kind: row.kind,
      ...(caption ? { caption } : {}),
      ...(model ? { model } : {}),
      url: served.url,
      alt: row.alt?.trim() || `${input.name}, ${row.kind === "still" ? "photo" : "video"} ${position + 1}`,
      position,
      selfHosted: served.selfHosted,
      attribution: row.attribution?.trim() || FREE_EXERCISE_DB_ATTRIBUTION,
      license: row.license?.trim() || FREE_EXERCISE_DB_LICENSE,
    });
  }
  items.sort((a, b) => a.position - b.position);
  const chosen = forModel(items, input.model ?? null);
  const stills = chosen.filter((item) => item.kind === "still");
  const videos = chosen.filter((item) => item.kind === "video_loop");
  if (items.length) return { stills: stills.length ? stills : pinnedStills(input.exerciseId, input.name, input.sourceRef), videos, origin: "table" };
  const pinned = pinnedStills(input.exerciseId, input.name, input.sourceRef);
  const standIn = pinned[0]?.caption;
  return { stills: pinned, videos: [], origin: pinned.length ? "pinned" : "none", ...(standIn ? { standIn } : {}) };
}

/**
 * The items for one demonstration model, per kind, so a loop never switches person half-way:
 *  - when the kind has items for the member's model, only those are kept (media tied to no model, the Free Exercise DB
 *    photos, is dropped);
 *  - otherwise the media tied to no model is the fallback (the other model is left out);
 *  - with neither, the first model listed is kept.
 * With no model chosen, the media tied to no model is shown when there is any, else the first model listed.
 */
export function forModel(items: readonly MediaItem[], model: DemoModelKey | null): MediaItem[] {
  const keep = new Map<ExerciseMediaKind, DemoModelKey | null>();
  for (const kind of ["still", "video_loop"] as const) {
    const ofKind = items.filter((item) => item.kind === kind);
    const models = ofKind.filter((item) => item.model).map((item) => item.model as DemoModelKey);
    const neutral = ofKind.some((item) => !item.model);
    keep.set(kind, model && models.includes(model) ? model : neutral ? null : models[0] ?? null);
  }
  return items.filter((item) => (keep.get(item.kind) ?? null) === (item.model ?? null));
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

// ---------------------------------------------------------------- FITX demonstrations (D6: files inside the site)

/** Where the demonstration files and their index are served from (public/media/demos/). */
export const DEMO_MEDIA_BASE = "/media/demos/";
export const DEMO_INDEX_PATH = "/media/demos/index.json";
export const DEMO_INDEX_VERSION = 1;
export const DEMO_ATTRIBUTION = "FITX demonstration (AI image made with Google Gemini from a Free Exercise DB photo)";
export const DEMO_LICENSE = "FITX";
/** The honest label shown with every FITX demonstration. */
export const DEMO_LABEL = "AI demonstration made from a real photo of the movement";
/** Virtual exercise_media positions: Free Exercise DB keeps 0 and 1. */
export const DEMO_POSITIONS: Readonly<Record<DemoModelKey, readonly [number, number]>> = { male: [2, 3], female: [4, 5] };
export const DEMO_MODEL_ORDER: readonly DemoModelKey[] = ["male", "female"];
export const DEMO_CAPTION_MAX = 120;
const DEMO_ID = /^[A-Za-z0-9_-]{1,200}$/;

/** One model's two frames (start, end) and the caption for each. */
export type DemoFrames = { frames: readonly [string, string]; captions: readonly [string, string] };
export type DemoIndexItem = Partial<Record<DemoModelKey, DemoFrames>>;
export type DemoCredit = { attribution: string; license: string };
export type DemoIndex = {
  version: number;
  items: ReadonlyMap<string, DemoIndexItem>;
  /** Which models each exercise has, in DEMO_MODEL_ORDER (the shape useDemoIndex returns). */
  models: ReadonlyMap<string, readonly DemoModelKey[]>;
  credit: DemoCredit;
};

/** The served path of a demonstration frame: /media/demos/<model>/<exercise_id>/<0|1>.webp. */
export function demoFramePath(model: DemoModelKey, exerciseId: string, frame: 0 | 1): string {
  return `${DEMO_MEDIA_BASE}${model}/${exerciseId}/${frame}.webp`;
}

const DEMO_PATH = /^\/media\/demos\/(male|female)\/([A-Za-z0-9_-]{1,200})\/([01])\.webp$/;

/** True for a demonstration file's path (never optimised by next/image). */
export function isDemoMediaUrl(url: string): boolean {
  return typeof url === "string" && DEMO_PATH.test(url);
}

function cleanCaption(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, DEMO_CAPTION_MAX) : "";
}

/**
 * The parsed index, or null when it is not one. Only entries whose two frames are exactly the paths for their model
 * and exercise are kept, so the index can never point the app anywhere else.
 */
export function parseDemoIndex(json: unknown): DemoIndex | null {
  if (!json || typeof json !== "object") return null;
  const raw = json as { version?: unknown; items?: unknown; credit?: unknown };
  if (raw.version !== DEMO_INDEX_VERSION || !raw.items || typeof raw.items !== "object") return null;
  const items = new Map<string, DemoIndexItem>();
  const models = new Map<string, readonly DemoModelKey[]>();
  for (const [exerciseId, value] of Object.entries(raw.items as Record<string, unknown>)) {
    if (!DEMO_ID.test(exerciseId) || !value || typeof value !== "object") continue;
    const item: DemoIndexItem = {};
    for (const model of DEMO_MODEL_ORDER) {
      const entry = (value as Record<string, unknown>)[model] as { frames?: unknown; captions?: unknown } | undefined;
      if (!entry || !Array.isArray(entry.frames) || entry.frames.length !== 2) continue;
      if (entry.frames[0] !== demoFramePath(model, exerciseId, 0) || entry.frames[1] !== demoFramePath(model, exerciseId, 1)) continue;
      const captions = Array.isArray(entry.captions) ? entry.captions : [];
      item[model] = { frames: [entry.frames[0], entry.frames[1]], captions: [cleanCaption(captions[0]), cleanCaption(captions[1])] };
    }
    const present = DEMO_MODEL_ORDER.filter((model) => item[model]);
    if (!present.length) continue;
    items.set(exerciseId, item);
    models.set(exerciseId, present);
  }
  const credit = (raw.credit ?? {}) as { attribution?: unknown; license?: unknown };
  return {
    version: DEMO_INDEX_VERSION,
    items,
    models,
    credit: {
      attribution: typeof credit.attribution === "string" && credit.attribution.trim() ? credit.attribution.trim() : DEMO_ATTRIBUTION,
      license: typeof credit.license === "string" && credit.license.trim() ? credit.license.trim() : DEMO_LICENSE,
    },
  };
}

/** An empty index: no demonstrations yet, so every surface shows today's photos. */
export const EMPTY_DEMO_INDEX: DemoIndex = { version: DEMO_INDEX_VERSION, items: new Map(), models: new Map(), credit: { attribution: DEMO_ATTRIBUTION, license: DEMO_LICENSE } };

/** An index entry as stills (virtual exercise_media rows): positions 2 and 3 male, 4 and 5 female. */
export function demoStills(exerciseId: string, name: string, item: DemoIndexItem | null | undefined, credit: DemoCredit): MediaItem[] {
  const stills: MediaItem[] = [];
  for (const model of DEMO_MODEL_ORDER) {
    const entry = item?.[model];
    if (!entry) continue;
    entry.frames.forEach((url, frame) => {
      const caption = entry.captions[frame];
      stills.push({
        kind: "still",
        ...(caption ? { caption } : {}),
        model,
        url,
        alt: `${name}, ${frame === 0 ? "start" : "end"} of the movement (${DEMO_LABEL.toLowerCase()})`,
        position: DEMO_POSITIONS[model][frame],
        selfHosted: true,
        attribution: credit.attribution,
        license: credit.license,
        aiDemo: true,
      });
    });
  }
  return stills;
}

/**
 * Media with an exercise's demonstrations merged in, for one model (forModel). Without an entry the media is
 * returned as it is, so with no index (or an empty one) every surface shows today's photos.
 */
export function withDemoMedia(media: ExerciseMedia, input: { exerciseId: string; name: string; index: DemoIndex | null | undefined; model: DemoModelKey | null }): ExerciseMedia {
  const item = input.index?.items.get(input.exerciseId);
  if (!item || !input.index) return media;
  const merged = [...demoStills(input.exerciseId, input.name, item, input.index.credit), ...media.stills].sort((a, b) => a.position - b.position);
  return { ...media, stills: forModel(merged, input.model) };
}

/** The models an exercise's demonstrations have, in DEMO_MODEL_ORDER (empty without an entry). */
export function demoModelsFor(index: DemoIndex | null | undefined, exerciseId: string): readonly DemoModelKey[] {
  return index?.models.get(exerciseId) ?? [];
}

/** The first frame to show on a card for the member's model: theirs, else none (the card keeps its photo). */
export function demoCoverFrame(index: DemoIndex | null | undefined, exerciseId: string, model: DemoModelKey | null): string | null {
  if (!model) return null;
  return index?.items.get(exerciseId)?.[model]?.frames[0] ?? null;
}

/**
 * A camera exercise's demonstration (the AI Form Check's DemoReel): the first of its library ids (form-rules
 * `libraryIds`) that the index has for the member's model, or null (the reel keeps its checked photos).
 */
export function demoForLibraryIds(index: DemoIndex | null | undefined, libraryIds: readonly string[], model: DemoModelKey | null): (DemoFrames & { exerciseId: string; model: DemoModelKey }) | null {
  if (!index || !model) return null;
  for (const exerciseId of libraryIds) {
    const entry = index.items.get(exerciseId)?.[model];
    if (entry) return { ...entry, exerciseId, model };
  }
  return null;
}
