"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUp, CalendarDays, Check, Clock3, Copy, Dumbbell, Info, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { PageHeading } from "@/components/app/PageHeading";
import { EmptyState } from "@/components/app/EmptyState";
import { createClient } from "@/lib/supabase/client";
import { generateWorkout, type ExerciseRecord, type WorkoutPreferences } from "@/lib/domain/workout";
import { localDateKey, readableDate } from "@/lib/domain/dates";
import { columnList, hasValuesIn, isMissingColumnError, isMissingRelationshipError, payloadFor, withOptionalColumns } from "@/lib/domain/schema-fallback";
import { PRESCRIPTION_TARGET_COLUMNS } from "./_lib/workout-columns";
import { plannerScheduleChange } from "./_lib/plan-schedule";
import { FIRST_PLAN_PAGE, composePlanPage, mergePlansById, planCardStatus, planPageRequests, planSegmentSpec, type PlanPageCursor, type PlanSegmentRequest } from "./_lib/plan-list";
import styles from "./Workouts.module.css";

/** `last_done_key`: local day of the plan's latest finished session, or null when none is known. */
type PlanRow = { id: string; title: string; planned_for: string | null; status: string; split: string; last_done_key: string | null };
type PlanListRow = Omit<PlanRow, "last_done_key"> & { workout_sessions?: Array<{ started_at: string }> | null };
type SupabaseBrowserClient = NonNullable<ReturnType<typeof createClient>>;
type SessionRow = { id: string; name: string; started_at: string; duration_seconds: number; total_volume: number; status: string };
type PlannedExercise = { exercise: ExerciseRecord; sort_order: number; target_sets: number; reps_min: number; reps_max: number; rest_seconds: number; target_weight_kg: number | null; target_duration_seconds: number | null };
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
function toPlannedExercise(row: PlanExerciseRow, exercise: ExerciseRecord): PlannedExercise {
  return { exercise, sort_order: row.sort_order, target_sets: row.target_sets, reps_min: row.reps_min, reps_max: row.reps_max, rest_seconds: row.rest_seconds, target_weight_kg: row.target_weight_kg ?? null, target_duration_seconds: row.target_duration_seconds ?? null };
}
function toPlanRow(row: PlanListRow): PlanRow {
  const lastDone = row.workout_sessions?.[0]?.started_at;
  return { id: row.id, title: row.title, planned_for: row.planned_for, status: row.status, split: row.split, last_done_key: lastDone ? localDateKey(new Date(lastDone)) : null };
}

/** A plan query with, when `withLastDone`, each plan's latest finished session embedded. */
function planListQuery(supabase: SupabaseBrowserClient, uid: string, withLastDone: boolean) {
  const query = supabase.from("workout_plans").select(withLastDone ? `${PLAN_LIST_COLUMNS},${PLAN_LAST_DONE_EMBED}` : PLAN_LIST_COLUMNS).eq("user_id", uid).in("status", PLAN_LIST_STATUSES);
  return withLastDone
    ? query.eq("workout_sessions.status", "completed").order("started_at", { referencedTable: "workout_sessions", ascending: false }).limit(1, { referencedTable: "workout_sessions" })
    : query;
}

function planSegmentQuery(supabase: SupabaseBrowserClient, uid: string, todayKey: string, request: PlanSegmentRequest, withLastDone: boolean) {
  const spec = planSegmentSpec(request.segment, todayKey);
  let query = planListQuery(supabase, uid, withLastDone);
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
  const run = (withLastDone: boolean) => Promise.all(requests.map((request) => planSegmentQuery(supabase, uid, todayKey, request, withLastDone)));
  let responses = await run(true);
  if (responses.some((response) => isMissingRelationshipError(response.error))) responses = await run(false);
  const failed = responses.find((response) => response.error);
  if (failed) return { error: failed.error, rows: [] as PlanRow[], next: cursor as PlanPageCursor | null };
  const page = composePlanPage(requests.map((request, index) => ({ segment: request.segment, from: request.from, rows: (responses[index].data || []) as unknown as PlanListRow[] })), PLAN_PAGE_SIZE);
  return { error: null, rows: page.rows.map(toPlanRow), next: page.next };
}

