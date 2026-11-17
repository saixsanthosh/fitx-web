"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CalendarDays, Check, Clock3, Copy, Dumbbell, History, Home, Info, LayoutGrid, Pencil, Plus, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import { PageHeading } from "@/components/app/PageHeading";
import { EmptyState } from "@/components/app/EmptyState";
import { FocusTiles } from "@/components/training/FocusTiles";
import { BuilderRow } from "@/components/workouts/BuilderRow";
import { EquipmentPicker } from "@/components/workouts/EquipmentPicker";
import { ExerciseInfoSheet } from "@/components/workouts/ExerciseInfoSheet";
import { LibraryPicker } from "@/components/workouts/LibraryPicker";
import { PlanPreviewSheet } from "@/components/workouts/PlanPreviewSheet";
import { ProgrammeBrowser } from "@/components/workouts/ProgrammeBrowser";
import { ProgrammeCard } from "@/components/workouts/ProgrammeCard";
import { Sheet } from "@/components/workouts/Sheet";
import { SwapSheet } from "@/components/workouts/SwapSheet";
import { programmeById } from "@/data/programmes";
import { programmeMeta } from "@/data/programmes/meta";
import { createClient } from "@/lib/supabase/client";
import { localDateKey, readableDate } from "@/lib/domain/dates";
import { columnList, hasValuesIn, isMissingColumnError, isMissingFunctionError, isMissingRelationshipError, payloadFor, withOptionalColumns } from "@/lib/domain/schema-fallback";
import { timedItemDay } from "@/lib/domain/todo";
import type { CatalogExercise } from "@/lib/training/catalog";
import { equipmentFor, loadCatalog, loadEquipmentProfiles, loadProgrammes, saveEquipmentProfile, type EquipmentProfiles } from "@/lib/training/data";
import { enrolInProgramme, finishProgramme, leaveProgramme, loadCurrentEnrolment, loadEnrolmentPlans, pauseProgramme, programmeShortTitle, resumeProgramme, scheduleProgrammeDays, topUpProgrammeDays, topUpWindow, type Enrolment, type ProgrammePlan } from "@/lib/training/enrolment";
import { equipmentLabel, expandOwnedEquipment } from "@/lib/training/equipment";
import { bestSet, formatBestSet, loadExerciseHistory, previousPerformance } from "@/lib/training/exercise-history";
import { survivingExerciseId } from "@/lib/training/exercise-merges";
import { focusCounts, listFocusAreas, parseFocusParam, type FocusArea } from "@/lib/training/focus";
import { generateDay, generateFocusDay } from "@/lib/training/generator";
import { contextForLocation, planSummary } from "@/lib/training/plan-summary";
import { splitProgrammeId, type Programme } from "@/lib/training/programmes";
import { readPlanExercises, startFailureMessage, startPlanSession, type PlanExerciseRow } from "@/lib/training/plans";
import { stripRange, targetSessions } from "@/lib/training/programme-calendar";
import { plannerEventForStart, startLinkFrom, type StartLink } from "@/lib/training/start-link";
import { LEVELS, type Level, type TrainingContext } from "@/lib/training/taxonomy";
import { PLANNER_DAY_COLUMNS, PRESCRIPTION_TARGET_COLUMNS } from "./_lib/workout-columns";
import { MAX_PLAN_EXERCISES, moveRow, plannedFrom, removeRow, selectedIds, swapRow, toggleRow, type PlannedExercise } from "./_lib/builder-rows";
import { plannerEventsForPlan, plannerScheduleChange } from "./_lib/plan-schedule";
import { FIRST_PLAN_PAGE, composePlanPage, mergePlansById, planCardStatus, planPageRequests, planSegmentSpec, type PlanPageCursor, type PlanSegmentRequest } from "./_lib/plan-list";
import styles from "./Workouts.module.css";

/** `last_done_key`: local day of the plan's latest finished session, or null when none is known. */
type PlanRow = { id: string; title: string; planned_for: string | null; status: string; split: string; last_done_key: string | null };
type PlanListRow = Omit<PlanRow, "last_done_key"> & { workout_sessions?: Array<{ started_at: string }> | null };
type SupabaseBrowserClient = NonNullable<ReturnType<typeof createClient>>;
type SessionRow = { id: string; name: string; started_at: string; duration_seconds: number; total_volume: number; status: string; plan_id?: string | null };
type WorkoutPreferences = { workout_location?: string; equipment?: string[] | null; fitness_level?: string; session_duration_minutes?: number; workout_split?: string };
type WorkoutCounts = { completed: number | null; plans: number | null; exercises: number | null };
/** How a new workout is put together: from body areas, from the member's split (a programme day), or by hand. */
type BuilderMode = "focus" | "auto" | "custom";

const PLAN_PAGE_SIZE = 30;
const PLAN_LIST_STATUSES = ["draft", "scheduled"];
const PLAN_LIST_COLUMNS = "id,title,planned_for,status,split";
// Each plan's latest finished session, for the "Done" label: one embedded row per plan.
const PLAN_LAST_DONE_EMBED = "workout_sessions(started_at)";
const HISTORY_LIMIT = 6;
const TARGETS_UNAVAILABLE_NOTICE = "Weight and time targets aren’t available yet while FITX finishes an update. Sets, reps, rest and exercise order still save as usual.";
const BUILDER_MODES: ReadonlyArray<[BuilderMode, string]> = [["focus", "Body areas"], ["auto", "Your split"], ["custom", "Blank"]];

/** "Done" in the success colour; the other statuses stay neutral. */
function PlanStatusChip({ status }: { status: ReturnType<typeof planCardStatus> }) {
  return <span className={status === "Done" ? "rounded-sm bg-fitx-success/10 px-2 py-1 text-[10px] font-medium text-fitx-success" : "rounded-sm bg-fitx-surface-variant px-2 py-1 text-[10px] text-fitx-text-secondary"}>{status}</span>;
}

/** An exact total, or a dash when the count could not be loaded. */
function CountValue({ value }: { value: number | null }) {
  if (value === null) return <><span aria-hidden="true">—</span><span className="sr-only">Not available right now</span></>;
  return <>{value.toLocaleString()}</>;
}
function toPlannedExercise(row: PlanExerciseRow, exercise: CatalogExercise): PlannedExercise {
  return { exercise, sort_order: row.sort_order, target_sets: row.target_sets, reps_min: row.reps_min, reps_max: row.reps_max, rest_seconds: row.rest_seconds, target_weight_kg: row.target_weight_kg ?? null, target_duration_seconds: row.target_duration_seconds ?? null };
}
function toPlanRow(row: PlanListRow): PlanRow {
  const lastDone = row.workout_sessions?.[0]?.started_at;
  return { id: row.id, title: row.title, planned_for: row.planned_for, status: row.status, split: row.split, last_done_key: lastDone ? localDateKey(new Date(lastDone)) : null };
}
function asLevel(value: string | undefined): Level {
  return (LEVELS as readonly string[]).includes(value ?? "") ? (value as Level) : "beginner";
}

function programmeNotice(created: number, unfilled: readonly string[], error: unknown) {
  if (error && !created) return "The programme days couldn’t be planned. Use “Plan the next 7 days” to try again.";
  const planned = created ? `Planned ${created} workout${created === 1 ? "" : "s"} for the next 7 days.` : "None of your training days fall in the next 7 days.";
  const gaps = unfilled.length ? ` Nothing in the library fits ${unfilled.join(", ").toLowerCase()} with your equipment, so ${unfilled.length === 1 ? "it was" : "those were"} left out.` : "";
  return planned + gaps + (error ? " Some days couldn’t be planned; try “Plan the next 7 days” again." : "");
}

/** "Last time (12 Nov): 3 sets, best 60 kg × 8", from the member's latest completed session with the exercise. */
function lastTimeLine(sessions: Parameters<typeof previousPerformance>[0]): string | null {
  const last = previousPerformance(sessions);
  if (!last) return null;
  const best = bestSet(last.sets, last.timed);
  const date = readableDate(new Date(last.startedAt), { day: "numeric", month: "short" });
  return `Last time (${date}): ${last.sets.length} set${last.sets.length === 1 ? "" : "s"}${best ? `, best ${formatBestSet(best)}` : ""}`;
}

/**
 * The programme an enrolment follows: as loaded, else the copy bundled with the app (a member can still
 * read a programme they follow after it is unpublished, but an older database may not allow that yet).
 */
function followedProgramme(programmes: readonly Programme[], enrolment: Pick<Enrolment, "programme_id"> | null): Programme | undefined {
  if (!enrolment) return undefined;
  return programmes.find((programme) => programme.id === enrolment.programme_id) ?? programmeById(enrolment.programme_id);
}

/** Programme days are listed in the programme card, not here; until that column exists, every plan shows. */
const PROGRAMME_PLAN_COLUMNS = ["programme_enrolment_id"];

/** A plan query with, when `withLastDone`, each plan's latest finished session embedded. */
function planListQuery(supabase: SupabaseBrowserClient, uid: string, withLastDone: boolean, onlyOwnPlans = true) {
  const base = supabase.from("workout_plans").select(withLastDone ? `${PLAN_LIST_COLUMNS},${PLAN_LAST_DONE_EMBED}` : PLAN_LIST_COLUMNS).eq("user_id", uid).in("status", PLAN_LIST_STATUSES);
  const query = onlyOwnPlans ? base.is("programme_enrolment_id", null) : base;
  return withLastDone
    ? query.eq("workout_sessions.status", "completed").order("started_at", { referencedTable: "workout_sessions", ascending: false }).limit(1, { referencedTable: "workout_sessions" })
    : query;
}

function planSegmentQuery(supabase: SupabaseBrowserClient, uid: string, todayKey: string, request: PlanSegmentRequest, withLastDone: boolean, onlyOwnPlans: boolean) {
  const spec = planSegmentSpec(request.segment, todayKey);
  let query = planListQuery(supabase, uid, withLastDone, onlyOwnPlans);
  query = spec.filter.op === "is" ? query.is("planned_for", null) : spec.filter.op === "gte" ? query.gte("planned_for", spec.filter.value) : query.lt("planned_for", spec.filter.value);
  for (const order of spec.order) query = query.order(order.column, { ascending: order.ascending });
  return query.range(request.from, request.to);
}

/**
 * One page of "Your plans": upcoming first, then undated, then past (see _lib/plan-list.ts).
 * If the database cannot embed the latest session, the page loads without the "Done" labels.
 */
