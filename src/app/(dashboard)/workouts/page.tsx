"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarDays, Check, Clock3, Dumbbell, Plus, Sparkles, X } from "lucide-react";
import { PageHeading } from "@/components/app/PageHeading";
import { EmptyState } from "@/components/app/EmptyState";
import { createClient } from "@/lib/supabase/client";
import { generateWorkout, type ExerciseRecord, type WorkoutPreferences } from "@/lib/domain/workout";
import { localDateKey, readableDate } from "@/lib/domain/dates";

type PlanRow = { id: string; title: string; planned_for: string | null; status: string; split: string };
type SessionRow = { id: string; name: string; started_at: string; duration_seconds: number; total_volume: number; status: string };
type PlannedExercise = { exercise: ExerciseRecord; sort_order: number; target_sets: number; reps_min: number; reps_max: number; rest_seconds: number };

export default function WorkoutsPage() {
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
  const [title, setTitle] = useState("Training session");
  const [split, setSplit] = useState("full_body");
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
      supabase.from("exercise_library").select("id,name,description,primary_muscle,secondary_muscles,equipment,locations,difficulty,movement_pattern,recommended_sets,reps_min,reps_max,rest_seconds,alternatives").eq("is_active", true).order("name").limit(300),
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

  const filteredCatalog = useMemo(() => {
    const value = query.trim().toLowerCase();
    return catalog.filter((item) => !value || item.name.toLowerCase().includes(value) || item.primary_muscle.toLowerCase().includes(value)).slice(0, 30);
  }, [catalog, query]);

  function openCreator(nextMode: "auto" | "custom") {
    setMode(nextMode);
    setTitle(nextMode === "auto" ? "Personalized workout" : "Custom workout");
    setSplit(preferences.workout_split || "full_body");
    setPlannedFor(localDateKey());
    setTime("18:00");
    setSelected([]);
    setQuery("");
    const generated = nextMode === "auto" ? generateWorkout(catalog, preferences) : [];
    setPreview(generated);
    setCreatorOpen(true);
    setError("");
  }

  function updateCustomPreview() {
    const items = selected.map((id) => catalog.find((item) => item.id === id)).filter((item): item is ExerciseRecord => Boolean(item));
    setPreview(items.map((exercise, index) => ({
      exercise, sort_order: index, target_sets: exercise.recommended_sets, reps_min: exercise.reps_min,
      reps_max: exercise.reps_max, rest_seconds: exercise.rest_seconds,
    })));
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
    const inserted = await supabase.from("workout_plans").insert({
      user_id: userId, title: title.trim(), split, workout_location: preferences.workout_location || "gym",
      planned_for: plannedFor || null, status: plannedFor ? "scheduled" : "draft",
    }).select("id").single();
    if (inserted.error || !inserted.data) { setSaving(false); return setError("The workout could not be saved. Please try again."); }
    const rows = preview.map((item) => ({
      user_id: userId, plan_id: inserted.data.id, exercise_id: item.exercise.id, exercise_name: item.exercise.name,
      sort_order: item.sort_order, target_sets: item.target_sets, reps_min: item.reps_min,
      reps_max: item.reps_max, rest_seconds: item.rest_seconds,
    }));
    const savedExercises = await supabase.from("workout_plan_exercises").insert(rows);
    if (savedExercises.error) {
      await supabase.from("workout_plans").delete().eq("id", inserted.data.id).eq("user_id", userId);
      setSaving(false);
      return setError("The workout exercises could not be saved. Please try again.");
    }
    if (plannedFor) {
      const startsAt = new Date(plannedFor + "T" + (time || "18:00") + ":00");
      const scheduled = await supabase.from("planner_events").insert({
        user_id: userId, event_type: "workout", title: title.trim(), starts_at: startsAt.toISOString(),
        ends_at: new Date(startsAt.getTime() + 3600000).toISOString(), workout_plan_id: inserted.data.id,
      });
      if (scheduled.error) {
        await supabase.from("workout_plans").delete().eq("id", inserted.data.id).eq("user_id", userId);
        setSaving(false);
        return setError("The workout was not scheduled. Please try again.");
      }
    }
    setSaving(false);
    setCreatorOpen(false);
    await load();
  }

  async function startWorkout(planId: string) {
    const supabase = createClient();
    if (!supabase || !userId || starting) return;
    if (activeSession) { window.location.assign("/workouts/active?session=" + activeSession.id); return; }
    setError("");
    setStarting(planId);
    const plan = plans.find((item) => item.id === planId);
    const exerciseQuery = await supabase.from("workout_plan_exercises").select("exercise_id,exercise_name,sort_order,target_sets,reps_min,reps_max,rest_seconds").eq("user_id", userId).eq("plan_id", planId).order("sort_order");
    if (!plan || exerciseQuery.error || !exerciseQuery.data?.length) {
      setStarting("");
      return setError("This workout plan has no exercises. Edit the plan and try again.");
    }
    const started = await supabase.from("workout_sessions").insert({ user_id: userId, plan_id: planId, name: plan.title, status: "in_progress" }).select("id").single();
    if (started.error || !started.data) { setStarting(""); return setError("Your workout could not be started. Please try again."); }
    const planExercises = exerciseQuery.data as Array<{ exercise_id: string | null; exercise_name: string; sort_order: number; target_sets: number; reps_min: number; reps_max: number; rest_seconds: number }>;
    const insertedExercises = await supabase.from("workout_session_exercises").insert(planExercises.map((row, index) => ({
      user_id: userId, session_id: started.data.id, exercise_id: row.exercise_id, exercise_name: row.exercise_name,
      sort_order: index, target_sets: row.target_sets, reps_min: row.reps_min, reps_max: row.reps_max, rest_seconds: row.rest_seconds,
    }))).select("id,target_sets,reps_min,reps_max");
    if (insertedExercises.error || !insertedExercises.data) {
      await supabase.from("workout_sessions").delete().eq("id", started.data.id).eq("user_id", userId);
      setStarting("");
      return setError("Your workout session could not be prepared. Please try again.");
    }
    const createdExerciseRows = insertedExercises.data as Array<{ id: string; target_sets: number; reps_min: number; reps_max: number }>;
    const setRows = createdExerciseRows.flatMap((item) => Array.from({ length: item.target_sets }, (_, index) => ({
      user_id: userId, session_exercise_id: item.id, set_number: index + 1,
      target_reps: Math.round((item.reps_min + item.reps_max) / 2), weight_kg: 0,
    })));
    const createdSets = await supabase.from("workout_sets").insert(setRows);
    if (createdSets.error) {
      await supabase.from("workout_sessions").delete().eq("id", started.data.id).eq("user_id", userId);
      setStarting("");
      return setError("Your workout session could not be prepared. Please try again.");
    }
    window.location.assign("/workouts/active?session=" + started.data.id);
  }

  async function cancelPlan(planId: string) {
    const supabase = createClient();
    if (!supabase || !userId) return;
    const result = await supabase.from("workout_plans").update({ status: "cancelled" }).eq("id", planId).eq("user_id", userId);
    if (result.error) setError("That plan could not be cancelled.");
    else await load();
  }

  if (loading) return <div className="animate-pulse space-y-4" aria-label="Loading workouts"><div className="h-9 w-1/3 rounded bg-fitx-surface-variant"/><div className="h-48 rounded-2xl bg-fitx-surface"/><div className="h-48 rounded-2xl bg-fitx-surface"/></div>;
  if (error && !userId) return <EmptyState title="Workouts unavailable" description={error} action={<button className="fitx-button fitx-button-secondary" onClick={() => { setLoading(true); void load(); }}>Try again</button>} />;

  return (
    <div className="space-y-6">
      <PageHeading title="Workouts" description="Build a plan, record each set, and keep your training history in one place."
        actions={<><button className="fitx-button fitx-button-secondary" onClick={() => openCreator("custom")}><Plus size={17}/>Custom workout</button><button className="fitx-button" onClick={() => openCreator("auto")}><Sparkles size={16}/>Auto plan</button></>} />
      {error && <p role="alert" className="rounded-lg border border-red-300/20 bg-red-300/5 px-3 py-2 text-sm text-red-200">{error}</p>}
      {activeSession && <div className="flex flex-col gap-3 rounded-xl border border-fitx-primary/30 bg-fitx-primary/[.06] p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium">Workout in progress</p><p className="mt-1 text-xs text-fitx-text-secondary">{activeSession.name} · started {readableDate(new Date(activeSession.started_at), { hour: "numeric", minute: "2-digit" })}</p></div><Link className="fitx-button" href={"/workouts/active?session=" + activeSession.id}>Continue workout<ArrowRight size={16}/></Link></div>}
      <section className="grid gap-3 sm:grid-cols-3">
        <div className="fitx-panel p-4"><p className="text-xs text-fitx-text-secondary">Completed workouts</p><p className="mt-1 text-2xl font-semibold tabular-nums">{sessions.length}</p></div>
        <div className="fitx-panel p-4"><p className="text-xs text-fitx-text-secondary">Saved plans</p><p className="mt-1 text-2xl font-semibold tabular-nums">{plans.length}</p></div>
        <div className="fitx-panel p-4"><p className="text-xs text-fitx-text-secondary">Exercise library</p><p className="mt-1 text-2xl font-semibold tabular-nums">{catalog.length}</p></div>
      </section>
      <section>
        <div className="mb-3 flex items-center justify-between"><div><h2 className="font-semibold">Your plans</h2><p className="mt-1 text-xs text-fitx-text-secondary">Auto plans use your level, available equipment, and session length.</p></div><Link href="/planner" className="text-xs font-medium text-fitx-primary">Open planner<ArrowRight className="ml-1 inline" size={14}/></Link></div>
        {plans.length ? <div className="space-y-3">{plans.map((plan) => <article key={plan.id} className="fitx-panel flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-fitx-primary/10 text-fitx-primary"><Dumbbell size={20}/></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-medium">{plan.title}</h3><span className="rounded-full bg-fitx-surface-variant px-2 py-1 text-[10px] capitalize text-fitx-text-secondary">{plan.status}</span></div><p className="mt-1 flex items-center gap-1.5 text-xs capitalize text-fitx-text-secondary"><CalendarDays size={13}/>{plan.planned_for ? readableDate(new Date(plan.planned_for + "T12:00:00")) : "No date set"} · {plan.split.replaceAll("_", " ")}</p></div><div className="flex items-center gap-2"><button className="fitx-button fitx-button-quiet min-h-10 px-3 text-xs" onClick={() => void cancelPlan(plan.id)} aria-label={"Cancel " + plan.title}><X size={15}/>Cancel</button><button disabled={Boolean(starting)} className="fitx-button min-h-10 px-4 text-xs" onClick={() => void startWorkout(plan.id)}>{starting === plan.id ? "Starting…" : "Start"}<ArrowRight size={15}/></button></div></article>)}</div> : <EmptyState title="No workout plans yet" description="Generate a plan that respects your equipment and training level, or build one movement by movement." action={<button className="fitx-button" onClick={() => openCreator("auto")}><Sparkles size={16}/>Create a plan</button>} />}
      </section>
      <section>
        <div className="mb-3 flex items-center justify-between"><div><h2 className="font-semibold">Recent history</h2><p className="mt-1 text-xs text-fitx-text-secondary">Sessions you’ve finished.</p></div><Link href="/progress" className="text-xs font-medium text-fitx-primary">View progress</Link></div>
        {sessions.length ? <div className="fitx-panel divide-y divide-fitx-divider px-4 sm:px-5">{sessions.slice(0, 6).map((session) => <div key={session.id} className="flex items-center justify-between gap-4 py-4"><div className="flex min-w-0 items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-fitx-surface text-fitx-primary"><Check size={18}/></span><div className="min-w-0"><p className="truncate text-sm font-medium">{session.name}</p><p className="mt-1 flex items-center gap-1.5 text-xs text-fitx-text-secondary"><Clock3 size={12}/>{readableDate(new Date(session.started_at), { weekday: "short", month: "short", day: "numeric" })} · {Math.round(session.duration_seconds / 60)} min</p></div></div><span className="shrink-0 text-xs text-fitx-text-secondary">{Math.round(session.total_volume).toLocaleString()} kg</span></div>)}</div> : <EmptyState title="No completed workouts yet" description="Your history will appear here after your first finished session." action={<Link className="fitx-button fitx-button-secondary" href="/exercises">Browse exercises</Link>} />}
      </section>
      <section className="fitx-panel p-5"><div className="mb-3 flex items-center justify-between gap-3"><div><h2 className="font-semibold">Exercise library</h2><p className="mt-1 text-xs text-fitx-text-secondary">{catalog.length} movements with instructions, equipment, and alternatives.</p></div><Link href="/exercises" className="text-xs font-medium text-fitx-primary">Open library<ArrowRight className="ml-1 inline" size={14}/></Link></div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{catalog.slice(0, 6).map((exercise) => <Link key={exercise.id} href={"/exercises/" + exercise.id} className="rounded-lg border border-fitx-border bg-fitx-surface p-3 hover:border-fitx-primary/35"><p className="text-sm font-medium">{exercise.name}</p><p className="mt-1 text-xs capitalize text-fitx-text-secondary">{exercise.primary_muscle} · {exercise.difficulty}</p></Link>)}</div></section>
      {creatorOpen && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="builder-title"><div className="max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-t-2xl border border-fitx-border bg-[#0c1213] p-5 sm:rounded-2xl sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-3"><div><h2 id="builder-title" className="text-xl font-semibold">{mode === "auto" ? "Build an auto plan" : "Create a custom workout"}</h2><p className="mt-1 text-sm text-fitx-text-secondary">Edit the exercise list before saving it to your planner.</p></div><button onClick={() => setCreatorOpen(false)} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-lg text-fitx-text-secondary hover:bg-white/[.05]"><X size={18}/></button></div>
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-fitx-text-secondary">Workout name<input className="fitx-field mt-1.5" maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label className="text-xs text-fitx-text-secondary">Training split<select className="fitx-field mt-1.5" value={split} onChange={(event) => setSplit(event.target.value)}><option value="full_body">Full body</option><option value="upper_lower">Upper / lower</option><option value="push_pull_legs">Push / pull / legs</option><option value="custom">Custom</option></select></label><label className="text-xs text-fitx-text-secondary">Schedule date<input className="fitx-field mt-1.5" type="date" value={plannedFor} onChange={(event) => setPlannedFor(event.target.value)} /></label><label className="text-xs text-fitx-text-secondary">Start time<input className="fitx-field mt-1.5" type="time" value={time} onChange={(event) => setTime(event.target.value)} /></label></div>
        {mode === "custom" && <div className="mt-5"><div className="flex flex-col gap-2 sm:flex-row"><input className="fitx-field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search exercise or muscle" /><button type="button" onClick={updateCustomPreview} className="fitx-button fitx-button-secondary min-h-11">Update preview</button></div><div className="mt-3 max-h-40 overflow-auto rounded-lg border border-fitx-border">{filteredCatalog.map((exercise) => <label key={exercise.id} className="flex cursor-pointer items-center gap-3 border-b border-fitx-divider px-3 py-2.5 text-sm last:border-0"><input type="checkbox" checked={selected.includes(exercise.id)} onChange={() => setSelected((items) => items.includes(exercise.id) ? items.filter((id) => id !== exercise.id) : [...items, exercise.id])} className="accent-[#79df83]"/><span className="flex-1">{exercise.name}</span><span className="text-xs capitalize text-fitx-text-disabled">{exercise.primary_muscle}</span></label>)}</div></div>}
        <div className="mt-5"><div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-medium">Preview · {preview.length} exercises</h3>{mode === "auto" && <button onClick={() => setPreview(generateWorkout(catalog, { ...preferences, workout_split: split }))} className="text-xs text-fitx-primary">Regenerate</button>}</div>{preview.length ? <ol className="space-y-2">{preview.map((item, index) => <li key={item.exercise.id} className="flex items-center gap-3 rounded-lg border border-fitx-border bg-fitx-surface px-3 py-2.5"><span className="w-6 text-xs text-fitx-text-disabled">{index + 1}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{item.exercise.name}</span><span className="text-xs capitalize text-fitx-text-secondary">{item.exercise.primary_muscle} · {item.target_sets} sets · {item.reps_min}–{item.reps_max} reps</span></span>{mode === "custom" && <button onClick={() => setPreview((rows) => rows.filter((row) => row.exercise.id !== item.exercise.id).map((row, sort_order) => ({ ...row, sort_order })))} aria-label={"Remove " + item.exercise.name} className="text-fitx-text-disabled hover:text-red-300"><X size={16}/></button>}</li>)}</ol> : <EmptyState title="No exercises in the plan" description="Select movements from the custom list, or check your equipment and location in Profile."/>}</div>
        {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}<div className="mt-6 flex justify-end gap-2 border-t border-fitx-divider pt-4"><button onClick={() => setCreatorOpen(false)} className="fitx-button fitx-button-quiet">Close</button><button disabled={saving || !preview.length} onClick={() => void savePlan()} className="fitx-button">{saving ? "Saving…" : "Save to planner"}<CalendarDays size={16}/></button></div>
      </div></div>}
    </div>
  );
}
