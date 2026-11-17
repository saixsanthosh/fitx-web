/**
 * Which muscles a member's logged training worked: the one counting rule FITX uses everywhere (body map,
 * muscle analytics, the workout record, Home and the AI coach), a PostgREST loader, and pure summaries.
 *
 * The rule (contract C3):
 *  - a set counts when `workout_sets.completed_at` is set and it has reps (> 0) or seconds (> 0);
 *  - only in sessions whose status is 'completed' (abandoned and in-progress sessions never count);
 *  - its muscles are the logged exercise's catalogue labels (`workout_session_exercises.exercise_id` →
 *    `exercise_library.primary_muscle` and `secondary_muscles`), read as body-map regions by anatomy.ts. A
 *    merged duplicate counts as the exercise it was merged into. Nothing counts from views, plans or favourites.
 *  - each set gives its primary regions a direct set and its secondary regions an assisting set (a region counts
 *    once per exercise, at its highest role); the weighted load is 1 per direct and 0.5 per assisting set
 *    (anatomy.ts muscleLoad), shown as each region's share of the period's load.
 *  - an exercise whose muscles map to no region (a free-text exercise, one no longer in the library, or one
 *    with no muscle labels) is reported as unmapped, never guessed.
 * Days and weeks follow the runtime's local calendar (the browser's), weeks start on Monday (dates.ts); a set
 * belongs to the day its completed_at falls on.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDateKey, weekStart } from "@/lib/domain/dates";
import { isMissingColumnError, isMissingRelationshipError } from "@/lib/domain/schema-fallback";
import { BODY_REGIONS, REGIONS, exerciseRegions, loadLevels, loadShare, muscleLoad, type MuscleLoadEntry, type RegionKey } from "./anatomy";
import { survivingExerciseId } from "./exercise-merges";

// ---------------------------------------------------------------- the counting rule

export type LoggedSet = {
  reps: number | null;
  weight_kg: number | null;
  /** Logged seconds for a timed set; null for lifts (and on databases before the timed-sets migration). */
  duration_seconds: number | null;
  completed_at: string | null;
  set_number?: number | null;
};

/** The library exercise a logged exercise counts as. */
export type LibraryMuscles = { id: string; name: string; primary_muscle: string | null; secondary_muscles: readonly string[] | null };

export type LoggedExercise = {
  /** workout_session_exercises.id */
  id: string;
  /** The library id as logged; null for a free-text exercise. */
  exercise_id: string | null;
  /** The name as logged. */
  name: string;
  /** Set for a timed movement (a hold, a stretch, cardio). */
  target_duration_seconds: number | null;
  /** Its catalogue row (merged duplicates read as their survivor); null when not linked or no longer in the library. */
  library: LibraryMuscles | null;
  sets: LoggedSet[];
};

export type LoggedSession = {
  id: string;
  name: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  exercises: LoggedExercise[];
};