async function fetchPlanPage(supabase: SupabaseBrowserClient, uid: string, todayKey: string, cursor: PlanPageCursor) {
  const requests = planPageRequests(cursor, PLAN_PAGE_SIZE);
  const run = (withLastDone: boolean, onlyOwnPlans: boolean) => Promise.all(requests.map((request) => planSegmentQuery(supabase, uid, todayKey, request, withLastDone, onlyOwnPlans)));
  let withLastDone = true;
  let onlyOwnPlans = true;
  let responses = await run(withLastDone, onlyOwnPlans);
  for (let attempt = 0; attempt < 2; attempt++) {
    if (onlyOwnPlans && responses.some((response) => isMissingColumnError(response.error, PROGRAMME_PLAN_COLUMNS))) onlyOwnPlans = false;
    else if (withLastDone && responses.some((response) => isMissingRelationshipError(response.error))) withLastDone = false;
    else break;
    responses = await run(withLastDone, onlyOwnPlans);
  }
  const failed = responses.find((response) => response.error);
  if (failed) return { error: failed.error, rows: [] as PlanRow[], next: cursor as PlanPageCursor | null };
  const page = composePlanPage(requests.map((request, index) => ({ segment: request.segment, from: request.from, rows: (responses[index].data || []) as unknown as PlanListRow[] })), PLAN_PAGE_SIZE);
  return { error: null, rows: page.rows.map(toPlanRow), next: page.next };
}

/** A single listed plan by id, for the dashboard's ?plan= link when it is not on the first page. */
async function fetchPlanById(supabase: SupabaseBrowserClient, uid: string, planId: string) {
  let result = await planListQuery(supabase, uid, true, false).eq("id", planId).maybeSingle();
  if (isMissingRelationshipError(result.error)) result = await planListQuery(supabase, uid, false, false).eq("id", planId).maybeSingle();
  return result.error || !result.data ? null : toPlanRow(result.data as unknown as PlanListRow);
}

/** Exercise id -> days since the user last trained it, from the last two weeks, for variety. */
async function fetchRecentExerciseDays(supabase: SupabaseBrowserClient, uid: string): Promise<Map<string, number>> {
  const since = new Date(Date.now() - 14 * 86400000);
  const result = await supabase.from("workout_session_exercises").select("exercise_id,created_at").eq("user_id", uid).gte("created_at", since.toISOString()).order("created_at", { ascending: false }).limit(300);
  const days = new Map<string, number>();
  for (const row of (result.data ?? []) as Array<{ exercise_id: string | null; created_at: string }>) {
    if (row.exercise_id && !days.has(row.exercise_id)) days.set(row.exercise_id, Math.floor((Date.now() - Date.parse(row.created_at)) / 86400000));
  }
  return days;
}