/** A single listed plan by id, for the dashboard's ?plan= link when it is not on the first page. */
async function fetchPlanById(supabase: SupabaseBrowserClient, uid: string, planId: string) {
  let result = await planListQuery(supabase, uid, true).eq("id", planId).maybeSingle();
  if (isMissingRelationshipError(result.error)) result = await planListQuery(supabase, uid, false).eq("id", planId).maybeSingle();
  return result.error || !result.data ? null : toPlanRow(result.data as unknown as PlanListRow);
}

export default function WorkoutsPage() {
  const builderRef = useRef<HTMLDivElement>(null);
  const [userId, setUserId] = useState("");
  const [catalog, setCatalog] = useState<ExerciseRecord[]>([]);
  const [preferences, setPreferences] = useState<WorkoutPreferences>({});
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [activeSession, setActiveSession] = useState<SessionRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [mode, setMode] = useState<"auto" | "custom">("auto");
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [title, setTitle] = useState("Training session");
  const [planNotes, setPlanNotes] = useState("");
  const [split, setSplit] = useState("full_body");
  const [planLocation, setPlanLocation] = useState("gym");
  const [plannedFor, setPlannedFor] = useState(() => localDateKey());
  const [time, setTime] = useState("18:00");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<PlannedExercise[]>([]);
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

  const load = useCallback(async () => {
    const supabase = createClient();
    if (!supabase) { setError("FITX is not connected to Supabase in this environment."); setLoading(false); return; }
    const auth = await supabase.auth.getUser();
    if (!auth.data.user) { setError("Sign in to manage your workouts."); setLoading(false); return; }
    const uid = auth.data.user.id;
    const todayKey = localDateKey();
    // The dashboard links to /workouts?plan=<id>; that plan is fetched on its own in case it is not on the first page.
    const linkedPlanId = new URLSearchParams(window.location.search).get("plan");
    const [catalogResult, preferencesResult, planPage, historyResult, activeResult, completedCount, planCount, exerciseCount, targetsProbe, linkedPlan] = await Promise.all([
      supabase.from("exercise_library").select("id,name,description,primary_muscle,secondary_muscles,equipment,locations,difficulty,movement_pattern,recommended_sets,reps_min,reps_max,rest_seconds,alternatives").eq("is_active", true).order("name").limit(1000),
      supabase.from("user_preferences").select("workout_location,equipment,fitness_level,session_duration_minutes,workout_split").eq("user_id", uid).maybeSingle(),
      fetchPlanPage(supabase, uid, todayKey, FIRST_PLAN_PAGE),
      supabase.from("workout_sessions").select("id,name,started_at,duration_seconds,total_volume,status").eq("user_id", uid).eq("status", "completed").order("started_at", { ascending: false }).limit(HISTORY_LIMIT),
      supabase.from("workout_sessions").select("id,name,started_at,duration_seconds,total_volume,status").eq("user_id", uid).eq("status", "in_progress").order("started_at", { ascending: false }).limit(1).maybeSingle(),
      // Exact totals for the tiles; the lists above stay short.
      supabase.from("workout_sessions").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("status", "completed"),
      supabase.from("workout_plans").select("id", { count: "exact", head: true }).eq("user_id", uid).in("status", PLAN_LIST_STATUSES),
      supabase.from("exercise_library").select("id", { count: "exact", head: true }).eq("is_active", true),
      // Finds out before the builder opens whether weight and time targets can be saved.
      supabase.from("workout_plan_exercises").select(PRESCRIPTION_TARGET_COLUMNS.join(",")).eq("user_id", uid).limit(1),
      linkedPlanId ? fetchPlanById(supabase, uid, linkedPlanId) : Promise.resolve(null),
    ]);
    const failure = [catalogResult, preferencesResult, planPage, historyResult, activeResult].find((result) => result.error);
    if (failure?.error) { setError("Workouts could not load. Check your connection and try again."); setLoading(false); return; }
    setUserId(uid);
    setCatalog((catalogResult.data || []) as ExerciseRecord[]);
    setPreferences((preferencesResult.data || {}) as WorkoutPreferences);
    // A linked plan from a later page is shown first; it is not repeated when its page loads.
    setPlans(linkedPlan && !planPage.rows.some((plan) => plan.id === linkedPlan.id) ? [linkedPlan, ...planPage.rows] : planPage.rows);
    setPlanCursor(planPage.next);
    setListDayKey(todayKey);
    setSessions((historyResult.data || []) as SessionRow[]);
    setActiveSession(activeResult.data as SessionRow | null);
    // A failed count shows a dash rather than a number it cannot vouch for.
    setCounts({
      completed: completedCount.error ? null : completedCount.count,
      plans: planCount.error ? null : planCount.count,
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
      setPlannedFor(localDateKey()); setSelected([exercise.id]);
      setPreview([{ exercise, sort_order: 0, target_sets: exercise.recommended_sets, reps_min: exercise.reps_min, reps_max: exercise.reps_max, rest_seconds: exercise.rest_seconds, target_weight_kg: null, target_duration_seconds: null }]);
      setCreatorOpen(true);
      window.history.replaceState(null, "", "/workouts");
    });
  }, [catalog, loading, preferences.workout_split, preferences.workout_location]);

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

  function openCreator(nextMode: "auto" | "custom") {
    setMode(nextMode);
    setEditingPlanId(null);
    setTitle(nextMode === "auto" ? "Personalized workout" : "Custom workout");
    setPlanNotes("");
    setSplit(preferences.workout_split || "full_body");
    setPlanLocation(preferences.workout_location || "gym");
    setPlannedFor(localDateKey());
    setTime("18:00");
    setSelected([]);
    setQuery("");
    const generated = nextMode === "auto" ? generateWorkout(catalog, preferences) : [];
    setPreview(generated.map((row) => ({ ...row, target_weight_kg: null, target_duration_seconds: null })));
    setCreatorOpen(true);
    setError("");
    setNotice("");
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

  function toggleSelected(exercise: ExerciseRecord) {
    const isSelected = selected.includes(exercise.id);
    const nextIds = isSelected ? selected.filter((id) => id !== exercise.id) : [...selected, exercise.id];
    if (nextIds.length > 20) { setError("A workout can contain up to 20 exercises."); return; }
    const currentRows = new Map(preview.map((row) => [row.exercise.id, row]));
    const nextPreview = nextIds.map((id, index) => {
      const existing = currentRows.get(id);
      const record = catalog.find((item) => item.id === id);
      if (!record) return null;
      return existing ? { ...existing, sort_order: index } : {
        exercise: record, sort_order: index, target_sets: record.recommended_sets,
        reps_min: record.reps_min, reps_max: record.reps_max, rest_seconds: record.rest_seconds,
        target_weight_kg: null, target_duration_seconds: null,
      };
    }).filter((row): row is PlannedExercise => Boolean(row));
    setSelected(nextIds); setPreview(nextPreview);
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
    const destination = index + direction;
    if (destination < 0 || destination >= preview.length) return;
    setPreview((rows) => {
      const next = [...rows];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next.map((row, sort_order) => ({ ...row, sort_order }));
    });
  }

  async function editPlan(plan: PlanRow) {
    const supabase = createClient();
    if (!supabase || !userId) return;
    setError(""); setNotice(""); setSaving(true);
    const [planResult, exercisesResult, eventResult] = await Promise.all([
      supabase.from("workout_plans").select("id,title,planned_for,status,split,notes,workout_location").eq("id", plan.id).eq("user_id", userId).maybeSingle(),
      readPlanExercises(plan.id),
      // The upcoming event gives the start time; "scheduled" sorts before "completed".
      supabase.from("planner_events").select("starts_at").eq("workout_plan_id", plan.id).eq("user_id", userId).eq("event_type", "workout").neq("status", "cancelled").order("status", { ascending: false }).order("starts_at", { ascending: true }).limit(1).maybeSingle(),
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
    setMode("custom"); setEditingPlanId(plan.id); setTitle(planResult.data.title); setPlanNotes(planResult.data.notes || ""); setSplit(planResult.data.split); setPlanLocation(planResult.data.workout_location || "gym");
    setPlannedFor(planResult.data.planned_for || ""); setTime(eventResult.data?.starts_at ? new Date(eventResult.data.starts_at).toTimeString().slice(0, 5) : "18:00");
    setSelected(nextPreview.map((row) => row.exercise.id)); setPreview(nextPreview); setQuery(""); setCreatorOpen(true); setSaving(false);
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
    setSelected(nextPreview.map((row) => row.exercise.id)); setPreview(nextPreview); setQuery(""); setCreatorOpen(true); setSaving(false);
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

  async function savePlan() {
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

    // Completed and cancelled events are kept as history; only the upcoming event follows the plan.
    const existingEvents = await supabase.from("planner_events").select("id,status,starts_at").eq("workout_plan_id", planId).eq("user_id", userId).eq("event_type", "workout").neq("status", "cancelled");
    let scheduleWarning = "";
    if (existingEvents.error) {
      scheduleWarning = "Workout saved, but the planner link could not be checked. Review your planner before scheduling it again.";
    } else {
      const linkedEvents = ((existingEvents.data || []) as Array<{ status: string; starts_at: string }>).map((event) => ({ status: event.status, dateKey: localDateKey(new Date(event.starts_at)) }));
      const change = plannerScheduleChange(linkedEvents, plannedFor);
      const eventPatch = () => {
        const startsAt = new Date(`${plannedFor}T${time || "18:00"}:00`);
        return { title: title.trim(), starts_at: startsAt.toISOString(), ends_at: new Date(startsAt.getTime() + 3600000).toISOString(), status: "scheduled" };
      };
      if (change === "update-scheduled") {
        const updated = await supabase.from("planner_events").update(eventPatch()).eq("workout_plan_id", planId).eq("user_id", userId).eq("event_type", "workout").eq("status", "scheduled");
        if (updated.error) scheduleWarning = "Workout saved, but its planner event could not be updated.";
      } else if (change === "insert") {
        const scheduled = await supabase.from("planner_events").insert({ user_id: userId, event_type: "workout", workout_plan_id: planId, ...eventPatch() });
        if (scheduled.error) scheduleWarning = "Workout saved, but its planner event could not be created.";
      } else if (change === "cancel-scheduled") {
        const cancelled = await supabase.from("planner_events").update({ status: "cancelled" }).eq("workout_plan_id", planId).eq("user_id", userId).eq("event_type", "workout").eq("status", "scheduled");
        if (cancelled.error) scheduleWarning = "Workout saved, but its planner event could not be cleared.";
      }
    }
    setSaving(false);
    setCreatorOpen(false);
    await load();
    if (scheduleWarning) setError(scheduleWarning);
    if (droppedTargets) setNotice("Workout saved. Weight and time targets aren’t available yet while FITX finishes an update, so those values weren’t stored. Everything else in the plan is saved.");
  }

  async function startWorkout(planId: string) {
    const supabase = createClient();
    if (!supabase || !userId || starting) return;
    if (activeSession) { window.location.assign("/workouts/active?session=" + activeSession.id); return; }
    setError(""); setNotice("");
    setStarting(planId);
    const plan = plans.find((item) => item.id === planId);
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
    const createdExerciseRows = insertedExercises.result.data as unknown as Array<{ id: string; target_sets: number; reps_min: number; reps_max: number; target_weight_kg?: number | null }>;
    const setRows = createdExerciseRows.flatMap((item) => Array.from({ length: item.target_sets }, (_, index) => ({
      user_id: userId, session_exercise_id: item.id, set_number: index + 1,
      target_reps: Math.round((item.reps_min + item.reps_max) / 2), weight_kg: item.target_weight_kg ?? 0,
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

  return (
    <div className={`${styles.page} space-y-6`}>
      <PageHeading title="Workouts" description="Build a plan, record each set, and keep your training history in one place."
        actions={<div className={styles.headingActions}><button className={`fitx-button fitx-button-secondary ${styles.secondaryAction}`} onClick={() => openCreator("custom")}><Plus size={17}/>Custom workout</button><button className={`fitx-button ${styles.primaryAction}`} onClick={() => openCreator("auto")}><Sparkles size={16}/>Auto plan</button></div>} />
      {error && <p role="alert" className="rounded-lg border border-fitx-warning/30 bg-fitx-warning/5 px-3 py-2 text-sm text-fitx-warning">{error}</p>}
      {notice && <p role="status" className="flex items-start gap-2 rounded-lg border border-fitx-border bg-fitx-surface px-3 py-2 text-sm text-fitx-text-secondary"><Info size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-fitx-info"/><span>{notice}</span></p>}
      {activeSession && <div className={`${styles.activeSession} flex flex-col gap-3 rounded-xl border border-fitx-primary/30 bg-fitx-primary/[.06] p-4 sm:flex-row sm:items-center sm:justify-between`}><div><p className="text-sm font-medium">Workout in progress</p><p className="mt-1 text-xs text-fitx-text-secondary">{activeSession.name} · started {readableDate(new Date(activeSession.started_at), { hour: "numeric", minute: "2-digit" })}</p></div><Link className="fitx-button" href={"/workouts/active?session=" + activeSession.id}>Continue workout<ArrowRight size={16}/></Link></div>}
      <section aria-label="Workout totals" className={styles.metricsStrip}>
        <div className={styles.metric}><span className={styles.metricMark} aria-hidden="true"/><p className={styles.metricValue}><CountValue value={counts.completed}/></p><p className={styles.metricLabel}>Completed</p></div>
        <div className={styles.metric}><span className={styles.metricMark} aria-hidden="true"/><p className={styles.metricValue}><CountValue value={counts.plans}/></p><p className={styles.metricLabel}>Saved plans</p></div>
        <div className={styles.metric}><span className={styles.metricMark} aria-hidden="true"/><p className={styles.metricValue}><CountValue value={counts.exercises}/></p><p className={styles.metricLabel}>Exercises</p></div>
      </section>
      <section className={styles.plansSection}>
        <div className="mb-3 flex items-center justify-between"><div><h2 className="font-semibold">Your plans</h2><p className="mt-1 text-xs text-fitx-text-secondary">Auto plans use your level, available equipment, and session length.</p></div><Link href="/planner" className="text-xs font-medium text-fitx-primary">Open planner<ArrowRight className="ml-1 inline" size={14}/></Link></div>
        {plans.length ? <div className={styles.planList}>{plans.map((plan) => <article key={plan.id} id={`workout-plan-${plan.id}`} className={`${styles.planCard} fitx-panel flex flex-col gap-4 p-4 transition-colors sm:flex-row sm:items-center sm:p-5`}><div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-fitx-primary/10 text-fitx-primary"><Dumbbell size={20}/></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-medium">{plan.title}</h3><PlanStatusChip status={planCardStatus(plan.planned_for, listDayKey, plan.last_done_key)}/></div><p className="mt-1 flex items-center gap-1.5 text-xs capitalize text-fitx-text-secondary"><CalendarDays size={13}/>{plan.planned_for ? readableDate(new Date(plan.planned_for + "T12:00:00")) : "No date set"} · {plan.split.replaceAll("_", " ")}</p></div><div className="flex flex-wrap items-center gap-2"><button className="fitx-button fitx-button-quiet min-h-11 px-3 text-xs" onClick={() => void editPlan(plan)} aria-label={"Edit " + plan.title}><Pencil size={14}/>Edit</button><button className="fitx-button fitx-button-quiet min-h-11 px-3 text-xs" onClick={() => void duplicatePlan(plan)} aria-label={"Duplicate " + plan.title}><Copy size={14}/>Copy</button><button className="fitx-button fitx-button-quiet min-h-11 px-3 text-xs" onClick={() => void deletePlan(plan)} aria-label={"Delete " + plan.title}><Trash2 size={14}/></button><button disabled={Boolean(starting)} className="fitx-button min-h-11 px-4 text-xs" onClick={() => void startWorkout(plan.id)}>{starting === plan.id ? "Starting…" : "Start"}<ArrowRight size={15}/></button></div></article>)}{(planCursor || (counts.plans !== null && counts.plans > plans.length)) && <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-fitx-text-secondary">Showing {plans.length.toLocaleString()}{counts.plans !== null && counts.plans >= plans.length ? ` of ${counts.plans.toLocaleString()}` : ""} saved plans</p>{planCursor && <button type="button" onClick={() => void loadMorePlans()} disabled={loadingMorePlans} className="fitx-button fitx-button-secondary min-h-11 px-4 text-xs">{loadingMorePlans ? "Loading…" : "Show more plans"}</button>}</div>}</div> : <div className={styles.plansEmpty}><EmptyState title="No workout plans yet" description="Generate a plan that respects your equipment and training level, or build one movement by movement." action={<button className="fitx-button" onClick={() => openCreator("auto")}><Sparkles size={16}/>Create a plan</button>} /></div>}
      </section>
      <section>
        <div className="mb-3 flex items-center justify-between"><div><h2 className="font-semibold">Recent history</h2><p className="mt-1 text-xs text-fitx-text-secondary">Sessions you’ve finished.</p></div><Link href="/progress" className="text-xs font-medium text-fitx-primary">View progress</Link></div>
        {sessions.length ? <div className={`${styles.historyList} fitx-panel divide-y divide-fitx-divider px-4 sm:px-5`}>{sessions.map((session) => <div key={session.id} className="flex items-center justify-between gap-4 py-4"><div className="flex min-w-0 items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-fitx-surface text-fitx-primary"><Check size={18}/></span><div className="min-w-0"><p className="truncate text-sm font-medium">{session.name}</p><p className="mt-1 flex items-center gap-1.5 text-xs text-fitx-text-secondary"><Clock3 size={12}/>{readableDate(new Date(session.started_at), { weekday: "short", month: "short", day: "numeric" })} · {Math.round(session.duration_seconds / 60)} min</p></div></div><span className="shrink-0 text-xs text-fitx-text-secondary">{Math.round(session.total_volume).toLocaleString()} kg</span></div>)}</div> : <EmptyState title="No completed workouts yet" description="Your history will appear here after your first finished session." action={<Link className="fitx-button fitx-button-secondary" href="/exercises">Browse exercises</Link>} />}
      </section>
      <section className={`${styles.library} fitx-panel p-5`}><div className="mb-3 flex items-center justify-between gap-3"><div><h2 className="font-semibold">Exercise library</h2><p className="mt-1 text-xs text-fitx-text-secondary">{(counts.exercises ?? catalog.length).toLocaleString()} movements with instructions, equipment, and alternatives.</p></div><Link href="/exercises" className="text-xs font-medium text-fitx-primary">Open library<ArrowRight className="ml-1 inline" size={14}/></Link></div><div className={styles.libraryGrid}>{catalog.slice(0, 6).map((exercise) => <Link key={exercise.id} href={"/exercises/" + exercise.id} className={styles.exerciseCard}><span className={styles.exerciseMark} aria-hidden="true"><Dumbbell size={15}/></span><span className={styles.exerciseText}><span className={styles.exerciseName}>{exercise.name}</span><span className={styles.exerciseMeta}>{exercise.primary_muscle} · {exercise.difficulty}</span></span><ArrowRight size={14} aria-hidden="true"/></Link>)}</div></section>
      {creatorOpen && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="builder-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreatorOpen(false); }}><div ref={builderRef} className="max-h-[94dvh] w-full max-w-4xl overflow-y-auto rounded-t-xl border border-fitx-border bg-background p-4 shadow-2xl sm:max-h-[90dvh] sm:rounded-xl sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.15em] text-fitx-primary">Workout builder</p><h2 id="builder-title" className="mt-1 text-xl font-semibold">{editingPlanId ? "Edit workout plan" : mode === "auto" ? "Build a personalized plan" : "Create a workout"}</h2><p className="mt-1 text-sm text-fitx-text-secondary">Set your order and rep targets before you save.</p></div><button onClick={() => setCreatorOpen(false)} aria-label="Close workout builder" className="grid h-10 w-10 place-items-center rounded-md border border-fitx-border text-fitx-text-secondary hover:text-fitx-text"><X size={18}/></button></div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><label className="grid gap-1.5 text-xs text-fitx-text-secondary">Workout name<input className="fitx-field" maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label className="grid gap-1.5 text-xs text-fitx-text-secondary">Training split<select className="fitx-field" value={split} onChange={(event) => setSplit(event.target.value)}><option value="full_body">Full body</option><option value="upper_lower">Upper / lower</option><option value="push_pull_legs">Push / pull / legs</option><option value="custom">Custom</option></select></label><label className="grid gap-1.5 text-xs text-fitx-text-secondary">Training location<select className="fitx-field" value={planLocation} onChange={(event) => setPlanLocation(event.target.value)}><option value="gym">Gym</option><option value="home">Home</option><option value="outdoor">Outdoor</option><option value="both">Home or gym</option></select></label><label className="grid gap-1.5 text-xs text-fitx-text-secondary">Schedule date<input className="fitx-field" type="date" value={plannedFor} onChange={(event) => setPlannedFor(event.target.value)} /></label><label className="grid gap-1.5 text-xs text-fitx-text-secondary">Start time<input className="fitx-field" type="time" value={time} onChange={(event) => setTime(event.target.value)} disabled={!plannedFor} /></label><label className="grid gap-1.5 text-xs text-fitx-text-secondary sm:col-span-2 xl:col-span-1">Notes (optional)<input className="fitx-field" maxLength={500} value={planNotes} onChange={(event) => setPlanNotes(event.target.value)} placeholder="Short focus for this session" /></label></div>
        {mode === "custom" && <div className="mt-5"><div className="flex flex-col gap-2 sm:flex-row"><input className="fitx-field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search exercise or muscle" aria-label="Search exercises to add" /><span className="self-center text-xs text-fitx-text-secondary">{selected.length} selected</span></div><div className="mt-3 max-h-48 overflow-auto rounded-lg border border-fitx-border bg-fitx-surface">{filteredCatalog.map((exercise) => <label key={exercise.id} className="flex min-h-12 cursor-pointer items-center gap-3 border-b border-fitx-divider px-3 py-2.5 text-sm last:border-0 hover:bg-fitx-surface-variant"><input type="checkbox" checked={selected.includes(exercise.id)} onChange={() => toggleSelected(exercise)} className="h-4 w-4 accent-[var(--fitx-primary)]"/><span className="min-w-0 flex-1 truncate">{exercise.name}</span><span className="text-xs capitalize text-fitx-text-secondary">{exercise.primary_muscle.replaceAll("_", " ")}</span></label>)}</div></div>}
        <div className="mt-5"><div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">Exercise order <span className="font-normal text-fitx-text-secondary">· {preview.length}</span></h3>{mode === "auto" && <button onClick={() => setPreview(generateWorkout(catalog, { ...preferences, workout_split: split }).map((row) => ({ ...row, target_weight_kg: null, target_duration_seconds: null })))} className="text-xs font-semibold text-fitx-primary">Regenerate plan</button>}</div>{!showTargets && <p role="status" className="mb-3 flex items-start gap-2 rounded-lg border border-fitx-border bg-fitx-surface-variant px-3 py-2 text-xs text-fitx-text-secondary"><Info size={14} aria-hidden="true" className="mt-px shrink-0 text-fitx-info"/><span>{TARGETS_UNAVAILABLE_NOTICE}</span></p>}{preview.length ? <ol className="space-y-2">{preview.map((item, index) => <li key={item.exercise.id} className={showTargets ? "grid grid-cols-[2.5rem_minmax(0,1fr)_auto] gap-2 rounded-lg border border-fitx-border bg-fitx-surface p-3 lg:grid-cols-[2.5rem_minmax(8rem,1fr)_repeat(6,minmax(4rem,.35fr))_auto]" : "grid grid-cols-[2.5rem_minmax(0,1fr)_auto] gap-2 rounded-lg border border-fitx-border bg-fitx-surface p-3 lg:grid-cols-[2.5rem_minmax(8rem,1fr)_repeat(4,minmax(4rem,.35fr))_auto]"}><div className="flex flex-col items-center justify-center gap-1"><button type="button" onClick={() => movePreview(index, -1)} disabled={index === 0} aria-label={`Move ${item.exercise.name} earlier`} className="grid h-7 w-8 place-items-center rounded border border-fitx-border disabled:opacity-35"><ArrowUp size={13}/></button><span className="text-xs tabular-nums text-fitx-text-secondary">{String(index + 1).padStart(2, "0")}</span><button type="button" onClick={() => movePreview(index, 1)} disabled={index === preview.length - 1} aria-label={`Move ${item.exercise.name} later`} className="grid h-7 w-8 place-items-center rounded border border-fitx-border disabled:opacity-35"><ArrowDown size={13}/></button></div><span className="min-w-0 self-center"><span className="block truncate text-sm font-medium">{item.exercise.name}</span><span className="text-xs capitalize text-fitx-text-secondary">{item.exercise.primary_muscle.replaceAll("_", " ")}</span></span><div className={showTargets ? "col-span-3 grid grid-cols-2 gap-2 lg:col-span-6 lg:grid-cols-6" : "col-span-3 grid grid-cols-2 gap-2 lg:col-span-4 lg:grid-cols-4"}><label className="grid grid-cols-2 items-center gap-1 text-[10px] text-fitx-text-secondary sm:grid-cols-1">Sets<input aria-label={`${item.exercise.name} target sets`} className="fitx-field min-h-10 px-2 text-center tabular-nums" type="number" min="1" max="10" value={item.target_sets} onChange={(event) => updatePreview(index, "target_sets", Number(event.target.value))}/></label><label className="grid grid-cols-2 items-center gap-1 text-[10px] text-fitx-text-secondary sm:grid-cols-1">Reps min<input aria-label={`${item.exercise.name} minimum reps`} className="fitx-field min-h-10 px-2 text-center tabular-nums" type="number" min="1" max="100" value={item.reps_min} onChange={(event) => updatePreview(index, "reps_min", Number(event.target.value))}/></label><label className="grid grid-cols-2 items-center gap-1 text-[10px] text-fitx-text-secondary sm:grid-cols-1">Reps max<input aria-label={`${item.exercise.name} maximum reps`} className="fitx-field min-h-10 px-2 text-center tabular-nums" type="number" min="1" max="100" value={item.reps_max} onChange={(event) => updatePreview(index, "reps_max", Number(event.target.value))}/></label><label className="grid grid-cols-2 items-center gap-1 text-[10px] text-fitx-text-secondary sm:grid-cols-1">Rest sec<input aria-label={`${item.exercise.name} rest seconds`} className="fitx-field min-h-10 px-2 text-center tabular-nums" type="number" min="15" max="600" step="15" value={item.rest_seconds} onChange={(event) => updatePreview(index, "rest_seconds", Number(event.target.value))}/></label>{showTargets && <><label className="grid grid-cols-2 items-center gap-1 text-[10px] text-fitx-text-secondary lg:grid-cols-1">Target kg<input aria-label={`${item.exercise.name} target weight in kilograms`} className="fitx-field min-h-10 px-2 text-center tabular-nums" type="number" min="0" max="2000" step="0.5" value={item.target_weight_kg ?? ""} onChange={(event) => updateOptionalTarget(index, "target_weight_kg", event.target.value)} placeholder="—"/></label><label className="grid grid-cols-2 items-center gap-1 text-[10px] text-fitx-text-secondary lg:grid-cols-1">Target sec<input aria-label={`${item.exercise.name} target duration in seconds`} className="fitx-field min-h-10 px-2 text-center tabular-nums" type="number" min="1" max="7200" step="5" value={item.target_duration_seconds ?? ""} onChange={(event) => updateOptionalTarget(index, "target_duration_seconds", event.target.value)} placeholder="—"/></label></>}</div><button type="button" onClick={() => { const next = preview.filter((row) => row.exercise.id !== item.exercise.id).map((row, sort_order) => ({ ...row, sort_order })); setPreview(next); setSelected(next.map((row) => row.exercise.id)); }} aria-label={`Remove ${item.exercise.name}`} className="col-span-3 grid h-10 w-10 place-items-center self-center justify-self-end rounded border border-fitx-border text-fitx-text-secondary hover:text-fitx-primary lg:col-span-1"><X size={15}/></button></li>)}</ol> : <EmptyState title="No exercises in the plan" description="Select movements from the library, or check your equipment and location in Profile."/>}</div>
        {error && <p role="alert" className="mt-4 text-sm text-fitx-warning">{error}</p>}<div className="mt-6 flex flex-col-reverse justify-end gap-2 border-t border-fitx-divider pt-4 sm:flex-row"><button onClick={() => setCreatorOpen(false)} className="fitx-button fitx-button-quiet">Close</button><button disabled={saving || !preview.length} onClick={() => void savePlan()} className="fitx-button">{saving ? "Saving…" : editingPlanId ? "Save changes" : "Save workout"}<CalendarDays size={16}/></button></div>
      </div></div>}
    </div>
  );
}
