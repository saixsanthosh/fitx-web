import { columnList, omitColumns, withOptionalColumns } from "@/lib/domain/schema-fallback";
import { effortsFromJson, effortsToJson, type BestEffort } from "./best-efforts";
import { isMissingColumnError, isMissingFunctionError } from "@/lib/supabase/errors";
import type { ActivityRecord, TrackChunk } from "./record";
import { isImportFormat, isSport, SPORTS, type ActivitySource, type ControlEvent, type Gap, type ImportFormat, type Split, type Sport } from "./types";

/*
 * Reading and writing activities in Supabase (public.activities, public.activity_track_chunks;
 * migration 20261118160000). Every call reports one of three outcomes, so screens can be honest:
 *   ok           the request worked;
 *   unavailable  the database does not have the activity tables yet (migration not applied);
 *   rejected     the database refused the data for good (it breaks a limit): retrying won't help;
 *   error        anything else, with `offline` set when the network failed.
 * Writes are idempotent: an activity is keyed by the device's client id and chunks by number, so
 * a retried upload never duplicates anything.
 */

type ErrorLike = { code?: unknown; message?: unknown; details?: unknown } | null | undefined;

/** The table is not there yet: Postgres 42P01, or PostgREST PGRST205 ("not in the schema cache"). */
export function isMissingTableError(error: unknown): boolean {
  const e = error as ErrorLike;
  const code = typeof e?.code === "string" ? e.code : "";
  if (code === "42P01" || code === "PGRST205") return true;
  const message = typeof e?.message === "string" ? e.message : "";
  return !code && /could not find the table|relation .* does not exist/i.test(message);
}

/** The request never reached the server (offline, DNS, blocked). */
export function isNetworkError(error: unknown): boolean {
  const e = error as ErrorLike;
  const text = `${typeof e?.message === "string" ? e.message : ""} ${typeof e?.details === "string" ? e.details : ""}`;
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(text);
}

export type DbResult<T> =
  | { status: "ok"; data: T }
  | { status: "unavailable" }
  | { status: "rejected"; message: string }
  | { status: "error"; message: string; offline: boolean };

/**
 * Postgres errors that mean the row itself is unacceptable (a check, a size or a value limit):
 * retrying can't fix them. The daily caps and the hourly and daily write budget (20261121100040) raise 54000
 * instead, so those uploads are retried.
 */
const PERMANENT_CODES = new Set(["23514", "23502", "22001", "22003", "22P02", "P0001"]);

export function isPermanentRejection(error: unknown): boolean {
  const code = (error as ErrorLike)?.code;
  return typeof code === "string" && PERMANENT_CODES.has(code);
}

function failure<T>(error: unknown): DbResult<T> {
  if (isMissingTableError(error) || isMissingColumnError(error) || isMissingFunctionError(error)) return { status: "unavailable" };
  if (isPermanentRejection(error)) {
    const message = typeof (error as ErrorLike)?.message === "string" ? ((error as ErrorLike)!.message as string) : "Rejected";
    return { status: "rejected", message };
  }
  const message = typeof (error as ErrorLike)?.message === "string" ? ((error as ErrorLike)!.message as string) : "Request failed";
  return { status: "error", message, offline: isNetworkError(error) };
}

/** The parts of the Supabase client used here (structural, so tests can pass a fake). */
export type SupabaseLike = { from(table: string): unknown };
// supabase-js query builders are fluent and thenable; this module only uses a small, typed subset.
type Query = PromiseLike<{ data: unknown; error: unknown; count?: number | null }> & Record<string, (...args: unknown[]) => Query>;
const table = (client: SupabaseLike, name: string) => client.from(name) as unknown as Query;

