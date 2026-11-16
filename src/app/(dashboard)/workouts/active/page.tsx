"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowRightLeft, Check, ChevronLeft, ChevronRight, Info, Pause, Play, Plus, Smartphone, Square, Timer, Trophy, Volume2, VolumeX, X } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { PageHeading } from "@/components/app/PageHeading";
import { ExerciseMovementFrames } from "@/components/exercises/ExerciseMedia";
import { SwapSheet } from "@/components/workouts/SwapSheet";
import { programmeById } from "@/data/programmes";
import { createClient } from "@/lib/supabase/client";
import { localDayRange } from "@/lib/domain/dates";
import { columnList, payloadFor, withOptionalColumns } from "@/lib/domain/schema-fallback";
import type { CatalogExercise } from "@/lib/training/catalog";
import { loadCatalog, loadEquipmentProfiles, ownedEquipmentSet } from "@/lib/training/data";
import { equipmentLabel, missingEquipment } from "@/lib/training/equipment";
import { advanceEnrolmentFallback } from "@/lib/training/enrolment";
import { estimateOneRepMax } from "@/lib/training/one-rep-max";
import { finishSessionWithRpc } from "@/lib/training/plans";
import { LEVELS, type Level } from "@/lib/training/taxonomy";
import { PRESCRIPTION_TARGET_COLUMNS, SESSION_PAUSE_COLUMNS, SET_DURATION_COLUMNS } from "../_lib/workout-columns";
import { plannerEventToComplete } from "../_lib/plan-schedule";
import { useScreenWakeLock, useWorkoutCues } from "./session-device";

type SetItem = { id: string; set_number: number; target_reps: number | null; reps: number | null; weight_kg: number; duration_seconds: number | null; completed_at: string | null; draftWeight: string; draftReps: string; draftDuration: string };
type ExerciseItem = { id: string; exercise_id: string | null; name: string; target_sets: number; reps_min: number; reps_max: number; rest_seconds: number; target_weight_kg: number | null; target_duration_seconds: number | null; sort_order: number; sets: SetItem[] };
type Session = { id: string; user_id: string; plan_id: string | null; name: string; started_at: string; status: string; active_duration_seconds?: number; resumed_at?: string | null; paused_at?: string | null };
type SessionClock = { elapsedSeconds: number; segmentStartedAt: number | null; paused: boolean };
type LocalSessionUi = { clock?: SessionClock; exerciseIndex?: number; restEndsAt?: number | null; restHeldSeconds?: number };
// Optional columns are absent from rows read from a database without the newer workout migrations.
type SessionExerciseRow = { id: string; exercise_id: string | null; exercise_name: string; target_sets: number; reps_min: number; reps_max: number; rest_seconds: number; target_weight_kg?: number | null; target_duration_seconds?: number | null; sort_order: number };
type SetRow = { id: string; session_exercise_id: string; set_number: number; target_reps: number | null; reps: number | null; weight_kg: number; duration_seconds?: number | null; completed_at: string | null };

const SESSION_COLUMNS = ["id", "user_id", "plan_id", "name", "started_at", "status"] as const;
const SESSION_EXERCISE_COLUMNS = ["id", "exercise_id", "exercise_name", "target_sets", "reps_min", "reps_max", "rest_seconds", "sort_order"] as const;
const SET_COLUMNS = ["id", "set_number", "target_reps", "reps", "weight_kg", "completed_at"] as const;