function timeOf(value: string | null | undefined): number | null {
  if (typeof value !== "string" || !value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/** A set that counts: ticked as completed (a real timestamp) with reps or seconds logged. */
export function isCountedSet(set: Pick<LoggedSet, "reps" | "completed_at"> & { duration_seconds?: number | null }): boolean {
  return timeOf(set.completed_at) !== null && (Number(set.reps) > 0 || Number(set.duration_seconds) > 0);
}

/** A session whose sets count: finished as completed. Abandoned and in-progress sessions never count. */
export function isCountedSession(session: { status?: string | null }): boolean {
  return session.status === "completed";
}

// ---------------------------------------------------------------- periods

export const MUSCLE_PERIODS = ["today", "week", "four_weeks", "all"] as const;
export type MusclePeriod = (typeof MUSCLE_PERIODS)[number];
export const MUSCLE_PERIOD_LABELS: Readonly<Record<MusclePeriod, string>> = {
  today: "Today", week: "This week", four_weeks: "Last 4 weeks", all: "All time",
};

/** A time window [start, end): null means open on that side. */
export type PeriodRange = { start: Date | null; end: Date | null };

/** Local midnight `days` days after the local day of `date` (DST-safe). */
function localDayStart(date: Date, days = 0): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/**
 * The window of a period on the local calendar: today; this week (from Monday); the last 4 weeks (this
 * week and the three before it, from Monday); all time.
 */
export function musclePeriodRange(period: MusclePeriod, now = new Date()): PeriodRange {
  if (period === "today") return { start: localDayStart(now), end: localDayStart(now, 1) };
  const monday = weekStart(now);
  if (period === "week") return { start: monday, end: localDayStart(monday, 7) };
  if (period === "four_weeks") return { start: localDayStart(monday, -21), end: localDayStart(monday, 7) };
  return { start: null, end: null };
}

/** A period from a URL value; anything else gives `fallback`. */
export function parseMusclePeriod(value: string | null | undefined, fallback: MusclePeriod = "week"): MusclePeriod {
  return (MUSCLE_PERIODS as readonly string[]).includes(value ?? "") ? (value as MusclePeriod) : fallback;
}

function inRange(time: number, range: PeriodRange): boolean {
  return (!range.start || time >= range.start.getTime()) && (!range.end || time < range.end.getTime());
}

// ---------------------------------------------------------------- summaries

export type MuscleRole = "primary" | "secondary";
export type RegionExercise = { id: string; name: string; sets: number; role: MuscleRole };
export type RegionSession = { id: string; name: string; startedAt: string; primarySets: number; secondarySets: number };

export type RegionHistory = {
  region: RegionKey;
  label: string;
  /** Counted sets of exercises with this region as their primary muscle ("direct sets"). */
  primarySets: number;
  /** Counted sets of exercises that work it as a secondary muscle ("assisting"). */
  secondarySets: number;
  /** Weighted load: 1 per direct set, 0.5 per assisting set. */
  load: number;
  /** Percent of the period's total load (all regions add up to 100 when anything was trained). */
  share: number;
  /** 0..1 relative to the period's busiest region, for the heat map. */
  level: number;
  /** Completed sessions with at least one counted set for it. */
  sessions: number;
  /** The latest local day (YYYY-MM-DD) one of its counted sets was logged; null when none in the period. */
  lastTrainedOn: string | null;
  /** The exercises behind it, most sets first. */
  exercises: RegionExercise[];
  /** The sessions behind it, newest first. */
  sessionList: RegionSession[];
};

export type UnmappedReason = "not_linked" | "not_in_library" | "no_muscles";
export type UnmappedExercise = { id: string | null; name: string; sets: number; reason: UnmappedReason };

export type MuscleSummary = {
  /** The window, as ISO instants (null: open). */
  start: string | null;
  end: string | null;
  regions: Record<RegionKey, RegionHistory>;
  /** Regions with any load, busiest first (ties in body order). */
  ranked: RegionHistory[];
  /** Every counted set in the window, mapped or not. */
  sets: number;
  /** Counted sets of exercises that reach at least one region. */
  mappedSets: number;
  /** Completed sessions with a counted set in the window. */
  sessions: number;
  /** Local days with a counted set, oldest first. */
  days: string[];
  /** Counted work no region could take: shown as "1 exercise isn't mapped to a muscle". */
  unmapped: { sets: number; exercises: UnmappedExercise[] };
};

function emptyRegion(region: RegionKey): RegionHistory {
  return {
    region, label: REGIONS[region].label, primarySets: 0, secondarySets: 0, load: 0, share: 0, level: 0,
    sessions: 0, lastTrainedOn: null, exercises: [], sessionList: [],
  };
}

const laterDay = (a: string | null, b: string) => (a === null || b > a ? b : a);

/**
 * Per-region totals for the counted sets in a window (default: all time). Sessions that are not completed,
 * sets that do not count and sets outside the window are left out.
 */
export function summariseMuscles(sessions: readonly LoggedSession[], range: PeriodRange = { start: null, end: null }): MuscleSummary {
  const regions = Object.fromEntries(BODY_REGIONS.map((key) => [key, emptyRegion(key)])) as Record<RegionKey, RegionHistory>;
  const exerciseSets = new Map<RegionKey, Map<string, RegionExercise>>();
  const sessionSets = new Map<RegionKey, Map<string, RegionSession>>();
  const unmapped = new Map<string, UnmappedExercise>();
  const entries: MuscleLoadEntry[] = [];
  const days = new Set<string>();
  const countedSessions = new Set<string>();
  let sets = 0;
  let mappedSets = 0;

  for (const session of sessions) {
    if (!isCountedSession(session)) continue;
    for (const exercise of session.exercises ?? []) {
      const counted = (exercise.sets ?? []).flatMap((set) => {
        if (!isCountedSet(set)) return [];
        const time = timeOf(set.completed_at)!;
        return inRange(time, range) ? [time] : [];
      });
      if (!counted.length) continue;
      const n = counted.length;
      sets += n;
      countedSessions.add(session.id);
      const exerciseDays = counted.map((time) => localDateKey(new Date(time)));
      for (const day of exerciseDays) days.add(day);
      const latest = exerciseDays.reduce((max, day) => (day > max ? day : max));

      const library = exercise.library;
      const { primary, secondary } = library ? exerciseRegions(library.primary_muscle, library.secondary_muscles) : { primary: [], secondary: [] };
      if (!library || (!primary.length && !secondary.length)) {
        const reason: UnmappedReason = !exercise.exercise_id ? "not_linked" : !library ? "not_in_library" : "no_muscles";
        const id = library?.id ?? (exercise.exercise_id ? survivingExerciseId(exercise.exercise_id) : null);
        const key = id ?? `name:${exercise.name.trim().toLowerCase()}`;
        const entry = unmapped.get(key) ?? { id, name: library?.name ?? exercise.name, sets: 0, reason };
        entry.sets += n;
        unmapped.set(key, entry);
        continue;
      }
      mappedSets += n;
      entries.push({ primary: library.primary_muscle, secondary: library.secondary_muscles, sets: n });
      const credit = (region: RegionKey, role: MuscleRole) => {
        const history = regions[region];
        if (role === "primary") history.primarySets += n;
        else history.secondarySets += n;
        history.lastTrainedOn = laterDay(history.lastTrainedOn, latest);
        const byExercise = exerciseSets.get(region) ?? new Map<string, RegionExercise>();
        const item = byExercise.get(library.id) ?? { id: library.id, name: library.name, sets: 0, role };
        item.sets += n;
        byExercise.set(library.id, item);
        exerciseSets.set(region, byExercise);
        const bySession = sessionSets.get(region) ?? new Map<string, RegionSession>();
        const visit = bySession.get(session.id) ?? { id: session.id, name: session.name, startedAt: session.started_at, primarySets: 0, secondarySets: 0 };
        if (role === "primary") visit.primarySets += n;
        else visit.secondarySets += n;
        bySession.set(session.id, visit);
        sessionSets.set(region, bySession);
      };
      for (const region of primary) credit(region, "primary");
      for (const region of secondary) credit(region, "secondary");
    }
  }

  const load = muscleLoad(entries);
  const share = loadShare(load);
  const level = loadLevels(load);
  for (const key of BODY_REGIONS) {
    const history = regions[key];
    history.load = load[key];
    history.share = share[key];
    history.level = level[key];
    history.exercises = [...(exerciseSets.get(key)?.values() ?? [])]
      .sort((a, b) => b.sets - a.sets || Number(a.role === "secondary") - Number(b.role === "secondary") || a.name.localeCompare(b.name));
    history.sessionList = [...(sessionSets.get(key)?.values() ?? [])]
      .sort((a, b) => (timeOf(b.startedAt) ?? 0) - (timeOf(a.startedAt) ?? 0) || a.id.localeCompare(b.id));
    history.sessions = history.sessionList.length;
  }
  const order = new Map(BODY_REGIONS.map((key, index) => [key, index]));
  return {
    start: range.start ? range.start.toISOString() : null,
    end: range.end ? range.end.toISOString() : null,
    regions,
    ranked: BODY_REGIONS.map((key) => regions[key]).filter((history) => history.load > 0)
      .sort((a, b) => b.load - a.load || (order.get(a.region) ?? 0) - (order.get(b.region) ?? 0)),
    sets,
    mappedSets,
    sessions: countedSessions.size,
    days: [...days].sort(),
    unmapped: { sets: [...unmapped.values()].reduce((sum, item) => sum + item.sets, 0), exercises: [...unmapped.values()].sort((a, b) => b.sets - a.sets || a.name.localeCompare(b.name)) },
  };
}

/** The four standard periods at once. */
export function summariseMusclePeriods(sessions: readonly LoggedSession[], now = new Date()): Record<MusclePeriod, MuscleSummary> {
  return Object.fromEntries(MUSCLE_PERIODS.map((period) => [period, summariseMuscles(sessions, musclePeriodRange(period, now))])) as Record<MusclePeriod, MuscleSummary>;
}

/**
 * The regions trained directly (as an exercise's primary muscle) in a summary, most direct sets first, ties
 * in body order. With `includeAssisting`, regions only worked as a secondary muscle follow.
 */
export function regionsTrained(summary: MuscleSummary, options: { includeAssisting?: boolean } = {}): RegionKey[] {
  const order = new Map(BODY_REGIONS.map((key, index) => [key, index]));
  const direct = BODY_REGIONS.filter((key) => summary.regions[key].primarySets > 0)
    .sort((a, b) => summary.regions[b].primarySets - summary.regions[a].primarySets || (order.get(a) ?? 0) - (order.get(b) ?? 0));
  if (!options.includeAssisting) return direct;
  const assisting = BODY_REGIONS.filter((key) => summary.regions[key].primarySets === 0 && summary.regions[key].secondarySets > 0)
    .sort((a, b) => summary.regions[b].secondarySets - summary.regions[a].secondarySets || (order.get(a) ?? 0) - (order.get(b) ?? 0));
  return [...direct, ...assisting];
}

export type WeekRegionSets = { weekStart: string; regions: Record<RegionKey, { primarySets: number; secondarySets: number }> };

/** Direct and assisting sets per region for each of the last `weeks` Monday weeks (this one last). */
export function weeklyRegionSets(sessions: readonly LoggedSession[], options: { weeks?: number; now?: Date } = {}): WeekRegionSets[] {
  const weeks = Math.max(1, Math.min(104, Math.round(options.weeks ?? 12)));
  const monday = weekStart(options.now ?? new Date());
  return Array.from({ length: weeks }, (_, index) => {
    const start = localDayStart(monday, -7 * (weeks - 1 - index));
    const summary = summariseMuscles(sessions, { start, end: localDayStart(start, 7) });
    const regions = Object.fromEntries(BODY_REGIONS.map((key) => [key, { primarySets: summary.regions[key].primarySets, secondarySets: summary.regions[key].secondarySets }])) as WeekRegionSets["regions"];
    return { weekStart: localDateKey(start), regions };
  });
}

// ---------------------------------------------------------------- loading

type Db = Pick<SupabaseClient, "from">;

export type MuscleHistoryResult = {
  /** Set when a request failed; `sessions` then holds nothing. */
  error: unknown | null;
  /** Completed sessions, newest first, with their exercises, sets and catalogue muscles. */
  sessions: LoggedSession[];
  /** True when more completed sessions exist than `maxSessions` allowed. */
  truncated: boolean;
};

export type MuscleHistoryOptions = {
  /** Only sessions that could hold sets from this instant on (they started at most a day before it). */
  since?: Date | null;
  /** At most this many sessions, newest first (default 1000). */
  maxSessions?: number;
};

const SESSION_COLUMNS = "id,name,status,started_at,completed_at";
/** Added by 20261115110000_fitx_workout_prescription_targets.sql; read when the database has them. */
const OPTIONAL_COLUMNS = ["target_duration_seconds", "duration_seconds"];
const SESSION_PAGE = 50;
const ID_CHUNK = 100;
const SET_CHUNK = 30;
const ROW_PAGE = 1000;

type SetRow = { session_exercise_id?: string; set_number?: number | null; reps: number | null; weight_kg: number | string | null; duration_seconds?: number | null; completed_at: string | null };
type ExerciseRow = { id: string; session_id?: string; exercise_id: string | null; exercise_name: string; target_duration_seconds?: number | null; workout_sets?: SetRow[] | null };
type SessionRow = { id: string; name: string; status: string; started_at: string; completed_at: string | null; workout_session_exercises?: ExerciseRow[] | null };
type LibraryRow = { id: string; name: string; primary_muscle: string | null; secondary_muscles: string[] | null };
type Answer = { data: unknown; error: unknown };

function exerciseColumns(optional: boolean) {
  return optional ? "id,exercise_id,exercise_name,target_duration_seconds" : "id,exercise_id,exercise_name";
}
function setColumns(optional: boolean) {
  return optional ? "set_number,reps,weight_kg,duration_seconds,completed_at" : "set_number,reps,weight_kg,completed_at";
}

const chunks = <T,>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));