/** One activity as the screens use it. */
export type ActivityView = {
  id: string | null;
  clientId: string;
  sport: Sport;
  title: string;
  startedAt: number;
  endedAt: number;
  elapsedSeconds: number;
  movingSeconds: number;
  pausedSeconds: number;
  distanceM: number;
  avgSpeedMps: number | null;
  maxSpeedMps: number | null;
  avgPaceSecondsPerKm: number | null;
  elevationGainM: number | null;
  kcal: number | null;
  kcalMethod: string | null;
  weightKg: number | null;
  gapCount: number;
  gapSeconds: number;
  splits: Split[];
  gaps: Gap[];
  /** Control events as [type, ms after the start] (detail reads only; empty in lists). */
  timeline: Array<[ControlEvent["type"], number]>;
  routePolyline: string;
  sharePolyline: string;
  shareBbox: [number, number, number, number] | null;
  pointCount: number;
  chunkCount: number;
  /** True while it exists only on this device (not uploaded yet). */
  local: boolean;
  /** Where the data came from; "fitx_gps" before migration 20261119100000 (every older row is a FITX recording). */
  source: ActivitySource;
  sourceFormat: ImportFormat | null;
  /** The device or app an imported file names, as the file names it. */
  sourceDevice: string | null;
  importedAt: number | null;
};

const SUMMARY_COLUMN_LIST = [
  "id", "client_id", "sport", "title", "started_at", "ended_at", "elapsed_seconds", "moving_seconds", "paused_seconds",
  "distance_m", "avg_speed_mps", "max_speed_mps", "avg_pace_seconds_per_km", "elevation_gain_m", "kcal_estimate", "kcal_method",
  "weight_kg_used", "gap_count", "gap_seconds", "route_polyline", "share_polyline", "share_bbox", "point_count", "chunk_count",
];
const DETAIL_COLUMN_LIST = [...SUMMARY_COLUMN_LIST, "splits", "gaps", "timeline"];
/** Columns added by migration 20261119100000; reads fall back without them until it is applied. */
export const SOURCE_COLUMNS = ["source", "source_format", "source_device", "imported_at"] as const;
const TIMELINE_TYPES = new Set(["start", "pause", "resume", "hidden", "visible", "finish"]);

/** Clients (by object) whose database turned out not to have the source columns yet: later reads skip them. */
const sourceColumnsMissing = new WeakMap<object, true>();

/**
 * Runs a read with the source columns, and again without them when the database doesn't have them
 * yet. Before the migration, history keeps working and every row reads as a FITX recording (which
 * is what every row then is).
 */
async function withSourceColumns<R extends PromiseLike<{ error: unknown }>>(client: SupabaseLike, run: (includeSource: boolean) => R) {
  const outcome = await withOptionalColumns(SOURCE_COLUMNS, run, sourceColumnsMissing.has(client) ? { includeOptional: false } : {});
  if (!outcome.includedOptional && outcome.missing) sourceColumnsMissing.set(client, true);
  return outcome;
}

type Row = Record<string, unknown>;
const num = (value: unknown): number | null => {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const str = (value: unknown): string => (typeof value === "string" ? value : "");

function splitsFrom(value: unknown): Split[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = item as Row;
    const index = num(row.index);
    const distanceM = num(row.distance_m);
    const movingSeconds = num(row.moving_s);
    const elapsedSeconds = num(row.elapsed_s);
    return index === null || distanceM === null || movingSeconds === null || elapsedSeconds === null ? [] : [{ index, distanceM, movingSeconds, elapsedSeconds }];
  });
}

function timelineFrom(value: unknown): Array<[ControlEvent["type"], number]> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!Array.isArray(item) || item.length !== 2 || !TIMELINE_TYPES.has(item[0] as string)) return [];
    const ms = num(item[1]);
    return ms === null ? [] : [[item[0] as ControlEvent["type"], ms] as [ControlEvent["type"], number]];
  });
}

function gapsFrom(value: unknown): Gap[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = item as Row;
    const start = Date.parse(str(row.start));
    const end = Date.parse(str(row.end));
    const kind = row.kind === "hidden" || row.kind === "signal" || row.kind === "jump" ? row.kind : null;
    if (!kind || !Number.isFinite(start) || !Number.isFinite(end)) return [];
    return [{ kind, start, end, straightLineM: num(row.straight_line_m) }];
  });
}

