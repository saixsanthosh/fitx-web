"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUp, CalendarDays, Check, Clock3, Copy, Dumbbell, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { PageHeading } from "@/components/app/PageHeading";
import { EmptyState } from "@/components/app/EmptyState";
import { createClient } from "@/lib/supabase/client";
import { generateWorkout, type ExerciseRecord, type WorkoutPreferences } from "@/lib/domain/workout";
import { localDateKey, readableDate } from "@/lib/domain/dates";
import styles from "./Workouts.module.css";

type PlanRow = { id: string; title: string; planned_for: string | null; status: string; split: string };
type SessionRow = { id: string; name: string; started_at: string; duration_seconds: number; total_volume: number; status: string };
type PlannedExercise = { exercise: ExerciseRecord; sort_order: number; target_sets: number; reps_min: number; reps_max: number; rest_seconds: number; target_weight_kg: number | null; target_duration_seconds: number | null };
type PlanExerciseRow = { id: string; exercise_id: string | null; exercise_name: string; sort_order: number; target_sets: number; reps_min: number; reps_max: number; rest_seconds: number; target_weight_kg: number | null; target_duration_seconds: number | null };

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

  const load = useCallback(async () => {
    const supabase = createClient();
    if (!supabase) { setError("FITX is not connected to Supabase in this environment."); setLoading(false); return; }
    const auth = await supabase.auth.getUser();
    if (!auth.data.user) { setError("Sign in to manage your workouts."); setLoading(false); return; }
    const uid = auth.data.user.id;
    const results = await Promise.all([
      supabase.from("exercise_library").select("id,name,description,primary_muscle,secondary_muscles,equipment,locations,difficulty,movement_pattern,recommended_sets,reps_min,reps_max,rest_seconds,alternatives").eq("is_active", true).order("name").limit(1000),
      supabase.from("user_preferences").select("workout_location,equipment,fitness_level,session_duration_minutes,workout_split").eq("user_id", uid).maybeSingle(),
      supabase.from("workout_plans").select("id,title,planned_for,status,split").eq("user_id", uid).in("status", ["draft", "scheduled"]).order("planned_for", { ascending: true, nullsFirst: false }).limit(30),
      supabase.from("workout_sessions").select("id,name,started_at,duration_seconds,total_volume,status").eq("user_id", uid).eq("status", "completed").order("started_at", { ascending: false }).limit(30),
      supabase.from("workout_sessions").select("id,name,started_at,duration_seconds,total_volume,status").eq("user_id", uid).eq("status", "in_progress").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const failure = results.find((result) => result.error);
    if (failure?.error) { setError("Workouts could not load. Check your connection and try again."); setLoading(false); return; }
    setUserId(uid);
    setCatalog((results[0].data || []) as ExerciseRecord[]);
    setPreferences((results[1].data || {}) as WorkoutPreferences);
    setPlans((results[2].data || []) as PlanRow[]);
    setSessions((results[3].data || []) as SessionRow[]);
    setActiveSession(results[4].data as SessionRow | null);
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
    const timeout = window.setTimeout(() => card.classList.remove("plan-navigation-target"), 3500);
    return () => window.clearTimeout(timeout);
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
    setError(""); setSaving(true);
    const [planResult, exercisesResult, eventResult] = await Promise.all([
      supabase.from("workout_plans").select("id,title,planned_for,status,split,notes,workout_location").eq("id", plan.id).eq("user_id", userId).maybeSingle(),
      supabase.from("workout_plan_exercises").select("id,exercise_id,exercise_name,sort_order,target_sets,reps_min,reps_max,rest_seconds,target_weight_kg,target_duration_seconds").eq("plan_id", plan.id).eq("user_id", userId).order("sort_order"),
      supabase.from("planner_events").select("starts_at").eq("workout_plan_id", plan.id).eq("user_id", userId).eq("event_type", "workout").neq("status", "cancelled").order("starts_at", { ascending: true }).limit(1).maybeSingle(),
    ]);
    if (planResult.error || !planResult.data || exercisesResult.error) {
      setSaving(false); setError("This workout could not be opened for editing."); return;
    }
    const rows = (exercisesResult.data || []) as PlanExerciseRow[];
    const nextPreview = rows.flatMap((row) => {
      const exercise = catalog.find((item) => item.id === row.exercise_id);
      return exercise ? [{ exercise, sort_order: row.sort_order, target_sets: row.target_sets, reps_min: row.reps_min, reps_max: row.reps_max, rest_seconds: row.rest_seconds, target_weight_kg: row.target_weight_kg, target_duration_seconds: row.target_duration_seconds }] : [];
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
    setError(""); setSaving(true);
    const [planResult, exercisesResult] = await Promise.all([
      supabase.from("workout_plans").select("title,split,notes,workout_location").eq("id", plan.id).eq("user_id", userId).maybeSingle(),
      supabase.from("workout_plan_exercises").select("exercise_id,exercise_name,sort_order,target_sets,reps_min,reps_max,rest_seconds,target_weight_kg,target_duration_seconds").eq("plan_id", plan.id).eq("user_id", userId).order("sort_order"),
    ]);
    if (!planResult.data || exercisesResult.error || !exercisesResult.data?.length) { setSaving(false); setError("This workout could not be duplicated."); return; }
    const nextPreview = (exercisesResult.data as PlanExerciseRow[]).flatMap((row) => {
      const exercise = catalog.find((item) => item.id === row.exercise_id);
      return exercise ? [{ exercise, sort_order: row.sort_order, target_sets: row.target_sets, reps_min: row.reps_min, reps_max: row.reps_max, rest_seconds: row.rest_seconds, target_weight_kg: row.target_weight_kg, target_duration_seconds: row.target_duration_seconds }] : [];
    });
    if (!nextPreview.length) { setSaving(false); setError("The saved movements are no longer available in the active library."); return; }
    setMode("custom"); setEditingPlanId(null); setTitle(`${planResult.data.title} copy`); setPlanNotes(planResult.data.notes || ""); setSplit(planResult.data.split); setPlanLocation(planResult.data.workout_location || "gym"); setPlannedFor(""); setTime("18:00");
    setSelected(nextPreview.map((row) => row.exercise.id)); setPreview(nextPreview); setQuery(""); setCreatorOpen(true); setSaving(false);
  }

  async function deletePlan(plan: PlanRow) {
    if (!window.confirm(`Delete “${plan.title}” and its saved exercise order? Completed workout sessions will remain in your history.`)) return;
    const supabase = createClient();
    if (!supabase || !userId) return;
    const result = await supabase.from("workout_plans").delete().eq("id", plan.id).eq("user_id", userId);
    if (result.error) setError("That workout could not be deleted."); else await load();
  }

  async function savePlan() {
    setError("");
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

    if (editingPlanId) {
      const [currentPlan, currentExercises] = await Promise.all([
        supabase.from("workout_plans").select("title,split,workout_location,planned_for,status,notes").eq("id", editingPlanId).eq("user_id", userId).maybeSingle(),
        supabase.from("workout_plan_exercises").select("id,exercise_id,exercise_name,sort_order,target_sets,reps_min,reps_max,rest_seconds,target_weight_kg,target_duration_seconds").eq("plan_id", editingPlanId).eq("user_id", userId).order("sort_order"),
      ]);
      if (currentPlan.error || !currentPlan.data || currentExercises.error) {
        setSaving(false); return setError("The saved workout could not be prepared for an update.");
      }
      originalPlan = currentPlan.data;
      originalRows = (currentExercises.data || []) as PlanExerciseRow[];
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
    const savedExercises = await supabase.from("workout_plan_exercises").insert(rows);
    if (savedExercises.error) {
      let restored = true;
      if (editingPlanId && originalPlan) {
        if (originalRows.length) {
          const rollback = await supabase.from("workout_plan_exercises").insert(originalRows.map((row) => ({ user_id: userId, plan_id: editingPlanId, exercise_id: row.exercise_id, exercise_name: row.exercise_name, sort_order: row.sort_order, target_sets: row.target_sets, reps_min: row.reps_min, reps_max: row.reps_max, rest_seconds: row.rest_seconds, target_weight_kg: row.target_weight_kg, target_duration_seconds: row.target_duration_seconds })));
          restored = !rollback.error;
        }
        await supabase.from("workout_plans").update(originalPlan).eq("id", editingPlanId).eq("user_id", userId);
      } else if (planId) {
        await supabase.from("workout_plans").delete().eq("id", planId).eq("user_id", userId);
      }
      setSaving(false);
      return setError(restored ? "The workout exercises could not be saved. Your previous plan was restored." : "The workout update was interrupted. Reload this page and check the saved exercise list.");
    }

    const eventFilter = supabase.from("planner_events").select("id").eq("workout_plan_id", planId).eq("user_id", userId).eq("event_type", "workout");
    const existingEvents = await eventFilter;
    let scheduleWarning = "";
    if (existingEvents.error) {
      scheduleWarning = "Workout saved, but the planner link could not be checked. Review your planner before scheduling it again.";
    } else if (plannedFor) {
      const startsAt = new Date(`${plannedFor}T${time || "18:00"}:00`);
      const eventPatch = { title: title.trim(), starts_at: startsAt.toISOString(), ends_at: new Date(startsAt.getTime() + 3600000).toISOString(), status: "scheduled" };
      if (existingEvents.data?.length) {
        const updated = await supabase.from("planner_events").update(eventPatch).eq("workout_plan_id", planId).eq("user_id", userId).eq("event_type", "workout");
        if (updated.error) scheduleWarning = "Workout saved, but its planner event could not be updated.";
      } else {
        const scheduled = await supabase.from("planner_events").insert({ user_id: userId, event_type: "workout", workout_plan_id: planId, ...eventPatch });
        if (scheduled.error) scheduleWarning = "Workout saved, but its planner event could not be created.";
      }
    } else if (existingEvents.data?.length) {
      const cancelled = await supabase.from("planner_events").update({ status: "cancelled" }).eq("workout_plan_id", planId).eq("user_id", userId).eq("event_type", "workout");
      if (cancelled.error) scheduleWarning = "Workout saved, but its planner event could not be cleared.";
    }
    setSaving(false);
    setCreatorOpen(false);
    await load();
    if (scheduleWarning) setError(scheduleWarning);
  }

  async function startWorkout(planId: string) {
    const supabase = createClient();
    if (!supabase || !userId || starting) return;
    if (activeSession) { window.location.assign("/workouts/active?session=" + activeSession.id); return; }
    setError("");
    setStarting(planId);
    const plan = plans.find((item) => item.id === planId);
    const exerciseQuery = await supabase.from("workout_plan_exercises").select("exercise_id,exercise_name,sort_order,target_sets,reps_min,reps_max,rest_seconds,target_weight_kg,target_duration_seconds").eq("user_id", userId).eq("plan_id", planId).order("sort_order");
    if (!plan || exerciseQuery.error || !exerciseQuery.data?.length) {
      setStarting("");
      return setError("This workout plan has no exercises. Edit the plan and try again.");
    }
    const started = await supabase.from("workout_sessions").insert({ user_id: userId, plan_id: planId, name: plan.title, status: "in_progress" }).select("id").single();
    if (started.error || !started.data) { setStarting(""); return setError("Your workout could not be started. Please try again."); }
    const planExercises = exerciseQuery.data as Array<{ exercise_id: string | null; exercise_name: string; sort_order: number; target_sets: number; reps_min: number; reps_max: number; rest_seconds: number; target_weight_kg: number | null; target_duration_seconds: number | null }>;
    const insertedExercises = await supabase.from("workout_session_exercises").insert(planExercises.map((row, index) => ({
      user_id: userId, session_id: started.data.id, exercise_id: row.exercise_id, exercise_name: row.exercise_name,
      sort_order: index, target_sets: row.target_sets, reps_min: row.reps_min, reps_max: row.reps_max, rest_seconds: row.rest_seconds,
      target_weight_kg: row.target_weight_kg, target_duration_seconds: row.target_duration_seconds,
    }))).select("id,target_sets,reps_min,reps_max,target_weight_kg,target_duration_seconds");
    if (insertedExercises.error || !insertedExercises.data) {
      await supabase.from("workout_sessions").delete().eq("id", started.data.id).eq("user_id", userId);
      setStarting("");
      return setError("Your workout session could not be prepared. Please try again.");
    }
    const createdExerciseRows = insertedExercises.data as Array<{ id: string; target_sets: number; reps_min: number; reps_max: number; target_weight_kg: number | null }>;
    const setRows = createdExerciseRows.flatMap((item) => Array.from({ length: item.target_sets }, (_, index) => ({
      user_id: userId, session_exercise_id: item.id, set_number: index + 1,
      target_reps: Math.round((item.reps_min + item.reps_max) / 2), weight_kg: item.target_weight_kg ?? 0,
    })));
    const createdSets = await supabase.from("workout_sets").insert(setRows);
    if (createdSets.error) {
      await supabase.from("workout_sessions").delete().eq("id", started.data.id).eq("user_id", userId);
      setStarting("");
      return setError("Your workout session could not be prepared. Please try again.");
    }
    window.location.assign("/workouts/active?session=" + started.data.id);
  }

  if (loading) return <div className="animate-pulse space-y-4" aria-label="Loading workouts"><div className="h-9 w-1/3 rounded bg-fitx-surface-variant"/><div className="h-48 rounded-2xl bg-fitx-surface"/><div className="h-48 rounded-2xl bg-fitx-surface"/></div>;
  if (error && !userId) return <EmptyState title="Workouts unavailable" description={error} action={<button className="fitx-button fitx-button-secondary" onClick={() => { setLoading(true); void load(); }}>Try again</button>} />;

  return (
    <div className={`${styles.page} space-y-6`}>
      <PageHeading title="Workouts" description="Build a plan, record each set, and keep your training history in one place."
        actions={<div className={styles.headingActions}><button className={`fitx-button fitx-button-secondary ${styles.secondaryAction}`} onClick={() => openCreator("custom")}><Plus size={17}/>Custom workout</button><button className={`fitx-button ${styles.primaryAction}`} onClick={() => openCreator("auto")}><Sparkles size={16}/>Auto plan</button></div>} />
      {error && <p role="alert" className="rounded-lg border border-red-300/20 bg-red-300/5 px-3 py-2 text-sm text-red-200">{error}</p>}
      {activeSession && <div className={`${styles.activeSession} flex flex-col gap-3 rounded-xl border border-fitx-primary/30 bg-fitx-primary/[.06] p-4 sm:flex-row sm:items-center sm:justify-between`}><div><p className="text-sm font-medium">Workout in progress</p><p className="mt-1 text-xs text-fitx-text-secondary">{activeSession.name} · started {readableDate(new Date(activeSession.started_at), { hour: "numeric", minute: "2-digit" })}</p></div><Link className="fitx-button" href={"/workouts/active?session=" + activeSession.id}>Continue workout<ArrowRight size={16}/></Link></div>}
      <section aria-label="Workout totals" className={styles.metricsStrip}>
        <div className={styles.metric}><span className={styles.metricMark} aria-hidden="true"/><p className={styles.metricValue}>{sessions.length}</p><p className={styles.metricLabel}>Completed</p></div>
        <div className={styles.metric}><span className={styles.metricMark} aria-hidden="true"/><p className={styles.metricValue}>{plans.length}</p><p className={styles.metricLabel}>Saved plans</p></div>
        <div className={styles.metric}><span className={styles.metricMark} aria-hidden="true"/><p className={styles.metricValue}>{catalog.length}</p><p className={styles.metricLabel}>Exercises</p></div>
      </section>
      <section className={styles.plansSection}>
        <div className="mb-3 flex items-center justify-between"><div><h2 className="font-semibold">Your plans</h2><p className="mt-1 text-xs text-fitx-text-secondary">Auto plans use your level, available equipment, and session length.</p></div><Link href="/planner" className="text-xs font-medium text-fitx-primary">Open planner<ArrowRight className="ml-1 inline" size={14}/></Link></div>
        {plans.length ? <div className={styles.planList}>{plans.map((plan) => <article key={plan.id} id={`workout-plan-${plan.id}`} className={`${styles.planCard} fitx-panel flex flex-col gap-4 p-4 transition-colors sm:flex-row sm:items-center sm:p-5`}><div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-fitx-primary/10 text-fitx-primary"><Dumbbell size={20}/></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-medium">{plan.title}</h3><span className="rounded-sm bg-fitx-surface-variant px-2 py-1 text-[10px] capitalize text-fitx-text-secondary">{plan.status}</span></div><p className="mt-1 flex items-center gap-1.5 text-xs capitalize text-fitx-text-secondary"><CalendarDays size={13}/>{plan.planned_for ? readableDate(new Date(plan.planned_for + "T12:00:00")) : "No date set"} · {plan.split.replaceAll("_", " ")}</p></div><div className="flex flex-wrap items-center gap-2"><button className="fitx-button fitx-button-quiet min-h-11 px-3 text-xs" onClick={() => void editPlan(plan)} aria-label={"Edit " + plan.title}><Pencil size={14}/>Edit</button><button className="fitx-button fitx-button-quiet min-h-11 px-3 text-xs" onClick={() => void duplicatePlan(plan)} aria-label={"Duplicate " + plan.title}><Copy size={14}/>Copy</button><button className="fitx-button fitx-button-quiet min-h-11 px-3 text-xs" onClick={() => void deletePlan(plan)} aria-label={"Delete " + plan.title}><Trash2 size={14}/></button><button disabled={Boolean(starting)} className="fitx-button min-h-11 px-4 text-xs" onClick={() => void startWorkout(plan.id)}>{starting === plan.id ? "Starting…" : "Start"}<ArrowRight size={15}/></button></div></article>)}</div> : <div className={styles.plansEmpty}><EmptyState title="No workout plans yet" description="Generate a plan that respects your equipment and training level, or build one movement by movement." action={<button className="fitx-button" onClick={() => openCreator("auto")}><Sparkles size={16}/>Create a plan</button>} /></div>}
      </section>
      <section>
        <div className="mb-3 flex items-center justify-between"><div><h2 className="font-semibold">Recent history</h2><p className="mt-1 text-xs text-fitx-text-secondary">Sessions you’ve finished.</p></div><Link href="/progress" className="text-xs font-medium text-fitx-primary">View progress</Link></div>
        {sessions.length ? <div className={`${styles.historyList} fitx-panel divide-y divide-fitx-divider px-4 sm:px-5`}>{sessions.slice(0, 6).map((session) => <div key={session.id} className="flex items-center justify-between gap-4 py-4"><div className="flex min-w-0 items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-fitx-surface text-fitx-primary"><Check size={18}/></span><div className="min-w-0"><p className="truncate text-sm font-medium">{session.name}</p><p className="mt-1 flex items-center gap-1.5 text-xs text-fitx-text-secondary"><Clock3 size={12}/>{readableDate(new Date(session.started_at), { weekday: "short", month: "short", day: "numeric" })} · {Math.round(session.duration_seconds / 60)} min</p></div></div><span className="shrink-0 text-xs text-fitx-text-secondary">{Math.round(session.total_volume).toLocaleString()} kg</span></div>)}</div> : <EmptyState title="No completed workouts yet" description="Your history will appear here after your first finished session." action={<Link className="fitx-button fitx-button-secondary" href="/exercises">Browse exercises</Link>} />}
      </section>
      <section className={`${styles.library} fitx-panel p-5`}><div className="mb-3 flex items-center justify-between gap-3"><div><h2 className="font-semibold">Exercise library</h2><p className="mt-1 text-xs text-fitx-text-secondary">{catalog.length} movements with instructions, equipment, and alternatives.</p></div><Link href="/exercises" className="text-xs font-medium text-fitx-primary">Open library<ArrowRight className="ml-1 inline" size={14}/></Link></div><div className={styles.libraryGrid}>{catalog.slice(0, 6).map((exercise) => <Link key={exercise.id} href={"/exercises/" + exercise.id} className={styles.exerciseCard}><span className={styles.exerciseMark} aria-hidden="true"><Dumbbell size={15}/></span><span className={styles.exerciseText}><span className={styles.exerciseName}>{exercise.name}</span><span className={styles.exerciseMeta}>{exercise.primary_muscle} · {exercise.difficulty}</span></span><ArrowRight size={14} aria-hidden="true"/></Link>)}</div></section>
      {creatorOpen && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="builder-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreatorOpen(false); }}><div ref={builderRef} className="max-h-[94dvh] w-full max-w-4xl overflow-y-auto rounded-t-xl border border-fitx-border bg-background p-4 shadow-2xl sm:max-h-[90dvh] sm:rounded-xl sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.15em] text-fitx-primary">Workout builder</p><h2 id="builder-title" className="mt-1 text-xl font-semibold">{editingPlanId ? "Edit workout plan" : mode === "auto" ? "Build a personalized plan" : "Create a workout"}</h2><p className="mt-1 text-sm text-fitx-text-secondary">Set your order and rep targets before you save.</p></div><button onClick={() => setCreatorOpen(false)} aria-label="Close workout builder" className="grid h-10 w-10 place-items-center rounded-md border border-fitx-border text-fitx-text-secondary hover:text-fitx-text"><X size={18}/></button></div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><label className="grid gap-1.5 text-xs text-fitx-text-secondary">Workout name<input className="fitx-field" maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label className="grid gap-1.5 text-xs text-fitx-text-secondary">Training split<select className="fitx-field" value={split} onChange={(event) => setSplit(event.target.value)}><option value="full_body">Full body</option><option value="upper_lower">Upper / lower</option><option value="push_pull_legs">Push / pull / legs</option><option value="custom">Custom</option></select></label><label className="grid gap-1.5 text-xs text-fitx-text-secondary">Training location<select className="fitx-field" value={planLocation} onChange={(event) => setPlanLocation(event.target.value)}><option value="gym">Gym</option><option value="home">Home</option><option value="outdoor">Outdoor</option><option value="both">Home or gym</option></select></label><label className="grid gap-1.5 text-xs text-fitx-text-secondary">Schedule date<input className="fitx-field" type="date" value={plannedFor} onChange={(event) => setPlannedFor(event.target.value)} /></label><label className="grid gap-1.5 text-xs text-fitx-text-secondary">Start time<input className="fitx-field" type="time" value={time} onChange={(event) => setTime(event.target.value)} disabled={!plannedFor} /></label><label className="grid gap-1.5 text-xs text-fitx-text-secondary sm:col-span-2 xl:col-span-1">Notes (optional)<input className="fitx-field" maxLength={500} value={planNotes} onChange={(event) => setPlanNotes(event.target.value)} placeholder="Short focus for this session" /></label></div>
        {mode === "custom" && <div className="mt-5"><div className="flex flex-col gap-2 sm:flex-row"><input className="fitx-field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search exercise or muscle" aria-label="Search exercises to add" /><span className="self-center text-xs text-fitx-text-disabled">{selected.length} selected</span></div><div className="mt-3 max-h-48 overflow-auto rounded-lg border border-fitx-border bg-fitx-surface">{filteredCatalog.map((exercise) => <label key={exercise.id} className="flex min-h-12 cursor-pointer items-center gap-3 border-b border-fitx-divider px-3 py-2.5 text-sm last:border-0 hover:bg-fitx-surface-variant"><input type="checkbox" checked={selected.includes(exercise.id)} onChange={() => toggleSelected(exercise)} className="h-4 w-4 accent-[var(--fitx-primary)]"/><span className="min-w-0 flex-1 truncate">{exercise.name}</span><span className="text-xs capitalize text-fitx-text-disabled">{exercise.primary_muscle.replaceAll("_", " ")}</span></label>)}</div></div>}
        <div className="mt-5"><div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">Exercise order <span className="font-normal text-fitx-text-disabled">· {preview.length}</span></h3>{mode === "auto" && <button onClick={() => setPreview(generateWorkout(catalog, { ...preferences, workout_split: split }).map((row) => ({ ...row, target_weight_kg: null, target_duration_seconds: null })))} className="text-xs font-semibold text-fitx-primary">Regenerate plan</button>}</div>{preview.length ? <ol className="space-y-2">{preview.map((item, index) => <li key={item.exercise.id} className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] gap-2 rounded-lg border border-fitx-border bg-fitx-surface p-3 lg:grid-cols-[2.5rem_minmax(8rem,1fr)_repeat(6,minmax(4rem,.35fr))_auto]"><div className="flex flex-col items-center justify-center gap-1"><button type="button" onClick={() => movePreview(index, -1)} disabled={index === 0} aria-label={`Move ${item.exercise.name} earlier`} className="grid h-7 w-8 place-items-center rounded border border-fitx-border disabled:opacity-35"><ArrowUp size={13}/></button><span className="text-xs tabular-nums text-fitx-text-disabled">{String(index + 1).padStart(2, "0")}</span><button type="button" onClick={() => movePreview(index, 1)} disabled={index === preview.length - 1} aria-label={`Move ${item.exercise.name} later`} className="grid h-7 w-8 place-items-center rounded border border-fitx-border disabled:opacity-35"><ArrowDown size={13}/></button></div><span className="min-w-0 self-center"><span className="block truncate text-sm font-medium">{item.exercise.name}</span><span className="text-xs capitalize text-fitx-text-secondary">{item.exercise.primary_muscle.replaceAll("_", " ")}</span></span><div className="col-span-3 grid grid-cols-2 gap-2 lg:col-span-6 lg:grid-cols-6"><label className="grid grid-cols-2 items-center gap-1 text-[10px] text-fitx-text-disabled sm:grid-cols-1">Sets<input aria-label={`${item.exercise.name} target sets`} className="fitx-field min-h-10 px-2 text-center tabular-nums" type="number" min="1" max="10" value={item.target_sets} onChange={(event) => updatePreview(index, "target_sets", Number(event.target.value))}/></label><label className="grid grid-cols-2 items-center gap-1 text-[10px] text-fitx-text-disabled sm:grid-cols-1">Reps min<input aria-label={`${item.exercise.name} minimum reps`} className="fitx-field min-h-10 px-2 text-center tabular-nums" type="number" min="1" max="100" value={item.reps_min} onChange={(event) => updatePreview(index, "reps_min", Number(event.target.value))}/></label><label className="grid grid-cols-2 items-center gap-1 text-[10px] text-fitx-text-disabled sm:grid-cols-1">Reps max<input aria-label={`${item.exercise.name} maximum reps`} className="fitx-field min-h-10 px-2 text-center tabular-nums" type="number" min="1" max="100" value={item.reps_max} onChange={(event) => updatePreview(index, "reps_max", Number(event.target.value))}/></label><label className="grid grid-cols-2 items-center gap-1 text-[10px] text-fitx-text-disabled sm:grid-cols-1">Rest sec<input aria-label={`${item.exercise.name} rest seconds`} className="fitx-field min-h-10 px-2 text-center tabular-nums" type="number" min="15" max="600" step="15" value={item.rest_seconds} onChange={(event) => updatePreview(index, "rest_seconds", Number(event.target.value))}/></label><label className="grid grid-cols-2 items-center gap-1 text-[10px] text-fitx-text-disabled lg:grid-cols-1">Target kg<input aria-label={`${item.exercise.name} target weight in kilograms`} className="fitx-field min-h-10 px-2 text-center tabular-nums" type="number" min="0" max="2000" step="0.5" value={item.target_weight_kg ?? ""} onChange={(event) => updateOptionalTarget(index, "target_weight_kg", event.target.value)} placeholder="—"/></label><label className="grid grid-cols-2 items-center gap-1 text-[10px] text-fitx-text-disabled lg:grid-cols-1">Target sec<input aria-label={`${item.exercise.name} target duration in seconds`} className="fitx-field min-h-10 px-2 text-center tabular-nums" type="number" min="1" max="7200" step="5" value={item.target_duration_seconds ?? ""} onChange={(event) => updateOptionalTarget(index, "target_duration_seconds", event.target.value)} placeholder="—"/></label></div><button type="button" onClick={() => { const next = preview.filter((row) => row.exercise.id !== item.exercise.id).map((row, sort_order) => ({ ...row, sort_order })); setPreview(next); setSelected(next.map((row) => row.exercise.id)); }} aria-label={`Remove ${item.exercise.name}`} className="col-span-3 grid h-10 w-10 place-items-center self-center justify-self-end rounded border border-fitx-border text-fitx-text-disabled hover:text-fitx-primary lg:col-span-1"><X size={15}/></button></li>)}</ol> : <EmptyState title="No exercises in the plan" description="Select movements from the library, or check your equipment and location in Profile."/>}</div>
        {error && <p role="alert" className="mt-4 text-sm text-fitx-warning">{error}</p>}<div className="mt-6 flex flex-col-reverse justify-end gap-2 border-t border-fitx-divider pt-4 sm:flex-row"><button onClick={() => setCreatorOpen(false)} className="fitx-button fitx-button-quiet">Close</button><button disabled={saving || !preview.length} onClick={() => void savePlan()} className="fitx-button">{saving ? "Saving…" : editingPlanId ? "Save changes" : "Save workout"}<CalendarDays size={16}/></button></div>
      </div></div>}
    </div>
  );
}