export default function WorkoutsPage() {
  const builderRef = useRef<HTMLDivElement>(null);
  const [userId, setUserId] = useState("");
  const [catalog, setCatalog] = useState<CatalogExercise[]>([]);
  const [catalogCurated, setCatalogCurated] = useState(true);
  const [preferences, setPreferences] = useState<WorkoutPreferences>({});
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [activeSession, setActiveSession] = useState<SessionRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [mode, setMode] = useState<BuilderMode>("auto");
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  // The edited plan's date when it was opened: its own planner event is the one on that day.
  const [editingPlannedFor, setEditingPlannedFor] = useState<string | null>(null);
  const [title, setTitle] = useState("Training session");
  const [planNotes, setPlanNotes] = useState("");
  const [split, setSplit] = useState("full_body");
  const [planLocation, setPlanLocation] = useState("gym");
  const [plannedFor, setPlannedFor] = useState(() => localDateKey());
  const [time, setTime] = useState("18:00");
  // The plan being built, in order; the ticked library exercises are read from it.
  const [preview, setPreview] = useState<PlannedExercise[]>([]);
  const selected = useMemo(() => selectedIds(preview), [preview]);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState("");
  const [counts, setCounts] = useState<WorkoutCounts>({ completed: null, plans: null, exercises: null });
  // Whether workout_plan_exercises has the weight and time target columns: null until known.
  const [targetsSupported, setTargetsSupported] = useState<boolean | null>(null);
  const [notice, setNotice] = useState("");
  // The plan list is paged; `listDayKey` is the "today" its segments and labels were built with.
  const [planCursor, setPlanCursor] = useState<PlanPageCursor | null>(null);
  const [loadingMorePlans, setLoadingMorePlans] = useState(false);
  const [listDayKey, setListDayKey] = useState("");
  // Workouts v2: Home and Gym, equipment lists, programmes, variety and swaps.
  const [context, setContext] = useState<TrainingContext>("gym");
  const [profiles, setProfiles] = useState<EquipmentProfiles>({ home: null, gym: null, available: false });
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [enrolAvailable, setEnrolAvailable] = useState(false);
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [programmePlans, setProgrammePlans] = useState<ProgrammePlan[]>([]);
  const [recentDays, setRecentDays] = useState<Map<string, number>>(() => new Map());
  const [programmeBusy, setProgrammeBusy] = useState(false);
  // The next programme days are being planned in the background (see topUpProgrammeDays).
  const [planningAhead, setPlanningAhead] = useState(false);
  // A list that failed to load is not shown as empty: saving the equipment list, following a programme
  // and planning its next week wait for a load that worked, so nothing saved is overwritten or doubled.
  const [equipmentLoadFailed, setEquipmentLoadFailed] = useState(false);
  const [programmeLoadFailed, setProgrammeLoadFailed] = useState(false);
  const [equipmentEditor, setEquipmentEditor] = useState<{ context: TrainingContext; keys: string[] } | null>(null);
  const [equipmentSaving, setEquipmentSaving] = useState(false);
  const [swapIndex, setSwapIndex] = useState<number | null>(null);
  const [autoDay, setAutoDay] = useState(0);
  const [autoSeed, setAutoSeed] = useState(0);
  const [autoNote, setAutoNote] = useState("");
  const [focusAreas, setFocusAreas] = useState<FocusArea[]>([]);
  // The body-area tiles take most of a phone screen: open while choosing, folded into one line after.
  const [focusPickerOpen, setFocusPickerOpen] = useState(true);
  // The plan whose preview is open (where every plan and programme day begins), and an exercise's details.
  const [previewPlanId, setPreviewPlanId] = useState<string | null>(null);
  const [infoExercise, setInfoExercise] = useState<CatalogExercise | null>(null);
  // "Last time" lines for the builder's exercises, by exercise id (null: nothing completed yet).
  const [lastTimes, setLastTimes] = useState<ReadonlyMap<string, string | null>>(() => new Map());
  const lastTimeRequested = useRef(new Set<string>());
  const contextInitialized = useRef(false);
  // A ?plan= link opens that plan's preview once, on the first load that finds it.
  const deepLinkHandled = useRef(false);
  // A planner item's Start link (/workouts?plan=<plan>&event=<item>): starting that plan here keeps the item on
  // the session, so finishing ticks it off. Read when the page opens, before the address is reset to /workouts.
  const startLink = useRef<StartLink | null>(null);
  useEffect(() => { startLink.current = startLinkFrom(window.location.search); }, []);

  const load = useCallback(async () => {
    const supabase = createClient();
    if (!supabase) { setError("FITX is not connected to Supabase in this environment."); setLoading(false); return; }
    const auth = await supabase.auth.getUser();
    if (!auth.data.user) { setError("Sign in to manage your workouts."); setLoading(false); return; }
    const uid = auth.data.user.id;
    const todayKey = localDateKey();
    // The dashboard links to /workouts?plan=<id>; that plan is fetched on its own in case it is not on the first page.
    const linkedPlanId = new URLSearchParams(window.location.search).get("plan");
    // A GET (one row at most) rather than HEAD: a HEAD error has no body, so a missing column could not be recognised.
    const planCountQuery = (onlyOwnPlans: boolean) => {
      const query = supabase.from("workout_plans").select("id", { count: "exact" }).eq("user_id", uid).in("status", PLAN_LIST_STATUSES);
      return (onlyOwnPlans ? query.is("programme_enrolment_id", null) : query).limit(1);
    };
    const [catalogResult, preferencesResult, planPage, historyResult, activeResult, completedCount, planCount, exerciseCount, targetsProbe, linkedPlan, profileResult, programmeResult, enrolmentResult, recent] = await Promise.all([
      loadCatalog(supabase),
      supabase.from("user_preferences").select("workout_location,equipment,fitness_level,session_duration_minutes,workout_split").eq("user_id", uid).maybeSingle(),
      fetchPlanPage(supabase, uid, todayKey, FIRST_PLAN_PAGE),
      supabase.from("workout_sessions").select("id,name,started_at,duration_seconds,total_volume,status,plan_id").eq("user_id", uid).eq("status", "completed").order("started_at", { ascending: false }).limit(HISTORY_LIMIT),
      supabase.from("workout_sessions").select("id,name,started_at,duration_seconds,total_volume,status").eq("user_id", uid).eq("status", "in_progress").order("started_at", { ascending: false }).limit(1).maybeSingle(),
      // Exact totals for the tiles; the lists above stay short. Programme days are counted in the programme card.
      supabase.from("workout_sessions").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("status", "completed"),
      withOptionalColumns(PROGRAMME_PLAN_COLUMNS, (include) => planCountQuery(include)),
      supabase.from("exercise_library").select("id", { count: "exact", head: true }).eq("is_active", true),
      // Finds out before the builder opens whether weight and time targets can be saved.
      supabase.from("workout_plan_exercises").select(PRESCRIPTION_TARGET_COLUMNS.join(",")).eq("user_id", uid).limit(1),
      linkedPlanId ? fetchPlanById(supabase, uid, linkedPlanId) : Promise.resolve(null),
      loadEquipmentProfiles(supabase, uid),
      loadProgrammes(supabase),
      loadCurrentEnrolment(supabase, uid),
      fetchRecentExerciseDays(supabase, uid),
    ]);
    const failure = [catalogResult, preferencesResult, planPage, historyResult, activeResult].find((result) => result.error);
    if (failure?.error) { setError("Workouts could not load. Check your connection and try again."); setLoading(false); return; }
    const prefs = (preferencesResult.data || {}) as WorkoutPreferences;
    const currentEnrolment = enrolmentResult.enrolment;
    // The programme card shows a week back (not before the start) to a week ahead.
    const plansFrom = currentEnrolment ? stripRange(todayKey, currentEnrolment.started_on).fromKey : todayKey;
    const enrolmentPlans = currentEnrolment ? await loadEnrolmentPlans(supabase, uid, currentEnrolment.id, plansFrom) : { plans: [], error: null };
    const targetsMissing = Boolean(targetsProbe.error && isMissingColumnError(targetsProbe.error, PRESCRIPTION_TARGET_COLUMNS));
    setUserId(uid);
    setCatalog(catalogResult.exercises);
    setCatalogCurated(catalogResult.curated);
    setPreferences(prefs);
    setProfiles(profileResult.profiles);
    setProgrammes(programmeResult.programmes);
    setEnrolAvailable(programmeResult.enrolAvailable && enrolmentResult.available);
    setEnrolment(currentEnrolment);
    setProgrammePlans(enrolmentPlans.plans);
    setEquipmentLoadFailed(Boolean(profileResult.error));
    setProgrammeLoadFailed(Boolean(enrolmentResult.error || enrolmentPlans.error));
    setRecentDays(recent);
    // The first load opens the section that matches the user's programme or where they said they train.
    if (!contextInitialized.current) {
      contextInitialized.current = true;
      setContext(currentEnrolment?.context ?? (prefs.workout_location === "home" || prefs.workout_location === "outdoor" ? "home" : "gym"));
    }
    // A linked plan from a later page is shown first; it is not repeated when its page loads.
    setPlans(linkedPlan && !planPage.rows.some((plan) => plan.id === linkedPlan.id) ? [linkedPlan, ...planPage.rows] : planPage.rows);
    setPlanCursor(planPage.next);
    setListDayKey(todayKey);
    setSessions((historyResult.data || []) as SessionRow[]);
    setActiveSession(activeResult.data as SessionRow | null);
    // A failed count shows a dash rather than a number it cannot vouch for.
    setCounts({
      completed: completedCount.error ? null : completedCount.count,
      plans: planCount.result.error ? null : planCount.result.count,
      exercises: exerciseCount.error ? null : exerciseCount.count,
    });
    setTargetsSupported((current) => !targetsProbe.error ? true : targetsMissing ? false : current);
    setLoading(false);
    setError("");
    // Home, the week view and To-Do link here with ?plan=: the plan opens in its preview first.
    if (linkedPlanId && !deepLinkHandled.current) {
      deepLinkHandled.current = true;
      if (linkedPlan || enrolmentPlans.plans.some((plan) => plan.id === linkedPlanId)) setPreviewPlanId(linkedPlanId);
    }

    // Keep a followed programme's next 7 days planned, so today's day is on Home, the week view and here. Only from a
    // load that worked: the programme's days (so none is planned twice) and the saved equipment lists (so the
    // exercises fit what the member has).
    const followed = followedProgramme(programmeResult.programmes, currentEnrolment);
    if (!currentEnrolment || currentEnrolment.status !== "active" || !followed || enrolmentPlans.error || profileResult.error || !catalogResult.exercises.length) return;
    const target = targetSessions(currentEnrolment.started_on, currentEnrolment.weekdays, programmeMeta(followed.id)?.lengthDays);
    if (!topUpWindow({ enrolment: currentEnrolment, plans: enrolmentPlans.plans, todayKey, target, dayCount: followed.days.length })) return;
    setPlanningAhead(true);
    const planned = await topUpProgrammeDays(supabase, {
      userId: uid, enrolment: currentEnrolment, programme: followed, catalog: catalogResult.exercises,
      owned: expandOwnedEquipment(equipmentFor(profileResult.profiles, currentEnrolment.context, prefs.equipment).keys),
      level: asLevel(prefs.fitness_level), recentDays: recent, includeTargets: !targetsMissing, plans: enrolmentPlans.plans, todayKey, target,
    });
    setPlanningAhead(false);
    if (!planned.ran) return;
    const fresh = await loadEnrolmentPlans(supabase, uid, currentEnrolment.id, plansFrom);
    if (!fresh.error) setProgrammePlans(fresh.plans);
    if (planned.created > 0) setNotice(`Planned ${planned.created} more programme day${planned.created === 1 ? "" : "s"}, so your next 7 days are ready.`);
    else if (planned.error) setNotice("Your next programme days couldn’t be planned. Use “Plan the next 7 days” to try again.");
  }, []);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("exercise");
    // A link to a merged duplicate adds the exercise it was merged into.
    const exerciseId = requested ? survivingExerciseId(requested) : null;
    if (!exerciseId || !catalog.length || loading) return;
    void Promise.resolve().then(() => {
      const exercise = catalog.find((item) => item.id === exerciseId);
      if (!exercise) return;
      setMode("custom"); setEditingPlanId(null); setTitle("Custom workout"); setPlanNotes(""); setSplit(preferences.workout_split || "full_body"); setPlanLocation(preferences.workout_location || "gym");
      setPlannedFor(localDateKey());
      setPreview([plannedFrom(exercise, 0)]); setAutoNote("");
      setCreatorOpen(true);
      window.history.replaceState(null, "", "/workouts");
    });
  }, [catalog, loading, preferences.workout_split, preferences.workout_location]);

  // /workouts?equipment=home|gym (linked from the exercise library) opens that equipment list.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("equipment");
    if (loading || (requested !== "home" && requested !== "gym")) return;
    void Promise.resolve().then(() => {
      setContext(requested);
      setEquipmentEditor({ context: requested, keys: equipmentFor(profiles, requested, preferences.equipment).keys });
      window.history.replaceState(null, "", "/workouts");
    });
  }, [loading, profiles, preferences.equipment]);

  useEffect(() => {
    const requestedPlanId = new URLSearchParams(window.location.search).get("plan");
    if (!requestedPlanId || !plans.some((plan) => plan.id === requestedPlanId)) return;
    const card = document.getElementById(`workout-plan-${requestedPlanId}`);
    if (!card) return;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    card.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "center" });
    card.classList.add("plan-navigation-target");
    const timeout = window.setTimeout(() => {
      card.classList.remove("plan-navigation-target");
      // Done highlighting: later list changes (Show more plans, a save) must not scroll back here.
      window.history.replaceState(null, "", "/workouts");
    }, 3500);
    return () => { window.clearTimeout(timeout); card.classList.remove("plan-navigation-target"); };
  }, [plans]);

  useEffect(() => {
    if (!creatorOpen) return;
    const dialog = builderRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const getFocusable = () => [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')];
    getFocusable()[0]?.focus();
    function keepFocusInside(event: KeyboardEvent) {
      // A sheet opened over the builder (Swap, an exercise's details) handles its own keys.
      if (document.querySelectorAll('[role="dialog"][aria-modal="true"]').length > 1) return;
      if (event.key === "Escape") { event.preventDefault(); setCreatorOpen(false); return; }
      if (event.key !== "Tab") return;
      const controls = getFocusable();
      if (!controls.length) return;
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", keepFocusInside);
    return () => { document.removeEventListener("keydown", keepFocusInside); previousFocus?.focus(); };
  }, [creatorOpen]);

  // "Last time" for the builder's exercises: the member's latest completed session with each, fetched once per exercise.
  useEffect(() => {
    if (!creatorOpen || !userId) return;
    const wanted = [...new Set(preview.map((row) => row.exercise.id))].filter((id) => !lastTimeRequested.current.has(id));
    if (!wanted.length) return;
    const supabase = createClient();
    if (!supabase) return;
    wanted.forEach((id) => lastTimeRequested.current.add(id));
    void loadExerciseHistory(supabase, userId, wanted, { sessions: 1 }).then((history) => {
      if (history.error) { wanted.forEach((id) => lastTimeRequested.current.delete(id)); return; }
      setLastTimes((current) => {
        const next = new Map(current);
        for (const id of wanted) next.set(id, lastTimeLine(history.byExercise.get(survivingExerciseId(id)) ?? []));
        return next;
      });
    });
  }, [creatorOpen, preview, userId]);

  const level = asLevel(preferences.fitness_level);
  const catalogReady = catalog.length > 0;
  /** The user's equipment for a context, including what their items also serve as. */
  const ownedFor = useCallback((target: TrainingContext) => expandOwnedEquipment(equipmentFor(profiles, target, preferences.equipment).keys), [profiles, preferences.equipment]);
  // The builder's equipment and the focus tiles' counts, worked out again only when their inputs change.
  const builderContext = contextForLocation(planLocation);
  const builderOwned = useMemo(() => ownedFor(builderContext), [ownedFor, builderContext]);
  const focusDetails = useMemo(() => {
    if (!creatorOpen || mode !== "focus") return undefined;
    const details: Partial<Record<FocusArea, string>> = {};
    for (const [area, count] of Object.entries(focusCounts(catalog, builderOwned)) as Array<[FocusArea, { doable: number | null }]>) details[area] = `${(count.doable ?? 0).toLocaleString()} you can do`;
    return details;
  }, [creatorOpen, mode, catalog, builderOwned]);

  /** The authored days an Auto plan draws from: the user's split at the gym, a home track at home. */
  function autoProgramme(target: TrainingContext): Programme | undefined {
    const id = splitProgrammeId(preferences.workout_split, target, ownedFor(target).has("dumbbell"));
    return programmes.find((programme) => programme.id === id) ?? programmes.find((programme) => programme.context === target);
  }

  function generateAuto(target: TrainingContext, dayIndex: number, seed: number) {
    const programme = autoProgramme(target);
    if (!programme?.days.length) return { rows: [] as PlannedExercise[], note: "", programme, title: "Personalized workout" };
    const day = programme.days[dayIndex % programme.days.length];
    const generated = generateDay(day.slots, {
      catalog, owned: ownedFor(target), level, seed: `${localDateKey()}:${programme.id}:${day.key}:${seed}`, context: target,
      recentDays, sessionMinutes: preferences.session_duration_minutes,
    });
    const rows = generated.items.map((item, index): PlannedExercise => ({
      exercise: item.exercise, sort_order: index, target_sets: item.target_sets, reps_min: item.reps_min, reps_max: item.reps_max,
      rest_seconds: item.rest_seconds, target_weight_kg: null, target_duration_seconds: item.target_duration_seconds,
    }));
    const missed = generated.unfilled.map((slot) => (slot.label ?? "one exercise").toLowerCase());
    const note = missed.length ? `Nothing in the library fits ${missed.join(", ")} with your ${target} equipment, so ${missed.length === 1 ? "it was" : "they were"} left out.` : "";
    return { rows, note, programme, title: `${day.title} · ${target === "home" ? "Home" : "Gym"}` };
  }

  function applyAuto(target: TrainingContext, dayIndex: number, seed: number) {
    const auto = generateAuto(target, dayIndex, seed);
    setPreview(auto.rows); setAutoNote(auto.note); setTitle(auto.title);
    if (auto.programme) setSplit(auto.programme.split);
  }

  /** A workout for the chosen body areas with the equipment at `target` (focusSlots through generateFocusDay). */
  function applyFocus(target: TrainingContext, areas: readonly FocusArea[], seed: number) {
    if (!areas.length) { setPreview([]); setAutoNote(""); setTitle("Custom workout"); return; }
    const day = generateFocusDay(areas, {
      catalog, owned: ownedFor(target), level, seed: `${localDateKey()}:focus:${areas.join(",")}:${seed}`, context: target,
      recentDays, sessionMinutes: preferences.session_duration_minutes,
    });
    setPreview(day.items.map((item, index): PlannedExercise => ({
      exercise: item.exercise, sort_order: index, target_sets: item.target_sets, reps_min: item.reps_min, reps_max: item.reps_max,
      rest_seconds: item.rest_seconds, target_weight_kg: null, target_duration_seconds: item.target_duration_seconds,
    })));
    const short = day.short.length ? `Few exercises fit ${listFocusAreas(day.short).toLowerCase()} with your ${target} equipment and level, so ${day.short.length === 1 ? "it has" : "they have"} fewer.` : "";
    setAutoNote(short);
    setTitle(`${listFocusAreas(areas)} · ${target === "home" ? "Home" : "Gym"}`.slice(0, 120));
    setSplit(areas.length === 1 && areas[0] === "full_body" ? "full_body" : "custom");
  }

  function openCreator(nextMode: BuilderMode, target: TrainingContext = context, areas: readonly FocusArea[] = []) {
    setMode(nextMode);
    setEditingPlanId(null);
    setTitle(nextMode === "auto" ? "Personalized workout" : "Custom workout");
    setPlanNotes("");
    setSplit(preferences.workout_split || "full_body");
    setPlanLocation(target === "home" ? "home" : "gym");
    setPlannedFor(localDateKey());
    setTime("18:00");
    setAutoDay(0); setAutoSeed(0); setAutoNote("");
    setFocusAreas([...areas]);
    setFocusPickerOpen(areas.length === 0);
    if (nextMode === "auto") applyAuto(target, 0, 0);
    else if (nextMode === "focus") applyFocus(target, areas, 0);
    else setPreview([]);
    setCreatorOpen(true);
    setError("");
    setNotice("");
  }

  /** Switching how a new workout starts: a split regenerates; body areas regenerate once chosen; Blank keeps the rows. */
  function switchMode(next: BuilderMode) {
    if (next === mode) return;
    setMode(next);
    const target = contextForLocation(planLocation);
    if (next === "auto") applyAuto(target, autoDay, autoSeed);
    else if (next === "focus" && focusAreas.length) applyFocus(target, focusAreas, autoSeed);
    else setAutoNote("");
  }

  // /workouts?focus=chest,arms (the focus vocabulary) opens the builder with those body areas chosen, once the
  // catalogue has loaded. The builder is opened through a ref so the effect runs only when loading finishes.
  const openCreatorRef = useRef(openCreator);
  useEffect(() => { openCreatorRef.current = openCreator; });
  useEffect(() => {
    const areas = parseFocusParam(new URLSearchParams(window.location.search).get("focus"));
    if (!areas.length || !catalogReady || loading) return;
    void Promise.resolve().then(() => {
      openCreatorRef.current("focus", undefined, areas);
      window.history.replaceState(null, "", "/workouts");
    });
  }, [catalogReady, loading]);

  async function repeatSession(session: SessionRow) {
    const supabase = createClient();
    if (!supabase || !userId) return;
    setError(""); setNotice(""); setSaving(true);
    const outcome = await withOptionalColumns(PRESCRIPTION_TARGET_COLUMNS, (include) =>
      supabase.from("workout_session_exercises").select(columnList(["id", "exercise_id", "exercise_name", "sort_order", "target_sets", "reps_min", "reps_max", "rest_seconds"], PRESCRIPTION_TARGET_COLUMNS, include)).eq("session_id", session.id).eq("user_id", userId).order("sort_order"),
    { includeOptional: targetsSupported !== false });
    setSaving(false);
    if (outcome.result.error) return setError("That workout couldn’t be loaded to repeat. Check your connection and try again.");
    const rows = (outcome.result.data || []) as unknown as PlanExerciseRow[];
    const nextPreview = rows.flatMap((row) => {
      const exercise = row.exercise_id ? catalog.find((item) => item.id === survivingExerciseId(row.exercise_id!)) : undefined;
      return exercise ? [toPlannedExercise(row, exercise)] : [];
    }).map((row, sort_order) => ({ ...row, sort_order }));
    if (!nextPreview.length) return setError("The movements from that workout are no longer in the library.");
    setMode("custom"); setEditingPlanId(null); setTitle(session.name); setPlanNotes(""); setSplit(preferences.workout_split || "custom");
    setPlanLocation(context === "home" ? "home" : "gym"); setPlannedFor(localDateKey()); setTime("18:00"); setAutoNote("");
    setPreview(nextPreview); setCreatorOpen(true);
    if (nextPreview.length < rows.length) setNotice(`${rows.length - nextPreview.length} movement${rows.length - nextPreview.length === 1 ? " is" : "s are"} no longer in the library and ${rows.length - nextPreview.length === 1 ? "was" : "were"} left out.`);
  }

  /** Keeps the user's sets and rest; reps or time follow the new movement when its type differs (see swapRow). */
  function swapPreview(index: number, replacement: CatalogExercise) {
    setPreview((rows) => swapRow(rows, index, replacement));
    setSwapIndex(null);
  }

  async function saveEquipment() {
    const supabase = createClient();
    if (!supabase || !userId || !equipmentEditor || equipmentLoadFailed) return;
    setEquipmentSaving(true);
    const result = await saveEquipmentProfile(supabase, userId, equipmentEditor.context, equipmentEditor.keys);
    setEquipmentSaving(false);
    if (result.error) return setError("Your equipment list couldn’t be saved. Check your connection and try again.");
    setProfiles((current) => ({ ...current, [equipmentEditor.context]: equipmentEditor.keys }));
    setEquipmentEditor(null);
  }

  async function enrol(programme: Programme, weekdays: number[], startTime: string): Promise<string | null> {
    const supabase = createClient();
    if (!supabase || !userId) return "FITX is not connected to Supabase.";
    setProgrammeBusy(true);
    const result = await enrolInProgramme(supabase, { userId, programme, context: programme.context, weekdays, time: startTime });
    if (result.error || !result.enrolment) {
      setProgrammeBusy(false);
      return result.alreadyActive ? "You already follow a programme. Leave it first to start another." : "The programme couldn’t be started. Check your connection and try again.";
    }
    const scheduled = await scheduleProgrammeDays(supabase, {
      userId, enrolment: result.enrolment, programme, catalog, owned: ownedFor(programme.context), level, recentDays,
      fromKey: localDateKey(), startDay: 0, includeTargets: targetsSupported !== false,
      maxDays: targetSessions(result.enrolment.started_on, result.enrolment.weekdays, programmeMeta(programme.id)?.lengthDays),
    });
    setProgrammeBusy(false);
    setContext(programme.context);
    await load();
    setNotice(programmeNotice(scheduled.created, scheduled.unfilledSlots, scheduled.error));
    return null;
  }

  /** "Plan the next 7 days": plans the training days after the last planned one, never a date twice. */
  async function planAhead() {
    const supabase = createClient();
    const programme = followedProgramme(programmes, enrolment);
    if (!supabase || !userId || !enrolment || !programme || programmeLoadFailed) return;
    setProgrammeBusy(true); setError(""); setNotice("");
    const todayKey = localDateKey();
    const scheduled = await topUpProgrammeDays(supabase, {
      userId, enrolment, programme, catalog, owned: ownedFor(enrolment.context), level, recentDays, includeTargets: targetsSupported !== false,
      plans: programmePlans, todayKey, target: targetSessions(enrolment.started_on, enrolment.weekdays, programmeMeta(programme.id)?.lengthDays),
    });
    setProgrammeBusy(false);
    await load();
    setNotice(scheduled.ran ? programmeNotice(scheduled.created, scheduled.unfilledSlots, scheduled.error) : "Your next 7 days are already planned.");
  }

  async function leave() {
    const supabase = createClient();
    const programme = followedProgramme(programmes, enrolment);
    if (!supabase || !userId || !enrolment) return;
    if (!window.confirm(`Stop following ${programme?.title ?? "this programme"}? Its upcoming days are removed from your plans and planner. Finished workouts stay in your history.`)) return;
    setProgrammeBusy(true);
    const result = await leaveProgramme(supabase, { userId, enrolmentId: enrolment.id, todayKey: localDateKey() });
    setProgrammeBusy(false);
    if (result.error) return setError("The programme couldn’t be left. Check your connection and try again.");
    await load();
  }

  async function pause() {
    const supabase = createClient();
    const programme = followedProgramme(programmes, enrolment);
    if (!supabase || !userId || !enrolment || activeSession) return;
    if (!window.confirm(`Pause ${programme?.title ?? "this programme"}? Its upcoming days are removed from your plans and planner until you resume. Your place in the programme is kept.`)) return;
    setProgrammeBusy(true); setError(""); setNotice("");
    const result = await pauseProgramme(supabase, { userId, enrolmentId: enrolment.id, todayKey: localDateKey() });
    setProgrammeBusy(false);
    if (result.error) return setError("The programme couldn’t be paused. Check your connection and try again.");
    await load();
    setNotice("Programme paused. Resume it whenever you’re ready; it picks up at the day you’re on.");
  }

  async function resume() {
    const supabase = createClient();
    if (!supabase || !userId || !enrolment) return;
    setProgrammeBusy(true); setError(""); setNotice("");
    const result = await resumeProgramme(supabase, { userId, enrolmentId: enrolment.id });
    setProgrammeBusy(false);
    if (result.alreadyActive) return setError("You follow another programme now. Leave it to resume this one.");
    if (result.error) return setError("The programme couldn’t be resumed. Check your connection and try again.");
    // Loading again plans the next 7 days from today, at the day the member is on.
    await load();
  }

  async function finish() {
    const supabase = createClient();
    if (!supabase || !userId || !enrolment) return;
    setProgrammeBusy(true); setError("");
    const result = await finishProgramme(supabase, { userId, enrolmentId: enrolment.id, todayKey: localDateKey() });
    setProgrammeBusy(false);
    if (result.error) return setError("The programme couldn’t be finished. Check your connection and try again.");
    await load();
    setNotice("Programme finished. Choose your next one below; your workouts stay in your history.");
  }

  /** Reads a plan's exercises, without the target columns when the database lacks them. */
  async function readPlanRows(planId: string) {
    const supabase = createClient();
    if (!supabase) return { error: new Error("FITX is not connected to Supabase."), rows: [] as PlanExerciseRow[], includedTargets: false };
    const outcome = await readPlanExercises(supabase, userId, planId, targetsSupported !== false);
    if (!outcome.includedTargets) setTargetsSupported(false);
    return outcome;
  }

  /** Ticking adds the exercise at the end; unticking removes it. The other rows keep their order and edits. */
  function toggleSelected(exercise: CatalogExercise) {
    const next = toggleRow(preview, exercise);
    if (!next) { setError(`A workout can contain up to ${MAX_PLAN_EXERCISES} exercises.`); return; }
    setPreview(next);
  }

  function updatePreview(index: number, field: "target_sets" | "reps_min" | "reps_max" | "rest_seconds", value: number) {
    setPreview((rows) => rows.map((row, rowIndex) => {
      if (rowIndex !== index) return row;
      const bounded = field === "target_sets" ? Math.max(1, Math.min(10, value))
        : field === "rest_seconds" ? Math.max(15, Math.min(600, value))
        : Math.max(1, Math.min(100, value));
      const updated = { ...row, [field]: bounded };
      if (field === "reps_min" && updated.reps_max < bounded) updated.reps_max = bounded;
      if (field === "reps_max" && updated.reps_min > bounded) updated.reps_min = bounded;
      return updated;
    }));
  }

  function updateOptionalTarget(index: number, field: "target_weight_kg" | "target_duration_seconds", rawValue: string) {
    const value = rawValue.trim() ? Number(rawValue) : null;
    if (value !== null && (!Number.isFinite(value) || value < 0)) return;
    setPreview((rows) => rows.map((row, rowIndex) => rowIndex === index ? {
      ...row,
      [field]: value === null ? null : field === "target_weight_kg" ? Math.min(2000, Math.round(value * 100) / 100) : Math.min(7200, Math.max(1, Math.round(value))),
    } : row));
  }

  function movePreview(index: number, direction: -1 | 1) {
    setPreview((rows) => moveRow(rows, index, direction));
  }

  async function editPlan(planId: string) {
    const supabase = createClient();
    if (!supabase || !userId) return;
    setError(""); setNotice(""); setSaving(true);
    const [planResult, exercisesResult, eventResult] = await Promise.all([
      supabase.from("workout_plans").select("id,title,planned_for,status,split,notes,workout_location").eq("id", planId).eq("user_id", userId).maybeSingle(),
      readPlanRows(planId),
      // The plan's own event gives the start time (see below); "scheduled" sorts before "completed".
      supabase.from("planner_events").select("status,starts_at").eq("workout_plan_id", planId).eq("user_id", userId).eq("event_type", "workout").neq("status", "cancelled").not("starts_at", "is", null).order("status", { ascending: false }).order("starts_at", { ascending: true }).limit(20),
    ]);
    if (planResult.error || !planResult.data || exercisesResult.error) {
      setSaving(false); setError("This workout could not be opened for editing. Check your connection and try again."); return;
    }
    const rows = exercisesResult.rows;
    const nextPreview = rows.flatMap((row) => {
      const exercise = row.exercise_id ? catalog.find((item) => item.id === survivingExerciseId(row.exercise_id!)) : undefined;
      return exercise ? [toPlannedExercise(row, exercise)] : [];
    });
    if (rows.length && !nextPreview.length) {
      setSaving(false); setError("The saved movements are no longer available in the active library."); return;
    }
    setMode("custom"); setEditingPlanId(planId); setEditingPlannedFor(planResult.data.planned_for || null); setTitle(planResult.data.title); setPlanNotes(planResult.data.notes || ""); setSplit(planResult.data.split); setPlanLocation(planResult.data.workout_location || "gym");
    // A To-Do workout linked to the plan has its own time: prefer the scheduled event on the plan's day.
    const planDay = planResult.data.planned_for;
    const timedEvents = (eventResult.data || []) as Array<{ status: string; starts_at: string }>;
    const ownEvent = timedEvents.find((event) => event.status === "scheduled" && localDateKey(new Date(event.starts_at)) === planDay) ?? timedEvents[0];
    setPlannedFor(planResult.data.planned_for || ""); setTime(ownEvent ? new Date(ownEvent.starts_at).toTimeString().slice(0, 5) : "18:00");
    setAutoNote(""); setPreview(nextPreview); setCreatorOpen(true); setSaving(false);
  }

  async function duplicatePlan(plan: PlanRow) {
    const supabase = createClient();
    if (!supabase || !userId) return;
    setError(""); setNotice(""); setSaving(true);
    const [planResult, exercisesResult] = await Promise.all([
      supabase.from("workout_plans").select("title,split,notes,workout_location").eq("id", plan.id).eq("user_id", userId).maybeSingle(),
      readPlanRows(plan.id),
    ]);
    if (planResult.error || !planResult.data || exercisesResult.error) { setSaving(false); setError("This workout could not be copied. Check your connection and try again."); return; }
    if (!exercisesResult.rows.length) { setSaving(false); setError("This plan has no exercises to copy yet. Edit it to add some first."); return; }
    const nextPreview = exercisesResult.rows.flatMap((row) => {
      const exercise = row.exercise_id ? catalog.find((item) => item.id === survivingExerciseId(row.exercise_id!)) : undefined;
      return exercise ? [toPlannedExercise(row, exercise)] : [];
    });
    if (!nextPreview.length) { setSaving(false); setError("The saved movements are no longer available in the active library."); return; }
    setMode("custom"); setEditingPlanId(null); setTitle(`${planResult.data.title} copy`); setPlanNotes(planResult.data.notes || ""); setSplit(planResult.data.split); setPlanLocation(planResult.data.workout_location || "gym"); setPlannedFor(""); setTime("18:00");
    setAutoNote(""); setPreview(nextPreview); setCreatorOpen(true); setSaving(false);
  }

  async function loadMorePlans() {
    const supabase = createClient();
    if (!supabase || !userId || !planCursor || loadingMorePlans) return;
    setLoadingMorePlans(true); setError("");
    const page = await fetchPlanPage(supabase, userId, listDayKey, planCursor);
    setLoadingMorePlans(false);
    if (page.error) return setError("More plans couldn’t be loaded. Check your connection and try again.");
    setPlans((current) => mergePlansById(current, page.rows));
    setPlanCursor(page.next);
  }

  async function deletePlan(plan: PlanRow) {
    if (!window.confirm(`Delete “${plan.title}” and its saved exercise order? Completed workout sessions will remain in your history.`)) return;
    const supabase = createClient();
    if (!supabase || !userId) return;
    const result = await supabase.from("workout_plans").delete().eq("id", plan.id).eq("user_id", userId);
    if (result.error) setError("That workout could not be deleted."); else await load();
  }

  async function savePlan(thenStart = false) {
    setError(""); setNotice("");
    if (!userId || !title.trim() || preview.length === 0) {
      setError(preview.length === 0 ? "Choose at least one exercise for your workout." : "Give this workout a name.");
      return;
    }
    const supabase = createClient();
    if (!supabase) return setError("FITX is not connected to Supabase.");
    setSaving(true);
    const patch = {
      title: title.trim(), split, workout_location: planLocation,
      planned_for: plannedFor || null, status: plannedFor ? "scheduled" : "draft",
      notes: planNotes.trim() || null,
    };
    let planId = editingPlanId;
    let originalRows: PlanExerciseRow[] = [];
    let originalPlan: { title: string; split: string; workout_location: string; planned_for: string | null; status: string; notes: string | null } | null = null;
    // Tracked locally: state set during this save is not visible until the next render.
    let includeTargets = targetsSupported !== false;
    const previousPlannedFor = editingPlanId ? editingPlannedFor : null;

    // One transaction when the database has fitx_save_workout_plan; on failure nothing changed.
    const rpc = await supabase.rpc("fitx_save_workout_plan", {
      p_plan: { id: editingPlanId, ...patch },
      p_exercises: preview.map((item) => ({ exercise_id: item.exercise.id, exercise_name: item.exercise.name, target_sets: item.target_sets, reps_min: item.reps_min, reps_max: item.reps_max, rest_seconds: item.rest_seconds, target_weight_kg: item.target_weight_kg, target_duration_seconds: item.target_duration_seconds })),
    });
    if (!rpc.error) return afterSave(supabase, rpc.data as string, false, thenStart, previousPlannedFor);
    if (!isMissingFunctionError(rpc.error)) {
      setSaving(false);
      return setError(editingPlanId ? "The workout could not be updated. Your saved plan is unchanged." : "The workout could not be saved. Please try again.");
    }

    if (editingPlanId) {
      const [currentPlan, currentExercises] = await Promise.all([
        supabase.from("workout_plans").select("title,split,workout_location,planned_for,status,notes").eq("id", editingPlanId).eq("user_id", userId).maybeSingle(),
        readPlanRows(editingPlanId),
      ]);
      if (currentPlan.error || !currentPlan.data || currentExercises.error) {
        setSaving(false); return setError("The saved workout could not be prepared for an update. Check your connection and try again.");
      }
      originalPlan = currentPlan.data;
      originalRows = currentExercises.rows;
      if (!currentExercises.includedTargets) includeTargets = false;
      const updated = await supabase.from("workout_plans").update(patch).eq("id", editingPlanId).eq("user_id", userId);
      if (updated.error) { setSaving(false); return setError("The workout details could not be updated."); }
      const removed = await supabase.from("workout_plan_exercises").delete().eq("plan_id", editingPlanId).eq("user_id", userId);
      if (removed.error) {
        await supabase.from("workout_plans").update(originalPlan).eq("id", editingPlanId).eq("user_id", userId);
        setSaving(false); return setError("The workout exercises could not be updated. Your previous plan was restored.");
      }
    } else {
      const inserted = await supabase.from("workout_plans").insert({ user_id: userId, ...patch }).select("id").single();
      if (inserted.error || !inserted.data) { setSaving(false); return setError("The workout could not be saved. Please try again."); }
      planId = inserted.data.id;
    }

    const rows = preview.map((item, index) => ({
      user_id: userId, plan_id: planId, exercise_id: item.exercise.id, exercise_name: item.exercise.name,
      sort_order: index, target_sets: item.target_sets, reps_min: item.reps_min,
      reps_max: item.reps_max, rest_seconds: item.rest_seconds,
      target_weight_kg: item.target_weight_kg, target_duration_seconds: item.target_duration_seconds,
    }));
    const savedExercises = await withOptionalColumns(PRESCRIPTION_TARGET_COLUMNS, (include) =>
      supabase.from("workout_plan_exercises").insert(rows.map((row) => payloadFor(row, PRESCRIPTION_TARGET_COLUMNS, include))),
    { includeOptional: includeTargets });
    if (!savedExercises.includedOptional) { includeTargets = false; setTargetsSupported(false); }
    if (savedExercises.result.error) {
      let restored = true;
      if (editingPlanId && originalPlan) {
        if (originalRows.length) {
          const originalPayload = originalRows.map((row) => ({ user_id: userId, plan_id: editingPlanId, exercise_id: row.exercise_id, exercise_name: row.exercise_name, sort_order: row.sort_order, target_sets: row.target_sets, reps_min: row.reps_min, reps_max: row.reps_max, rest_seconds: row.rest_seconds, target_weight_kg: row.target_weight_kg ?? null, target_duration_seconds: row.target_duration_seconds ?? null }));
          const rollback = await withOptionalColumns(PRESCRIPTION_TARGET_COLUMNS, (include) =>
            supabase.from("workout_plan_exercises").insert(originalPayload.map((row) => payloadFor(row, PRESCRIPTION_TARGET_COLUMNS, include))),
          { includeOptional: includeTargets });
          restored = !rollback.result.error;
        }
        await supabase.from("workout_plans").update(originalPlan).eq("id", editingPlanId).eq("user_id", userId);
      } else if (planId) {
        await supabase.from("workout_plans").delete().eq("id", planId).eq("user_id", userId);
      }
      setSaving(false);
      return setError(restored ? "The workout exercises could not be saved. Your previous plan was restored." : "The workout update was interrupted. Reload this page and check the saved exercise list.");
    }
    // Only possible when the builder showed target fields before the database said it lacks them.
    const droppedTargets = !savedExercises.includedOptional && hasValuesIn(rows, PRESCRIPTION_TARGET_COLUMNS);
    if (!planId) { setSaving(false); return setError("The workout could not be saved. Please try again."); }
    return afterSave(supabase, planId, droppedTargets, thenStart, originalPlan ? originalPlan.planned_for : previousPlannedFor);
  }

  /**
   * After a plan is stored: keep its planner event in step, refresh, report, and optionally start it.
   * `previousPlannedFor` is the plan's date before this save; its own event is the one on that day.
   */
  async function afterSave(supabase: SupabaseBrowserClient, planId: string, droppedTargets: boolean, thenStart: boolean, previousPlannedFor: string | null) {
    // Completed and cancelled events are kept as history; only the plan's own upcoming event follows the
    // plan. To-Do workouts linked to the plan keep their own day (see plannerEventsForPlan).
    // An event's day is its local_date (planner migration), so a phone in another time zone still finds the plan's own event.
    const existingEvents = await withOptionalColumns(PLANNER_DAY_COLUMNS, (include) =>
      supabase.from("planner_events").select(columnList(["id", "status", "starts_at"], PLANNER_DAY_COLUMNS, include)).eq("workout_plan_id", planId).eq("user_id", userId).eq("event_type", "workout").neq("status", "cancelled"));
    let scheduleWarning = "";
    if (existingEvents.result.error) {
      scheduleWarning = "Workout saved, but the planner link could not be checked. Review your planner before scheduling it again.";
    } else {
      // Untimed To-Do items (no starts_at) arrive with the planner migration.
      const linkedEvents = ((existingEvents.result.data || []) as unknown as Array<{ id: string; status: string; starts_at: string | null; local_date?: string | null }>)
        .map((event) => ({ id: event.id, status: event.status, dateKey: timedItemDay(event, (iso) => localDateKey(new Date(iso))) }));
      const planEvents = plannerEventsForPlan(linkedEvents, previousPlannedFor);
      const ownScheduled = planEvents.filter((event) => event.status === "scheduled").map((event) => event.id);
      const change = plannerScheduleChange(planEvents, plannedFor);
      // local_date is the To-Do list's day; a database without it works the day out from starts_at.
      const eventPatch = () => {
        const startsAt = new Date(`${plannedFor}T${time || "18:00"}:00`);
        return { title: title.trim(), starts_at: startsAt.toISOString(), ends_at: new Date(startsAt.getTime() + 3600000).toISOString(), status: "scheduled", local_date: plannedFor };
      };
      if (change === "update-scheduled") {
        const updated = await withOptionalColumns(PLANNER_DAY_COLUMNS, (include) =>
          supabase.from("planner_events").update(payloadFor(eventPatch(), PLANNER_DAY_COLUMNS, include)).in("id", ownScheduled).eq("user_id", userId).eq("status", "scheduled"));
        if (updated.result.error) scheduleWarning = "Workout saved, but its planner event could not be updated.";
      } else if (change === "insert") {
        const scheduled = await withOptionalColumns(PLANNER_DAY_COLUMNS, (include) =>
          supabase.from("planner_events").insert(payloadFor({ user_id: userId, event_type: "workout", workout_plan_id: planId, ...eventPatch() }, PLANNER_DAY_COLUMNS, include)));
        if (scheduled.result.error) scheduleWarning = "Workout saved, but its planner event could not be created.";
      } else if (change === "cancel-scheduled") {
        const cancelled = await supabase.from("planner_events").update({ status: "cancelled" }).in("id", ownScheduled).eq("user_id", userId).eq("status", "scheduled");
        if (cancelled.error) scheduleWarning = "Workout saved, but its planner event could not be cleared.";
      }
    }
    const savedTitle = title.trim();
    setSaving(false);
    setCreatorOpen(false);
    if (thenStart) {
      const message = await startWorkout(planId, savedTitle);
      if (message) { await load(); setError(message); }
      return;
    }
    await load();
    if (scheduleWarning) setError(scheduleWarning);
    if (droppedTargets) setNotice("Workout saved. Weight and time targets aren’t available yet while FITX finishes an update, so those values weren’t stored. Everything else in the plan is saved.");
  }

  /**
   * Starts a session from a plan and opens it; a workout already in progress is opened instead. Resolves with a
   * message when it could not start (the plan preview shows it beside Begin workout).
   */
  async function startWorkout(planId: string, titleOverride?: string): Promise<string | null> {
    const supabase = createClient();
    if (!supabase || !userId) return "FITX is not connected to Supabase.";
    if (starting) return null;
    if (activeSession) { window.location.assign("/workouts/active?session=" + activeSession.id); return null; }
    setError(""); setNotice("");
    setStarting(planId);
    const listed = plans.find((item) => item.id === planId) ?? programmePlans.find((item) => item.id === planId);
    const started = await startPlanSession(supabase, {
      userId, planId, plannerEventId: plannerEventForStart(startLink.current, planId),
      title: listed?.title ?? titleOverride ?? null, includeTargets: targetsSupported !== false,
    });
    if (!started.includedTargets) setTargetsSupported(false);
    if ("sessionId" in started) { window.location.assign("/workouts/active?session=" + started.sessionId); return null; }
    setStarting("");
    return startFailureMessage(started.failure);
  }

  if (loading) return <div className="animate-pulse space-y-4 motion-reduce:animate-none" aria-label="Loading workouts"><div className="h-9 w-1/3 rounded bg-fitx-surface-variant"/><div className="h-48 rounded-2xl bg-fitx-surface"/><div className="h-48 rounded-2xl bg-fitx-surface"/></div>;
  if (error && !userId) return <EmptyState title="Workouts unavailable" description={error} action={<button className="fitx-button fitx-button-secondary" onClick={() => { setLoading(true); void load(); }}>Try again</button>} />;
  // Hidden only once the database has said it lacks the target columns, so nothing typed is lost on save.
  const showTargets = targetsSupported !== false;
  const contextEquipment = equipmentFor(profiles, context, preferences.equipment);
  const contextProgrammes = programmes.filter((programme) => programme.context === context);
  const enrolledProgramme = followedProgramme(programmes, enrolment);
  const builderProgramme = mode === "auto" && !editingPlanId ? autoProgramme(builderContext) : undefined;
  const rowToSwap = swapIndex !== null ? preview[swapIndex] : undefined;
  const equipmentNames = contextEquipment.keys.map(equipmentLabel);
  const equipmentSummary = equipmentNames.length
    ? `${equipmentNames.slice(0, 5).join(", ")}${equipmentNames.length > 5 ? ` and ${equipmentNames.length - 5} more` : ""}.`
    : "No equipment: body weight, the floor and a wall.";
  const builderSummary = planSummary(preview);
  const previewProgramme = enrolment && enrolledProgramme
    ? { enrolmentId: enrolment.id, title: programmeShortTitle(enrolledProgramme), dayCount: enrolledProgramme.days.length, dayTitles: enrolledProgramme.days.map((day) => day.title), paused: enrolment.status === "paused" }
    : null;
  const enrolledNote = enrolment
    ? `${enrolment.status === "paused" ? "Your paused programme is" : "You follow"} ${enrolledProgramme?.title ?? "a programme"}. Leave it on the ${enrolment.context === "home" ? "Home" : "Gym"} Workout tab to start another.`
    : undefined;

  return (
    <div className={`${styles.page} space-y-6`}>
      <PageHeading title="Workouts" description="Train at home or in the gym, follow a programme, record each set and keep your history in one place."
        actions={<div className={styles.headingActions}><button className={`fitx-button fitx-button-secondary ${styles.secondaryAction}`} onClick={() => openCreator("custom")}><Plus size={17}/>Custom workout</button><button className={`fitx-button ${styles.primaryAction}`} onClick={() => openCreator("auto")}><Sparkles size={16}/>Auto plan</button></div>} />
      {error && <p role="alert" className="fitx-alert fitx-alert-danger px-3 py-2 text-sm">{error}</p>}
      {notice && <p role="status" className="flex items-start gap-2 rounded-lg border border-fitx-border bg-fitx-surface px-3 py-2 text-sm text-fitx-text-secondary"><Info size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-fitx-info"/><span>{notice}</span></p>}
      {activeSession && <div className={`${styles.activeSession} flex flex-col gap-3 rounded-xl border border-fitx-primary/30 bg-fitx-primary/[.06] p-4 sm:flex-row sm:items-center sm:justify-between`}><div><p className="text-sm font-medium">Workout in progress</p><p className="mt-1 text-xs text-fitx-text-secondary">{activeSession.name} · started {readableDate(new Date(activeSession.started_at), { hour: "numeric", minute: "2-digit" })}</p></div><Link className="fitx-button" href={"/workouts/active?session=" + activeSession.id}>Continue workout<ArrowRight size={16}/></Link></div>}

      <section aria-label="Home and gym workouts" className={styles.contextSection}>
        <div role="tablist" aria-label="Where you train" className={styles.contextTabs}>
          {(["home", "gym"] as const).map((value) => (
            <button key={value} id={`workout-tab-${value}`} role="tab" type="button" aria-selected={context === value} aria-controls="workout-context-panel" onClick={() => setContext(value)} className={`${styles.contextTab} ${context === value ? styles.contextTabActive : ""}`}>
              {value === "home" ? <Home size={16} aria-hidden="true"/> : <Dumbbell size={16} aria-hidden="true"/>}{value === "home" ? "Home Workout" : "Gym Workout"}
            </button>
          ))}
        </div>
        <div id="workout-context-panel" role="tabpanel" aria-labelledby={`workout-tab-${context}`} className={`${styles.contextPanel} fitx-panel`}>
          <div className={styles.contextHeader}>
            <div className="min-w-0">
              <h2 className="font-semibold">{context === "home" ? "Your home equipment" : "Your gym equipment"}</h2>
              <p className="mt-1 text-sm text-fitx-text-secondary">{equipmentSummary}{!contextEquipment.saved && <span> {context === "home" ? "A starting list from your profile: edit it to match what you have." : "A full commercial gym until you edit it."}</span>}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="fitx-button fitx-button-quiet min-h-11 px-3 text-sm" onClick={() => setEquipmentEditor({ context, keys: contextEquipment.keys })}><Pencil size={14}/>Edit equipment</button>
              <button type="button" className="fitx-button fitx-button-secondary min-h-11 px-3 text-sm" onClick={() => openCreator("focus", context)}><LayoutGrid size={15} aria-hidden="true"/>By body area</button>
              <button type="button" className="fitx-button min-h-11 px-4 text-sm" onClick={() => openCreator("auto", context)}><Sparkles size={15}/>{context === "home" ? "Home workout for today" : "Gym workout for today"}</button>
            </div>
          </div>
          {!catalogCurated && <p className="mt-3 text-xs text-fitx-text-secondary">Equipment matching is approximate until FITX’s exercise catalogue update is applied.</p>}
          {(equipmentLoadFailed || programmeLoadFailed) && <p role="status" className="fitx-alert mt-3">
            {equipmentLoadFailed && programmeLoadFailed ? "Your equipment lists and programme couldn’t be loaded. Saving a list and planning wait until they load, so nothing you saved is replaced or planned twice."
              : equipmentLoadFailed ? "Your saved equipment lists couldn’t be loaded, so this shows starting lists. Saving a list waits until they load, so the one you saved is not replaced."
              : "Your programme couldn’t be loaded. Following or planning a programme waits until it loads, so no week is planned twice."}
            <button type="button" onClick={() => { setLoading(true); void load(); }} className="fitx-alert-action">Try again</button>
          </p>}
          <div className="mt-6">
            <h3 className="text-sm font-semibold">{context === "home" ? "Home programmes" : "Gym programmes"}</h3>
            <p className="mt-1 mb-3 text-xs text-fitx-text-secondary">Pick a programme and FITX keeps the next 7 days planned on your training days, with exercises you can do with your equipment. Rest days are part of every plan.</p>
            {enrolment && enrolment.context === context
              ? enrolledProgramme
                ? <ProgrammeCard programme={enrolledProgramme} enrolment={enrolment} plans={programmePlans} plansFailed={programmeLoadFailed} todayKey={listDayKey} busy={programmeBusy || Boolean(starting)} planning={planningAhead} activeSession={Boolean(activeSession)}
                    onPreview={(planId) => setPreviewPlanId(planId)} onPlanAhead={() => void planAhead()} onLeave={() => void leave()} onPause={() => void pause()} onResume={() => void resume()} onFinish={() => void finish()} />
                : <section aria-label="Your programme" className="rounded-xl border border-fitx-border bg-fitx-surface p-4 sm:p-5">
                    <p className="font-medium">The programme you follow is no longer available</p>
                    <p className="mt-1 text-sm text-fitx-text-secondary">Your finished workouts stay in your history. Leave it to follow another programme.</p>
                    <button type="button" onClick={() => void leave()} disabled={programmeBusy} className="fitx-button fitx-button-secondary mt-3 min-h-11 text-sm">Leave programme</button>
                  </section>
              : <ProgrammeBrowser programmes={contextProgrammes} enrolAvailable={enrolAvailable && !enrolment && !programmeLoadFailed} busy={programmeBusy} onEnrol={enrol}
                  disabledNote={enrolledNote ?? (programmeLoadFailed ? "Following a programme waits until your current one has loaded." : !enrolAvailable ? "You can browse these now. Following a programme becomes available with the next FITX update." : undefined)} />}
          </div>
        </div>
      </section>

      <section aria-label="Workout totals" className={styles.metricsStrip}>
        <div className={styles.metric}><span className={styles.metricMark} aria-hidden="true"/><p className={styles.metricValue}><CountValue value={counts.completed}/></p><p className={styles.metricLabel}>Completed</p></div>
        <div className={styles.metric}><span className={styles.metricMark} aria-hidden="true"/><p className={styles.metricValue}><CountValue value={counts.plans}/></p><p className={styles.metricLabel}>Saved plans</p></div>
        <div className={styles.metric}><span className={styles.metricMark} aria-hidden="true"/><p className={styles.metricValue}><CountValue value={counts.exercises}/></p><p className={styles.metricLabel}>Exercises</p></div>
      </section>
      <section className={styles.plansSection}>
        <div className="mb-3 flex items-center justify-between"><div><h2 className="font-semibold">Your plans</h2><p className="mt-1 text-xs text-fitx-text-secondary">Workouts you built or saved. Start one to review its exercises first. Programme days are listed with your programme.</p></div><Link href="/goals?tab=week" className="text-xs font-medium text-fitx-primary-text">Open your week<ArrowRight className="ml-1 inline" size={14}/></Link></div>
        {plans.length ? <div className={styles.planList}>{plans.map((plan) => <article key={plan.id} id={`workout-plan-${plan.id}`} className={`${styles.planCard} fitx-panel flex flex-col gap-4 p-4 transition-colors sm:flex-row sm:items-center sm:p-5`}><div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-fitx-primary/10 text-fitx-primary"><Dumbbell size={20}/></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-medium">{plan.title}</h3><PlanStatusChip status={planCardStatus(plan.planned_for, listDayKey, plan.last_done_key)}/></div><p className="mt-1 flex items-center gap-1.5 text-xs capitalize text-fitx-text-secondary"><CalendarDays size={13}/>{plan.planned_for ? readableDate(new Date(plan.planned_for + "T12:00:00")) : "No date set"} · {plan.split.replaceAll("_", " ")}</p></div><div className="flex flex-wrap items-center gap-2"><button className="fitx-button fitx-button-quiet min-h-11 px-3 text-sm" onClick={() => void editPlan(plan.id)} aria-label={"Edit " + plan.title}><Pencil size={14}/>Edit</button><button className="fitx-button fitx-button-quiet min-h-11 px-3 text-sm" onClick={() => void duplicatePlan(plan)} aria-label={"Duplicate " + plan.title}><Copy size={14}/>Copy</button><button className="fitx-button fitx-button-quiet min-h-11 px-3 text-sm" onClick={() => void deletePlan(plan)} aria-label={"Delete " + plan.title}><Trash2 size={14}/></button><button type="button" aria-haspopup="dialog" disabled={Boolean(starting)} className="fitx-button min-h-11 px-4 text-sm" onClick={() => setPreviewPlanId(plan.id)}>{starting === plan.id ? "Starting…" : "Start"}<ArrowRight size={15}/></button></div></article>)}{(planCursor || (counts.plans !== null && counts.plans > plans.length)) && <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-fitx-text-secondary">Showing {plans.length.toLocaleString()}{counts.plans !== null && counts.plans >= plans.length ? ` of ${counts.plans.toLocaleString()}` : ""} saved plans</p>{planCursor && <button type="button" onClick={() => void loadMorePlans()} disabled={loadingMorePlans} className="fitx-button fitx-button-secondary min-h-11 px-4 text-sm">{loadingMorePlans ? "Loading…" : "Show more plans"}</button>}</div>}</div> : <div className={styles.plansEmpty}><EmptyState title="No workout plans yet" description="Generate a plan that respects your equipment and training level, build one from the body areas you want to train, or add movements one by one." action={<button className="fitx-button" onClick={() => openCreator("focus")}><LayoutGrid size={16}/>Build a workout</button>} /></div>}
      </section>
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">Recent history</h2><p className="mt-1 text-xs text-fitx-text-secondary">Sessions you’ve finished. Open one to see its sets, or repeat it to train it again.</p></div><Link href="/workouts/history" className="inline-flex min-h-10 items-center gap-1.5 text-xs font-medium text-fitx-primary-text"><History size={14} aria-hidden="true"/>All history<ArrowRight size={14} aria-hidden="true"/></Link></div>
        {sessions.length ? <div className={`${styles.historyList} fitx-panel divide-y divide-fitx-divider px-4 sm:px-5`}>{sessions.map((session) => <div key={session.id} className="flex items-center justify-between gap-4 py-3"><Link href={`/workouts/history/${session.id}`} className="-mx-2 flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1 hover:bg-fitx-hover"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-fitx-surface text-fitx-primary"><Check size={18} aria-hidden="true"/></span><span className="min-w-0"><span className="block truncate text-sm font-medium">{session.name}</span><span className="mt-1 flex items-center gap-1.5 text-xs text-fitx-text-secondary"><Clock3 size={12} aria-hidden="true"/>{readableDate(new Date(session.started_at), { weekday: "short", month: "short", day: "numeric" })} · {Math.round(session.duration_seconds / 60)} min{Number(session.total_volume) > 0 ? ` · ${Math.round(session.total_volume).toLocaleString()} kg` : ""}</span></span></Link><button type="button" disabled={saving} onClick={() => void repeatSession(session)} aria-label={`Repeat ${session.name}`} className="fitx-button fitx-button-quiet min-h-11 shrink-0 px-3 text-sm"><RotateCcw size={14}/>Repeat</button></div>)}</div> : <EmptyState title="No completed workouts yet" description="Your history will appear here after your first finished session." action={<Link className="fitx-button fitx-button-secondary" href="/exercises">Browse exercises</Link>} />}
      </section>
      <section className={`${styles.library} fitx-panel p-5`}><div className="mb-3 flex items-center justify-between gap-3"><div><h2 className="font-semibold">Exercise library</h2><p className="mt-1 text-xs text-fitx-text-secondary">{(counts.exercises ?? catalog.length).toLocaleString()} movements with instructions and equipment. Swap finds alternatives for anything you can’t do.</p></div><Link href="/exercises" className="text-xs font-medium text-fitx-primary-text">Open library<ArrowRight className="ml-1 inline" size={14}/></Link></div><div className={styles.libraryGrid}>{catalog.slice(0, 6).map((exercise) => <Link key={exercise.id} href={"/exercises/" + exercise.id} className={styles.exerciseCard}><span className={styles.exerciseMark} aria-hidden="true"><Dumbbell size={15}/></span><span className={styles.exerciseText}><span className={styles.exerciseName}>{exercise.name}</span><span className={styles.exerciseMeta}>{exercise.primary_muscle.replaceAll("_", " ")} · {exercise.difficulty}</span></span><ArrowRight size={14} aria-hidden="true"/></Link>)}</div></section>

      {creatorOpen && <div className="fixed inset-0 z-50 flex items-end justify-center bg-fitx-scrim/55 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="builder-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreatorOpen(false); }}><div ref={builderRef} className="max-h-[94dvh] w-full max-w-4xl overflow-y-auto rounded-t-xl border border-fitx-border bg-fitx-elevated shadow-2xl sm:max-h-[90dvh] sm:rounded-xl">
        <div className="p-4 sm:p-6">
          <div className="mb-5 flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.15em] text-fitx-primary-text">Workout builder</p><h2 id="builder-title" className="mt-1 text-xl font-semibold">{editingPlanId ? "Edit workout plan" : mode === "auto" ? "Build a personalized plan" : mode === "focus" ? "Build by body area" : "Create a workout"}</h2><p className="mt-1 text-sm text-fitx-text-secondary">{builderProgramme ? `From ${builderProgramme.title}: main lifts first, matched to your ${builderContext} equipment, level and recent workouts.` : mode === "focus" && !editingPlanId ? `Choose what to train. FITX picks exercises you can do with your ${builderContext} equipment; change anything before you save.` : "Set your order and rep targets before you save."}</p></div><button onClick={() => setCreatorOpen(false)} aria-label="Close workout builder" className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-fitx-border text-fitx-text-secondary hover:text-fitx-text"><X size={18}/></button></div>
          {!editingPlanId && <div role="group" aria-label="Start from" className="mb-4 inline-grid grid-cols-3 gap-1 rounded-xl border border-fitx-border bg-fitx-surface-variant p-1">
            {BUILDER_MODES.map(([value, label]) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => switchMode(value)} className={`min-h-11 rounded-lg px-3 text-sm font-semibold ${mode === value ? "bg-fitx-surface text-fitx-text shadow-sm" : "text-fitx-text-secondary hover:text-fitx-text"}`}>{label}</button>)}
          </div>}
          {mode === "focus" && !editingPlanId && <div className="mb-5">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">{focusAreas.length ? `Training: ${listFocusAreas(focusAreas)}` : "What do you want to train?"}</p>
              {focusAreas.length > 0 && <button type="button" aria-expanded={focusPickerOpen} onClick={() => setFocusPickerOpen((open) => !open)} className="inline-flex min-h-11 items-center text-sm font-semibold text-fitx-primary-text">{focusPickerOpen ? "Done choosing" : "Change areas"}</button>}
            </div>
            {(focusPickerOpen || !focusAreas.length) && <div id="builder-focus-tiles" className="max-w-3xl"><FocusTiles value={focusAreas} label="Body areas to train" details={focusDetails} onChange={(areas) => { setFocusAreas(areas); applyFocus(builderContext, areas, autoSeed); }} /></div>}
          </div>}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <label className="grid gap-1.5 text-xs text-fitx-text-secondary">Workout name<input className="fitx-field" maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
            <label className="grid gap-1.5 text-xs text-fitx-text-secondary">Training split<select className="fitx-field" value={split} onChange={(event) => setSplit(event.target.value)}><option value="full_body">Full body</option><option value="upper_lower">Upper / lower</option><option value="push_pull_legs">Push / pull / legs</option><option value="bro_split">Bro split</option><option value="home_bodyweight">Home bodyweight</option><option value="home_dumbbell">Home dumbbells</option><option value="custom">Custom</option></select></label>
            <label className="grid gap-1.5 text-xs text-fitx-text-secondary">Training location<select className="fitx-field" value={planLocation} onChange={(event) => { setPlanLocation(event.target.value); const target = contextForLocation(event.target.value); if (!editingPlanId && mode === "auto") applyAuto(target, autoDay, autoSeed); if (!editingPlanId && mode === "focus" && focusAreas.length) applyFocus(target, focusAreas, autoSeed); }}><option value="gym">Gym</option><option value="home">Home</option><option value="outdoor">Outdoor</option><option value="both">Home or gym</option></select></label>
            <label className="grid gap-1.5 text-xs text-fitx-text-secondary">Schedule date<input className="fitx-field" type="date" value={plannedFor} onChange={(event) => setPlannedFor(event.target.value)} /></label>
            <label className="grid gap-1.5 text-xs text-fitx-text-secondary">Start time<input className="fitx-field" type="time" value={time} onChange={(event) => setTime(event.target.value)} disabled={!plannedFor} /></label>
            <label className="grid gap-1.5 text-xs text-fitx-text-secondary sm:col-span-2 xl:col-span-1">Notes (optional)<input className="fitx-field" maxLength={500} value={planNotes} onChange={(event) => setPlanNotes(event.target.value)} placeholder="Short focus for this session" /></label>
            {builderProgramme && <label className="grid gap-1.5 text-xs text-fitx-text-secondary">Day<select className="fitx-field" value={autoDay % builderProgramme.days.length} onChange={(event) => { const day = Number(event.target.value); setAutoDay(day); applyAuto(builderContext, day, autoSeed); }}>{builderProgramme.days.map((day, index) => <option key={day.key} value={index}>{day.title}</option>)}</select></label>}
          </div>
          <div className="mt-5">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Exercise order <span className="font-normal text-fitx-text-secondary">· {preview.length}</span></h3>
              {((builderProgramme) || (mode === "focus" && !editingPlanId && focusAreas.length > 0)) && <button type="button" onClick={() => { const seed = autoSeed + 1; setAutoSeed(seed); if (mode === "focus") applyFocus(builderContext, focusAreas, seed); else applyAuto(builderContext, autoDay, seed); }} className="inline-flex min-h-11 items-center text-sm font-semibold text-fitx-primary-text">Regenerate plan</button>}
            </div>
            {preview.length > 0 && <p className="mb-3 text-xs text-fitx-text-secondary" aria-live="polite">{builderSummary.exercises} exercise{builderSummary.exercises === 1 ? "" : "s"} · {builderSummary.totalSets} sets{builderSummary.estimateMinutes ? ` · about ${builderSummary.estimateMinutes} min (estimate from sets, reps and rest)` : ""}</p>}
            {autoNote && <p role="status" className="mb-3 flex items-start gap-2 rounded-lg border border-fitx-border bg-fitx-surface-variant px-3 py-2 text-xs text-fitx-text-secondary"><Info size={14} aria-hidden="true" className="mt-px shrink-0 text-fitx-info"/><span>{autoNote} Add equipment to your list for more options.</span></p>}
            {!showTargets && <p role="status" className="mb-3 flex items-start gap-2 rounded-lg border border-fitx-border bg-fitx-surface-variant px-3 py-2 text-xs text-fitx-text-secondary"><Info size={14} aria-hidden="true" className="mt-px shrink-0 text-fitx-info"/><span>{TARGETS_UNAVAILABLE_NOTICE}</span></p>}
            {preview.length ? <ol className="space-y-2">{preview.map((item, index) => (
              <BuilderRow key={item.exercise.id} item={item} index={index} count={preview.length} owned={builderOwned} listName={builderContext} showTargets={showTargets} lastTime={lastTimes.get(item.exercise.id)}
                onMove={(direction) => movePreview(index, direction)} onUpdate={(field, value) => updatePreview(index, field, value)} onUpdateTarget={(field, raw) => updateOptionalTarget(index, field, raw)}
                onSwap={() => setSwapIndex(index)} onRemove={() => setPreview((rows) => removeRow(rows, item.exercise.id))} onInfo={() => setInfoExercise(item.exercise)} />
            ))}</ol> : <EmptyState title="No exercises in the plan" description={mode === "focus" && !editingPlanId && !focusAreas.length ? "Choose one or more body areas above, or add exercises from the library below." : "Add exercises from the library below, or add equipment to your list for more options."}/>}
          </div>
          <LibraryPicker catalog={catalog} selectedIds={selected} owned={builderOwned} listName={builderContext} full={preview.length >= MAX_PLAN_EXERCISES} onToggle={toggleSelected} onInfo={setInfoExercise} />
          {error && <p role="alert" className="fitx-alert fitx-alert-danger mt-4 px-3 py-2 text-sm">{error}</p>}
        </div>
        <div className="sticky bottom-0 flex flex-col-reverse justify-end gap-2 border-t border-fitx-divider bg-fitx-elevated p-4 sm:flex-row sm:px-6"><button onClick={() => setCreatorOpen(false)} className="fitx-button fitx-button-quiet">Close</button><button disabled={saving || !preview.length} onClick={() => void savePlan()} className={`fitx-button ${activeSession ? "" : "fitx-button-secondary"}`}>{saving ? "Saving…" : editingPlanId ? "Save changes" : "Save workout"}<CalendarDays size={16}/></button>{!activeSession && <button disabled={saving || !preview.length || Boolean(starting)} onClick={() => void savePlan(true)} className="fitx-button">{starting ? "Starting…" : "Save and start"}<ArrowRight size={16}/></button>}</div>
      </div></div>}

      {rowToSwap && <SwapSheet target={rowToSwap.exercise} catalog={catalog} owned={builderOwned} level={level} exclude={new Set(preview.map((row) => row.exercise.id))} contextLabel={builderContext} onPick={(exercise) => swapPreview(swapIndex!, exercise)} onClose={() => setSwapIndex(null)} />}
      {infoExercise && <ExerciseInfoSheet exerciseId={infoExercise.id} name={infoExercise.name} owned={builderOwned} listName={builderContext} fullPageLink={false} onClose={() => setInfoExercise(null)} />}
      {previewPlanId && userId && <PlanPreviewSheet planId={previewPlanId} userId={userId} catalog={catalog} ownedFor={ownedFor} todayKey={listDayKey || localDateKey()} programme={previewProgramme}
        activeSession={activeSession ? { id: activeSession.id, name: activeSession.name } : null} starting={starting === previewPlanId} includeTargets={targetsSupported !== false}
        onBegin={startWorkout} onEdit={(planId) => { setPreviewPlanId(null); void editPlan(planId); }} onClose={() => setPreviewPlanId(null)} />}
      {equipmentEditor && <Sheet title={equipmentEditor.context === "home" ? "Your home equipment" : "Your gym equipment"} size="lg" onClose={() => setEquipmentEditor(null)}
        description={equipmentEditor.context === "home" ? "Choose what you have at home. Workouts, programmes and swaps only use exercises you can do with it." : "Choose what your gym has. Remove anything it lacks and FITX picks alternatives."}
        footer={<><button type="button" onClick={() => setEquipmentEditor(null)} className="fitx-button fitx-button-quiet">Cancel</button><button type="button" disabled={equipmentSaving || !profiles.available || equipmentLoadFailed} onClick={() => void saveEquipment()} className="fitx-button">{equipmentSaving ? "Saving…" : "Save list"}</button></>}>
        {!profiles.available && <p role="status" className="mb-4 rounded-lg border border-fitx-border bg-fitx-surface-variant p-3 text-xs text-fitx-text-secondary">Saving equipment lists arrives with the next FITX update. Until then FITX uses the equipment from your profile at home and a full gym otherwise.</p>}
        {profiles.available && equipmentLoadFailed && <p role="status" className="mb-4 rounded-lg border border-fitx-border bg-fitx-surface-variant p-3 text-xs text-fitx-text-secondary">Your saved list couldn’t be loaded, so this shows a starting list and saving is off for now. Close this and choose Try again.</p>}
        <EquipmentPicker value={equipmentEditor.keys} context={equipmentEditor.context} onChange={(keys) => setEquipmentEditor({ context: equipmentEditor.context, keys })} />
      </Sheet>}
    </div>
  );
}
