"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Clock3, Plus, Timer, Trophy } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { PageHeading } from "@/components/app/PageHeading";
import { createClient } from "@/lib/supabase/client";
import { estimateOneRepMax } from "@/lib/domain/workout";

type SetItem = { id: string; set_number: number; target_reps: number | null; reps: number | null; weight_kg: number; completed_at: string | null; draftWeight: string; draftReps: string };
type ExerciseItem = { id: string; name: string; target_sets: number; rest_seconds: number; sort_order: number; sets: SetItem[] };
type Session = { id: string; user_id: string; plan_id: string | null; name: string; started_at: string; status: string };

export default function ActiveWorkoutPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [exercises, setExercises] = useState<ExerciseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [restRemaining, setRestRemaining] = useState(0);
  const [finished, setFinished] = useState(false);
  const [summary, setSummary] = useState({ duration: 0, volume: 0, sets: 0, records: 0 });

  const load = useCallback(async (id: string) => {
    if (!id) { setLoading(false); setError("Start a workout from your workout plans to open a session."); return; }
    const supabase = createClient();
    if (!supabase) { setLoading(false); setError("FITX is not connected to Supabase."); return; }
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setLoading(false); setError("Sign in to open this workout."); return; }
    const sessionResult = await supabase.from("workout_sessions").select("id,user_id,plan_id,name,started_at,status").eq("id", id).eq("user_id", auth.user.id).maybeSingle();
    if (!sessionResult.data) { setLoading(false); setError("This workout session could not be found."); return; }
    const { data: exerciseRows, error: exerciseError } = await supabase.from("workout_session_exercises").select("id,exercise_name,target_sets,rest_seconds,sort_order").eq("user_id", auth.user.id).eq("session_id", id).order("sort_order");
    if (exerciseError) { setLoading(false); setError("The workout exercises could not be loaded."); return; }
    const exerciseIds = ((exerciseRows || []) as Array<{ id: string }>).map((row) => row.id);
    const { data: setRows, error: setResultError } = exerciseIds.length
      ? await supabase.from("workout_sets").select("id,session_exercise_id,set_number,target_reps,reps,weight_kg,completed_at").eq("user_id", auth.user.id).in("session_exercise_id", exerciseIds).order("set_number")
      : { data: [], error: null };
    if (setResultError) { setLoading(false); setError("Your workout sets could not be loaded."); return; }
    setSession(sessionResult.data as Session);
    const exerciseList = (exerciseRows || []) as Array<{ id: string; exercise_name: string; target_sets: number; rest_seconds: number; sort_order: number }>;
    const setList = (setRows || []) as Array<{ id: string; session_exercise_id: string; set_number: number; target_reps: number | null; reps: number | null; weight_kg: number; completed_at: string | null }>;
    setExercises(exerciseList.map((row) => ({
      id: row.id, name: row.exercise_name, target_sets: row.target_sets, rest_seconds: row.rest_seconds, sort_order: row.sort_order,
      sets: setList.filter((set) => set.session_exercise_id === row.id).map((set) => ({
        ...set, weight_kg: Number(set.weight_kg || 0), draftWeight: String(set.weight_kg || ""), draftReps: set.reps == null ? String(set.target_reps || "") : String(set.reps),
      })),
    })));
    setLoading(false); setError("");
  }, []);

  useEffect(() => { const id = new URLSearchParams(window.location.search).get("session") || ""; void Promise.resolve().then(() => load(id)); }, [load]);
  useEffect(() => { if (!restRemaining) return; const timer = window.setTimeout(() => setRestRemaining((value) => Math.max(0, value - 1)), 1000); return () => window.clearTimeout(timer); }, [restRemaining]);

  const completedSets = useMemo(() => exercises.flatMap((exercise) => exercise.sets.filter((set) => Boolean(set.completed_at))), [exercises]);

  function changeSet(exerciseId: string, setId: string, field: "draftWeight" | "draftReps", value: string) {
    setExercises((items) => items.map((exercise) => exercise.id !== exerciseId ? exercise : {
      ...exercise, sets: exercise.sets.map((set) => set.id === setId ? { ...set, [field]: value } : set),
    }));
  }

  async function saveSet(exerciseId: string, set: SetItem, complete: boolean) {
    const weight = Number(set.draftWeight || 0); const reps = Number(set.draftReps || 0);
    if (!Number.isFinite(weight) || weight < 0 || weight > 2000 || !Number.isInteger(reps) || reps < 0 || reps > 500) { setError("Enter a valid weight and rep count."); return; }
    const supabase = createClient(); if (!supabase) return;
    const patch = { weight_kg: weight, reps, completed_at: complete ? new Date().toISOString() : null };
    const { error: updateError } = await supabase.from("workout_sets").update(patch).eq("id", set.id);
    if (updateError) { setError("That set could not be saved."); return; }
    setExercises((items) => items.map((exercise) => exercise.id !== exerciseId ? exercise : {
      ...exercise, sets: exercise.sets.map((item) => item.id === set.id ? { ...item, ...patch, draftWeight: String(weight), draftReps: String(reps) } : item),
    }));
    setError("");
    if (complete) setRestRemaining(exercises.find((item) => item.id === exerciseId)?.rest_seconds || 90);
  }

  async function addSet(exercise: ExerciseItem) {
    const supabase = createClient(); if (!supabase || !session) return;
    const next = exercise.sets.length + 1;
    const inserted = await supabase.from("workout_sets").insert({ user_id: session.user_id, session_exercise_id: exercise.id, set_number: next, target_reps: 8, weight_kg: 0 }).select("id,set_number,target_reps,reps,weight_kg,completed_at").single();
    if (inserted.error || !inserted.data) return setError("A new set could not be added.");
    setExercises((items) => items.map((item) => item.id === exercise.id ? { ...item, sets: [...item.sets, { ...inserted.data, weight_kg: 0, draftWeight: "", draftReps: "8" }] } : item));
  }

  async function finishWorkout() {
    const supabase = createClient(); if (!supabase || !session) return;
    const validSets = completedSets.filter((set) => Number(set.reps) > 0);
    if (!validSets.length) { setError("Complete at least one set before finishing your workout."); return; }
    setSaving(true); setError("");
    const now = new Date();
    const duration = Math.max(0, Math.floor((now.getTime() - new Date(session.started_at).getTime()) / 1000));
    const volume = validSets.reduce((sum, set) => sum + Number(set.reps) * Number(set.weight_kg), 0);
    const sessionUpdate = await supabase.from("workout_sessions").update({ status: "completed", completed_at: now.toISOString(), duration_seconds: duration, total_volume: volume }).eq("id", session.id).eq("user_id", session.user_id).eq("status", "in_progress");
    if (sessionUpdate.error) { setSaving(false); return setError("Your session could not be completed. Try again."); }

    let recordCount = 0;
    for (const exercise of exercises) {
      const liftSets = exercise.sets.filter((set) => set.completed_at && Number(set.reps) > 0);
      if (!liftSets.length) continue;
      const best = liftSets.reduce((winner, set) => estimateOneRepMax(Number(set.weight_kg), Number(set.reps)) > estimateOneRepMax(Number(winner.weight_kg), Number(winner.reps)) ? set : winner);
      const { data: existing } = await supabase.from("personal_records").select("best_weight_kg,estimated_one_rep_max").eq("user_id", session.user_id).eq("exercise_name", exercise.name).maybeSingle();
      const estimated = estimateOneRepMax(Number(best.weight_kg), Number(best.reps));
      if (!existing || Number(best.weight_kg) > Number(existing.best_weight_kg) || estimated > Number(existing.estimated_one_rep_max)) {
        const record = await supabase.from("personal_records").upsert({ user_id: session.user_id, exercise_name: exercise.name, best_weight_kg: Math.max(Number(existing?.best_weight_kg || 0), Number(best.weight_kg)), best_reps: Number(best.reps), estimated_one_rep_max: Math.max(Number(existing?.estimated_one_rep_max || 0), estimated), session_id: session.id, achieved_at: now.toISOString() }, { onConflict: "user_id,exercise_name" });
        if (!record.error) recordCount++;
      }
    }
    if (session.plan_id) {
      await supabase.from("planner_events").update({ status: "completed" }).eq("workout_plan_id", session.plan_id).eq("user_id", session.user_id);
      await supabase.from("workout_plans").update({ status: "completed" }).eq("id", session.plan_id).eq("user_id", session.user_id);
    }
    setSummary({ duration, volume, sets: validSets.length, records: recordCount }); setFinished(true); setSaving(false);
  }

  if (loading) return <div className="fitx-panel animate-pulse p-8 text-sm text-fitx-text-secondary">Loading workout…</div>;
  if (!session) return <EmptyState title="Workout not available" description={error || "This workout session could not be loaded."} action={<Link href="/workouts" className="fitx-button fitx-button-secondary">Back to workouts</Link>}/>;
  if (session && session.status !== "in_progress") return <EmptyState title="This session is closed" description="Only an in-progress workout can be edited here." action={<Link href="/workouts" className="fitx-button fitx-button-secondary">Return to workouts</Link>}/>;
  if (finished) return <div className="mx-auto max-w-2xl space-y-5"><PageHeading title="Workout complete" description="Your session has been saved to your workout history."/><section className="fitx-panel p-6"><div className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-fitx-primary/10 text-fitx-primary"><Check size={24}/></div><h2 className="text-lg font-semibold">{session?.name}</h2><div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">{[["Duration", `${Math.floor(summary.duration / 60)} min`], ["Sets", String(summary.sets)], ["Volume", `${Math.round(summary.volume).toLocaleString()} kg`], ["New records", String(summary.records)]].map(([label, value]) => <div key={label} className="rounded-lg border border-fitx-border bg-fitx-surface p-3"><p className="text-xs text-fitx-text-disabled">{label}</p><p className="mt-1 font-medium">{value}</p></div>)}</div><Link href="/workouts" className="fitx-button mt-5 w-full">Return to workouts</Link></section></div>;

  return <div className="mx-auto max-w-4xl space-y-5"><PageHeading title={session?.name || "Active workout"} description="Record weights and reps as you go. Each completed set is saved to your account." actions={<Link href="/workouts" className="fitx-button fitx-button-secondary"><ArrowLeft size={15}/>Close</Link>}/>
    {error && <p role="alert" className="rounded-lg border border-red-400/25 bg-red-400/5 px-4 py-3 text-sm text-red-200">{error}</p>}
    <div className="fitx-panel flex flex-wrap items-center justify-between gap-3 p-4"><p className="flex items-center gap-2 text-sm"><Clock3 size={16} className="text-fitx-primary"/>Started {new Date(session.started_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p><p className="flex items-center gap-2 text-sm text-fitx-text-secondary"><Check size={15} className="text-fitx-primary"/>{completedSets.length} sets completed</p></div>
    {!exercises.length && <EmptyState title="No exercises in this session" description="This workout has no exercises yet. Go back and choose a saved plan with movements."/>}
    <div className="space-y-4">{exercises.map((exercise) => <section key={exercise.id} className="fitx-panel p-4 sm:p-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-medium">{exercise.sort_order + 1}. {exercise.name}</h2><p className="mt-1 text-xs text-fitx-text-secondary">Target: {exercise.target_sets} sets · Rest {exercise.rest_seconds}s</p></div><button onClick={() => void addSet(exercise)} className="fitx-button fitx-button-secondary"><Plus size={14}/>Add set</button></div><div className="grid grid-cols-[44px_1fr_1fr_40px] gap-2 px-1 pb-2 text-[11px] text-fitx-text-disabled"><span>SET</span><span>WEIGHT (KG)</span><span>REPS</span><span/></div><div className="space-y-2">{exercise.sets.map((set) => <div key={set.id} className="grid grid-cols-[44px_1fr_1fr_40px] items-center gap-2"><span className="text-sm text-fitx-text-secondary">{set.set_number}</span><input aria-label={`${exercise.name} set ${set.set_number} weight in kg`} className="fitx-field h-10" type="number" min="0" max="2000" step="0.5" value={set.draftWeight} onChange={(event) => changeSet(exercise.id, set.id, "draftWeight", event.target.value)}/><input aria-label={`${exercise.name} set ${set.set_number} reps`} className="fitx-field h-10" type="number" min="0" max="500" step="1" value={set.draftReps} onChange={(event) => changeSet(exercise.id, set.id, "draftReps", event.target.value)}/><button onClick={() => void saveSet(exercise.id, set, !set.completed_at)} aria-label={set.completed_at ? "Mark set incomplete" : "Complete set"} className={`grid h-10 w-10 place-items-center rounded-lg border ${set.completed_at ? "border-fitx-primary/50 bg-fitx-primary/10 text-fitx-primary" : "border-fitx-border text-fitx-text-disabled hover:text-fitx-primary"}`}><Check size={17}/></button></div>)}</div></section>)}</div>
    {restRemaining > 0 && <section className="fitx-panel flex items-center justify-between gap-3 border-fitx-primary/30 p-4"><p className="flex items-center gap-2 text-sm"><Timer size={17} className="text-fitx-primary"/>Rest timer</p><p className="text-xl font-semibold tabular-nums">{Math.floor(restRemaining / 60)}:{String(restRemaining % 60).padStart(2, "0")}</p><button onClick={() => setRestRemaining(0)} className="fitx-button fitx-button-secondary">Skip</button></section>}
    <section className="fitx-panel flex flex-wrap items-center justify-between gap-3 p-4"><p className="flex items-center gap-2 text-sm text-fitx-text-secondary"><Trophy size={16} className="text-fitx-primary"/>{completedSets.length} completed sets · {Math.round(completedSets.reduce((sum, set) => sum + Number(set.weight_kg) * Number(set.reps), 0)).toLocaleString()} kg logged</p><button disabled={saving} onClick={() => void finishWorkout()} className="fitx-button">{saving ? "Saving…" : "Finish workout"}<Check size={15}/></button></section>
  </div>;
}