const numberOrNull = (value: unknown) => (value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value));

function toSet(row: SetRow): LoggedSet {
  return {
    reps: numberOrNull(row.reps),
    weight_kg: numberOrNull(row.weight_kg),
    duration_seconds: numberOrNull(row.duration_seconds),
    completed_at: typeof row.completed_at === "string" ? row.completed_at : null,
    set_number: numberOrNull(row.set_number),
  };
}

function toExercise(row: ExerciseRow, sets: readonly SetRow[]): LoggedExercise {
  return {
    id: row.id,
    exercise_id: row.exercise_id ?? null,
    name: row.exercise_name ?? "",
    target_duration_seconds: numberOrNull(row.target_duration_seconds),
    library: null,
    sets: [...sets].map(toSet).sort((a, b) => (a.set_number ?? 0) - (b.set_number ?? 0)),
  };
}

/** Pages through a request until a short page; `run(from, to)` must build a fresh request each time. */
async function allRows<T>(run: (from: number, to: number) => PromiseLike<Answer>, pageSize = ROW_PAGE, limit = Number.POSITIVE_INFINITY): Promise<{ rows: T[]; error: unknown | null; more: boolean }> {
  const rows: T[] = [];
  for (let from = 0; from < limit; from += pageSize) {
    const size = Math.min(pageSize, limit - from);
    const { data, error } = await run(from, from + size - 1);
    if (error) return { rows, error, more: false };
    const page = Array.isArray(data) ? (data as T[]) : [];
    rows.push(...page);
    if (page.length < size) return { rows, error: null, more: false };
  }
  return { rows, error: null, more: true };
}