/** One calm line naming what this database cannot store yet; empty when everything is available. */
function unavailableFieldsNotice(targetsSupported: boolean, timedSetsSupported: boolean) {
  if (targetsSupported && timedSetsSupported) return "";
  const subject = !targetsSupported && !timedSetsSupported ? "Weight and time targets and timed sets aren’t" : !targetsSupported ? "Weight and time targets aren’t" : "Timed sets aren’t";
  return `${subject} available yet while FITX finishes an update. Weight and reps still save as you train.`;
}

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
  // False once the database has said it lacks the column(s); the matching fields are then hidden.
  const [targetsSupported, setTargetsSupported] = useState(true);
  const [timedSetsSupported, setTimedSetsSupported] = useState(true);
  const [error, setError] = useState("");
  const [restEndsAt, setRestEndsAt] = useState<number | null>(null);
  const [restHeldSeconds, setRestHeldSeconds] = useState(0);
  const [exerciseIndex, setExerciseIndex] = useState(0);
  const [clock, setClock] = useState<SessionClock | null>(null);
  const [now, setNow] = useState(0);
  const [finished, setFinished] = useState(false);
  const [summary, setSummary] = useState({ duration: 0, volume: 0, sets: 0, records: 0 });
  // Swap: the light catalogue and the equipment for where this workout happens.
  const [catalog, setCatalog] = useState<CatalogExercise[]>([]);
  const [owned, setOwned] = useState<Set<string>>(() => new Set());
  const [ownedContext, setOwnedContext] = useState<"home" | "gym">("gym");
  const [level, setLevel] = useState<Level>("beginner");
  const [swapOpen, setSwapOpen] = useState(false);
  // A countdown for a timed set; when it ends the set's seconds are filled in and the cue plays.
  const [setTimer, setSetTimer] = useState<{ exerciseId: string; setId: string; seconds: number; startedAt: number; endsAt: number } | null>(null);
  const cues = useWorkoutCues();
  const { cue } = cues;
  const wakeLock = useScreenWakeLock(Boolean(session && session.status === "in_progress" && !finished && clock && !clock.paused && cues.keepAwake));
  const timerRef = useRef(setTimer);
  const restCueRef = useRef<{ endsAt: number | null; cued: boolean }>({ endsAt: null, cued: true });
  useEffect(() => { timerRef.current = setTimer; }, [setTimer]);
  useEffect(() => { restCueRef.current = { endsAt: restEndsAt, cued: restEndsAt === null || restEndsAt <= Date.now() }; }, [restEndsAt]);

  const load = useCallback(async (id: string) => {
    if (!id) { setLoading(false); setError("Start a workout from your saved plans to open a session."); return; }
    const supabase = createClient();
    if (!supabase) { setLoading(false); setError("FITX is not connected to Supabase."); return; }
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setLoading(false); setError("Sign in to open this workout."); return; }
    const uid = auth.user.id;

    // Without the pause columns the session still opens; the clock is then kept in this browser.
    const sessionQuery = await withOptionalColumns(SESSION_PAUSE_COLUMNS, (include) =>
      supabase.from("workout_sessions").select(columnList(SESSION_COLUMNS, SESSION_PAUSE_COLUMNS, include)).eq("id", id).eq("user_id", uid).maybeSingle());
    if (sessionQuery.result.error) { setLoading(false); setError("This workout session could not be loaded. Check your connection and try again."); return; }
    const sessionRow = sessionQuery.result.data as unknown as Session | null;
    if (!sessionRow) { setLoading(false); setError("This workout session could not be found."); return; }
    const supportsDurablePause = sessionQuery.includedOptional;
    const currentSession: Session = supportsDurablePause ? sessionRow : { ...sessionRow, active_duration_seconds: 0, resumed_at: sessionRow.started_at, paused_at: null };
    setPausePersistenceSupported(supportsDurablePause);

    const exerciseQuery = await withOptionalColumns(PRESCRIPTION_TARGET_COLUMNS, (include) =>
      supabase.from("workout_session_exercises").select(columnList(SESSION_EXERCISE_COLUMNS, PRESCRIPTION_TARGET_COLUMNS, include)).eq("user_id", uid).eq("session_id", id).order("sort_order"));
    if (exerciseQuery.result.error) { setLoading(false); setError("The workout exercises could not be loaded. Check your connection and try again."); return; }
    const exerciseRows = (exerciseQuery.result.data || []) as unknown as SessionExerciseRow[];
    const exerciseIds = exerciseRows.map((row) => row.id);
    const setQuery = exerciseIds.length
      ? await withOptionalColumns(SET_DURATION_COLUMNS, (include) =>
        supabase.from("workout_sets").select(columnList(["session_exercise_id", ...SET_COLUMNS], SET_DURATION_COLUMNS, include)).eq("user_id", uid).in("session_exercise_id", exerciseIds).order("set_number"))
      : null;
    if (setQuery?.result.error) { setLoading(false); setError("Your workout sets could not be loaded. Check your connection and try again."); return; }
    const setRows = (setQuery?.result.data || []) as unknown as SetRow[];
    setTargetsSupported(exerciseQuery.includedOptional);
    setTimedSetsSupported(setQuery ? setQuery.includedOptional : true);

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
    setExercises(exerciseRows.map((row) => ({
      id: row.id, exercise_id: row.exercise_id, name: row.exercise_name, target_sets: row.target_sets, reps_min: row.reps_min, reps_max: row.reps_max, rest_seconds: row.rest_seconds, target_weight_kg: row.target_weight_kg ?? null, target_duration_seconds: row.target_duration_seconds ?? null, sort_order: row.sort_order,
      sets: setRows.filter((set) => set.session_exercise_id === row.id).map((set) => ({
        id: set.id, set_number: set.set_number, target_reps: set.target_reps, reps: set.reps, completed_at: set.completed_at, duration_seconds: set.duration_seconds ?? null,
        weight_kg: Number(set.weight_kg || 0), draftWeight: String(set.weight_kg || ""), draftReps: set.reps == null ? String(set.target_reps || "") : String(set.reps), draftDuration: set.duration_seconds == null ? "" : String(set.duration_seconds),
      })),
    })));
    setClock(nextClock);
    setExerciseIndex(Math.max(0, Math.min(Number(ui.exerciseIndex || 0), Math.max(0, exerciseRows.length - 1))));
    setRestEndsAt(ui.restEndsAt && !nextClock.paused ? ui.restEndsAt : null);
    setRestHeldSeconds(Number(ui.restHeldSeconds || 0));
    setNow(Date.now());
    setLoading(false); setError("");
  }, []);

  useEffect(() => { const id = new URLSearchParams(window.location.search).get("session") || ""; void Promise.resolve().then(() => load(id)); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      const running = timerRef.current;
      if (running && current >= running.endsAt) {
        timerRef.current = null;
        setSetTimer(null);
        setExercises((items) => items.map((exercise) => exercise.id !== running.exerciseId ? exercise : {
          ...exercise, sets: exercise.sets.map((set) => set.id === running.setId ? { ...set, draftDuration: String(running.seconds) } : set),
        }));
        cue();
      }
      const rest = restCueRef.current;
      if (rest.endsAt && !rest.cued && current >= rest.endsAt) { rest.cued = true; cue(); }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cue]);

  const sessionId = session?.id;
  const sessionUserId = session?.user_id;
  const sessionPlanId = session?.plan_id ?? null;
  useEffect(() => {
    if (!sessionId || !sessionUserId) return;
    let active = true;
    void (async () => {
      const supabase = createClient();
      if (!supabase) return;
      const [catalogResult, profileResult, preferences, plan] = await Promise.all([
        loadCatalog(supabase),
        loadEquipmentProfiles(supabase, sessionUserId),
        supabase.from("user_preferences").select("equipment,fitness_level,workout_location").eq("user_id", sessionUserId).maybeSingle(),
        sessionPlanId ? supabase.from("workout_plans").select("workout_location").eq("id", sessionPlanId).eq("user_id", sessionUserId).maybeSingle() : Promise.resolve({ data: null, error: null }),
      ]);
      if (!active) return;
      const prefs = (preferences.data ?? {}) as { equipment?: string[] | null; fitness_level?: string; workout_location?: string };
      const location = (plan.data as { workout_location?: string } | null)?.workout_location ?? prefs.workout_location ?? "gym";
      const target = location === "home" || location === "outdoor" ? "home" : "gym";
      setCatalog(catalogResult.exercises);
      setOwned(ownedEquipmentSet(profileResult.profiles, target, prefs.equipment));
      setOwnedContext(target);
      setLevel((LEVELS as readonly string[]).includes(prefs.fitness_level ?? "") ? (prefs.fitness_level as Level) : "beginner");
    })();
    return () => { active = false; };
  }, [sessionId, sessionUserId, sessionPlanId]);
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

  function startSetTimer(exerciseId: string, setId: string, seconds: number) {
    cues.prime();
    const startedAt = Date.now();
    setSetTimer({ exerciseId, setId, seconds, startedAt, endsAt: startedAt + seconds * 1000 });
  }

  /** Stopping early records the seconds actually done. */
  function stopSetTimer() {
    const running = setTimer;
    if (!running) return;
    setSetTimer(null);
    changeSet(running.exerciseId, running.setId, "draftDuration", String(Math.max(1, Math.round((Date.now() - running.startedAt) / 1000))));
  }

  /** Replaces the current exercise for this session only; the saved plan is unchanged. */
  async function swapExercise(replacement: CatalogExercise) {
    const exercise = currentExercise;
    if (!exercise || !session) return;
    if (exercise.sets.some((set) => Boolean(set.completed_at))) { setSwapOpen(false); return setError("Swap an exercise before logging its sets."); }
    const supabase = createClient();
    if (!supabase) return;
    const timed = replacement.prescription_type === "time";
    const patch = { exercise_id: replacement.id, exercise_name: replacement.name, target_duration_seconds: timed ? exercise.target_duration_seconds ?? replacement.default_duration_seconds ?? 30 : null };
    const outcome = await withOptionalColumns(["target_duration_seconds"], (include) =>
      supabase.from("workout_session_exercises").update(payloadFor(patch, ["target_duration_seconds"], include)).eq("id", exercise.id).eq("user_id", session.user_id).select("id").maybeSingle(),
    { includeOptional: targetsSupported });
    if (outcome.result.error || !outcome.result.data) { setSwapOpen(false); return setError("That exercise couldn’t be swapped. Check your connection and try again."); }
    setExercises((items) => items.map((item) => item.id !== exercise.id ? item : {
      ...item, exercise_id: replacement.id, name: replacement.name, target_duration_seconds: outcome.includedOptional ? patch.target_duration_seconds : item.target_duration_seconds,
    }));
    setSwapOpen(false);
    setError("");
  }

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
    setSetTimer(null);
    setClock({ elapsedSeconds: elapsed, segmentStartedAt: null, paused: true });
    setRestHeldSeconds(restRemaining);
    setRestEndsAt(null);
  }

  async function saveSet(exerciseId: string, set: SetItem, complete: boolean) {
    if (clock?.paused) return;
    // A tap: browsers allow the end-of-rest sound only after one.
    if (complete) cues.prime();
    const weight = Number(set.draftWeight || 0); const reps = Number(set.draftReps || 0);
    // The duration field is hidden when the database cannot store it, so nothing typed is dropped.
    const duration = timedSetsSupported ? Number(set.draftDuration || 0) : 0;
    const exercise = exercises.find((item) => item.id === exerciseId);
    const requiresDuration = timedSetsSupported && Boolean(exercise?.target_duration_seconds);
    if (!Number.isFinite(weight) || weight < 0 || weight > 2000 || !Number.isInteger(reps) || reps < 0 || reps > 500 || !Number.isInteger(duration) || duration < 0 || duration > 86400 || (complete && (requiresDuration ? duration === 0 : reps === 0 && duration === 0))) { setError(requiresDuration ? "Enter the completed duration before logging this timed movement." : timedSetsSupported ? "Enter a positive rep count or duration before completing a set." : "Enter a positive rep count before completing a set."); return; }
    const supabase = createClient(); if (!supabase || !session) return;
    const patch = { weight_kg: weight, reps: reps > 0 ? reps : null, duration_seconds: duration > 0 ? duration : null, completed_at: complete ? new Date().toISOString() : null };
    const updated = await withOptionalColumns(SET_DURATION_COLUMNS, (include) =>
      supabase.from("workout_sets").update(payloadFor(patch, SET_DURATION_COLUMNS, include)).eq("id", set.id).eq("user_id", session.user_id).select("id").maybeSingle(),
    { includeOptional: timedSetsSupported });
    if (!updated.includedOptional) setTimedSetsSupported(false);
    if (updated.result.error || !updated.result.data) { setError("That set could not be saved. Check your connection and try again."); return; }
    // What the database now holds: a duration it could not store is not kept as saved.
    const saved = updated.includedOptional ? patch : { ...patch, duration_seconds: null };
    setExercises((items) => items.map((exercise) => exercise.id !== exerciseId ? exercise : {
      ...exercise, sets: exercise.sets.map((item) => item.id === set.id ? { ...item, ...saved, draftWeight: String(weight), draftReps: String(reps), draftDuration: saved.duration_seconds ? String(saved.duration_seconds) : "" } : item),
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
    const inserted = await withOptionalColumns(SET_DURATION_COLUMNS, (include) =>
      supabase.from("workout_sets").insert({ user_id: session.user_id, session_exercise_id: exercise.id, set_number: next, target_reps: targetReps, weight_kg: exercise.target_weight_kg ?? 0 }).select(columnList(SET_COLUMNS, SET_DURATION_COLUMNS, include)).single(),
    { includeOptional: timedSetsSupported });
    if (!inserted.includedOptional) setTimedSetsSupported(false);
    const row = inserted.result.data as unknown as SetRow | null;
    if (inserted.result.error || !row) return setError("A new set could not be added.");
    setExercises((items) => items.map((item) => item.id === exercise.id ? { ...item, sets: [...item.sets, { id: row.id, set_number: row.set_number, target_reps: row.target_reps, reps: row.reps, completed_at: row.completed_at, weight_kg: exercise.target_weight_kg ?? 0, duration_seconds: null, draftWeight: String(exercise.target_weight_kg ?? ""), draftReps: String(targetReps), draftDuration: "" }] } : item));
    setError("");
  }

  async function finishWorkout() {
    const supabase = createClient(); if (!supabase || !session || saving || clock?.paused) return;
    const validSets = completedSets.filter((set) => Number(set.reps) > 0 || Number(set.duration_seconds) > 0);
    if (!validSets.length) { setError("Complete at least one set before finishing your workout."); return; }
    setSaving(true); setError("");
    const nowDate = new Date();
    const duration = elapsedSeconds;
    // One transaction when the database has fitx_finish_workout_session: totals, records, the planner
    // event and the programme's next day are worked out from the saved sets.
    const viaRpc = await finishSessionWithRpc(supabase, session.id, duration, localDayRange(new Date(session.started_at)));
    if (viaRpc.summary) {
      try { window.localStorage.removeItem(sessionUiKey(session.id)); } catch { /* The completed server record is authoritative. */ }
      setSummary(viaRpc.summary); setSession({ ...session, status: "completed" }); setFinished(true); setSaving(false);
      return;
    }
    if (!viaRpc.fallback) {
      setSaving(false);
      const message = String((viaRpc.error as { message?: string } | null)?.message ?? "");
      return setError(message.includes("at least one set") ? "Complete at least one set before finishing your workout." : "This session was already closed or could not be completed. Reload to check its status.");
    }
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
      // Completes one planner event: the plan's scheduled event on the day this session started
      // (today for a normal workout), else its most recent overdue one; never a later day's event
      // (see plannerEventToComplete). The saved plan is left untouched so it can be used again.
      const sessionDay = localDayRange(new Date(session.started_at));
      // Newest first, so the session day's events and the latest overdue one are within the limit.
      const candidates = await supabase.from("planner_events").select("id,status,starts_at")
        .eq("workout_plan_id", session.plan_id).eq("user_id", session.user_id)
        .eq("event_type", "workout").eq("status", "scheduled")
        .lt("starts_at", sessionDay.end)
        .order("starts_at", { ascending: false }).limit(20);
      const events = ((candidates.data || []) as Array<{ id: string; status: string; starts_at: string }>).map((event) => ({ id: event.id, status: event.status, startsAt: Date.parse(event.starts_at) }));
      const eventId = candidates.error ? null : plannerEventToComplete(events, { start: Date.parse(sessionDay.start), end: Date.parse(sessionDay.end) }, Date.parse(session.started_at));
      if (eventId) await supabase.from("planner_events").update({ status: "completed" }).eq("id", eventId).eq("user_id", session.user_id).eq("status", "scheduled");
      // A programme day moves its programme on (the database function does this when it exists).
      const plan = await withOptionalColumns(["programme_enrolment_id", "programme_day_index"], (include) =>
        supabase.from("workout_plans").select(columnList(["id"], ["programme_enrolment_id", "programme_day_index"], include)).eq("id", session.plan_id!).eq("user_id", session.user_id).maybeSingle());
      const programmeLink = (plan.includedOptional ? plan.result.data : null) as { programme_enrolment_id?: string | null; programme_day_index?: number | null } | null;
      if (programmeLink?.programme_enrolment_id && programmeLink.programme_day_index != null) {
        const enrolment = await supabase.from("programme_enrolments").select("programme_id").eq("id", programmeLink.programme_enrolment_id).eq("user_id", session.user_id).maybeSingle();
        const programme = programmeById((enrolment.data as { programme_id?: string } | null)?.programme_id);
        if (programme) await advanceEnrolmentFallback(supabase, { userId: session.user_id, enrolmentId: programmeLink.programme_enrolment_id, dayIndex: programmeLink.programme_day_index, dayCount: programme.days.length });
      }
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
  if (finished) return <div className="mx-auto max-w-2xl space-y-5"><PageHeading title="Workout complete" description="Your session has been saved to your workout history." /><section className="fitx-panel p-6"><div className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-fitx-primary/10 text-fitx-primary"><Check size={24} /></div><h2 className="text-lg font-semibold">{session.name}</h2><div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">{[["Duration", `${Math.floor(summary.duration / 60)} min`], ["Sets", String(summary.sets)], ["Volume", `${Math.round(summary.volume).toLocaleString()} kg`], ["New records", String(summary.records)]].map(([label, value]) => <div key={label} className="rounded-md border border-fitx-border bg-fitx-surface p-3"><p className="text-xs text-fitx-text-secondary">{label}</p><p className="mt-1 font-medium">{value}</p></div>)}</div><Link href="/workouts" className="fitx-button mt-5 w-full">Return to workouts</Link></section></div>;
  if (session.status !== "in_progress") return <EmptyState title={session.status === "abandoned" ? "Workout abandoned" : "This session is closed"} description={session.status === "abandoned" ? "Completed sets remain in your session record. You can start a fresh workout from your saved plans." : "This workout session has already been closed."} action={<Link href="/workouts" className="fitx-button fitx-button-secondary">Return to workouts</Link>} />;
  const fieldsNotice = unavailableFieldsNotice(targetsSupported, timedSetsSupported);
  const swapTarget = currentExercise?.exercise_id ? catalog.find((exercise) => exercise.id === currentExercise.exercise_id) : undefined;
  const swapMissing = swapTarget ? missingEquipment(swapTarget.required_equipment, owned) : [];
  const nextOpenSet = currentExercise?.sets.find((set) => !set.completed_at);
  const timerHere = Boolean(setTimer && currentExercise && setTimer.exerciseId === currentExercise.id);
  const timerRemaining = setTimer ? Math.max(0, Math.ceil((setTimer.endsAt - now) / 1000)) : 0;
  // Set · weight · reps (· seconds) · complete
  const setGridColumns = timedSetsSupported
    ? "grid grid-cols-[2rem_repeat(3,minmax(0,1fr))_3rem] sm:grid-cols-[3rem_repeat(3,minmax(0,1fr))_3rem]"
    : "grid grid-cols-[2rem_repeat(2,minmax(0,1fr))_3rem] sm:grid-cols-[3rem_repeat(2,minmax(0,1fr))_3rem]";

  return <div className="mx-auto max-w-4xl space-y-4 pb-28 sm:space-y-5 sm:pb-8">
    <PageHeading title={session.name} description="A focused view for your current movement. Set entries save as you train." actions={<Link href="/workouts" className="fitx-button fitx-button-secondary min-h-11"><ArrowLeft size={15} />Workouts</Link>} />
    {error && <p role="alert" className="rounded-lg border border-fitx-warning/30 bg-fitx-warning/5 px-4 py-3 text-sm text-fitx-warning">{error}</p>}
    {fieldsNotice && <p role="status" className="flex items-start gap-2 rounded-lg border border-fitx-border bg-fitx-surface px-4 py-3 text-xs text-fitx-text-secondary"><Info size={15} aria-hidden="true" className="mt-px shrink-0 text-fitx-info" /><span>{fieldsNotice}</span></p>}

    <section className="fitx-panel grid grid-cols-2 gap-4 p-4 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:px-5"><div><p className="text-[10px] font-semibold uppercase tracking-[.13em] text-fitx-text-secondary">Elapsed training time</p><p className="mt-1 font-mono text-xl font-semibold tabular-nums tracking-tight sm:text-2xl">{formatClock(elapsedSeconds)}</p></div><div><p className="text-[10px] font-semibold uppercase tracking-[.13em] text-fitx-text-secondary">Exercises complete</p><p className="mt-1 text-lg font-semibold tabular-nums">{completedExerciseCount}<span className="text-sm font-normal text-fitx-text-secondary"> / {exercises.length}</span></p></div><button type="button" onClick={() => void togglePause()} disabled={clockSaving} className="fitx-button fitx-button-secondary col-span-2 min-h-11 sm:col-span-1">{clock?.paused ? <Play size={15} /> : <Pause size={15} />}{clockSaving ? "Saving…" : clock?.paused ? "Resume" : "Pause session"}</button></section>
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <button type="button" onClick={cues.toggleCues} aria-pressed={cues.cuesOn} className="fitx-button fitx-button-quiet min-h-10 px-3 text-xs">{cues.cuesOn ? <Volume2 size={14} aria-hidden="true" /> : <VolumeX size={14} aria-hidden="true" />}{cues.cuesOn ? "Rest alert on" : "Rest alert off"}</button>
      <button type="button" onClick={cues.toggleKeepAwake} aria-pressed={cues.keepAwake} className="fitx-button fitx-button-quiet min-h-10 px-3 text-xs"><Smartphone size={14} aria-hidden="true" />{cues.keepAwake ? "Keep screen on" : "Screen can sleep"}</button>
      {cues.keepAwake && wakeLock !== "off" && <span role="status" className="text-fitx-text-secondary">{wakeLock === "on" ? "The screen stays on while you train." : wakeLock === "unsupported" ? "This browser can’t keep the screen on." : "The screen couldn’t be kept on; battery saver can block it."}</span>}
    </div>

    {clock?.paused && <section role="status" className="flex flex-col gap-3 rounded-lg border border-fitx-primary/30 bg-fitx-primary/[.06] p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold">Session paused</p><p className="mt-1 text-xs text-fitx-text-secondary">Your training timer is held. Resume when you’re ready.</p></div><button type="button" onClick={() => void togglePause()} disabled={clockSaving} className="fitx-button min-h-11">{clockSaving ? "Saving…" : "Resume workout"}<Play size={14} /></button></section>}

    <section className="fitx-panel p-4 sm:p-5"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-sm font-semibold">Workout sequence</h2><p className="mt-1 text-xs text-fitx-text-secondary">{completedSets.length} of {totalSets} sets logged</p></div><span className="text-xs tabular-nums text-fitx-text-secondary">{formatClock(elapsedSeconds)}</span></div><div className="fitx-progress-track h-1.5" role="progressbar" aria-label="Workout sets completed" aria-valuemin={0} aria-valuemax={Math.max(1, totalSets)} aria-valuenow={completedSets.length}><div className="fitx-progress-fill" style={{ width: `${totalSets ? Math.min(100, completedSets.length / totalSets * 100) : 0}%` }} /></div>
      {exercises.length > 0 && <nav aria-label="Workout exercises" className="mt-4 flex gap-2 overflow-x-auto pb-1">{exercises.map((exercise, index) => <button key={exercise.id} type="button" aria-current={exerciseIndex === index ? "step" : undefined} onClick={() => setExerciseIndex(index)} className={`min-h-10 shrink-0 rounded-md border px-3 text-xs transition-colors ${exerciseIndex === index ? "border-fitx-primary bg-fitx-primary/[.08] text-fitx-primary" : "border-fitx-border text-fitx-text-secondary hover:border-fitx-primary/40"}`}><span className="mr-1.5 font-mono text-[10px]">{String(index + 1).padStart(2, "0")}</span><span className="max-w-36 align-middle">{exercise.name}</span></button>)}</nav>}
    </section>

    {!exercises.length && <EmptyState title="No exercises in this session" description="This workout has no movements yet. Go back and start a saved plan with exercises." />}
    {currentExercise && <section aria-labelledby="current-exercise-title" className="fitx-panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-fitx-divider p-4 sm:p-5"><div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-fitx-primary">Movement {String(currentExerciseIndex + 1).padStart(2, "0")} <span className="text-fitx-text-secondary">/ {String(exercises.length).padStart(2, "0")}</span></p><h2 id="current-exercise-title" className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">{currentExercise.name}</h2><p className="mt-1 text-xs text-fitx-text-secondary">Target: {currentExercise.target_sets} sets · {currentExercise.reps_min}–{currentExercise.reps_max} reps{targetsSupported && <> · {currentExercise.target_weight_kg == null ? "No load" : `${currentExercise.target_weight_kg} kg`} · {currentExercise.target_duration_seconds == null ? "No time target" : `${currentExercise.target_duration_seconds}s`}</>} · {currentExercise.rest_seconds}s rest</p>{swapMissing.length > 0 && <p className="mt-1 text-xs text-fitx-warning">Needs {swapMissing.map(equipmentLabel).join(", ").toLowerCase()}, not on your {ownedContext} list. Swap it for something you can do.</p>}</div><div className="flex items-center gap-2"><button type="button" onClick={() => setSwapOpen(true)} disabled={!swapTarget || clock?.paused || currentExercise.sets.some((set) => Boolean(set.completed_at))} title={currentExercise.sets.some((set) => Boolean(set.completed_at)) ? "Swap before logging sets" : undefined} className="fitx-button fitx-button-quiet min-h-10 px-3 text-xs"><ArrowRightLeft size={14} aria-hidden="true" />Swap</button><button type="button" onClick={() => setExerciseIndex((index) => Math.max(0, index - 1))} disabled={currentExerciseIndex === 0} aria-label="Previous exercise" className="grid h-10 w-10 place-items-center rounded-md border border-fitx-border disabled:opacity-40"><ChevronLeft size={18} /></button><button type="button" onClick={() => setExerciseIndex((index) => Math.min(exercises.length - 1, index + 1))} disabled={currentExerciseIndex >= exercises.length - 1} aria-label="Next exercise" className="grid h-10 w-10 place-items-center rounded-md border border-fitx-border disabled:opacity-40"><ChevronRight size={18} /></button></div></div>
      <div className="p-4 sm:p-5"><div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">Working sets</h3><p className="mt-1 text-xs text-fitx-text-secondary">Completed entries save to this session.</p></div><button type="button" onClick={() => void addSet(currentExercise)} disabled={clock?.paused} className="fitx-button fitx-button-secondary min-h-10 px-3 text-xs"><Plus size={14} />Add set</button></div>
        {/* Form coach mount point (Phase 8, src/components/form-coach): a "Count with camera" control goes here, beside "Add set",
            for the movements the coach supports. It should fill the next open set's reps with
            changeSet(currentExercise.id, set.id, "draftReps", String(count)) and leave logging to the user's tick. */}
        {timedSetsSupported && currentExercise.target_duration_seconds != null && nextOpenSet && <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-fitx-border bg-fitx-surface-variant p-3" aria-live="polite">
          <div><p className="text-sm font-medium tabular-nums">{timerHere ? `Set ${nextOpenSet.set_number}: ${timerRemaining}s left` : `Set ${nextOpenSet.set_number}: ${currentExercise.target_duration_seconds}s`}</p><p className="text-xs text-fitx-text-secondary">{timerHere ? "The seconds fill in when the timer ends. Tick the set to log it." : "Start the timer as you begin."}</p></div>
          {timerHere ? <button type="button" onClick={stopSetTimer} className="fitx-button fitx-button-secondary min-h-11"><Square size={14} aria-hidden="true" />Stop</button> : <button type="button" disabled={clock?.paused || Boolean(setTimer)} onClick={() => startSetTimer(currentExercise.id, nextOpenSet.id, currentExercise.target_duration_seconds!)} className="fitx-button min-h-11"><Play size={14} aria-hidden="true" />Start timer</button>}
        </div>}
        <div className={`${setGridColumns} gap-2 px-1 pb-2 text-[10px] font-medium uppercase tracking-wide text-fitx-text-secondary`}><span>Set</span><span>Weight · kg</span><span>Reps</span>{timedSetsSupported && <span>Sec</span>}<span /></div>
        <div className="space-y-2">{currentExercise.sets.map((set) => <div key={set.id} className={`${setGridColumns} items-center gap-2`}><span className="text-sm font-medium tabular-nums text-fitx-text-secondary">{String(set.set_number).padStart(2, "0")}</span><input aria-label={`${currentExercise.name} set ${set.set_number} weight in kg`} disabled={clock?.paused || Boolean(set.completed_at)} className="fitx-field h-12 px-2 text-center tabular-nums sm:px-3" type="number" min="0" max="2000" step="0.5" value={set.draftWeight} onChange={(event) => changeSet(currentExercise.id, set.id, "draftWeight", event.target.value)} /><input aria-label={`${currentExercise.name} set ${set.set_number} repetitions`} disabled={clock?.paused || Boolean(set.completed_at)} className="fitx-field h-12 px-2 text-center tabular-nums sm:px-3" type="number" min="0" max="500" step="1" value={set.draftReps} onChange={(event) => changeSet(currentExercise.id, set.id, "draftReps", event.target.value)} />{timedSetsSupported && <input aria-label={`${currentExercise.name} set ${set.set_number} duration in seconds`} disabled={clock?.paused || Boolean(set.completed_at)} className="fitx-field h-12 px-2 text-center tabular-nums sm:px-3" type="number" min="0" max="86400" step="1" value={set.draftDuration} onChange={(event) => changeSet(currentExercise.id, set.id, "draftDuration", event.target.value)} />}<button type="button" disabled={clock?.paused} onClick={() => void saveSet(currentExercise.id, set, !set.completed_at)} aria-label={set.completed_at ? "Mark set incomplete" : "Complete set"} className={`grid h-12 w-12 place-items-center rounded-md border transition-colors disabled:opacity-50 ${set.completed_at ? "border-fitx-primary/50 bg-fitx-primary/10 text-fitx-primary" : "border-fitx-border text-fitx-text-secondary hover:border-fitx-primary/40 hover:text-fitx-primary"}`}><Check size={19} /></button></div>)}</div>
        {currentExercise.exercise_id && <details className="mt-5 border-t border-fitx-divider pt-3"><summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-fitx-text-secondary">View movement reference frames</summary><div className="mt-2 max-w-2xl"><ExerciseMovementFrames exerciseId={currentExercise.exercise_id} name={currentExercise.name} /></div></details>}
      </div>
    </section>}

    {restRemaining > 0 && <section role="timer" aria-label="Rest timer" className="fitx-panel fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-40 mx-auto flex max-w-md items-center justify-between gap-3 border-fitx-primary/30 bg-fitx-card p-3 shadow-xl sm:bottom-4 sm:p-4"><p className="flex items-center gap-2 text-sm"><Timer size={17} className="text-fitx-primary" />Rest</p><p className="text-xl font-semibold tabular-nums text-fitx-primary">{Math.floor(restRemaining / 60)}:{String(restRemaining % 60).padStart(2, "0")}</p><button type="button" onClick={() => { setRestEndsAt(null); setRestHeldSeconds(0); }} className="fitx-button fitx-button-secondary min-h-10 px-3 text-xs">Skip rest</button></section>}

    <section className="fitx-panel flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><p className="flex items-center gap-2 text-sm text-fitx-text-secondary"><Trophy size={16} className="shrink-0 text-fitx-primary" /><span>{completedSets.length} completed sets · {Math.round(completedSets.reduce((sum, set) => sum + Number(set.weight_kg) * Number(set.reps), 0)).toLocaleString()} kg logged{timedSetsSupported && <> · {Math.round(completedSets.reduce((sum, set) => sum + Number(set.duration_seconds || 0), 0) / 60)} min timed</>}</span></p><div className="flex flex-col-reverse gap-2 sm:flex-row"><button type="button" onClick={() => void abandonWorkout()} disabled={saving || clockSaving} className="fitx-button fitx-button-quiet min-h-11"><X size={14} />Abandon</button><button type="button" disabled={saving || clockSaving || clock?.paused} onClick={() => void finishWorkout()} className="fitx-button min-h-12">{saving ? "Saving…" : "Finish workout"}<Check size={15} /></button></div></section>
    <div className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+.75rem)] z-30 mx-auto grid max-w-md grid-cols-2 gap-2 sm:hidden"><button type="button" onClick={() => setExerciseIndex((index) => Math.max(0, index - 1))} disabled={exerciseIndex === 0} className="fitx-button fitx-button-secondary min-h-12"><ArrowLeft size={15} />Previous</button><button type="button" onClick={() => setExerciseIndex((index) => Math.min(exercises.length - 1, index + 1))} disabled={exerciseIndex >= exercises.length - 1} className="fitx-button min-h-12">Next exercise<ArrowRight size={15} /></button></div>
    {swapOpen && swapTarget && <SwapSheet target={swapTarget} catalog={catalog} owned={owned} level={level} exclude={new Set(exercises.flatMap((exercise) => (exercise.exercise_id ? [exercise.exercise_id] : [])))} contextLabel={ownedContext} onPick={(exercise) => void swapExercise(exercise)} onClose={() => setSwapOpen(false)} />}
  </div>;
}
