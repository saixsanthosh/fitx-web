"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowRight, ArrowRightLeft, ArrowUp, CalendarDays, Check, Clock3, Copy, Dumbbell, Home, Info, Pencil, Plus, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import { PageHeading } from "@/components/app/PageHeading";
import { EmptyState } from "@/components/app/EmptyState";
import { EquipmentPicker } from "@/components/workouts/EquipmentPicker";
import { ProgrammeBrowser } from "@/components/workouts/ProgrammeBrowser";
import { ProgrammeCard } from "@/components/workouts/ProgrammeCard";
import { Sheet } from "@/components/workouts/Sheet";
import { SwapSheet } from "@/components/workouts/SwapSheet";
import { programmeById } from "@/data/programmes";
import { createClient } from "@/lib/supabase/client";
import { localDateKey, readableDate } from "@/lib/domain/dates";
import { columnList, hasValuesIn, isMissingColumnError, isMissingFunctionError, isMissingRelationshipError, payloadFor, withOptionalColumns } from "@/lib/domain/schema-fallback";
import type { CatalogExercise } from "@/lib/training/catalog";
import { equipmentFor, loadCatalog, loadEquipmentProfiles, loadProgrammes, saveEquipmentProfile, type EquipmentProfiles } from "@/lib/training/data";
import { addDaysToKey, enrolInProgramme, leaveProgramme, loadActiveEnrolment, loadEnrolmentPlans, nextScheduleStart, scheduleProgrammeDays, type Enrolment, type ProgrammePlan } from "@/lib/training/enrolment";
import { equipmentLabel, expandOwnedEquipment, missingEquipment } from "@/lib/training/equipment";
import { generateDay } from "@/lib/training/generator";
import { splitProgrammeId, type Programme } from "@/lib/training/programmes";
import { startSessionWithRpc } from "@/lib/training/plans";
import { setTargetReps } from "@/lib/training/sets";
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
/** The target columns are absent when the database has not received the prescription-targets migration. */
type PlanExerciseRow = { id: string; exercise_id: string | null; exercise_name: string; sort_order: number; target_sets: number; reps_min: number; reps_max: number; rest_seconds: number; target_weight_kg?: number | null; target_duration_seconds?: number | null };
type WorkoutCounts = { completed: number | null; plans: number | null; exercises: number | null };