/**
 * The member's completed sessions with every exercise, set and catalogue muscle, newest first. One embedded
 * request per 50 sessions; databases that cannot embed fall back to plain requests, and ones without the
 * timed-sets columns are read without them. The library is read separately (RLS returns active rows only),
 * so merged duplicates find their survivor and removed exercises come back as unmapped.
 */
export async function loadMuscleHistory(db: Db, userId: string, options: MuscleHistoryOptions = {}): Promise<MuscleHistoryResult> {
  const maxSessions = Math.max(1, Math.round(options.maxSessions ?? 1000));
  // A session that started the evening before can still hold sets inside the window.
  const since = options.since ? new Date(options.since.getTime() - 86_400_000).toISOString() : null;
  const sessionQuery = (columns: string, from: number, to: number) => {
    let query = db.from("workout_sessions").select(columns).eq("user_id", userId).eq("status", "completed");
    if (since) query = query.gte("started_at", since);
    return query.order("started_at", { ascending: false }).order("id", { ascending: true }).range(from, to);
  };

  let optional = true;
  let embedded = await allRows<SessionRow>((from, to) => sessionQuery(`${SESSION_COLUMNS},workout_session_exercises(${exerciseColumns(true)},workout_sets(${setColumns(true)}))`, from, to), SESSION_PAGE, maxSessions + 1);
  if (embedded.error && isMissingColumnError(embedded.error, OPTIONAL_COLUMNS)) {
    optional = false;
    embedded = await allRows<SessionRow>((from, to) => sessionQuery(`${SESSION_COLUMNS},workout_session_exercises(${exerciseColumns(false)},workout_sets(${setColumns(false)}))`, from, to), SESSION_PAGE, maxSessions + 1);
  }

  let sessions: LoggedSession[];
  let truncated: boolean;
  if (!embedded.error) {
    truncated = embedded.rows.length > maxSessions;
    sessions = embedded.rows.slice(0, maxSessions).map((row) => ({
      id: row.id, name: row.name, status: row.status, started_at: row.started_at, completed_at: row.completed_at ?? null,
      exercises: (row.workout_session_exercises ?? []).map((exercise) => toExercise(exercise, exercise.workout_sets ?? [])),
    }));
  } else if (isMissingRelationshipError(embedded.error)) {
    const plain = await loadPlain(db, userId, sessionQuery, maxSessions, optional);
    if (plain.error) return { error: plain.error, sessions: [], truncated: false };
    sessions = plain.sessions;
    truncated = plain.truncated;
  } else {
    return { error: embedded.error, sessions: [], truncated: false };
  }

  const library = await loadLibraryMuscles(db, sessions.flatMap((session) => session.exercises.map((exercise) => exercise.exercise_id)));
  if (library.error) return { error: library.error, sessions: [], truncated: false };
  for (const session of sessions) {
    for (const exercise of session.exercises) {
      exercise.library = exercise.exercise_id ? library.rows.get(survivingExerciseId(exercise.exercise_id)) ?? null : null;
    }
  }
  return { error: null, sessions, truncated };
}

