"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, Pause, Play, Plus, Timer, Trophy, X } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { PageHeading } from "@/components/app/PageHeading";
import { ExerciseMovementFrames } from "@/components/exercises/ExerciseMedia";
import { createClient } from "@/lib/supabase/client";
import { estimateOneRepMax } from "@/lib/domain/workout";

type SetItem = { id: string; set_number: number; target_reps: number | null; reps: number | null; weight_kg: number; duration_seconds: number | null; completed_at: string | null; draftWeight: string; draftReps: string; draftDuration: string };
type ExerciseItem = { id: string; exercise_id: string | null; name: string; target_sets: number; reps_min: number; reps_max: number; rest_seconds: number; target_weight_kg: number | null; target_duration_seconds: number | null; sort_order: number; sets: SetItem[] };
type Session = { id: string; user_id: string; plan_id: string | null; name: string; started_at: string; status: string; active_duration_seconds?: number; resumed_at?: string | null; paused_at?: string | null };
type SessionClock = { elapsedSeconds: number; segmentStartedAt: number | null; paused: boolean };
type LocalSessionUi = { clock?: SessionClock; exerciseIndex?: number; restEndsAt?: number | null; restHeldSeconds?: number };

function sessionUiKey(sessionId: string) { return `fitx:workout:session-ui:v1:${sessionId}`; }
function readSessionUi(sessionId: string): LocalSessionUi {
  try { return JSON.parse(window.localStorage.getItem(sessionUiKey(sessionId)) || "{}"); } catch { return {}; }
}
function formatClock(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(seconds / 3600).toString().padStart(2, "0")}:${Math.floor((seconds % 3600) / 60).toString().padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function ActiveWorkoutPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [exercises, setExercises] = useState<ExerciseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clockSaving, setClockSaving] = useState(false);
  const [pausePersistenceSupported, setPausePersistenceSupported] = useState(false);
  const [error, setError] = useState("");
  const [restEndsAt, setRestEndsAt] = useState<number | null>(null);
  const [restHeldSeconds, setRestHeldSeconds] = useState(0);
  const [exerciseIndex, setExerciseIndex] = useState(0);
  const [clock, setClock] = useState<SessionClock | null>(null);
  const [now, setNow] = useState(0);
  const [finished, setFinished] = useState(false);
  const [summary, setSummary] = useState({ duration: 0, volume: 0, sets: 0, records: 0 });

  const load = useCallback(async (id: string) => {
    if (!id) { setLoading(false); setError("Start a workout from your saved plans to open a session."); return; }
    const supabase = createClient();
    if (!supabase) { setLoading(false); setError("FITX is not connected to Supabase."); return; }
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setLoading(false); setError("Sign in to open this workout."); return; }

    const detailedSession = await supabase.from("workout_sessions").select("id,user_id,plan_id,name,started_at,status,active_duration_seconds,resumed_at,paused_at").eq("id", id).eq("user_id", auth.user.id).maybeSingle();
    let currentSession: Session | null = detailedSession.data as Session | null;
    const supportsDurablePause = !detailedSession.error;
    if (detailedSession.error) {
      const legacySession = await supabase.from("workout_sessions").select("id,user_id,plan_id,name,started_at,status").eq("id", id).eq("user_id", auth.user.id).maybeSingle();
      if (!legacySession.data) { setLoading(false); setError("This workout session could not be loaded. Check your connection and try again."); return; }
      currentSession = { ...legacySession.data, active_duration_seconds: 0, resumed_at: legacySession.data.started_at, paused_at: null } as Session;
    }
    if (!currentSession) { setLoading(false); setError("This workout session could not be found."); return; }
    setPausePersistenceSupported(supportsDurablePause);

    const { data: exerciseRows, error: exerciseError } = await supabase.from("workout_session_exercises").select("id,exercise_id,exercise_name,target_sets,reps_min,reps_max,rest_seconds,target_weight_kg,target_duration_seconds,sort_order").eq("user_id", auth.user.id).eq("session_id", id).order("sort_order");
    if (exerciseError) { setLoading(false); setError("The workout exercises could not be loaded."); return; }
    const rawExerciseRows = (exerciseRows || []) as Array<{ id: string }>;
    const exerciseIds = rawExerciseRows.map((row) => row.id);
    const { data: setRows, error: setResultError } = exerciseIds.length
      ? await supabase.from("workout_sets").select("id,session_exercise_id,set_number,target_reps,reps,weight_kg,duration_seconds,completed_at").eq("user_id", auth.user.id).in("session_exercise_id", exerciseIds).order("set_number")
      : { data: [], error: null };
    if (setResultError) { setLoading(false); setError("Your workout sets could not be loaded."); return; }

    const ui = readSessionUi(id);
    const startedAt = Date.parse(currentSession.started_at);
    const activeDuration = Math.max(0, Number(currentSession.active_duration_seconds || 0));
    const dbPaused = Boolean(currentSession.paused_at);
    const nextClock: SessionClock = supportsDurablePause
      ? { elapsedSeconds: activeDuration, segmentStartedAt: dbPaused ? null : Date.parse(currentSession.resumed_at || currentSession.started_at), paused: dbPaused }
      : ui.clock && typeof ui.clock.elapsedSeconds === "number"
        ? ui.clock
        : { elapsedSeconds: activeDuration, segmentStartedAt: startedAt, paused: false };

    setSession(currentSession);
    const exerciseList = (exerciseRows || []) as Array<{ id: string; exercise_id: string | null; exercise_name: string; target_sets: number; reps_min: number; reps_max: number; rest_seconds: number; target_weight_kg: number | null; target_duration_seconds: number | null; sort_order: number }>;
    const setList = (setRows || []) as Array<{ id: string; session_exercise_id: string; set_number: number; target_reps: number | null; reps: number | null; weight_kg: number; duration_seconds: number | null; completed_at: string | null }>;
    setExercises(exerciseList.map((row) => ({
      id: row.id, exercise_id: row.exercise_id, name: row.exercise_name, target_sets: row.target_sets, reps_min: row.reps_min, reps_max: row.reps_max, rest_seconds: row.rest_seconds, target_weight_kg: row.target_weight_kg, target_duration_seconds: row.target_duration_seconds, sort_order: row.sort_order,
      sets: setList.filter((set) => set.session_exercise_id === row.id).map((set) => ({
        ...set, weight_kg: Number(set.weight_kg || 0), draftWeight: String(set.weight_kg || ""), draftReps: set.reps == null ? String(set.target_reps || "") : String(set.reps), draftDuration: set.duration_seconds == null ? "" : String(set.duration_seconds),
      })),
    })));
    setClock(nextClock);
    setExerciseIndex(Math.max(0, Math.min(Number(ui.exerciseIndex || 0), Math.max(0, exerciseList.length - 1))));
    setRestEndsAt(ui.restEndsAt && !nextClock.paused ? ui.restEndsAt : null);
    setRestHeldSeconds(Number(ui.restHeldSeconds || 0));
    setNow(Date.now());
    setLoading(false); setError("");
  }, []);

  useEffect(() => { const id = new URLSearchParams(window.location.search).get("session") || ""; void Promise.resolve().then(() => load(id)); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!session || !clock) return;
    try { window.localStorage.setItem(sessionUiKey(session.id), JSON.stringify({ clock, exerciseIndex, restEndsAt, restHeldSeconds } satisfies LocalSessionUi)); } catch { /* Durable session rows remain authoritative. */ }
  }, [session, clock, exerciseIndex, restEndsAt, restHeldSeconds]);
  const completedSets = useMemo(() => exercises.flatMap((exercise) => exercise.sets.filter((set) => Boolean(set.completed_at))), [exercises]);
  const totalSets = useMemo(() => exercises.reduce((count, exercise) => count + exercise.sets.length, 0), [exercises]);
  const elapsedSeconds = useMemo(() => {
    if (!clock) return 0;
    return clock.paused || clock.segmentStartedAt === null
      ? Math.max(0, clock.elapsedSeconds)
      : Math.max(0, clock.elapsedSeconds + Math.floor((now - clock.segmentStartedAt) / 1000));
  }, [clock, now]);
  const restRemaining = restEndsAt ? Math.max(0, Math.ceil((restEndsAt - now) / 1000)) : 0;
  const currentExerciseIndex = Math.max(0, Math.min(exerciseIndex, Math.max(0, exercises.length - 1)));
  const currentExercise = exercises[currentExerciseIndex] || null;
  const completedExerciseCount = exercises.filter((exercise) => exercise.sets.length > 0 && exercise.sets.every((set) => Boolean(set.completed_at))).length;

  function changeSet(exerciseId: string, setId: string, field: "draftWeight" | "draftReps" | "draftDuration", value: string) {
    setExercises((items) => items.map((exercise) => exercise.id !== exerciseId ? exercise : {
      ...exercise, sets: exercise.sets.map((set) => set.id === setId ? { ...set, [field]: value } : set),
    }));
  }

  async function togglePause() {
    if (!session || !clock || clockSaving) return;
    setError("");
    const supabase = createClient();
    const nowDate = new Date();
    if (clock.paused) {
      if (pausePersistenceSupported && supabase) {
        setClockSaving(true);
        const resumed = await supabase.from("workout_sessions").update({ paused_at: null, resumed_at: nowDate.toISOString() }).eq("id", session.id).eq("user_id", session.user_id).eq("status", "in_progress").not("paused_at", "is", null).select("id,paused_at,resumed_at,active_duration_seconds").maybeSingle();
        setClockSaving(false);
        if (resumed.error || !resumed.data) return setError("The workout could not be resumed. Check your connection and try again.");
        setSession({ ...session, paused_at: null, resumed_at: resumed.data.resumed_at, active_duration_seconds: Number(resumed.data.active_duration_seconds || 0) });
      }
      setClock({ elapsedSeconds: clock.elapsedSeconds, segmentStartedAt: Date.now(), paused: false });
      if (restHeldSeconds > 0) setRestEndsAt(Date.now() + restHeldSeconds * 1000);
      setRestHeldSeconds(0);
      return;
    }
    const elapsed = elapsedSeconds;
    if (pausePersistenceSupported && supabase) {
      setClockSaving(true);
      const paused = await supabase.from("workout_sessions").update({ active_duration_seconds: elapsed, paused_at: nowDate.toISOString(), resumed_at: null }).eq("id", session.id).eq("user_id", session.user_id).eq("status", "in_progress").is("paused_at", null).select("id,paused_at,resumed_at,active_duration_seconds").maybeSingle();
      setClockSaving(false);
      if (paused.error || !paused.data) return setError("The workout could not be paused. Check your connection and try again.");
      setSession({ ...session, paused_at: paused.data.paused_at, resumed_at: null, active_duration_seconds: Number(paused.data.active_duration_seconds || elapsed) });
    }
    setClock({ elapsedSeconds: elapsed, segmentStartedAt: null, paused: true });
    setRestHeldSeconds(restRemaining);
    setRestEndsAt(null);
  }

  async function saveSet(exerciseId: string, set: SetItem, complete: boolean) {
    if (clock?.paused) return;
    const weight = Number(set.draftWeight || 0); const reps = Number(set.draftReps || 0);
    const duration = Number(set.draftDuration || 0);
    const exercise = exercises.find((item) => item.id === exerciseId);
    const requiresDuration = Boolean(exercise?.target_duration_seconds);
    if (!Number.isFinite(weight) || weight < 0 || weight > 2000 || !Number.isInteger(reps) || reps < 0 || reps > 500 || !Number.isInteger(duration) || duration < 0 || duration > 86400 || (complete && (requiresDuration ? duration === 0 : reps === 0 && duration === 0))) { setError(requiresDuration ? "Enter the completed duration before logging this timed movement." : "Enter a positive rep count or duration before completing a set."); return; }
    const supabase = createClient(); if (!supabase || !session) return;
    const patch = { weight_kg: weight, reps: reps > 0 ? reps : null, duration_seconds: duration > 0 ? duration : null, completed_at: complete ? new Date().toISOString() : null };
    const updated = await supabase.from("workout_sets").update(patch).eq("id", set.id).eq("user_id", session.user_id).select("id").maybeSingle();
    if (updated.error || !updated.data) { setError("That set could not be saved. Check your connection and try again."); return; }
    setExercises((items) => items.map((exercise) => exercise.id !== exerciseId ? exercise : {
      ...exercise, sets: exercise.sets.map((item) => item.id === set.id ? { ...item, ...patch, draftWeight: String(weight), draftReps: String(reps), draftDuration: duration > 0 ? String(duration) : "" } : item),
    }));
    setError("");
    if (complete) {
      const current = exercises.find((item) => item.id === exerciseId);
      setRestEndsAt(Date.now() + (current?.rest_seconds || 90) * 1000);
      setRestHeldSeconds(0);
      if (current && current.sets.every((item) => item.id === set.id || Boolean(item.completed_at)) && exerciseIndex < exercises.length - 1) setExerciseIndex(exerciseIndex + 1);
    } else { setRestEndsAt(null); setRestHeldSeconds(0); }
  }

  async function addSet(exercise: ExerciseItem) {
    const supabase = createClient(); if (!supabase || !session || clock?.paused) return;
    if (exercise.sets.length >= 30) return setError("A movement can have up to 30 sets in one session.");
    const next = exercise.sets.length + 1;
    const targetReps = Math.round((exercise.reps_min + exercise.reps_max) / 2);
    const inserted = await supabase.from("workout_sets").insert({ user_id: session.user_id, session_exercise_id: exercise.id, set_number: next, target_reps: targetReps, weight_kg: exercise.target_weight_kg ?? 0 }).select("id,set_number,target_reps,reps,weight_kg,duration_seconds,completed_at").single();
    if (inserted.error || !inserted.data) return setError("A new set could not be added.");
    setExercises((items) => items.map((item) => item.id === exercise.id ? { ...item, sets: [...item.sets, { ...inserted.data, weight_kg: exercise.target_weight_kg ?? 0, duration_seconds: null, draftWeight: String(exercise.target_weight_kg ?? ""), draftReps: String(targetReps), draftDuration: "" }] } : item));
    setError("");
  }

  async function finishWorkout() {
    const supabase = createClient(); if (!supabase || !session || saving || clock?.paused) return;
    const validSets = completedSets.filter((set) => Number(set.reps) > 0 || Number(set.duration_seconds) > 0);
    if (!validSets.length) { setError("Complete at least one set before finishing your workout."); return; }
    setSaving(true); setError("");
    const nowDate = new Date();
    const duration = elapsedSeconds;
    const volume = validSets.reduce((sum, set) => sum + Number(set.reps) * Number(set.weight_kg), 0);
    const sessionUpdate = await supabase.from("workout_sessions").update({ status: "completed", completed_at: nowDate.toISOString(), duration_seconds: duration, total_volume: volume }).eq("id", session.id).eq("user_id", session.user_id).eq("status", "in_progress").select("id").maybeSingle();
    if (sessionUpdate.error || !sessionUpdate.data) { setSaving(false); return setError("This session was already closed or could not be completed. Reload to check its status."); }
    let recordCount = 0;
    for (const exercise of exercises) {
      const liftSets = exercise.sets.filter((set) => set.completed_at && Number(set.reps) > 0);
      if (!liftSets.length) continue;
      const bestWeightSet = liftSets.reduce((winner, set) => Number(set.weight_kg) > Number(winner.weight_kg) ? set : winner);
      const bestEstimatedSet = liftSets.reduce((winner, set) => estimateOneRepMax(Number(set.weight_kg), Number(set.reps)) > estimateOneRepMax(Number(winner.weight_kg), Number(winner.reps)) ? set : winner);
      const { data: existing } = await supabase.from("personal_records").select("best_weight_kg,best_reps,estimated_one_rep_max").eq("user_id", session.user_id).eq("exercise_name", exercise.name).maybeSingle();
      const bestWeight = Math.max(Number(existing?.best_weight_kg || 0), Number(bestWeightSet.weight_kg));
      const bestReps = Number(bestWeightSet.weight_kg) > Number(existing?.best_weight_kg || 0) ? Number(bestWeightSet.reps) : Number(existing?.best_reps || bestWeightSet.reps);
      const estimated = Math.max(Number(existing?.estimated_one_rep_max || 0), estimateOneRepMax(Number(bestEstimatedSet.weight_kg), Number(bestEstimatedSet.reps)));
      if (!existing || bestWeight > Number(existing.best_weight_kg) || estimated > Number(existing.estimated_one_rep_max)) {
        const record = await supabase.from("personal_records").upsert({ user_id: session.user_id, exercise_id: exercise.exercise_id, exercise_name: exercise.name, best_weight_kg: bestWeight, best_reps: bestReps, estimated_one_rep_max: estimated, session_id: session.id, achieved_at: nowDate.toISOString() }, { onConflict: "user_id,exercise_name" });
        if (!record.error) recordCount++;
      }
    }
    if (session.plan_id) {
      await supabase.from("planner_events").update({ status: "completed" }).eq("workout_plan_id", session.plan_id).eq("user_id", session.user_id);
      await supabase.from("workout_plans").update({ status: "completed" }).eq("id", session.plan_id).eq("user_id", session.user_id);
    }
    try { window.localStorage.removeItem(sessionUiKey(session.id)); } catch { /* The completed server record is authoritative. */ }
    setSummary({ duration, volume, sets: validSets.length, records: recordCount }); setSession({ ...session, status: "completed" }); setFinished(true); setSaving(false);
  }

  async function abandonWorkout() {
    if (!session || !window.confirm("Abandon this workout? Completed sets will remain on the session record, but it will not count as a completed workout.")) return;
    const supabase = createClient(); if (!supabase || saving) return;
    setSaving(true); setError("");
    const result = await supabase.from("workout_sessions").update({ status: "abandoned", duration_seconds: elapsedSeconds }).eq("id", session.id).eq("user_id", session.user_id).eq("status", "in_progress").select("id").maybeSingle();
    setSaving(false);
    if (result.error || !result.data) return setError("The session could not be abandoned. Check your connection and try again.");
    try { window.localStorage.removeItem(sessionUiKey(session.id)); } catch { /* Ignore unavailable browser storage. */ }
    setSession({ ...session, status: "abandoned" });
  }

  if (loading) return <div className="fitx-panel animate-pulse p-8 text-sm text-fitx-text-secondary">Loading workout…</div>;
  if (!session) return <EmptyState title="Workout not available" description={error || "This workout session could not be loaded."} action={<Link href="/workouts" className="fitx-button fitx-button-secondary">Back to workouts</Link>} />;
  if (finished) return <div className="mx-auto max-w-2xl space-y-5"><PageHeading title="Workout complete" description="Your session has been saved to your workout history." /><section className="fitx-panel p-6"><div className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-fitx-primary/10 text-fitx-primary"><Check size={24} /></div><h2 className="text-lg font-semibold">{session.name}</h2><div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">{[["Duration", `${Math.floor(summary.duration / 60)} min`], ["Sets", String(summary.sets)], ["Volume", `${Math.round(summary.volume).toLocaleString()} kg`], ["New records", String(summary.records)]].map(([label, value]) => <div key={label} className="rounded-md border border-fitx-border bg-fitx-surface p-3"><p className="text-xs text-fitx-text-disabled">{label}</p><p className="mt-1 font-medium">{value}</p></div>)}</div><Link href="/workouts" className="fitx-button mt-5 w-full">Return to workouts</Link></section></div>;
  if (session.status !== "in_progress") return <EmptyState title={session.status === "abandoned" ? "Workout abandoned" : "This session is closed"} description={session.status === "abandoned" ? "Completed sets remain in your session record. You can start a fresh workout from your saved plans." : "This workout session has already been closed."} action={<Link href="/workouts" className="fitx-button fitx-button-secondary">Return to workouts</Link>} />;

  return <div className="mx-auto max-w-4xl space-y-4 pb-28 sm:space-y-5 sm:pb-8">
    <PageHeading title={session.name} description="A focused view for your current movement. Set entries save as you train." actions={<Link href="/workouts" className="fitx-button fitx-button-secondary min-h-11"><ArrowLeft size={15} />Workouts</Link>} />
    {error && <p role="alert" className="rounded-lg border border-fitx-warning/30 bg-fitx-warning/5 px-4 py-3 text-sm text-fitx-warning">{error}</p>}

    <section className="fitx-panel grid grid-cols-2 gap-4 p-4 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:px-5"><div><p className="text-[10px] font-semibold uppercase tracking-[.13em] text-fitx-text-disabled">Elapsed training time</p><p className="mt-1 font-mono text-xl font-semibold tabular-nums tracking-tight sm:text-2xl">{formatClock(elapsedSeconds)}</p></div><div><p className="text-[10px] font-semibold uppercase tracking-[.13em] text-fitx-text-disabled">Exercises complete</p><p className="mt-1 text-lg font-semibold tabular-nums">{completedExerciseCount}<span className="text-sm font-normal text-fitx-text-disabled"> / {exercises.length}</span></p></div><button type="button" onClick={() => void togglePause()} disabled={clockSaving} className="fitx-button fitx-button-secondary col-span-2 min-h-11 sm:col-span-1">{clock?.paused ? <Play size={15} /> : <Pause size={15} />}{clockSaving ? "Saving…" : clock?.paused ? "Resume" : "Pause session"}</button></section>

    {clock?.paused && <section role="status" className="flex flex-col gap-3 rounded-lg border border-fitx-primary/30 bg-fitx-primary/[.06] p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold">Session paused</p><p className="mt-1 text-xs text-fitx-text-secondary">Your training timer is held. Resume when you’re ready.</p></div><button type="button" onClick={() => void togglePause()} disabled={clockSaving} className="fitx-button min-h-11">{clockSaving ? "Saving…" : "Resume workout"}<Play size={14} /></button></section>}

    <section className="fitx-panel p-4 sm:p-5"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-sm font-semibold">Workout sequence</h2><p className="mt-1 text-xs text-fitx-text-secondary">{completedSets.length} of {totalSets} sets logged</p></div><span className="text-xs tabular-nums text-fitx-text-disabled">{formatClock(elapsedSeconds)}</span></div><div className="fitx-progress-track h-1.5" role="progressbar" aria-label="Workout sets completed" aria-valuemin={0} aria-valuemax={Math.max(1, totalSets)} aria-valuenow={completedSets.length}><div className="fitx-progress-fill" style={{ width: `${totalSets ? Math.min(100, completedSets.length / totalSets * 100) : 0}%` }} /></div>
      {exercises.length > 0 && <nav aria-label="Workout exercises" className="mt-4 flex gap-2 overflow-x-auto pb-1">{exercises.map((exercise, index) => <button key={exercise.id} type="button" aria-current={exerciseIndex === index ? "step" : undefined} onClick={() => setExerciseIndex(index)} className={`min-h-10 shrink-0 rounded-md border px-3 text-xs transition-colors ${exerciseIndex === index ? "border-fitx-primary bg-fitx-primary/[.08] text-fitx-primary" : "border-fitx-border text-fitx-text-secondary hover:border-fitx-primary/40"}`}><span className="mr-1.5 font-mono text-[10px]">{String(index + 1).padStart(2, "0")}</span><span className="max-w-36 align-middle">{exercise.name}</span></button>)}</nav>}
    </section>

    {!exercises.length && <EmptyState title="No exercises in this session" description="This workout has no movements yet. Go back and start a saved plan with exercises." />}
    {currentExercise && <section aria-labelledby="current-exercise-title" className="fitx-panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-fitx-divider p-4 sm:p-5"><div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-fitx-primary">Movement {String(currentExerciseIndex + 1).padStart(2, "0")} <span className="text-fitx-text-disabled">/ {String(exercises.length).padStart(2, "0")}</span></p><h2 id="current-exercise-title" className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">{currentExercise.name}</h2><p className="mt-1 text-xs text-fitx-text-secondary">Target: {currentExercise.target_sets} sets · {currentExercise.reps_min}–{currentExercise.reps_max} reps · {currentExercise.target_weight_kg == null ? "No load" : `${currentExercise.target_weight_kg} kg`} · {currentExercise.target_duration_seconds == null ? "No time target" : `${currentExercise.target_duration_seconds}s`} · {currentExercise.rest_seconds}s rest</p></div><div className="flex items-center gap-2"><button type="button" onClick={() => setExerciseIndex((index) => Math.max(0, index - 1))} disabled={currentExerciseIndex === 0} aria-label="Previous exercise" className="grid h-10 w-10 place-items-center rounded-md border border-fitx-border disabled:opacity-40"><ChevronLeft size={18} /></button><button type="button" onClick={() => setExerciseIndex((index) => Math.min(exercises.length - 1, index + 1))} disabled={currentExerciseIndex >= exercises.length - 1} aria-label="Next exercise" className="grid h-10 w-10 place-items-center rounded-md border border-fitx-border disabled:opacity-40"><ChevronRight size={18} /></button></div></div>
      <div className="p-4 sm:p-5"><div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">Working sets</h3><p className="mt-1 text-xs text-fitx-text-secondary">Completed entries save to this session.</p></div><button type="button" onClick={() => void addSet(currentExercise)} disabled={clock?.paused} className="fitx-button fitx-button-secondary min-h-10 px-3 text-xs"><Plus size={14} />Add set</button></div>
        <div className="grid grid-cols-[2rem_repeat(3,minmax(0,1fr))_3rem] gap-2 px-1 pb-2 text-[10px] font-medium uppercase tracking-wide text-fitx-text-disabled sm:grid-cols-[3rem_repeat(3,minmax(0,1fr))_3rem]"><span>Set</span><span>Weight · kg</span><span>Reps</span><span>Sec</span><span /></div>
        <div className="space-y-2">{currentExercise.sets.map((set) => <div key={set.id} className="grid grid-cols-[2rem_repeat(3,minmax(0,1fr))_3rem] items-center gap-2 sm:grid-cols-[3rem_repeat(3,minmax(0,1fr))_3rem]"><span className="text-sm font-medium tabular-nums text-fitx-text-secondary">{String(set.set_number).padStart(2, "0")}</span><input aria-label={`${currentExercise.name} set ${set.set_number} weight in kg`} disabled={clock?.paused || Boolean(set.completed_at)} className="fitx-field h-12 px-2 text-center tabular-nums sm:px-3" type="number" min="0" max="2000" step="0.5" value={set.draftWeight} onChange={(event) => changeSet(currentExercise.id, set.id, "draftWeight", event.target.value)} /><input aria-label={`${currentExercise.name} set ${set.set_number} repetitions`} disabled={clock?.paused || Boolean(set.completed_at)} className="fitx-field h-12 px-2 text-center tabular-nums sm:px-3" type="number" min="0" max="500" step="1" value={set.draftReps} onChange={(event) => changeSet(currentExercise.id, set.id, "draftReps", event.target.value)} /><input aria-label={`${currentExercise.name} set ${set.set_number} duration in seconds`} disabled={clock?.paused || Boolean(set.completed_at)} className="fitx-field h-12 px-2 text-center tabular-nums sm:px-3" type="number" min="0" max="86400" step="1" value={set.draftDuration} onChange={(event) => changeSet(currentExercise.id, set.id, "draftDuration", event.target.value)} /><button type="button" disabled={clock?.paused} onClick={() => void saveSet(currentExercise.id, set, !set.completed_at)} aria-label={set.completed_at ? "Mark set incomplete" : "Complete set"} className={`grid h-12 w-12 place-items-center rounded-md border transition-colors disabled:opacity-50 ${set.completed_at ? "border-fitx-primary/50 bg-fitx-primary/10 text-fitx-primary" : "border-fitx-border text-fitx-text-disabled hover:border-fitx-primary/40 hover:text-fitx-primary"}`}><Check size={19} /></button></div>)}</div>
        {currentExercise.exercise_id && <details className="mt-5 border-t border-fitx-divider pt-3"><summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-fitx-text-secondary">View movement reference frames</summary><div className="mt-2 max-w-2xl"><ExerciseMovementFrames exerciseId={currentExercise.exercise_id} name={currentExercise.name} /></div></details>}
      </div>
    </section>}

    {restRemaining > 0 && <section role="timer" aria-label="Rest timer" className="fitx-panel fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-40 mx-auto flex max-w-md items-center justify-between gap-3 border-fitx-primary/30 bg-fitx-card p-3 shadow-xl sm:bottom-4 sm:p-4"><p className="flex items-center gap-2 text-sm"><Timer size={17} className="text-fitx-primary" />Rest</p><p className="text-xl font-semibold tabular-nums text-fitx-primary">{Math.floor(restRemaining / 60)}:{String(restRemaining % 60).padStart(2, "0")}</p><button type="button" onClick={() => { setRestEndsAt(null); setRestHeldSeconds(0); }} className="fitx-button fitx-button-secondary min-h-10 px-3 text-xs">Skip rest</button></section>}

    <section className="fitx-panel flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><p className="flex items-center gap-2 text-sm text-fitx-text-secondary"><Trophy size={16} className="shrink-0 text-fitx-primary" /><span>{completedSets.length} completed sets · {Math.round(completedSets.reduce((sum, set) => sum + Number(set.weight_kg) * Number(set.reps), 0)).toLocaleString()} kg logged · {Math.round(completedSets.reduce((sum, set) => sum + Number(set.duration_seconds || 0), 0) / 60)} min timed</span></p><div className="flex flex-col-reverse gap-2 sm:flex-row"><button type="button" onClick={() => void abandonWorkout()} disabled={saving || clockSaving} className="fitx-button fitx-button-quiet min-h-11"><X size={14} />Abandon</button><button type="button" disabled={saving || clockSaving || clock?.paused} onClick={() => void finishWorkout()} className="fitx-button min-h-12">{saving ? "Saving…" : "Finish workout"}<Check size={15} /></button></div></section>
    <div className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+.75rem)] z-30 mx-auto grid max-w-md grid-cols-2 gap-2 sm:hidden"><button type="button" onClick={() => setExerciseIndex((index) => Math.max(0, index - 1))} disabled={exerciseIndex === 0} className="fitx-button fitx-button-secondary min-h-12"><ArrowLeft size={15} />Previous</button><button type="button" onClick={() => setExerciseIndex((index) => Math.min(exercises.length - 1, index + 1))} disabled={exerciseIndex >= exercises.length - 1} className="fitx-button min-h-12">Next exercise<ArrowRight size={15} /></button></div>
  </div>;
}