const PLAN_EXERCISE_COLUMNS = ["id", "exercise_id", "exercise_name", "sort_order", "target_sets", "reps_min", "reps_max", "rest_seconds"] as const;
const PLAN_PAGE_SIZE = 30;
const PLAN_LIST_STATUSES = ["draft", "scheduled"];
const PLAN_LIST_COLUMNS = "id,title,planned_for,status,split";
// Each plan's latest finished session, for the "Done" label: one embedded row per plan.
const PLAN_LAST_DONE_EMBED = "workout_sessions(started_at)";
const HISTORY_LIMIT = 6;
const TARGETS_UNAVAILABLE_NOTICE = "Weight and time targets aren’t available yet while FITX finishes an update. Sets, reps, rest and exercise order still save as usual.";

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
/** Builder locations map to the two equipment lists; outdoor training uses the home list. */
function contextForLocation(location: string): TrainingContext {
  return location === "home" || location === "outdoor" ? "home" : "gym";
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
  const [mode, setMode] = useState<"auto" | "custom">("auto");
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  // The edited plan's date when it was opened: its own planner event is the one on that day.
  const [editingPlannedFor, setEditingPlannedFor] = useState<string | null>(null);
  const [title, setTitle] = useState("Training session");
  const [planNotes, setPlanNotes] = useState("");
  const [split, setSplit] = useState("full_body");
  const [planLocation, setPlanLocation] = useState("gym");
  const [plannedFor, setPlannedFor] = useState(() => localDateKey());
  const [time, setTime] = useState("18:00");
  const [query, setQuery] = useState("");
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
  const contextInitialized = useRef(false);

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
      loadActiveEnrolment(supabase, uid),
      fetchRecentExerciseDays(supabase, uid),
    ]);
    const failure = [catalogResult, preferencesResult, planPage, historyResult, activeResult].find((result) => result.error);
    if (failure?.error) { setError("Workouts could not load. Check your connection and try again."); setLoading(false); return; }
    const prefs = (preferencesResult.data || {}) as WorkoutPreferences;
    const activeEnrolment = enrolmentResult.enrolment;
    const weekStartKey = addDaysToKey(todayKey, -6);
    const enrolmentPlans = activeEnrolment ? await loadEnrolmentPlans(supabase, uid, activeEnrolment.id, weekStartKey) : { plans: [], error: null };
    setUserId(uid);
    setCatalog(catalogResult.exercises);
    setCatalogCurated(catalogResult.curated);
    setPreferences(prefs);
    setProfiles(profileResult.profiles);
    setProgrammes(programmeResult.programmes);
    setEnrolAvailable(programmeResult.enrolAvailable && enrolmentResult.available);
    setEnrolment(activeEnrolment);
    setProgrammePlans(enrolmentPlans.plans);
    setEquipmentLoadFailed(Boolean(profileResult.error));
    setProgrammeLoadFailed(Boolean(enrolmentResult.error || enrolmentPlans.error));
    setRecentDays(recent);
    // The first load opens the section that matches the user's programme or where they said they train.
    if (!contextInitialized.current) {
      contextInitialized.current = true;
      setContext(activeEnrolment?.context ?? (prefs.workout_location === "home" || prefs.workout_location === "outdoor" ? "home" : "gym"));
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
    setTargetsSupported((current) => !targetsProbe.error ? true : isMissingColumnError(targetsProbe.error, PRESCRIPTION_TARGET_COLUMNS) ? false : current);
    setLoading(false);
    setError("");
  }, []);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  useEffect(() => {
    const exerciseId = new URLSearchParams(window.location.search).get("exercise");
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
      // A sheet opened over the builder (Swap) handles its own keys.
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

  const filteredCatalog = useMemo(() => {
    const value = query.trim().toLowerCase();
    return catalog.filter((item) => !value || item.name.toLowerCase().includes(value) || item.primary_muscle.toLowerCase().includes(value)).slice(0, 30);
  }, [catalog, query]);

  const level = asLevel(preferences.fitness_level);
  /** The user's equipment for a context, including what their items also serve as. */
  const ownedFor = useCallback((target: TrainingContext) => expandOwnedEquipment(equipmentFor(profiles, target, preferences.equipment).keys), [profiles, preferences.equipment]);

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

  function openCreator(nextMode: "auto" | "custom", target: TrainingContext = context) {
    setMode(nextMode);
    setEditingPlanId(null);
    setTitle(nextMode === "auto" ? "Personalized workout" : "Custom workout");
    setPlanNotes("");
    setSplit(preferences.workout_split || "full_body");
    setPlanLocation(target === "home" ? "home" : "gym");
    setPlannedFor(localDateKey());
    setTime("18:00");
    setQuery("");
    setAutoDay(0); setAutoSeed(0); setAutoNote("");
    if (nextMode === "auto") applyAuto(target, 0, 0); else setPreview([]);
    setCreatorOpen(true);
    setError("");
    setNotice("");
  }

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
      const exercise = catalog.find((item) => item.id === row.exercise_id);
      return exercise ? [toPlannedExercise(row, exercise)] : [];
    }).map((row, sort_order) => ({ ...row, sort_order }));
    if (!nextPreview.length) return setError("The movements from that workout are no longer in the library.");
    setMode("custom"); setEditingPlanId(null); setTitle(session.name); setPlanNotes(""); setSplit(preferences.workout_split || "custom");
    setPlanLocation(context === "home" ? "home" : "gym"); setPlannedFor(localDateKey()); setTime("18:00"); setAutoNote("");
    setPreview(nextPreview); setQuery(""); setCreatorOpen(true);
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
    });
    setProgrammeBusy(false);
    setContext(programme.context);
    await load();
    setNotice(programmeNotice(scheduled.created, scheduled.unfilledSlots, scheduled.error));
    return null;
  }

  async function planAhead() {
    const supabase = createClient();
    const programme = followedProgramme(programmes, enrolment);
    if (!supabase || !userId || !enrolment || !programme || programmeLoadFailed) return;
    setProgrammeBusy(true); setError(""); setNotice("");
    const todayKey = localDateKey();
    const start = nextScheduleStart(programmePlans, enrolment.next_day_index, todayKey, programme.days.length);
    const scheduled = await scheduleProgrammeDays(supabase, {
      userId, enrolment, programme, catalog, owned: ownedFor(enrolment.context), level, recentDays,
      fromKey: start.fromKey < todayKey ? todayKey : start.fromKey, startDay: start.startDay, includeTargets: targetsSupported !== false,
    });
    setProgrammeBusy(false);
    await load();
    setNotice(programmeNotice(scheduled.created, scheduled.unfilledSlots, scheduled.error));
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

  /** Reads a plan's exercises, without the target columns when the database lacks them. */
  async function readPlanExercises(planId: string) {
    const supabase = createClient();
    if (!supabase) return { error: new Error("FITX is not connected to Supabase."), rows: [] as PlanExerciseRow[], includedTargets: false };
    const outcome = await withOptionalColumns(PRESCRIPTION_TARGET_COLUMNS, (include) =>
      supabase.from("workout_plan_exercises").select(columnList(PLAN_EXERCISE_COLUMNS, PRESCRIPTION_TARGET_COLUMNS, include)).eq("plan_id", planId).eq("user_id", userId).order("sort_order"),
    { includeOptional: targetsSupported !== false });
    if (!outcome.includedOptional) setTargetsSupported(false);
    return { error: outcome.result.error, rows: (outcome.result.data || []) as unknown as PlanExerciseRow[], includedTargets: outcome.includedOptional };
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

  async function editPlan(plan: PlanRow) {
    const supabase = createClient();
    if (!supabase || !userId) return;
    setError(""); setNotice(""); setSaving(true);
    const [planResult, exercisesResult, eventResult] = await Promise.all([
      supabase.from("workout_plans").select("id,title,planned_for,status,split,notes,workout_location").eq("id", plan.id).eq("user_id", userId).maybeSingle(),
      readPlanExercises(plan.id),
      // The plan's own event gives the start time (see below); "scheduled" sorts before "completed".
      supabase.from("planner_events").select("status,starts_at").eq("workout_plan_id", plan.id).eq("user_id", userId).eq("event_type", "workout").neq("status", "cancelled").not("starts_at", "is", null).order("status", { ascending: false }).order("starts_at", { ascending: true }).limit(20),
    ]);
    if (planResult.error || !planResult.data || exercisesResult.error) {
      setSaving(false); setError("This workout could not be opened for editing. Check your connection and try again."); return;
    }
    const rows = exercisesResult.rows;
    const nextPreview = rows.flatMap((row) => {
      const exercise = catalog.find((item) => item.id === row.exercise_id);
      return exercise ? [toPlannedExercise(row, exercise)] : [];
    });
    if (rows.length && !nextPreview.length) {
      setSaving(false); setError("The saved movements are no longer available in the active library."); return;
    }
    setMode("custom"); setEditingPlanId(plan.id); setEditingPlannedFor(planResult.data.planned_for || null); setTitle(planResult.data.title); setPlanNotes(planResult.data.notes || ""); setSplit(planResult.data.split); setPlanLocation(planResult.data.workout_location || "gym");
    // A To-Do workout linked to the plan has its own time: prefer the scheduled event on the plan's day.
    const planDay = planResult.data.planned_for;
    const timedEvents = (eventResult.data || []) as Array<{ status: string; starts_at: string }>;
    const ownEvent = timedEvents.find((event) => event.status === "scheduled" && localDateKey(new Date(event.starts_at)) === planDay) ?? timedEvents[0];
    setPlannedFor(planResult.data.planned_for || ""); setTime(ownEvent ? new Date(ownEvent.starts_at).toTimeString().slice(0, 5) : "18:00");
    setPreview(nextPreview); setQuery(""); setCreatorOpen(true); setSaving(false);
  }

  async function duplicatePlan(plan: PlanRow) {
    const supabase = createClient();
    if (!supabase || !userId) return;
    setError(""); setNotice(""); setSaving(true);
    const [planResult, exercisesResult] = await Promise.all([
      supabase.from("workout_plans").select("title,split,notes,workout_location").eq("id", plan.id).eq("user_id", userId).maybeSingle(),
      readPlanExercises(plan.id),
    ]);
    if (planResult.error || !planResult.data || exercisesResult.error) { setSaving(false); setError("This workout could not be copied. Check your connection and try again."); return; }
    if (!exercisesResult.rows.length) { setSaving(false); setError("This plan has no exercises to copy yet. Edit it to add some first."); return; }
    const nextPreview = exercisesResult.rows.flatMap((row) => {
      const exercise = catalog.find((item) => item.id === row.exercise_id);
      return exercise ? [toPlannedExercise(row, exercise)] : [];
    });
    if (!nextPreview.length) { setSaving(false); setError("The saved movements are no longer available in the active library."); return; }
    setMode("custom"); setEditingPlanId(null); setTitle(`${planResult.data.title} copy`); setPlanNotes(planResult.data.notes || ""); setSplit(planResult.data.split); setPlanLocation(planResult.data.workout_location || "gym"); setPlannedFor(""); setTime("18:00");
    setPreview(nextPreview); setQuery(""); setCreatorOpen(true); setSaving(false);
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
        readPlanExercises(editingPlanId),
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
    const existingEvents = await supabase.from("planner_events").select("id,status,starts_at").eq("workout_plan_id", planId).eq("user_id", userId).eq("event_type", "workout").neq("status", "cancelled");
    let scheduleWarning = "";
    if (existingEvents.error) {
      scheduleWarning = "Workout saved, but the planner link could not be checked. Review your planner before scheduling it again.";
    } else {
      // Untimed To-Do items (no starts_at) arrive with the planner migration.
      const linkedEvents = ((existingEvents.data || []) as Array<{ id: string; status: string; starts_at: string | null }>)
        .map((event) => ({ id: event.id, status: event.status, dateKey: event.starts_at ? localDateKey(new Date(event.starts_at)) : null }));
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
    if (thenStart) return startWorkout(planId, savedTitle);
    await load();
    if (scheduleWarning) setError(scheduleWarning);
    if (droppedTargets) setNotice("Workout saved. Weight and time targets aren’t available yet while FITX finishes an update, so those values weren’t stored. Everything else in the plan is saved.");
  }

  async function startWorkout(planId: string, titleOverride?: string) {
    const supabase = createClient();
    if (!supabase || !userId || starting) return;
    if (activeSession) { window.location.assign("/workouts/active?session=" + activeSession.id); return; }
    setError(""); setNotice("");
    setStarting(planId);
    // One transaction when the database has fitx_start_workout_session.
    const viaRpc = await startSessionWithRpc(supabase, planId);
    if (viaRpc.sessionId) { window.location.assign("/workouts/active?session=" + viaRpc.sessionId); return; }
    if (!viaRpc.fallback) {
      setStarting("");
      const message = String((viaRpc.error as { message?: string } | null)?.message ?? "");
      return setError(message.includes("no exercises") ? "This plan doesn’t have any exercises yet. Edit it to add some, then start it."
        : message.includes("not found") ? "This plan is no longer in your list. Refresh the page and try again."
        : "Your workout could not be started. Check your connection and try again.");
    }
    const listed = plans.find((item) => item.id === planId) ?? programmePlans.find((item) => item.id === planId);
    const plan = listed ? { title: listed.title } : titleOverride ? { title: titleOverride } : null;
    if (!plan) { setStarting(""); return setError("This plan is no longer in your list. Refresh the page and try again."); }
    const planExercises = await readPlanExercises(planId);
    if (planExercises.error) { setStarting(""); return setError("This plan’s exercises couldn’t be loaded, so the workout wasn’t started. Check your connection and try again."); }
    if (!planExercises.rows.length) { setStarting(""); return setError("This plan doesn’t have any exercises yet. Edit it to add some, then start it."); }
    const started = await supabase.from("workout_sessions").insert({ user_id: userId, plan_id: planId, name: plan.title, status: "in_progress" }).select("id").single();
    if (started.error || !started.data) { setStarting(""); return setError("Your workout could not be started. Please try again."); }
    const sessionId: string = started.data.id;
    const sessionExercises = planExercises.rows.map((row, index) => ({
      user_id: userId, session_id: sessionId, exercise_id: row.exercise_id, exercise_name: row.exercise_name,
      sort_order: index, target_sets: row.target_sets, reps_min: row.reps_min, reps_max: row.reps_max, rest_seconds: row.rest_seconds,
      target_weight_kg: row.target_weight_kg ?? null, target_duration_seconds: row.target_duration_seconds ?? null,
    }));
    // The session copies the plan's targets; without target columns it starts with sets, reps and rest only.
    const insertedExercises = await withOptionalColumns(PRESCRIPTION_TARGET_COLUMNS, (include) =>
      supabase.from("workout_session_exercises").insert(sessionExercises.map((row) => payloadFor(row, PRESCRIPTION_TARGET_COLUMNS, include))).select(columnList(["id", "target_sets", "reps_min", "reps_max"], PRESCRIPTION_TARGET_COLUMNS, include)),
    { includeOptional: planExercises.includedTargets });
    if (insertedExercises.result.error || !insertedExercises.result.data) {
      await supabase.from("workout_sessions").delete().eq("id", sessionId).eq("user_id", userId);
      setStarting("");
      return setError("Your workout session could not be prepared. Please try again.");
    }
    const createdExerciseRows = insertedExercises.result.data as unknown as Array<{ id: string; target_sets: number; reps_min: number; reps_max: number; target_weight_kg?: number | null; target_duration_seconds?: number | null }>;
    // A timed movement's sets get no rep target (see setTargetReps).
    const setRows = createdExerciseRows.flatMap((item) => Array.from({ length: item.target_sets }, (_, index) => ({
      user_id: userId, session_exercise_id: item.id, set_number: index + 1,
      target_reps: setTargetReps(item), weight_kg: item.target_weight_kg ?? 0,
    })));
    const createdSets = await supabase.from("workout_sets").insert(setRows);
    if (createdSets.error) {
      await supabase.from("workout_sessions").delete().eq("id", sessionId).eq("user_id", userId);
      setStarting("");
      return setError("Your workout session could not be prepared. Please try again.");
    }
    window.location.assign("/workouts/active?session=" + sessionId);
  }

  if (loading) return <div className="animate-pulse space-y-4" aria-label="Loading workouts"><div className="h-9 w-1/3 rounded bg-fitx-surface-variant"/><div className="h-48 rounded-2xl bg-fitx-surface"/><div className="h-48 rounded-2xl bg-fitx-surface"/></div>;
  if (error && !userId) return <EmptyState title="Workouts unavailable" description={error} action={<button className="fitx-button fitx-button-secondary" onClick={() => { setLoading(true); void load(); }}>Try again</button>} />;
  // Hidden only once the database has said it lacks the target columns, so nothing typed is lost on save.
  const showTargets = targetsSupported !== false;
  const contextEquipment = equipmentFor(profiles, context, preferences.equipment);
  const contextProgrammes = programmes.filter((programme) => programme.context === context);
  const enrolledProgramme = followedProgramme(programmes, enrolment);
  const builderContext = contextForLocation(planLocation);
  const builderOwned = ownedFor(builderContext);
  const builderProgramme = mode === "auto" && !editingPlanId ? autoProgramme(builderContext) : undefined;
  const rowToSwap = swapIndex !== null ? preview[swapIndex] : undefined;
  const equipmentNames = contextEquipment.keys.map(equipmentLabel);
  const equipmentSummary = equipmentNames.length
    ? `${equipmentNames.slice(0, 5).join(", ")}${equipmentNames.length > 5 ? ` and ${equipmentNames.length - 5} more` : ""}.`
    : "No equipment: body weight, the floor and a wall.";

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
              <button type="button" className="fitx-button min-h-11 px-4 text-sm" onClick={() => openCreator("auto", context)}><Sparkles size={15}/>{context === "home" ? "Home workout for today" : "Gym workout for today"}</button>
            </div>
          </div>
          {!catalogCurated && <p className="mt-3 text-xs text-fitx-text-secondary">Equipment matching is approximate until FITX’s exercise catalogue update is applied.</p>}
          {(equipmentLoadFailed || programmeLoadFailed) && <p role="status" className="fitx-alert mt-3">
            {equipmentLoadFailed && programmeLoadFailed ? "Your equipment lists and programme couldn’t be loaded" : equipmentLoadFailed ? "Your saved equipment lists couldn’t be loaded, so this shows starting lists" : "Your programme couldn’t be loaded"}. Saving and planning wait until they load, so nothing you saved is replaced.
            <button type="button" onClick={() => { setLoading(true); void load(); }} className="fitx-alert-action">Try again</button>
          </p>}
          <div className="mt-6">
            <h3 className="text-sm font-semibold">{context === "home" ? "Home programmes" : "Gym programmes"}</h3>
            <p className="mt-1 mb-3 text-xs text-fitx-text-secondary">Pick a programme and FITX plans the next 7 days on your training days, with exercises you can do with your equipment. Plan each week after that from your programme card.</p>
            {enrolment && enrolment.context === context
              ? enrolledProgramme
                ? <ProgrammeCard programme={enrolledProgramme} enrolment={enrolment} plans={programmePlans} plansFailed={programmeLoadFailed} todayKey={listDayKey} busy={programmeBusy} starting={starting} onStart={(planId) => void startWorkout(planId)} onPlanAhead={() => void planAhead()} onLeave={() => void leave()} />
                : <section aria-label="Your programme" className="rounded-xl border border-fitx-border bg-fitx-surface p-4 sm:p-5">
                    <p className="font-medium">The programme you follow is no longer available</p>
                    <p className="mt-1 text-sm text-fitx-text-secondary">Your finished workouts stay in your history. Leave it to follow another programme.</p>
                    <button type="button" onClick={() => void leave()} disabled={programmeBusy} className="fitx-button fitx-button-secondary mt-3 min-h-11 text-sm">Leave programme</button>
                  </section>
              : <ProgrammeBrowser programmes={contextProgrammes} enrolAvailable={enrolAvailable && !enrolment && !programmeLoadFailed} busy={programmeBusy} onEnrol={enrol}
                  disabledNote={enrolment ? `You follow ${enrolledProgramme?.title ?? "a programme"}. Leave it on the ${enrolment.context === "home" ? "Home" : "Gym"} Workout tab to start another.` : programmeLoadFailed ? "Following a programme waits until your current one has loaded." : !enrolAvailable ? "You can browse these now. Following a programme becomes available with the next FITX update." : undefined} />}
          </div>
        </div>
      </section>

      <section aria-label="Workout totals" className={styles.metricsStrip}>
        <div className={styles.metric}><span className={styles.metricMark} aria-hidden="true"/><p className={styles.metricValue}><CountValue value={counts.completed}/></p><p className={styles.metricLabel}>Completed</p></div>
        <div className={styles.metric}><span className={styles.metricMark} aria-hidden="true"/><p className={styles.metricValue}><CountValue value={counts.plans}/></p><p className={styles.metricLabel}>Saved plans</p></div>
        <div className={styles.metric}><span className={styles.metricMark} aria-hidden="true"/><p className={styles.metricValue}><CountValue value={counts.exercises}/></p><p className={styles.metricLabel}>Exercises</p></div>
      </section>
      <section className={styles.plansSection}>
        <div className="mb-3 flex items-center justify-between"><div><h2 className="font-semibold">Your plans</h2><p className="mt-1 text-xs text-fitx-text-secondary">Workouts you built or saved. Programme days are listed with your programme.</p></div><Link href="/goals?tab=week" className="text-xs font-medium text-fitx-primary-text">Open your week<ArrowRight className="ml-1 inline" size={14}/></Link></div>
        {plans.length ? <div className={styles.planList}>{plans.map((plan) => <article key={plan.id} id={`workout-plan-${plan.id}`} className={`${styles.planCard} fitx-panel flex flex-col gap-4 p-4 transition-colors sm:flex-row sm:items-center sm:p-5`}><div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-fitx-primary/10 text-fitx-primary"><Dumbbell size={20}/></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-medium">{plan.title}</h3><PlanStatusChip status={planCardStatus(plan.planned_for, listDayKey, plan.last_done_key)}/></div><p className="mt-1 flex items-center gap-1.5 text-xs capitalize text-fitx-text-secondary"><CalendarDays size={13}/>{plan.planned_for ? readableDate(new Date(plan.planned_for + "T12:00:00")) : "No date set"} · {plan.split.replaceAll("_", " ")}</p></div><div className="flex flex-wrap items-center gap-2"><button className="fitx-button fitx-button-quiet min-h-11 px-3 text-sm" onClick={() => void editPlan(plan)} aria-label={"Edit " + plan.title}><Pencil size={14}/>Edit</button><button className="fitx-button fitx-button-quiet min-h-11 px-3 text-sm" onClick={() => void duplicatePlan(plan)} aria-label={"Duplicate " + plan.title}><Copy size={14}/>Copy</button><button className="fitx-button fitx-button-quiet min-h-11 px-3 text-sm" onClick={() => void deletePlan(plan)} aria-label={"Delete " + plan.title}><Trash2 size={14}/></button><button disabled={Boolean(starting)} className="fitx-button min-h-11 px-4 text-sm" onClick={() => void startWorkout(plan.id)}>{starting === plan.id ? "Starting…" : "Start"}<ArrowRight size={15}/></button></div></article>)}{(planCursor || (counts.plans !== null && counts.plans > plans.length)) && <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-fitx-text-secondary">Showing {plans.length.toLocaleString()}{counts.plans !== null && counts.plans >= plans.length ? ` of ${counts.plans.toLocaleString()}` : ""} saved plans</p>{planCursor && <button type="button" onClick={() => void loadMorePlans()} disabled={loadingMorePlans} className="fitx-button fitx-button-secondary min-h-11 px-4 text-sm">{loadingMorePlans ? "Loading…" : "Show more plans"}</button>}</div>}</div> : <div className={styles.plansEmpty}><EmptyState title="No workout plans yet" description="Generate a plan that respects your equipment and training level, or build one movement by movement." action={<button className="fitx-button" onClick={() => openCreator("auto")}><Sparkles size={16}/>Create a plan</button>} /></div>}
      </section>
      <section>
        <div className="mb-3 flex items-center justify-between"><div><h2 className="font-semibold">Recent history</h2><p className="mt-1 text-xs text-fitx-text-secondary">Sessions you’ve finished. Repeat one to train it again.</p></div><Link href="/progress" className="text-xs font-medium text-fitx-primary-text">View progress</Link></div>
        {sessions.length ? <div className={`${styles.historyList} fitx-panel divide-y divide-fitx-divider px-4 sm:px-5`}>{sessions.map((session) => <div key={session.id} className="flex items-center justify-between gap-4 py-4"><div className="flex min-w-0 items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-fitx-surface text-fitx-primary"><Check size={18}/></span><div className="min-w-0"><p className="truncate text-sm font-medium">{session.name}</p><p className="mt-1 flex items-center gap-1.5 text-xs text-fitx-text-secondary"><Clock3 size={12}/>{readableDate(new Date(session.started_at), { weekday: "short", month: "short", day: "numeric" })} · {Math.round(session.duration_seconds / 60)} min · {Math.round(session.total_volume).toLocaleString()} kg</p></div></div><button type="button" disabled={saving} onClick={() => void repeatSession(session)} aria-label={`Repeat ${session.name}`} className="fitx-button fitx-button-quiet min-h-10 shrink-0 px-3 text-sm"><RotateCcw size={14}/>Repeat</button></div>)}</div> : <EmptyState title="No completed workouts yet" description="Your history will appear here after your first finished session." action={<Link className="fitx-button fitx-button-secondary" href="/exercises">Browse exercises</Link>} />}
      </section>
      <section className={`${styles.library} fitx-panel p-5`}><div className="mb-3 flex items-center justify-between gap-3"><div><h2 className="font-semibold">Exercise library</h2><p className="mt-1 text-xs text-fitx-text-secondary">{(counts.exercises ?? catalog.length).toLocaleString()} movements with instructions and equipment. Swap finds alternatives for anything you can’t do.</p></div><Link href="/exercises" className="text-xs font-medium text-fitx-primary-text">Open library<ArrowRight className="ml-1 inline" size={14}/></Link></div><div className={styles.libraryGrid}>{catalog.slice(0, 6).map((exercise) => <Link key={exercise.id} href={"/exercises/" + exercise.id} className={styles.exerciseCard}><span className={styles.exerciseMark} aria-hidden="true"><Dumbbell size={15}/></span><span className={styles.exerciseText}><span className={styles.exerciseName}>{exercise.name}</span><span className={styles.exerciseMeta}>{exercise.primary_muscle.replaceAll("_", " ")} · {exercise.difficulty}</span></span><ArrowRight size={14} aria-hidden="true"/></Link>)}</div></section>

      {creatorOpen && <div className="fixed inset-0 z-50 flex items-end justify-center bg-fitx-scrim/55 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="builder-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreatorOpen(false); }}><div ref={builderRef} className="max-h-[94dvh] w-full max-w-4xl overflow-y-auto rounded-t-xl border border-fitx-border bg-fitx-elevated p-4 shadow-2xl sm:max-h-[90dvh] sm:rounded-xl sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.15em] text-fitx-primary-text">Workout builder</p><h2 id="builder-title" className="mt-1 text-xl font-semibold">{editingPlanId ? "Edit workout plan" : mode === "auto" ? "Build a personalized plan" : "Create a workout"}</h2><p className="mt-1 text-sm text-fitx-text-secondary">{builderProgramme ? `From ${builderProgramme.title}: main lifts first, matched to your ${builderContext} equipment, level and recent workouts.` : "Set your order and rep targets before you save."}</p></div><button onClick={() => setCreatorOpen(false)} aria-label="Close workout builder" className="grid h-10 w-10 place-items-center rounded-md border border-fitx-border text-fitx-text-secondary hover:text-fitx-text"><X size={18}/></button></div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <label className="grid gap-1.5 text-xs text-fitx-text-secondary">Workout name<input className="fitx-field" maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label className="grid gap-1.5 text-xs text-fitx-text-secondary">Training split<select className="fitx-field" value={split} onChange={(event) => setSplit(event.target.value)}><option value="full_body">Full body</option><option value="upper_lower">Upper / lower</option><option value="push_pull_legs">Push / pull / legs</option><option value="bro_split">Bro split</option><option value="home_bodyweight">Home bodyweight</option><option value="home_dumbbell">Home dumbbells</option><option value="custom">Custom</option></select></label>
          <label className="grid gap-1.5 text-xs text-fitx-text-secondary">Training location<select className="fitx-field" value={planLocation} onChange={(event) => { setPlanLocation(event.target.value); if (mode === "auto" && !editingPlanId) applyAuto(contextForLocation(event.target.value), autoDay, autoSeed); }}><option value="gym">Gym</option><option value="home">Home</option><option value="outdoor">Outdoor</option><option value="both">Home or gym</option></select></label>
          <label className="grid gap-1.5 text-xs text-fitx-text-secondary">Schedule date<input className="fitx-field" type="date" value={plannedFor} onChange={(event) => setPlannedFor(event.target.value)} /></label>
          <label className="grid gap-1.5 text-xs text-fitx-text-secondary">Start time<input className="fitx-field" type="time" value={time} onChange={(event) => setTime(event.target.value)} disabled={!plannedFor} /></label>
          <label className="grid gap-1.5 text-xs text-fitx-text-secondary sm:col-span-2 xl:col-span-1">Notes (optional)<input className="fitx-field" maxLength={500} value={planNotes} onChange={(event) => setPlanNotes(event.target.value)} placeholder="Short focus for this session" /></label>
          {builderProgramme && <label className="grid gap-1.5 text-xs text-fitx-text-secondary">Day<select className="fitx-field" value={autoDay % builderProgramme.days.length} onChange={(event) => { const day = Number(event.target.value); setAutoDay(day); applyAuto(builderContext, day, autoSeed); }}>{builderProgramme.days.map((day, index) => <option key={day.key} value={index}>{day.title}</option>)}</select></label>}
        </div>
        {mode === "custom" && <div className="mt-5"><div className="flex flex-col gap-2 sm:flex-row"><input className="fitx-field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search exercise or muscle" aria-label="Search exercises to add" /><span className="self-center text-xs text-fitx-text-secondary">{selected.length} selected</span></div><div className="mt-3 max-h-48 overflow-auto rounded-lg border border-fitx-border bg-fitx-surface">{filteredCatalog.map((exercise) => <label key={exercise.id} className="flex min-h-12 cursor-pointer items-center gap-3 border-b border-fitx-divider px-3 py-2.5 text-sm last:border-0 hover:bg-fitx-hover"><input type="checkbox" checked={selected.includes(exercise.id)} onChange={() => toggleSelected(exercise)} className="h-4 w-4 accent-[var(--fitx-primary)]"/><span className="min-w-0 flex-1 truncate">{exercise.name}</span><span className="text-xs capitalize text-fitx-text-secondary">{exercise.primary_muscle.replaceAll("_", " ")}</span></label>)}</div></div>}
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">Exercise order <span className="font-normal text-fitx-text-secondary">· {preview.length}</span></h3>{builderProgramme && <button type="button" onClick={() => { const seed = autoSeed + 1; setAutoSeed(seed); applyAuto(builderContext, autoDay, seed); }} className="inline-flex min-h-10 items-center text-sm font-semibold text-fitx-primary-text">Regenerate plan</button>}</div>
          {autoNote && <p role="status" className="mb-3 flex items-start gap-2 rounded-lg border border-fitx-border bg-fitx-surface-variant px-3 py-2 text-xs text-fitx-text-secondary"><Info size={14} aria-hidden="true" className="mt-px shrink-0 text-fitx-info"/><span>{autoNote} Add equipment to your list for more options.</span></p>}
          {!showTargets && <p role="status" className="mb-3 flex items-start gap-2 rounded-lg border border-fitx-border bg-fitx-surface-variant px-3 py-2 text-xs text-fitx-text-secondary"><Info size={14} aria-hidden="true" className="mt-px shrink-0 text-fitx-info"/><span>{TARGETS_UNAVAILABLE_NOTICE}</span></p>}
          {preview.length ? <ol className="space-y-2">{preview.map((item, index) => {
            const missing = missingEquipment(item.exercise.required_equipment, builderOwned);
            return <li key={item.exercise.id} className={showTargets ? "grid grid-cols-[2.5rem_minmax(0,1fr)_auto] gap-2 rounded-lg border border-fitx-border bg-fitx-surface p-3 lg:grid-cols-[2.5rem_minmax(8rem,1fr)_repeat(6,minmax(4rem,.35fr))_auto]" : "grid grid-cols-[2.5rem_minmax(0,1fr)_auto] gap-2 rounded-lg border border-fitx-border bg-fitx-surface p-3 lg:grid-cols-[2.5rem_minmax(8rem,1fr)_repeat(4,minmax(4rem,.35fr))_auto]"}>
              <div className="flex flex-col items-center justify-center gap-1"><button type="button" onClick={() => movePreview(index, -1)} disabled={index === 0} aria-label={`Move ${item.exercise.name} earlier`} className="grid h-7 w-8 place-items-center rounded border border-fitx-border disabled:opacity-35"><ArrowUp size={13}/></button><span className="text-xs tabular-nums text-fitx-text-secondary">{String(index + 1).padStart(2, "0")}</span><button type="button" onClick={() => movePreview(index, 1)} disabled={index === preview.length - 1} aria-label={`Move ${item.exercise.name} later`} className="grid h-7 w-8 place-items-center rounded border border-fitx-border disabled:opacity-35"><ArrowDown size={13}/></button></div>
              <span className="min-w-0 self-center"><span className="block truncate text-sm font-medium">{item.exercise.name}</span><span className="text-xs capitalize text-fitx-text-secondary">{item.exercise.primary_muscle.replaceAll("_", " ")}{item.exercise.prescription_type === "time" ? " · timed" : ""}</span>{missing.length > 0 && <span className="mt-1 block text-xs text-fitx-warning">Needs {missing.map(equipmentLabel).join(", ").toLowerCase()}, not on your {builderContext} list</span>}</span>
              <div className={showTargets ? "col-span-3 grid grid-cols-2 gap-2 lg:col-span-6 lg:grid-cols-6" : "col-span-3 grid grid-cols-2 gap-2 lg:col-span-4 lg:grid-cols-4"}><label className="grid grid-cols-2 items-center gap-1 text-[10px] text-fitx-text-secondary sm:grid-cols-1">Sets<input aria-label={`${item.exercise.name} target sets`} className="fitx-field min-h-10 px-2 text-center tabular-nums" type="number" min="1" max="10" value={item.target_sets} onChange={(event) => updatePreview(index, "target_sets", Number(event.target.value))}/></label><label className="grid grid-cols-2 items-center gap-1 text-[10px] text-fitx-text-secondary sm:grid-cols-1">Reps min<input aria-label={`${item.exercise.name} minimum reps`} className="fitx-field min-h-10 px-2 text-center tabular-nums" type="number" min="1" max="100" value={item.reps_min} onChange={(event) => updatePreview(index, "reps_min", Number(event.target.value))}/></label><label className="grid grid-cols-2 items-center gap-1 text-[10px] text-fitx-text-secondary sm:grid-cols-1">Reps max<input aria-label={`${item.exercise.name} maximum reps`} className="fitx-field min-h-10 px-2 text-center tabular-nums" type="number" min="1" max="100" value={item.reps_max} onChange={(event) => updatePreview(index, "reps_max", Number(event.target.value))}/></label><label className="grid grid-cols-2 items-center gap-1 text-[10px] text-fitx-text-secondary sm:grid-cols-1">Rest sec<input aria-label={`${item.exercise.name} rest seconds`} className="fitx-field min-h-10 px-2 text-center tabular-nums" type="number" min="15" max="600" step="15" value={item.rest_seconds} onChange={(event) => updatePreview(index, "rest_seconds", Number(event.target.value))}/></label>{showTargets && <><label className="grid grid-cols-2 items-center gap-1 text-[10px] text-fitx-text-secondary lg:grid-cols-1">Target kg<input aria-label={`${item.exercise.name} target weight in kilograms`} className="fitx-field min-h-10 px-2 text-center tabular-nums" type="number" min="0" max="2000" step="0.5" value={item.target_weight_kg ?? ""} onChange={(event) => updateOptionalTarget(index, "target_weight_kg", event.target.value)} placeholder="—"/></label><label className="grid grid-cols-2 items-center gap-1 text-[10px] text-fitx-text-secondary lg:grid-cols-1">Target sec<input aria-label={`${item.exercise.name} target duration in seconds`} className="fitx-field min-h-10 px-2 text-center tabular-nums" type="number" min="1" max="7200" step="5" value={item.target_duration_seconds ?? ""} onChange={(event) => updateOptionalTarget(index, "target_duration_seconds", event.target.value)} placeholder="—"/></label></>}</div>
              <div className="col-span-3 flex items-center justify-end gap-2 self-center lg:col-span-1"><button type="button" onClick={() => setSwapIndex(index)} aria-label={`Swap ${item.exercise.name}`} className={`grid h-10 w-10 place-items-center rounded border ${missing.length ? "border-fitx-warning/50 text-fitx-warning" : "border-fitx-border text-fitx-text-secondary"} hover:text-fitx-primary`}><ArrowRightLeft size={15}/></button><button type="button" onClick={() => setPreview((rows) => removeRow(rows, item.exercise.id))} aria-label={`Remove ${item.exercise.name}`} className="grid h-10 w-10 place-items-center rounded border border-fitx-border text-fitx-text-secondary hover:text-fitx-primary"><X size={15}/></button></div>
            </li>;
          })}</ol> : <EmptyState title="No exercises in the plan" description="Select movements from the library, or add equipment to your list for more options."/>}
        </div>
        {error && <p role="alert" className="fitx-alert fitx-alert-danger mt-4 px-3 py-2 text-sm">{error}</p>}
        <div className="mt-6 flex flex-col-reverse justify-end gap-2 border-t border-fitx-divider pt-4 sm:flex-row"><button onClick={() => setCreatorOpen(false)} className="fitx-button fitx-button-quiet">Close</button><button disabled={saving || !preview.length} onClick={() => void savePlan()} className={`fitx-button ${activeSession ? "" : "fitx-button-secondary"}`}>{saving ? "Saving…" : editingPlanId ? "Save changes" : "Save workout"}<CalendarDays size={16}/></button>{!activeSession && <button disabled={saving || !preview.length || Boolean(starting)} onClick={() => void savePlan(true)} className="fitx-button">{starting ? "Starting…" : "Save and start"}<ArrowRight size={16}/></button>}</div>
      </div></div>}

      {rowToSwap && <SwapSheet target={rowToSwap.exercise} catalog={catalog} owned={builderOwned} level={level} exclude={new Set(preview.map((row) => row.exercise.id))} contextLabel={builderContext} onPick={(exercise) => swapPreview(swapIndex!, exercise)} onClose={() => setSwapIndex(null)} />}
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