/** Sessions, then their exercises, then their sets, for databases where the embedded request fails. */
async function loadPlain(
  db: Db,
  userId: string,
  sessionQuery: (columns: string, from: number, to: number) => PromiseLike<Answer>,
  maxSessions: number,
  optionalAtStart: boolean,
): Promise<{ error: unknown | null; sessions: LoggedSession[]; truncated: boolean }> {
  const head = await allRows<SessionRow>((from, to) => sessionQuery(SESSION_COLUMNS, from, to), SESSION_PAGE, maxSessions + 1);
  if (head.error) return { error: head.error, sessions: [], truncated: false };
  const rows = head.rows.slice(0, maxSessions);
  let optional = optionalAtStart;
  const exerciseRows: ExerciseRow[] = [];
  for (const ids of chunks(rows.map((row) => row.id), ID_CHUNK)) {
    const run = (withOptional: boolean) => allRows<ExerciseRow>((from, to) => db.from("workout_session_exercises")
      .select(`session_id,${exerciseColumns(withOptional)}`).eq("user_id", userId).in("session_id", ids).order("id", { ascending: true }).range(from, to));
    let page = await run(optional);
    if (page.error && optional && isMissingColumnError(page.error, OPTIONAL_COLUMNS)) { optional = false; page = await run(false); }
    if (page.error) return { error: page.error, sessions: [], truncated: false };
    exerciseRows.push(...page.rows);
  }
  const setRows: SetRow[] = [];
  for (const ids of chunks(exerciseRows.map((row) => row.id), SET_CHUNK)) {
    const run = (withOptional: boolean) => allRows<SetRow>((from, to) => db.from("workout_sets")
      .select(`session_exercise_id,${setColumns(withOptional)}`).eq("user_id", userId).in("session_exercise_id", ids).not("completed_at", "is", null).order("id", { ascending: true }).range(from, to));
    let page = await run(optional);
    if (page.error && optional && isMissingColumnError(page.error, OPTIONAL_COLUMNS)) { optional = false; page = await run(false); }
    if (page.error) return { error: page.error, sessions: [], truncated: false };
    setRows.push(...page.rows);
  }
  const setsByExercise = new Map<string, SetRow[]>();
  for (const set of setRows) {
    const list = setsByExercise.get(set.session_exercise_id ?? "") ?? [];
    list.push(set);
    setsByExercise.set(set.session_exercise_id ?? "", list);
  }
  const exercisesBySession = new Map<string, LoggedExercise[]>();
  for (const row of exerciseRows) {
    const list = exercisesBySession.get(row.session_id ?? "") ?? [];
    list.push(toExercise(row, setsByExercise.get(row.id) ?? []));
    exercisesBySession.set(row.session_id ?? "", list);
  }
  return {
    error: null,
    truncated: head.rows.length > maxSessions,
    sessions: rows.map((row) => ({
      id: row.id, name: row.name, status: row.status, started_at: row.started_at, completed_at: row.completed_at ?? null,
      exercises: exercisesBySession.get(row.id) ?? [],
    })),
  };
}

/** Catalogue muscles for logged exercise ids, keyed by surviving id. Inactive rows are not readable (RLS). */
export async function loadLibraryMuscles(db: Db, exerciseIds: ReadonlyArray<string | null>): Promise<{ error: unknown | null; rows: Map<string, LibraryMuscles> }> {
  const ids = [...new Set(exerciseIds.filter((id): id is string => typeof id === "string" && id.length > 0).map(survivingExerciseId))];
  const rows = new Map<string, LibraryMuscles>();
  for (const chunk of chunks(ids, ID_CHUNK)) {
    const { data, error } = await db.from("exercise_library").select("id,name,primary_muscle,secondary_muscles").in("id", chunk);
    if (error) return { error, rows: new Map() };
    for (const row of (Array.isArray(data) ? data : []) as LibraryRow[]) {
      rows.set(row.id, { id: row.id, name: row.name, primary_muscle: row.primary_muscle ?? null, secondary_muscles: Array.isArray(row.secondary_muscles) ? row.secondary_muscles : [] });
    }
  }
  return { error: null, rows };
}