export function viewFromRow(row: Row): ActivityView | null {
  const sport = row.sport;
  const startedAt = Date.parse(str(row.started_at));
  const endedAt = Date.parse(str(row.ended_at));
  if (!isSport(sport) || !Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return null;
  const bbox = Array.isArray(row.share_bbox) && row.share_bbox.length === 4 && row.share_bbox.every((v) => num(v) !== null)
    ? (row.share_bbox.map((v) => num(v) as number) as [number, number, number, number])
    : null;
  return {
    id: str(row.id) || null,
    clientId: str(row.client_id),
    sport,
    title: str(row.title) || "Activity",
    startedAt,
    endedAt,
    elapsedSeconds: num(row.elapsed_seconds) ?? 0,
    movingSeconds: num(row.moving_seconds) ?? 0,
    pausedSeconds: num(row.paused_seconds) ?? 0,
    distanceM: num(row.distance_m) ?? 0,
    avgSpeedMps: num(row.avg_speed_mps),
    maxSpeedMps: num(row.max_speed_mps),
    avgPaceSecondsPerKm: num(row.avg_pace_seconds_per_km),
    elevationGainM: num(row.elevation_gain_m),
    kcal: num(row.kcal_estimate),
    kcalMethod: typeof row.kcal_method === "string" ? row.kcal_method : null,
    weightKg: num(row.weight_kg_used),
    gapCount: num(row.gap_count) ?? 0,
    gapSeconds: num(row.gap_seconds) ?? 0,
    splits: splitsFrom(row.splits),
    gaps: gapsFrom(row.gaps),
    timeline: timelineFrom(row.timeline),
    routePolyline: str(row.route_polyline),
    sharePolyline: str(row.share_polyline),
    shareBbox: bbox,
    pointCount: num(row.point_count) ?? 0,
    chunkCount: num(row.chunk_count) ?? 0,
    local: false,
    ...sourceFromRow(row),
  };
}

/** The source fields of a row; a row read without them (before the migration) is a FITX recording. */
export function sourceFromRow(row: Row): Pick<ActivityView, "source" | "sourceFormat" | "sourceDevice" | "importedAt"> {
  const imported = Date.parse(str(row.imported_at));
  return {
    source: row.source === "file" ? "file" : "fitx_gps",
    sourceFormat: isImportFormat(row.source_format) ? row.source_format : null,
    sourceDevice: str(row.source_device).trim() || null,
    importedAt: Number.isFinite(imported) ? imported : null,
  };
}

/** A finished recording that is still only on this device, shown like a saved one. */
export function viewFromRecord(record: ActivityRecord): ActivityView {
  return {
    id: null,
    clientId: record.clientId,
    sport: record.sport,
    title: record.title,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    elapsedSeconds: record.elapsedSeconds,
    movingSeconds: record.movingSeconds,
    pausedSeconds: record.pausedSeconds,
    distanceM: record.distanceM,
    avgSpeedMps: record.avgSpeedMps,
    maxSpeedMps: record.maxSpeedMps,
    avgPaceSecondsPerKm: record.avgPaceSecondsPerKm,
    elevationGainM: record.elevationGainM,
    kcal: record.kcal,
    kcalMethod: record.kcalMethod,
    weightKg: record.weightKg,
    gapCount: record.gapCount,
    gapSeconds: record.gapSeconds,
    splits: record.splits,
    gaps: record.gaps,
    timeline: record.timeline,
    routePolyline: record.routePolyline,
    sharePolyline: record.sharePolyline,
    shareBbox: record.shareBbox,
    pointCount: record.pointCount,
    chunkCount: record.chunks.length,
    local: true,
    source: record.source === "file" ? "file" : "fitx_gps",
    sourceFormat: record.sourceFormat ?? null,
    sourceDevice: record.sourceDevice ?? null,
    importedAt: record.importedAt ?? null,
  };
}

/**
 * The row to save. A FITX recording never sends the source columns (their default says
 * 'fitx_gps'), so phone uploads keep working whether or not migration 20261119100000 is applied.
 * An import sends them, and so needs the migration (the import page checks for it first).
 */
export function rowFromRecord(record: ActivityRecord, userId: string): Row {
  const iso = (ms: number) => new Date(ms).toISOString();
  const source: Row = record.source === "file"
    ? {
        source: "file",
        source_format: record.sourceFormat ?? null,
        source_device: record.sourceDevice ? record.sourceDevice.slice(0, 120) : null,
        imported_at: record.importedAt ? iso(record.importedAt) : null,
      }
    : {};
  return {
    ...source,
    user_id: userId,
    client_id: record.clientId,
    sport: record.sport,
    title: record.title,
    started_at: iso(record.startedAt),
    ended_at: iso(record.endedAt),
    elapsed_seconds: record.elapsedSeconds,
    moving_seconds: record.movingSeconds,
    paused_seconds: record.pausedSeconds,
    distance_m: record.distanceM,
    avg_speed_mps: record.avgSpeedMps,
    max_speed_mps: record.maxSpeedMps,
    avg_pace_seconds_per_km: record.avgPaceSecondsPerKm,
    elevation_gain_m: record.elevationGainM,
    kcal_estimate: record.kcal,
    kcal_method: record.kcalMethod,
    weight_kg_used: record.weightKg,
    gap_count: record.gapCount,
    gap_seconds: record.gapSeconds,
    splits: record.splits.map((s) => ({ index: s.index, distance_m: s.distanceM, moving_s: s.movingSeconds, elapsed_s: s.elapsedSeconds })),
    gaps: record.gaps.map((g) => ({ kind: g.kind, start: iso(g.start), end: iso(g.end), straight_line_m: g.straightLineM })),
    timeline: record.timeline,
    route_polyline: record.routePolyline || null,
    share_polyline: record.sharePolyline || null,
    share_bbox: record.shareBbox,
    point_count: record.pointCount,
    chunk_count: record.chunks.length,
    engine_version: record.engineVersion,
    // Only when worked out; saveRowAndChunks drops it again on a database without migration 20261123100050.
    ...(Array.isArray(record.bestEfforts) ? { best_efforts: effortsToJson(record.bestEfforts) } : {}),
  };
}

/** Added by migration 20261123100050; writes fall back without it until it is applied. */
export const V2_COLUMNS = ["best_efforts"] as const;

const CHUNK_BATCH = 6;

/**
 * Saves the row and then its chunks. `created` is the id when this call inserted the row (it did not
 * exist before), so a caller can take it back out when the chunks then fail. With `keepChunks`, chunks
 * already stored are left as they are and only the missing ones are added.
 */
async function saveRowAndChunks(client: SupabaseLike, userId: string, record: ActivityRecord, keepChunks = false): Promise<{ result: DbResult<{ id: string }>; created: string | null }> {
  let created: string | null = null;
  try {
    const row = rowFromRecord(record, userId);
    const { result: inserted } = await withOptionalColumns(V2_COLUMNS, (withV2) => table(client, "activities")
      .upsert(withV2 ? row : omitColumns(row, V2_COLUMNS), { onConflict: "user_id,client_id", ignoreDuplicates: true })
      .select("id"));
    if (inserted.error) return { result: failure(inserted.error), created };
    let id = Array.isArray(inserted.data) && inserted.data.length ? str((inserted.data[0] as Row).id) : "";
    if (id) created = id;
    if (!id) {
      const existing = await table(client, "activities").select("id").eq("user_id", userId).eq("client_id", record.clientId).maybeSingle();
      if (existing.error) return { result: failure(existing.error), created };
      id = str((existing.data as Row | null)?.id);
    }
    if (!id) return { result: { status: "error", message: "The activity was not saved", offline: false }, created };
    const chunks = record.chunks;
    for (let i = 0; i < chunks.length; i += CHUNK_BATCH) {
      const rows = chunks.slice(i, i + CHUNK_BATCH).map((chunk: TrackChunk) => ({
        activity_id: id,
        user_id: userId,
        seq: chunk.seq,
        started_at: new Date(chunk.startedAt).toISOString(),
        ended_at: new Date(chunk.endedAt).toISOString(),
        point_count: chunk.pointCount,
        encoding: 1,
        points: chunk.points,
      }));
      const saved = await table(client, "activity_track_chunks").upsert(rows, keepChunks ? { onConflict: "activity_id,seq", ignoreDuplicates: true } : { onConflict: "activity_id,seq" });
      if (saved.error) return { result: failure(saved.error), created };
    }
    return { result: { status: "ok", data: { id } }, created };
  } catch (error) {
    return { result: failure(error), created };
  }
}

/** Saves (or re-saves) a finished activity and its GPS chunks. Safe to retry. */
export async function saveActivity(client: SupabaseLike, userId: string, record: ActivityRecord): Promise<DbResult<{ id: string }>> {
  return (await saveRowAndChunks(client, userId, record)).result;
}

/**
 * Saves an imported activity. A phone recording that fails part way is retried from the device
 * copy, but an import has no copy to retry from: when this call created the row and its points
 * then failed, the row is removed again (its chunks go with it), so importing the file again
 * starts clean instead of finding an activity without its points. A row that was already there
 * is never removed, and its stored points are never overwritten: only the missing ones are added.
 */
export async function saveImportedActivity(client: SupabaseLike, userId: string, record: ActivityRecord): Promise<DbResult<{ id: string }>> {
  const { result, created } = await saveRowAndChunks(client, userId, record, true);
  if (result.status !== "ok" && created) await deleteActivity(client, userId, created);
  return result;
}

/** A page of activities, newest first; `sport` limits it to walks, runs or rides. */
export async function listActivities(client: SupabaseLike, userId: string, options: { limit?: number; before?: number | null; sport?: Sport | null } = {}): Promise<DbResult<ActivityView[]>> {
  try {
    const { result } = await withSourceColumns(client, (includeSource) => {
      let query = table(client, "activities").select(columnList(SUMMARY_COLUMN_LIST, SOURCE_COLUMNS, includeSource)).eq("user_id", userId).order("started_at", { ascending: false }).limit(options.limit ?? 20);
      if (options.sport) query = query.eq("sport", options.sport);
      if (options.before) query = query.lt("started_at", new Date(options.before).toISOString());
      return query;
    });
    if (result.error) return failure(result.error);
    const rows = Array.isArray(result.data) ? (result.data as Row[]) : [];
    return { status: "ok", data: rows.map(viewFromRow).filter((view): view is ActivityView => view !== null) };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Whether imports can be saved: true once migration 20261119100000 has added the source columns,
 * false before. "unavailable" when there is no activities table at all.
 */
export async function activitySourcesReady(client: SupabaseLike, userId: string): Promise<DbResult<boolean>> {
  try {
    const result = await table(client, "activities").select("id,source").eq("user_id", userId).limit(1);
    if (!result.error) return { status: "ok", data: true };
    if (isMissingColumnError(result.error)) {
      sourceColumnsMissing.set(client, true);
      return { status: "ok", data: false };
    }
    return failure(result.error);
  } catch (error) {
    return failure(error);
  }
}

/** The account's activities with these device ids (imports already saved). */
export async function findActivitiesByClientIds(client: SupabaseLike, userId: string, clientIds: readonly string[]): Promise<DbResult<ActivityView[]>> {
  if (!clientIds.length) return { status: "ok", data: [] };
  try {
    const { result } = await withSourceColumns(client, (includeSource) =>
      table(client, "activities").select(columnList(SUMMARY_COLUMN_LIST, SOURCE_COLUMNS, includeSource)).eq("user_id", userId).in("client_id", [...clientIds]).limit(clientIds.length));
    if (result.error) return failure(result.error);
    const rows = Array.isArray(result.data) ? (result.data as Row[]) : [];
    return { status: "ok", data: rows.map(viewFromRow).filter((view): view is ActivityView => view !== null) };
  } catch (error) {
    return failure(error);
  }
}

/** The account's activities that share any time with [from, to] (newest first, at most `limit`). */
export async function findActivitiesBetween(client: SupabaseLike, userId: string, from: number, to: number, limit = 1000): Promise<DbResult<ActivityView[]>> {
  try {
    const { result } = await withSourceColumns(client, (includeSource) =>
      table(client, "activities").select(columnList(SUMMARY_COLUMN_LIST, SOURCE_COLUMNS, includeSource)).eq("user_id", userId)
        .lt("started_at", new Date(to).toISOString()).gt("ended_at", new Date(from).toISOString())
        .order("started_at", { ascending: false }).limit(limit));
    if (result.error) return failure(result.error);
    const rows = Array.isArray(result.data) ? (result.data as Row[]) : [];
    return { status: "ok", data: rows.map(viewFromRow).filter((view): view is ActivityView => view !== null) };
  } catch (error) {
    return failure(error);
  }
}

/** The few numbers statistics need, for every activity of the account. */
export type ActivitySummary = Pick<ActivityView, "id" | "clientId" | "sport" | "title" | "startedAt" | "distanceM" | "movingSeconds" | "avgPaceSecondsPerKm" | "avgSpeedMps" | "local">;

const STATS_COLUMNS = "id,client_id,sport,title,started_at,ended_at,distance_m,moving_seconds,avg_pace_seconds_per_km,avg_speed_mps";
/** Rows per request (PostgREST's usual cap) and the most read for statistics. */
const STATS_PAGE = 1000;
export const STATS_MAX_ROWS = 10_000;

/**
 * Every activity's summary numbers, newest first, read in pages (for totals and personal bests).
 * `complete` is false when the account has more than STATS_MAX_ROWS activities.
 */
export async function listActivitySummaries(client: SupabaseLike, userId: string): Promise<DbResult<{ rows: ActivitySummary[]; complete: boolean }>> {
  try {
    const rows: ActivitySummary[] = [];
    for (let from = 0; from < STATS_MAX_ROWS; from += STATS_PAGE) {
      const result = await table(client, "activities").select(STATS_COLUMNS).eq("user_id", userId).order("started_at", { ascending: false }).order("id", { ascending: true }).range(from, from + STATS_PAGE - 1);
      if (result.error) return failure(result.error);
      const page = Array.isArray(result.data) ? (result.data as Row[]) : [];
      for (const row of page) {
        const view = viewFromRow(row);
        if (view) rows.push({ id: view.id, clientId: view.clientId, sport: view.sport, title: view.title, startedAt: view.startedAt, distanceM: view.distanceM, movingSeconds: view.movingSeconds, avgPaceSecondsPerKm: view.avgPaceSecondsPerKm, avgSpeedMps: view.avgSpeedMps, local: false });
      }
      if (page.length < STATS_PAGE) return { status: "ok", data: { rows, complete: true } };
    }
    return { status: "ok", data: { rows, complete: false } };
  } catch (error) {
    return failure(error);
  }
}

export type PeriodTotals = { count: number; distanceM: number; movingSeconds: number; bySport: Record<Sport, { count: number; distanceM: number }> };

export function totalsOf(activities: ReadonlyArray<Pick<ActivityView, "sport" | "distanceM" | "movingSeconds">>): PeriodTotals {
  const totals: PeriodTotals = { count: 0, distanceM: 0, movingSeconds: 0, bySport: Object.fromEntries(SPORTS.map((sport) => [sport, { count: 0, distanceM: 0 }])) as PeriodTotals["bySport"] };
  for (const activity of activities) {
    totals.count++;
    totals.distanceM += activity.distanceM;
    totals.movingSeconds += activity.movingSeconds;
    totals.bySport[activity.sport].count++;
    totals.bySport[activity.sport].distanceM += activity.distanceM;
  }
  return totals;
}

/** Totals for activities started at or after `since` (for "this week"). */
export async function totalsSince(client: SupabaseLike, userId: string, since: number): Promise<DbResult<PeriodTotals>> {
  try {
    const result = await table(client, "activities").select("sport,distance_m,moving_seconds").eq("user_id", userId).gte("started_at", new Date(since).toISOString()).limit(1000);
    if (result.error) return failure(result.error);
    const rows = Array.isArray(result.data) ? (result.data as Row[]) : [];
    return {
      status: "ok",
      data: totalsOf(rows.flatMap((row) => (isSport(row.sport) ? [{ sport: row.sport, distanceM: num(row.distance_m) ?? 0, movingSeconds: num(row.moving_seconds) ?? 0 }] : []))),
    };
  } catch (error) {
    return failure(error);
  }
}

export async function getActivity(client: SupabaseLike, userId: string, id: string): Promise<DbResult<ActivityView | null>> {
  try {
    const { result } = await withSourceColumns(client, (includeSource) =>
      table(client, "activities").select(columnList(DETAIL_COLUMN_LIST, SOURCE_COLUMNS, includeSource)).eq("user_id", userId).eq("id", id).maybeSingle());
    if (result.error) return failure(result.error);
    return { status: "ok", data: result.data ? viewFromRow(result.data as Row) : null };
  } catch (error) {
    return failure(error);
  }
}

export type StoredChunk = { seq: number; startedAt: number; points: string };

/** How many GPS chunks an activity has stored (an activity holds at most 200, so one page). */
export async function countTrackChunks(client: SupabaseLike, userId: string, activityId: string): Promise<DbResult<number>> {
  try {
    const result = await table(client, "activity_track_chunks").select("seq").eq("user_id", userId).eq("activity_id", activityId);
    if (result.error) return failure(result.error);
    return { status: "ok", data: Array.isArray(result.data) ? result.data.length : 0 };
  } catch (error) {
    return failure(error);
  }
}

/** The detailed GPS chunks of an activity (empty once the retention period removed them). */
export async function getTrackChunks(client: SupabaseLike, userId: string, activityId: string): Promise<DbResult<StoredChunk[]>> {
  try {
    const result = await table(client, "activity_track_chunks").select("seq,started_at,points").eq("user_id", userId).eq("activity_id", activityId).order("seq", { ascending: true });
    if (result.error) return failure(result.error);
    const rows = Array.isArray(result.data) ? (result.data as Row[]) : [];
    return { status: "ok", data: rows.flatMap((row) => {
      const seq = num(row.seq);
      const startedAt = Date.parse(str(row.started_at));
      return seq === null || !Number.isFinite(startedAt) || !str(row.points) ? [] : [{ seq, startedAt, points: str(row.points) }];
    }) };
  } catch (error) {
    return failure(error);
  }
}

export type ActivityPatch = { title?: string; sport?: Sport; kcal?: number | null; kcalMethod?: string | null; weightKg?: number | null };

export async function updateActivity(client: SupabaseLike, userId: string, id: string, patch: ActivityPatch): Promise<DbResult<null>> {
  const row: Row = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.sport !== undefined) row.sport = patch.sport;
  if (patch.kcal !== undefined) row.kcal_estimate = patch.kcal;
  if (patch.kcalMethod !== undefined) row.kcal_method = patch.kcalMethod;
  if (patch.weightKg !== undefined) row.weight_kg_used = patch.weightKg;
  try {
    const result = await table(client, "activities").update(row).eq("user_id", userId).eq("id", id).select("id");
    if (result.error) return failure(result.error);
    if (!Array.isArray(result.data) || !result.data.length) return { status: "error", message: "Activity not found", offline: false };
    return { status: "ok", data: null };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteActivity(client: SupabaseLike, userId: string, id: string): Promise<DbResult<null>> {
  try {
    const result = await table(client, "activities").delete().eq("user_id", userId).eq("id", id);
    if (result.error) return failure(result.error);
    return { status: "ok", data: null };
  } catch (error) {
    return failure(error);
  }
}

/** Deletes the saved copy of a device recording, if one was uploaded (found by its device id). */
export async function deleteActivityByClientId(client: SupabaseLike, userId: string, clientId: string): Promise<DbResult<null>> {
  try {
    const result = await table(client, "activities").delete().eq("user_id", userId).eq("client_id", clientId);
    if (result.error) return failure(result.error);
    return { status: "ok", data: null };
  } catch (error) {
    return failure(error);
  }
}

/** Deletes every activity and GPS point of the account (chunks go with their activity). */
export async function deleteAllActivities(client: SupabaseLike, userId: string): Promise<DbResult<null>> {
  try {
    const result = await table(client, "activities").delete().eq("user_id", userId);
    if (result.error) return failure(result.error);
    return { status: "ok", data: null };
  } catch (error) {
    return failure(error);
  }
}

/** The newest logged body weight, else the profile weight; null when neither is known. */
export async function latestWeight(client: SupabaseLike, userId: string): Promise<number | null> {
  try {
    const metric = await table(client, "body_metrics").select("weight").eq("user_id", userId).not("weight", "is", null).order("date", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const fromMetrics = metric.error ? null : num((metric.data as Row | null)?.weight);
    if (fromMetrics !== null) return fromMetrics;
    const profile = await table(client, "profiles").select("weight").eq("id", userId).maybeSingle();
    return profile.error ? null : num((profile.data as Row | null)?.weight);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Activity v2 (migration 20261123100050): the newer sports and stored best efforts.

/** Clients whose database has (true) or lacks (false) migration 20261123100050. */
const v2Ready = new WeakMap<object, boolean>();

/**
 * Whether migration 20261123100050 is applied: its best_efforts column answers a select. Until it is, the newer
 * sports are not offered (the database would refuse them) and best efforts are only worked out on activity pages.
 * "unavailable" (no activities table, or a network error) counts as not ready.
 */
export async function activityV2Ready(client: SupabaseLike, userId: string): Promise<boolean> {
  const known = v2Ready.get(client);
  if (known !== undefined) return known;
  try {
    const result = await table(client, "activities").select("id,best_efforts").eq("user_id", userId).limit(1);
    if (result.error) {
      if (isMissingColumnError(result.error) || isMissingTableError(result.error)) v2Ready.set(client, false);
      return false;
    }
    v2Ready.set(client, true);
    return true;
  } catch {
    return false;
  }
}

export type StoredEfforts = { id: string; sport: Sport; startedAt: number; efforts: BestEffort[] };

/** Every activity with stored best efforts (newest first, at most STATS_MAX_ROWS); "unavailable" before the migration. */
export async function listBestEfforts(client: SupabaseLike, userId: string): Promise<DbResult<StoredEfforts[]>> {
  try {
    const result = await table(client, "activities").select("id,sport,started_at,best_efforts").eq("user_id", userId).not("best_efforts", "is", null)
      .order("started_at", { ascending: false }).limit(STATS_MAX_ROWS);
    if (result.error) return failure(result.error);
    const rows = Array.isArray(result.data) ? (result.data as Row[]) : [];
    return {
      status: "ok",
      data: rows.flatMap((row) => {
        const efforts = effortsFromJson(row.best_efforts);
        const startedAt = Date.parse(str(row.started_at));
        return isSport(row.sport) && efforts && Number.isFinite(startedAt) ? [{ id: str(row.id), sport: row.sport, startedAt, efforts }] : [];
      }),
    };
  } catch (error) {
    return failure(error);
  }
}

/** Stores best efforts worked out later (an activity page replaying an older activity's points). */
export async function saveBestEfforts(client: SupabaseLike, userId: string, id: string, efforts: readonly BestEffort[]): Promise<DbResult<null>> {
  try {
    const result = await table(client, "activities").update({ best_efforts: effortsToJson(efforts) }).eq("user_id", userId).eq("id", id).is("best_efforts", null);
    return result.error ? failure(result.error) : { status: "ok", data: null };
  } catch (error) {
    return failure(error);
  }
}
