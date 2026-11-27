"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, ArrowRightLeft, Check, ChevronLeft, ChevronRight, History, Info, Pause, Play, Plus, Smartphone, Square, Trophy, Volume2, VolumeX, X } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { trackBottomInset } from "@/components/layout/bottom-inset";
import { PageHeader } from "@/components/ui/PageHeader";
import { CountWithCamera, cameraFitsSet, cameraRuleFor, type CameraCountResult } from "@/components/form-coach";
import { ExerciseDemo } from "@/components/session/ExerciseDemo";
import { RestDock } from "@/components/session/RestDock";
import { SessionMuscles } from "@/components/session/SessionMuscles";
import { SessionRings } from "@/components/session/SessionRings";
import { SetList } from "@/components/session/SetList";
import { UpNext } from "@/components/session/UpNext";
import type { DraftField, LiveExercise, LiveSet, RepSource } from "@/components/session/types";
import { StatStrip } from "@/components/training/StatStrip";
import { SwapSheet } from "@/components/workouts/SwapSheet";
import { programmeById } from "@/data/programmes";
import { createClient } from "@/lib/supabase/client";
import { localDayRange, readableDate } from "@/lib/domain/dates";
import { columnList, isMissingFunctionError, payloadFor, withOptionalColumns } from "@/lib/domain/schema-fallback";
import type { CatalogExercise } from "@/lib/training/catalog";
import { loadCatalog, loadEquipmentProfiles, ownedEquipmentSet } from "@/lib/training/data";
import { equipmentLabel, missingEquipment } from "@/lib/training/equipment";
import { advanceEnrolmentFallback } from "@/lib/training/enrolment";
import { loadExerciseHistory, previousPerformance, type ExerciseSession } from "@/lib/training/exercise-history";
import { survivingExerciseId } from "@/lib/training/exercise-merges";
import { loadLibraryMuscles, summariseMuscles, type MuscleSummary } from "@/lib/training/muscle-history";
import { estimateOneRepMax } from "@/lib/training/one-rep-max";
import { finishSessionWithRpc } from "@/lib/training/plans";
import { sessionStats } from "@/lib/training/session-stats";
import { draftRepsFor, isLiftSet, isTimedPrescription, liftedVolume, setTargetReps, swappedPrescription } from "@/lib/training/sets";
import { LEVELS, type Level } from "@/lib/training/taxonomy";
import { focusHeading } from "@/lib/workouts/focus-heading";
import { PRESCRIPTION_TARGET_COLUMNS, SESSION_PAUSE_COLUMNS, SET_DURATION_COLUMNS, SET_REP_SOURCE_COLUMNS } from "../_lib/workout-columns";
import { plannerEventToComplete } from "../_lib/plan-schedule";
import { readWithOptional, recordHref, stripStats } from "../history/_lib/session-record";
import { exerciseProblem, problemAfterExerciseChange, type ActionProblem } from "./_lib/action-problem";
import { browserFootPage, footBarRef, revealReason } from "./_lib/foot-clearance";
import { formatHistorySet, lastTimeForSet, summariseLastTime } from "./_lib/last-time";
import { SESSION_NOT_FOUND, sessionLinkFrom, type SessionLink } from "./_lib/session-link";
import { SET_LIMITS, readSetEntry, setEntryProblem, setInputId, setProblemId } from "./_lib/set-entry";
import {
  adjustRest, describeNextStep, exerciseAfterTick, exerciseProgress, formatKg, formatRest, restRemaining, sessionProgress, setHeadline, setTarget, setsLeftLabel,
  sessionTally, startRest, stepAfterCurrentSet, stepAfterRest, stepValue, tickMovesOn, timerSecondsDone, updateSet, workTarget,
} from "./_lib/session-progress";
import { useScreenWakeLock, useWorkoutCues } from "./session-device";

type Session = { id: string; user_id: string; plan_id: string | null; name: string; started_at: string; status: string; active_duration_seconds?: number; resumed_at?: string | null; paused_at?: string | null };
type SessionClock = { elapsedSeconds: number; segmentStartedAt: number | null; paused: boolean };
type LocalSessionUi = { clock?: SessionClock; exerciseIndex?: number; restEndsAt?: number | null; restHeldSeconds?: number; restTotalSeconds?: number };
// Optional columns are absent from rows read from a database without the newer workout migrations.
type SessionExerciseRow = { id: string; exercise_id: string | null; exercise_name: string; target_sets: number; reps_min: number; reps_max: number; rest_seconds: number; target_weight_kg?: number | null; target_duration_seconds?: number | null; sort_order: number };
type SetRow = { id: string; session_exercise_id: string; set_number: number; target_reps: number | null; reps: number | null; weight_kg: number; duration_seconds?: number | null; completed_at: string | null; rep_source?: string | null };
/** "Last time" per exercise (surviving id → latest completed session with it, or null), for the ids in `key`. */
type PreviousState = { key: string; failed: boolean; byExercise: Map<string, ExerciseSession | null> };
type Completion = { finishedAt: string; duration: number; records: number; muscles: MuscleSummary | null; musclesFailed: boolean };

const SESSION_COLUMNS = ["id", "user_id", "plan_id", "name", "started_at", "status"] as const;
const SESSION_EXERCISE_COLUMNS = ["id", "exercise_id", "exercise_name", "target_sets", "reps_min", "reps_max", "rest_seconds", "sort_order"] as const;
const SET_COLUMNS = ["id", "set_number", "target_reps", "reps", "weight_kg", "completed_at"] as const;
/** −/+ limits for the number boxes: the database's own ranges. */
const DRAFT_LIMITS: Record<DraftField, { max: number; decimals: number }> = { draftWeight: { max: SET_LIMITS.weightKg, decimals: 2 }, draftReps: { max: SET_LIMITS.reps, decimals: 0 }, draftDuration: { max: SET_LIMITS.seconds, decimals: 0 } };

/** An action's problem, beside the control that was used. */
const PROBLEM_CLASS = "m-0 rounded-lg border border-fitx-danger-border bg-fitx-danger-bg px-3 py-2 text-sm text-fitx-danger";
/** The headings of the screens that Finish workout and Abandon open: each takes focus once its action has worked (D5). */
const COMPLETE_HEADING = "workout-complete-title";
const ABANDONED_HEADING = "workout-abandoned-title";

/** One calm line naming what this database cannot store yet; empty when everything is available. */
function unavailableFieldsNotice(targetsSupported: boolean, timedSetsSupported: boolean) {
  if (targetsSupported && timedSetsSupported) return "";
  const subject = !targetsSupported && !timedSetsSupported ? "Weight and time targets and timed sets aren’t" : !targetsSupported ? "Weight and time targets aren’t" : "Timed sets aren’t";
  return `${subject} available yet while FITX finishes an update. Weight and reps still save as you train.`;
}

type Supabase = NonNullable<ReturnType<typeof createClient>>;

/** A page state without a running workout (loading, none, unavailable, abandoned): the page's h1, then the state. */
function ActiveState({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-5xl"><PageHeader title="Workout" />{children}</div>;
}

/** The browser's time zone, so the database counts the session's day as the user does. */
function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * Ticks off the planner item behind a finished session with fitx_complete_workout_event (planner
 * migration): the item it was started from, else the plan's workout on the session's day (untimed To-Do
 * workouts included, nearest time first), else its latest overdue one; never a later day's. Nothing to
 * tick is still "done". "missing" means the database does not have the function yet.
 * fitx_finish_workout_session calls it itself, so this is only for databases without that function.
 */
async function completeWorkoutEvent(supabase: Supabase, sessionId: string): Promise<"done" | "missing" | "failed"> {
  const { error } = await supabase.rpc("fitx_complete_workout_event", { p_session_id: sessionId, p_tz: browserTimeZone() });
  if (!error) return "done";
  return isMissingFunctionError(error) ? "missing" : "failed";
}

function sessionUiKey(sessionId: string) { return `fitx:workout:session-ui:v1:${sessionId}`; }
function readSessionUi(sessionId: string): LocalSessionUi {
  try { return JSON.parse(window.localStorage.getItem(sessionUiKey(sessionId)) || "{}"); } catch { return {}; }
}
function formatClock(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(seconds / 3600).toString().padStart(2, "0")}:${Math.floor((seconds % 3600) / 60).toString().padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
const repSourceOf = (value: unknown): RepSource | null => (value === "camera" || value === "manual" ? value : null);

export default function ActiveWorkoutPage() {
  const router = useRouter();
  // load() runs once per page visit; it reads the router through a ref so a new router object never re-runs it.
  const routerRef = useRef(router);
  useEffect(() => { routerRef.current = router; }, [router]);
  const [session, setSession] = useState<Session | null>(null);
  const [exercises, setExercises] = useState<LiveExercise[]>([]);
  const [loading, setLoading] = useState(true);
  // A closed session opens its record instead (see load).
  const [redirecting, setRedirecting] = useState(false);
  // No ?session= and no workout in progress.
  const [noSession, setNoSession] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clockSaving, setClockSaving] = useState(false);
  const [pausePersistenceSupported, setPausePersistenceSupported] = useState(false);
  // False once the database has said it lacks the column(s); the matching fields are then hidden.
  const [targetsSupported, setTargetsSupported] = useState(true);
  const [timedSetsSupported, setTimedSetsSupported] = useState(true);
  // Why the session could not be opened (the page then shows only that); an action's problem shows beside its control.
  const [error, setError] = useState("");
  const [problem, setProblem] = useState<ActionProblem | null>(null);
  // The box a set problem is about, focused once the page has marked it (seq: the same box again moves focus again).
  const [focusBox, setFocusBox] = useState<{ id: string; seq: number } | null>(null);
  const [restEndsAt, setRestEndsAt] = useState<number | null>(null);
  // The rest as set (planned plus −/+), which the rest ring measures against.
  const [restTotal, setRestTotal] = useState(0);
  const [restHeldSeconds, setRestHeldSeconds] = useState(0);
  const [exerciseIndex, setExerciseIndex] = useState(0);
  const [clock, setClock] = useState<SessionClock | null>(null);
  const [now, setNow] = useState(0);
  const [finished, setFinished] = useState(false);
  const [completion, setCompletion] = useState<Completion | null>(null);
  // Swap: the light catalogue and the equipment for where this workout happens.
  const [catalog, setCatalog] = useState<CatalogExercise[]>([]);
  const [owned, setOwned] = useState<Set<string>>(() => new Set());
  const [ownedContext, setOwnedContext] = useState<"home" | "gym">("gym");
  const [level, setLevel] = useState<Level>("beginner");
  const [swapOpen, setSwapOpen] = useState(false);
  // A countdown for a timed set; when it ends the set's seconds are filled in and the cue plays.
  const [setTimer, setSetTimer] = useState<{ exerciseId: string; setId: string; setNumber: number; seconds: number; startedAt: number; endsAt: number } | null>(null);
  // What screen readers hear about the set timer and rest: their start, stop and end, never each second.
  const [timerNotice, setTimerNotice] = useState("");
  // Sets "Count with camera" filled, with the number it filled in, so a saved set can record where its count came from.
  const [cameraCounts, setCameraCounts] = useState<Map<string, { kind: CameraCountResult["kind"]; value: number }>>(() => new Map());
  // False once the database has said it lacks workout_sets.rep_source; sets then save without that label.
  const [repSourceSupported, setRepSourceSupported] = useState(true);
  const [previous, setPrevious] = useState<PreviousState | null>(null);
  const cues = useWorkoutCues();
  const { cue } = cues;
  const wakeLock = useScreenWakeLock(Boolean(session && session.status === "in_progress" && !finished && clock && !clock.paused && cues.keepAwake));
  const timerRef = useRef(setTimer);
  // The exercises as last rendered, for a save that returns after other changes (see saveSet).
  const exercisesRef = useRef(exercises);
  useEffect(() => { exercisesRef.current = exercises; }, [exercises]);
  const chipsRef = useRef<HTMLElement>(null);
  // The clock's Pause/Resume button: where focus goes when the paused banner's "Resume workout" goes away (bug 84).
  const clockButtonRef = useRef<HTMLButtonElement>(null);
  const [focusClock, setFocusClock] = useState(0);
  useEffect(() => { if (focusClock) clockButtonRef.current?.focus(); }, [focusClock]);
  // Finish workout and Abandon replace the running workout with their own screen, and the button that held focus goes
  // with it (focus fell to the page body): that screen's heading, which says what happened, takes focus. Not when the
  // action fails: the button then stays, with the problem beside it, and keeps focus.
  const [closedFocus, setClosedFocus] = useState<string | null>(null);
  useEffect(() => { if (closedFocus) focusHeading(document, closedFocus); }, [closedFocus]);
  // The same when ticking an exercise's last open set moves the page on: the set list that held focus is replaced by
  // the next exercise's, whose name takes focus (a touch or mouse user's page does not scroll for it).
  const exerciseIndexRef = useRef(exerciseIndex);
  useEffect(() => { exerciseIndexRef.current = exerciseIndex; }, [exerciseIndex]);
  const [movedOn, setMovedOn] = useState(0);
  useEffect(() => { if (movedOn) focusHeading(document, "current-exercise-title", { keepScroll: true }); }, [movedOn]);
  const restCueRef = useRef<{ endsAt: number | null; cued: boolean }>({ endsAt: null, cued: true });
  useEffect(() => { timerRef.current = setTimer; }, [setTimer]);
  useEffect(() => { restCueRef.current = { endsAt: restEndsAt, cued: restEndsAt === null || restEndsAt <= Date.now() }; }, [restEndsAt]);
  // The current exercise's chip stays in view in the sideways list (only the list scrolls, never the page).
  useEffect(() => {
    const nav = chipsRef.current;
    const chip = nav?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!nav || !chip) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    nav.scrollTo({ left: Math.max(0, chip.offsetLeft - (nav.clientWidth - chip.clientWidth) / 2), behavior: reduced ? "auto" : "smooth" });
  }, [exerciseIndex, exercises.length]);
  // A set refused for one of its boxes: that box, now marked and described by the message, takes focus to be fixed.
  useEffect(() => {
    if (!focusBox) return;
    const box = document.getElementById(focusBox.id);
    if (box instanceof HTMLInputElement && !box.disabled) { box.focus(); box.select(); }
  }, [focusBox]);
  // When an action says why it did not work, beside the control that was used, the reason is brought into view clear of
  // the rest timer and the phone's Previous and Next, fixed over the page's foot (revealReason): on a desktop Finish
  // workout's lay under the floating rest timer (round 3d re-check), and Swap's, Add set's and a refused set's could on
  // a tablet or phone while resting (round 3e open item). After the effect above, so a refused set's box has taken focus
  // first. Focus stays where it is; the page stays put if focus has moved elsewhere meanwhile.
  const finishBarRef = useRef<HTMLElement>(null);
  const clockRef = useRef<HTMLElement>(null);
  const pausedRef = useRef<HTMLDivElement>(null);
  const swapAreaRef = useRef<HTMLDivElement>(null);
  const addSetAreaRef = useRef<HTMLDivElement>(null);
  const restDockRef = useRef<HTMLElement>(null);
  const stepBarRef = useRef<HTMLDivElement>(null);
  // While they show, the rest timer and the phone's Previous and Next set the shell's "foot" inset, which html's scroll
  // padding reads (and nothing else): a control reached with Tab then stops above them, as it does above the phone's
  // bar and the privacy banner (round 3e open item). With neither showing, nothing changes.
  const restDockAttach = useMemo(() => footBarRef(restDockRef, (bar) => trackBottomInset(bar, "foot")), []);
  const stepBarAttach = useMemo(() => footBarRef(stepBarRef, (bar) => trackBottomInset(bar, "foot")), []);
  useEffect(() => {
    if (!problem) return;
    const blocks = { finish: finishBarRef.current, clock: clockRef.current, banner: pausedRef.current, swap: swapAreaRef.current, "add-set": addSetAreaRef.current };
    const set = (setId: string) => {
      const reason = document.getElementById(setProblemId(setId));
      const row = reason?.closest("li");
      return reason && row ? { reason, row } : null;
    };
    revealReason(problem, { blocks, set }, [restDockRef.current, stepBarRef.current], browserFootPage());
  }, [problem]);

  const load = useCallback(async (link: SessionLink) => {
    // A malformed ?session= is a workout that cannot be found: no request is made for it.
    if (link.kind === "invalid") { setLoading(false); setError(SESSION_NOT_FOUND); return; }
    const requested = link.kind === "id" ? link.id : "";
    const supabase = createClient();
    if (!supabase) { setLoading(false); setError("FITX is not connected to Supabase."); return; }
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setLoading(false); setError("Sign in to open this workout."); return; }
    const uid = auth.user.id;

    // Without ?session= the workout in progress opens, if there is one.
    let id = requested;
    if (!id) {
      const running = await supabase.from("workout_sessions").select("id").eq("user_id", uid).eq("status", "in_progress").order("started_at", { ascending: false }).limit(1).maybeSingle();
      const runningId = (running.data as { id?: string } | null)?.id;
      if (running.error || !runningId) { setLoading(false); setNoSession(true); return; }
      id = runningId;
      window.history.replaceState(null, "", `/workouts/active?session=${encodeURIComponent(id)}`);
    }

    // Without the pause columns the session still opens; the clock is then kept in this browser.
    const sessionQuery = await withOptionalColumns(SESSION_PAUSE_COLUMNS, (include) =>
      supabase.from("workout_sessions").select(columnList(SESSION_COLUMNS, SESSION_PAUSE_COLUMNS, include)).eq("id", id).eq("user_id", uid).maybeSingle());
    if (sessionQuery.result.error) { setLoading(false); setError("This workout session could not be loaded. Check your connection and try again."); return; }
    const sessionRow = sessionQuery.result.data as unknown as Session | null;
    if (!sessionRow) { setLoading(false); setError(SESSION_NOT_FOUND); return; }
    // A finished or abandoned session is a record now: open it there.
    if (sessionRow.status !== "in_progress") { setRedirecting(true); routerRef.current.replace(recordHref(sessionRow.id)); return; }
    const supportsDurablePause = sessionQuery.includedOptional;
    const currentSession: Session = supportsDurablePause ? sessionRow : { ...sessionRow, active_duration_seconds: 0, resumed_at: sessionRow.started_at, paused_at: null };
    setPausePersistenceSupported(supportsDurablePause);

    const exerciseQuery = await withOptionalColumns(PRESCRIPTION_TARGET_COLUMNS, (include) =>
      supabase.from("workout_session_exercises").select(columnList(SESSION_EXERCISE_COLUMNS, PRESCRIPTION_TARGET_COLUMNS, include)).eq("user_id", uid).eq("session_id", id).order("sort_order"));
    if (exerciseQuery.result.error) { setLoading(false); setError("The workout exercises could not be loaded. Check your connection and try again."); return; }
    const exerciseRows = (exerciseQuery.result.data || []) as unknown as SessionExerciseRow[];
    const exerciseIds = exerciseRows.map((row) => row.id);
    // Seconds (timed sets) and the rep source arrive in separate migrations; each is left out when missing.
    const setQuery = exerciseIds.length
      ? await readWithOptional([SET_DURATION_COLUMNS, SET_REP_SOURCE_COLUMNS], ([duration, source]) =>
        supabase.from("workout_sets").select([...["session_exercise_id", ...SET_COLUMNS], ...(duration ? SET_DURATION_COLUMNS : []), ...(source ? SET_REP_SOURCE_COLUMNS : [])].join(","))
          .eq("user_id", uid).in("session_exercise_id", exerciseIds).order("set_number"))
      : null;
    if (setQuery?.answer.error) { setLoading(false); setError("Your workout sets could not be loaded. Check your connection and try again."); return; }
    const setRows = (setQuery?.answer.data || []) as unknown as SetRow[];
    setTargetsSupported(exerciseQuery.includedOptional);
    setTimedSetsSupported(setQuery ? setQuery.included[0] : true);
    if (setQuery && !setQuery.included[1]) setRepSourceSupported(false);

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
        id: set.id, set_number: set.set_number, target_reps: set.target_reps, reps: set.reps, completed_at: set.completed_at, duration_seconds: set.duration_seconds ?? null, rep_source: repSourceOf(set.rep_source),
        weight_kg: Number(set.weight_kg || 0), draftWeight: String(set.weight_kg || ""), draftReps: draftRepsFor(set, row.target_duration_seconds != null), draftDuration: set.duration_seconds == null ? "" : String(set.duration_seconds),
      })),
    })));
    setClock(nextClock);
    setExerciseIndex(Math.max(0, Math.min(Number(ui.exerciseIndex || 0), Math.max(0, exerciseRows.length - 1))));
    const restingUntil = ui.restEndsAt && !nextClock.paused ? ui.restEndsAt : null;
    setRestEndsAt(restingUntil);
    setRestHeldSeconds(Number(ui.restHeldSeconds || 0));
    // Older saved state has no total: the rest left stands in for it.
    setRestTotal(Number(ui.restTotalSeconds || 0) || (restingUntil ? Math.max(0, Math.ceil((restingUntil - Date.now()) / 1000)) : Number(ui.restHeldSeconds || 0)));
    setNow(Date.now());
    setLoading(false); setError("");
  }, []);

  useEffect(() => { const link = sessionLinkFrom(window.location.search); void Promise.resolve().then(() => load(link)); }, [load]);
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
        setTimerNotice(`Time is up for set ${running.setNumber}. Its seconds are filled in; tick the set to log it.`);
        cue();
      }
      const rest = restCueRef.current;
      if (rest.endsAt && !rest.cued && current >= rest.endsAt) { rest.cued = true; cue(); setTimerNotice("Rest is over."); }
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

  // "Last time": the latest completed session with each exercise (contract C8). Read again after a swap.
  const libraryKey = useMemo(() => [...new Set(exercises.flatMap((exercise) => (exercise.exercise_id ? [survivingExerciseId(exercise.exercise_id)] : [])))].sort().join(","), [exercises]);
  useEffect(() => {
    if (!sessionId || !sessionUserId || !libraryKey) return;
    let active = true;
    void (async () => {
      const supabase = createClient();
      if (!supabase) return;
      const ids = libraryKey.split(",");
      const history = await loadExerciseHistory(supabase, sessionUserId, ids, { sessions: 3, excludeSessionId: sessionId });
      if (!active) return;
      if (history.error) { setPrevious({ key: libraryKey, failed: true, byExercise: new Map() }); return; }
      setPrevious({ key: libraryKey, failed: false, byExercise: new Map(ids.map((id) => [id, previousPerformance(history.byExercise.get(id) ?? [], { excludeSessionId: sessionId })])) });
    })();
    return () => { active = false; };
  }, [sessionId, sessionUserId, libraryKey]);

  useEffect(() => {
    if (!session || !clock || session.status !== "in_progress") return;
    try { window.localStorage.setItem(sessionUiKey(session.id), JSON.stringify({ clock, exerciseIndex, restEndsAt, restHeldSeconds, restTotalSeconds: restTotal } satisfies LocalSessionUi)); } catch { /* Durable session rows remain authoritative. */ }
  }, [session, clock, exerciseIndex, restEndsAt, restHeldSeconds, restTotal]);
  const completedSets = useMemo(() => exercises.flatMap((exercise) => exercise.sets.filter((set) => Boolean(set.completed_at))), [exercises]);
  // Kilograms lifted so far; a timed movement's sets count for their seconds instead.
  const liftedKilograms = useMemo(() => exercises.reduce((sum, exercise) => sum + liftedVolume(exercise.sets.filter((set) => Boolean(set.completed_at)), isTimedPrescription(exercise)), 0), [exercises]);
  const progress = useMemo(() => sessionProgress(exercises), [exercises]);
  const elapsedSeconds = useMemo(() => {
    if (!clock) return 0;
    return clock.paused || clock.segmentStartedAt === null
      ? Math.max(0, clock.elapsedSeconds)
      : Math.max(0, clock.elapsedSeconds + Math.floor((now - clock.segmentStartedAt) / 1000));
  }, [clock, now]);
  const restLeft = restRemaining(restEndsAt === null ? null : { endsAt: restEndsAt }, now);
  const currentExerciseIndex = Math.max(0, Math.min(exerciseIndex, Math.max(0, exercises.length - 1)));
  const currentExercise = exercises[currentExerciseIndex] || null;

  function startSetTimer(exerciseId: string, setId: string, setNumber: number, seconds: number) {
    cues.prime();
    const startedAt = Date.now();
    setSetTimer({ exerciseId, setId, setNumber, seconds, startedAt, endsAt: startedAt + seconds * 1000 });
    setTimerNotice(`Set ${setNumber} timer started: ${seconds} seconds.`);
  }

  /** Stopping early records the seconds actually done. */
  function stopSetTimer(at = Date.now()) {
    const running = timerRef.current;
    if (!running) return;
    timerRef.current = null;
    setSetTimer(null);
    const done = timerSecondsDone(running, at);
    changeSet(running.exerciseId, running.setId, "draftDuration", String(done));
    setTimerNotice(`Set ${running.setNumber} timer stopped at ${done} seconds.`);
  }

  /** −/+ on the rest: past 0 the rest is over. */
  function adjustRestBy(deltaSeconds: number) {
    if (!restEndsAt) return;
    const current = Date.now();
    const next = adjustRest({ endsAt: restEndsAt, totalSeconds: restTotal || restLeft }, deltaSeconds, current);
    setNow(current);
    if (!next) { skipRest(); return; }
    setRestEndsAt(next.endsAt);
    setRestTotal(next.totalSeconds);
  }
  function skipRest() {
    setRestEndsAt(null);
    setRestHeldSeconds(0);
  }

  /** Replaces the current exercise for this session only; the saved plan is unchanged. */
  async function swapExercise(replacement: CatalogExercise) {
    const exercise = currentExercise;
    if (!exercise || !session) return;
    if (exercise.sets.some((set) => Boolean(set.completed_at))) { setSwapOpen(false); return setProblem({ at: "swap", exerciseId: exercise.id, message: "Swap an exercise before logging its sets." }); }
    const supabase = createClient();
    if (!supabase) return;
    // Reps or seconds follow the new movement when its type differs (a hold for push-ups, or the reverse).
    // Without the time-target column a movement cannot be timed, so only the movement changes.
    const prescription = targetsSupported ? swappedPrescription(exercise, replacement) : { reps_min: exercise.reps_min, reps_max: exercise.reps_max, target_duration_seconds: exercise.target_duration_seconds };
    const patch = { exercise_id: replacement.id, exercise_name: replacement.name, ...prescription };
    const outcome = await withOptionalColumns(["target_duration_seconds"], (include) =>
      supabase.from("workout_session_exercises").update(payloadFor(patch, ["target_duration_seconds"], include)).eq("id", exercise.id).eq("user_id", session.user_id).select("id").maybeSingle(),
    { includeOptional: targetsSupported });
    if (outcome.result.error || !outcome.result.data) { setSwapOpen(false); return setProblem({ at: "swap", exerciseId: exercise.id, message: "That exercise couldn’t be swapped. Check your connection and try again." }); }
    const stored = { ...prescription, target_duration_seconds: outcome.includedOptional ? prescription.target_duration_seconds : exercise.target_duration_seconds };
    const changed = stored.reps_min !== exercise.reps_min || stored.reps_max !== exercise.reps_max || stored.target_duration_seconds !== exercise.target_duration_seconds;
    const targetReps = setTargetReps(stored);
    // None of its sets is logged yet (see above), so every set takes the new target. If this request
    // fails, the page still shows the right fields and a reload leaves a timed set's reps empty.
    if (changed) await supabase.from("workout_sets").update({ target_reps: targetReps }).eq("session_exercise_id", exercise.id).eq("user_id", session.user_id).is("completed_at", null);
    setExercises((items) => items.map((item) => item.id !== exercise.id ? item : {
      ...item, exercise_id: replacement.id, name: replacement.name, reps_min: stored.reps_min, reps_max: stored.reps_max, target_duration_seconds: stored.target_duration_seconds,
      // A different type of movement starts its sets afresh: its rep target, or empty reps and seconds to time.
      sets: changed ? item.sets.map((set) => set.completed_at ? set : { ...set, target_reps: targetReps, draftReps: targetReps == null ? "" : String(targetReps), draftDuration: "" }) : item.sets,
    }));
    if (setTimer?.exerciseId === exercise.id) setSetTimer(null);
    setSwapOpen(false);
    setProblem(null);
  }

  /** Moves to another exercise; a Swap or Add set problem was about the one left, so it goes (workouts-r3). */
  function showExercise(next: number | ((index: number) => number)) {
    setExerciseIndex(next);
    setProblem(problemAfterExerciseChange);
  }

  /** A set's problem goes once the member changes that set: it was about what the boxes held. */
  function clearSetProblem(setId: string) {
    setProblem((current) => (current?.at === "set" && current.setId === setId ? null : current));
  }

  function changeSet(exerciseId: string, setId: string, field: DraftField, value: string) {
    clearSetProblem(setId);
    setExercises((items) => items.map((exercise) => exercise.id !== exerciseId ? exercise : {
      ...exercise, sets: exercise.sets.map((set) => set.id === setId ? { ...set, [field]: value } : set),
    }));
  }

  /** −/+ beside the current set's boxes: the typed value moves by one step, within the database's limits. */
  function stepSet(exerciseId: string, setId: string, field: DraftField, delta: number) {
    clearSetProblem(setId);
    setExercises((items) => items.map((exercise) => exercise.id !== exerciseId ? exercise : {
      ...exercise, sets: exercise.sets.map((set) => set.id === setId ? { ...set, [field]: stepValue(set[field], delta, DRAFT_LIMITS[field]) } : set),
    }));
  }

  /** A count confirmed in "Count with camera" fills the open set for review; the user still ticks it to log it. */
  function applyCameraCount(exerciseId: string, setId: string, result: CameraCountResult) {
    const value = result.kind === "reps" ? result.reps : result.seconds;
    changeSet(exerciseId, setId, result.kind === "reps" ? "draftReps" : "draftDuration", String(value));
    setCameraCounts((counts) => new Map(counts).set(setId, { kind: result.kind, value }));
  }

  /** Pause or resume, from the clock's button or the paused banner's (`from`: where a problem is shown). */
  async function togglePause(from: "clock" | "banner" = "clock") {
    if (!session || !clock || clockSaving) return;
    setProblem(null);
    const supabase = createClient();
    const nowDate = new Date();
    if (clock.paused) {
      if (pausePersistenceSupported && supabase) {
        setClockSaving(true);
        const resumed = await supabase.from("workout_sessions").update({ paused_at: null, resumed_at: nowDate.toISOString() }).eq("id", session.id).eq("user_id", session.user_id).eq("status", "in_progress").not("paused_at", "is", null).select("id,paused_at,resumed_at,active_duration_seconds").maybeSingle();
        setClockSaving(false);
        if (resumed.error || !resumed.data) return setProblem({ at: from, message: "The workout could not be resumed. Check your connection and try again." });
        setSession({ ...session, paused_at: null, resumed_at: resumed.data.resumed_at, active_duration_seconds: Number(resumed.data.active_duration_seconds || 0) });
      }
      setClock({ elapsedSeconds: clock.elapsedSeconds, segmentStartedAt: Date.now(), paused: false });
      if (restHeldSeconds > 0) setRestEndsAt(Date.now() + restHeldSeconds * 1000);
      setRestHeldSeconds(0);
      setTimerNotice("Workout resumed.");
      // The banner and its button go: focus moves to the clock's button, now Pause session. The clock's own button stays.
      if (from === "banner") setFocusClock((value) => value + 1);
      return;
    }
    const elapsed = elapsedSeconds;
    if (pausePersistenceSupported && supabase) {
      setClockSaving(true);
      const paused = await supabase.from("workout_sessions").update({ active_duration_seconds: elapsed, paused_at: nowDate.toISOString(), resumed_at: null }).eq("id", session.id).eq("user_id", session.user_id).eq("status", "in_progress").is("paused_at", null).select("id,paused_at,resumed_at,active_duration_seconds").maybeSingle();
      setClockSaving(false);
      if (paused.error || !paused.data) return setProblem({ at: from, message: "The workout could not be paused. Check your connection and try again." });
      setSession({ ...session, paused_at: paused.data.paused_at, resumed_at: null, active_duration_seconds: Number(paused.data.active_duration_seconds || elapsed) });
    }
    // A set timer stops at the moment of the pause and keeps the seconds held so far.
    stopSetTimer(nowDate.getTime());
    setClock({ elapsedSeconds: elapsed, segmentStartedAt: null, paused: true });
    setRestHeldSeconds(restLeft);
    setRestEndsAt(null);
    setTimerNotice("Workout paused. Your training timer and rest are held.");
  }

  async function saveSet(exerciseId: string, set: LiveSet, complete: boolean) {
    if (clock?.paused) return;
    // A tap: browsers allow the end-of-rest sound only after one.
    if (complete) cues.prime();
    // The duration field is hidden when the database cannot store it, so nothing typed is dropped.
    const { weight, reps, duration } = readSetEntry(set, timedSetsSupported);
    const exercise = exercises.find((item) => item.id === exerciseId);
    const requiresDuration = timedSetsSupported && Boolean(exercise?.target_duration_seconds);
    // Each box is checked on its own, so the message is about the box at fault (an over-limit weight, not the reps).
    const entryProblem = setEntryProblem({ weight, reps, duration }, { complete, timed: requiresDuration });
    if (entryProblem) {
      setProblem({ at: "set", setId: set.id, field: entryProblem.field, message: entryProblem.message });
      setFocusBox((current) => ({ id: setInputId(set.id, entryProblem.field), seq: (current?.seq ?? 0) + 1 }));
      return;
    }
    const supabase = createClient(); if (!supabase || !session) return;
    const patch = { weight_kg: weight, reps: reps > 0 ? reps : null, duration_seconds: duration > 0 ? duration : null, completed_at: complete ? new Date().toISOString() : null };
    // "camera" while the number is still the one the camera counted and the user confirmed.
    const counted = cameraCounts.get(set.id);
    const repSource: RepSource = counted && (counted.kind === "reps" ? reps : duration) === counted.value ? "camera" : "manual";
    // Two optional columns from different migrations, each dropped on its own when the database lacks it.
    let includeSource = repSourceSupported;
    const updated = await withOptionalColumns(SET_DURATION_COLUMNS, async (includeDuration) => {
      const attempt = await withOptionalColumns(SET_REP_SOURCE_COLUMNS, (withSource) =>
        supabase.from("workout_sets").update(payloadFor(payloadFor({ ...patch, rep_source: repSource }, SET_REP_SOURCE_COLUMNS, withSource), SET_DURATION_COLUMNS, includeDuration)).eq("id", set.id).eq("user_id", session.user_id).select("id").maybeSingle(),
      { includeOptional: includeSource });
      if (!attempt.includedOptional) includeSource = false;
      return attempt.result;
    }, { includeOptional: timedSetsSupported });
    if (!includeSource && repSourceSupported) setRepSourceSupported(false);
    if (!updated.includedOptional) setTimedSetsSupported(false);
    if (updated.result.error || !updated.result.data) { setProblem({ at: "set", setId: set.id, field: null, message: "That set could not be saved. Check your connection and try again." }); return; }
    // What the database now holds: a duration it could not store is not kept as saved.
    const saved = { ...(updated.includedOptional ? patch : { ...patch, duration_seconds: null }), rep_source: includeSource ? repSource : null };
    // Applied to the exercises as they are now, not as they were when the set was tapped: ticks, typing and timer
    // seconds from while this save was in flight stay.
    const applySaved = (items: LiveExercise[]) => updateSet(items, exerciseId, set.id, (entry) => ({ ...entry, ...saved, draftWeight: String(weight), draftReps: String(reps), draftDuration: saved.duration_seconds ? String(saved.duration_seconds) : "" }));
    const nextExercises = applySaved(exercisesRef.current);
    setExercises(applySaved);
    setProblem(null);
    if (complete) {
      // Rest follows every set except the last one of the workout.
      const left = sessionProgress(nextExercises).setsLeft;
      if (left > 0) {
        const rest = startRest(exercise?.rest_seconds, Date.now());
        setRestEndsAt(rest.endsAt);
        setRestTotal(rest.totalSeconds);
        setTimerNotice(`Set ${set.set_number} logged. Rest ${formatRest(rest.totalSeconds)}.`);
      } else {
        setRestEndsAt(null);
        setTimerNotice(`Set ${set.set_number} logged. That was the last set: finish the workout when you’re ready.`);
      }
      setRestHeldSeconds(0);
      // Moves on only when the member is still on this exercise.
      const index = nextExercises.findIndex((item) => item.id === exerciseId);
      if (tickMovesOn(nextExercises, index, exerciseIndexRef.current)) setMovedOn((value) => value + 1);
      setExerciseIndex((current) => (index >= 0 && Math.max(0, Math.min(current, nextExercises.length - 1)) === index ? exerciseAfterTick(nextExercises, index) : current));
    } else { setRestEndsAt(null); setRestHeldSeconds(0); }
  }

  async function addSet(exercise: LiveExercise) {
    const supabase = createClient(); if (!supabase || !session || clock?.paused) return;
    if (exercise.sets.length >= 30) return setProblem({ at: "add-set", exerciseId: exercise.id, message: "A movement can have up to 30 sets in one session." });
    const next = exercise.sets.length + 1;
    // No rep target for a timed movement: its sets are logged by time.
    const targetReps = setTargetReps(exercise);
    const inserted = await withOptionalColumns(SET_DURATION_COLUMNS, (include) =>
      supabase.from("workout_sets").insert({ user_id: session.user_id, session_exercise_id: exercise.id, set_number: next, target_reps: targetReps, weight_kg: exercise.target_weight_kg ?? 0 }).select(columnList(SET_COLUMNS, SET_DURATION_COLUMNS, include)).single(),
    { includeOptional: timedSetsSupported });
    if (!inserted.includedOptional) setTimedSetsSupported(false);
    const row = inserted.result.data as unknown as SetRow | null;
    if (inserted.result.error || !row) return setProblem({ at: "add-set", exerciseId: exercise.id, message: "A new set could not be added. Check your connection and try again." });
    setExercises((items) => items.map((item) => item.id === exercise.id ? { ...item, sets: [...item.sets, { id: row.id, set_number: row.set_number, target_reps: row.target_reps, reps: row.reps, completed_at: row.completed_at, weight_kg: exercise.target_weight_kg ?? 0, duration_seconds: null, rep_source: null, draftWeight: String(exercise.target_weight_kg ?? ""), draftReps: targetReps == null ? "" : String(targetReps), draftDuration: "" }] } : item));
    setProblem(null);
  }

  /** The muscles the finished session trained, for the summary (muscle-history.ts: the one counting rule). */
  async function loadCompletionMuscles(supabase: Supabase, finishedSession: Session, finishedAt: string, logged: LiveExercise[]) {
    const library = await loadLibraryMuscles(supabase, logged.map((exercise) => exercise.exercise_id));
    if (library.error) { setCompletion((current) => current && { ...current, musclesFailed: true }); return; }
    const summary = summariseMuscles([{
      id: finishedSession.id, name: finishedSession.name, status: "completed", started_at: finishedSession.started_at, completed_at: finishedAt,
      exercises: logged.map((exercise) => ({
        id: exercise.id, exercise_id: exercise.exercise_id, name: exercise.name, target_duration_seconds: exercise.target_duration_seconds,
        library: exercise.exercise_id ? library.rows.get(survivingExerciseId(exercise.exercise_id)) ?? null : null,
        sets: exercise.sets.map((set) => ({ reps: set.reps, weight_kg: set.weight_kg, duration_seconds: set.duration_seconds, completed_at: set.completed_at, set_number: set.set_number })),
      })),
    }]);
    setCompletion((current) => current && { ...current, muscles: summary });
  }

  function showCompletion(supabase: Supabase, duration: number, records: number) {
    if (!session) return;
    const finishedAt = new Date().toISOString();
    try { window.localStorage.removeItem(sessionUiKey(session.id)); } catch { /* The completed server record is authoritative. */ }
    setCompletion({ finishedAt, duration, records, muscles: null, musclesFailed: false });
    setSession({ ...session, status: "completed" });
    setRestEndsAt(null);
    setSetTimer(null);
    setFinished(true);
    setSaving(false);
    setClosedFocus(COMPLETE_HEADING);
    void loadCompletionMuscles(supabase, session, finishedAt, exercises);
  }

  async function finishWorkout() {
    // Not disabled while saving (Chrome would drop focus): a press meanwhile is ignored here.
    const supabase = createClient(); if (!supabase || !session || saving || clockSaving || clock?.paused) return;
    const validSets = completedSets.filter((set) => Number(set.reps) > 0 || Number(set.duration_seconds) > 0);
    if (!validSets.length) { setProblem({ at: "finish", message: "Complete at least one set before finishing your workout." }); return; }
    setSaving(true); setProblem(null);
    const nowDate = new Date();
    const duration = elapsedSeconds;
    // One transaction when the database has fitx_finish_workout_session: totals, records, the planner
    // item behind this workout (fitx_complete_workout_event, in the browser's time zone) and the
    // programme's next day are worked out from the saved sets.
    const viaRpc = await finishSessionWithRpc(supabase, session.id, duration, browserTimeZone());
    if (viaRpc.summary) return showCompletion(supabase, viaRpc.summary.duration, viaRpc.summary.records);
    if (!viaRpc.fallback) {
      setSaving(false);
      const message = String((viaRpc.error as { message?: string } | null)?.message ?? "");
      return setProblem({ at: "finish", message: message.includes("at least one set") ? "Complete at least one set before finishing your workout." : "This session was already closed or could not be completed. Reload to check its status." });
    }
    // Without fitx_finish_workout_session: the same steps, one request at a time.
    const volume = liftedKilograms;
    const sessionUpdate = await supabase.from("workout_sessions").update({ status: "completed", completed_at: nowDate.toISOString(), duration_seconds: duration, total_volume: volume }).eq("id", session.id).eq("user_id", session.user_id).eq("status", "in_progress").select("id").maybeSingle();
    if (sessionUpdate.error || !sessionUpdate.data) { setSaving(false); return setProblem({ at: "finish", message: "This session was already closed or could not be completed. Reload to check its status." }); }
    let recordCount = 0;
    for (const exercise of exercises) {
      const liftSets = exercise.sets.filter((set) => set.completed_at && isLiftSet(set, isTimedPrescription(exercise)));
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
    // Ticks off one planner item (see completeWorkoutEvent). The saved plan is left untouched so it can
    // be used again.
    const linked = await completeWorkoutEvent(supabase, session.id);
    if (session.plan_id) {
      if (linked === "missing") {
        // Before the planner migration too: the plan's scheduled timed event on the day this session
        // started (today for a normal workout), else its most recent overdue one; never a later day's
        // event (see plannerEventToComplete).
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
      }
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
    showCompletion(supabase, duration, recordCount);
  }

  async function abandonWorkout() {
    if (!session || saving || clockSaving || !window.confirm("Abandon this workout? The sets you completed stay in your workout history, but it won’t count as a completed workout.")) return;
    const supabase = createClient(); if (!supabase || saving) return;
    setSaving(true); setProblem(null);
    const result = await supabase.from("workout_sessions").update({ status: "abandoned", duration_seconds: elapsedSeconds }).eq("id", session.id).eq("user_id", session.user_id).eq("status", "in_progress").select("id").maybeSingle();
    setSaving(false);
    if (result.error || !result.data) return setProblem({ at: "finish", message: "The session could not be abandoned. Check your connection and try again." });
    try { window.localStorage.removeItem(sessionUiKey(session.id)); } catch { /* Ignore unavailable browser storage. */ }
    setRestEndsAt(null);
    setSetTimer(null);
    setSession({ ...session, status: "abandoned" });
    setClosedFocus(ABANDONED_HEADING);
  }

  // Every state of the page has one main heading (bug 94): "Workout" over a state, the workout's name while it runs.
  if (loading || redirecting) return <ActiveState><div role="status" className="fitx-panel animate-pulse p-8 text-sm text-fitx-text-secondary motion-reduce:animate-none">{redirecting ? "Opening the workout record…" : "Loading workout…"}</div></ActiveState>;
  if (noSession) return <ActiveState><EmptyState headingLevel={2} title="No workout in progress" description="Start a workout from your plans or a programme day. Finished workouts are kept in your history." action={<div className="flex flex-wrap justify-center gap-2"><Link href="/workouts" className="fitx-button">Go to workouts</Link><Link href="/workouts/history" className="fitx-button fitx-button-secondary"><History size={15} aria-hidden="true" />Workout history</Link></div>} /></ActiveState>;
  if (!session) return <ActiveState><EmptyState headingLevel={2} title="Workout not available" description={error || "This workout session could not be loaded."} action={<Link href="/workouts" className="fitx-button fitx-button-secondary">Back to workouts</Link>} /></ActiveState>;
  if (finished && completion) {
    const stats = sessionStats({ status: "completed", started_at: session.started_at, completed_at: completion.finishedAt, duration_seconds: completion.duration }, exercises);
    return <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader title="Workout complete" meta="Saved to your workout history." titleId={COMPLETE_HEADING} />
      <section aria-labelledby="completed-workout-name" className="fitx-panel space-y-6 p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-fitx-primary/10 text-fitx-primary"><Check size={24} aria-hidden="true" /></span>
          <div className="min-w-0"><h2 id="completed-workout-name" className="text-lg font-semibold tracking-tight">{session.name}</h2><p className="mt-0.5 text-sm text-fitx-text-secondary">{readableDate(new Date(session.started_at), { weekday: "long", day: "numeric", month: "long" })}</p></div>
        </div>
        <StatStrip label="Session totals" stats={stripStats(stats, ["active", "volume", "sets", "exercises"])} />
        {completion.records > 0 && <p className="flex items-center gap-2 rounded-lg border border-fitx-border bg-fitx-surface px-4 py-3 text-sm font-medium"><Trophy size={16} aria-hidden="true" className="shrink-0 text-fitx-primary" />{completion.records === 1 ? "1 new personal record" : `${completion.records} new personal records`}</p>}
        <div>
          <h3 className="text-sm font-semibold">Muscles trained</h3>
          <p className="mb-4 mt-1 text-xs text-fitx-text-secondary">This session now counts towards your muscle history.</p>
          <SessionMuscles summary={completion.muscles} failed={completion.musclesFailed} />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Link href={recordHref(session.id)} className="fitx-button min-h-12">View the full record<ArrowRight size={15} aria-hidden="true" /></Link>
          <Link href="/workouts" className="fitx-button fitx-button-secondary min-h-12">Back to workouts</Link>
          <Link href="/workouts/history" className="inline-flex min-h-11 items-center justify-center gap-2 px-3 text-sm font-medium text-fitx-primary-text hover:underline sm:ml-auto"><History size={15} aria-hidden="true" />Workout history</Link>
        </div>
      </section>
    </div>;
  }
  if (session.status === "abandoned") return <ActiveState><EmptyState headingLevel={2} title="Workout abandoned" headingId={ABANDONED_HEADING} description="It doesn’t count as a completed workout. The sets you completed are kept with it in your history." action={<div className="flex flex-wrap justify-center gap-2"><Link href={recordHref(session.id)} className="fitx-button">View its record</Link><Link href="/workouts" className="fitx-button fitx-button-secondary">Back to workouts</Link></div>} /></ActiveState>;
  if (session.status !== "in_progress") return <ActiveState><EmptyState headingLevel={2} title="Opening the workout record" description="This workout has finished." action={<Link href={recordHref(session.id)} className="fitx-button">View its record</Link>} /></ActiveState>;

  const paused = Boolean(clock?.paused);
  const fieldsNotice = unavailableFieldsNotice(targetsSupported, timedSetsSupported);
  const survivor = currentExercise?.exercise_id ? survivingExerciseId(currentExercise.exercise_id) : null;
  const swapTarget = currentExercise?.exercise_id ? catalog.find((exercise) => exercise.id === currentExercise.exercise_id) : undefined;
  const swapMissing = swapTarget ? missingEquipment(swapTarget.required_equipment, owned) : [];
  const currentProgress = currentExercise ? exerciseProgress(currentExercise) : null;
  const atFirst = currentExerciseIndex === 0;
  const atLast = currentExerciseIndex >= exercises.length - 1;
  // Only the exercise on screen's own Swap and Add set problems show under its buttons.
  const swapProblem = exerciseProblem(problem, "swap", currentExercise?.id);
  const addSetProblem = exerciseProblem(problem, "add-set", currentExercise?.id);
  const currentSet = currentProgress?.current && currentExercise ? currentExercise.sets.find((set) => set.id === currentProgress.current!.id) ?? null : null;
  const target = currentExercise ? setTarget(currentExercise, currentSet) : null;
  const showDuration = Boolean(currentExercise && timedSetsSupported && isTimedPrescription(currentExercise));
  // "Count with camera" for the movements the camera can count, when its result fits the set: reps for a
  // set logged in reps, a hold's seconds for a timed set (so never a rep count on 30 s of mountain climbers).
  const cameraMatch = currentExercise ? cameraRuleFor({ id: currentExercise.exercise_id, name: currentExercise.name }) : null;
  const cameraRule = cameraMatch && cameraFitsSet(cameraMatch, showDuration) ? cameraMatch : null;
  const timerHere = Boolean(setTimer && currentExercise && setTimer.exerciseId === currentExercise.id);
  const timerRemaining = setTimer ? Math.max(0, Math.ceil((setTimer.endsAt - now) / 1000)) : 0;
  const resting = restLeft > 0 && !paused;
  const restRing = resting ? { remaining: restLeft, total: Math.max(restTotal, restLeft), held: false } : paused && restHeldSeconds > 0 ? { remaining: restHeldSeconds, total: Math.max(restTotal, restHeldSeconds), held: true } : null;
  // "Last time": undefined while loading, null when there is none.
  const previousReady = previous && previous.key === libraryKey ? previous : null;
  const lastSession = survivor && previousReady ? previousReady.byExercise.get(survivor) ?? null : undefined;
  const nextAfterSet = stepAfterCurrentSet(exercises, currentExerciseIndex);
  const upNext = describeNextStep(nextAfterSet, exercises);
  const upNextExercise = nextAfterSet.kind === "exercise" ? exercises[nextAfterSet.exerciseIndex] : null;
  const upNextId = upNextExercise?.exercise_id ? survivingExerciseId(upNextExercise.exercise_id) : null;
  const afterRest = describeNextStep(stepAfterRest(exercises, currentExerciseIndex), exercises);
  // The same numbers as the finish screen and the record (session-stats.ts), so unknown weight is never "0 kg".
  const tally = sessionTally(sessionStats({ status: "in_progress", started_at: session.started_at }, exercises), timedSetsSupported);

  return <div className={`mx-auto max-w-5xl space-y-4 sm:space-y-5 ${resting ? "pb-64 sm:pb-40" : "pb-28 sm:pb-10"}`}>
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <Link href="/workouts" className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-medium text-fitx-text-secondary hover:text-fitx-text"><ArrowLeft size={15} aria-hidden="true" />Workouts</Link>
      <p className="text-xs text-fitx-text-secondary">Sets save as you tick them.</p>
    </div>
    <h1 className="text-[24px] font-bold leading-tight tracking-[-.03em] text-fitx-text sm:text-[30px]">{session.name}</h1>
    <p role="status" className="sr-only">{timerNotice}</p>
    {fieldsNotice && <p role="status" className="flex items-start gap-2 rounded-lg border border-fitx-border bg-fitx-surface px-4 py-3 text-xs text-fitx-text-secondary"><Info size={15} aria-hidden="true" className="mt-px shrink-0 text-fitx-info" /><span>{fieldsNotice}</span></p>}

    <section ref={clockRef} aria-label="Workout clock" className="fitx-panel grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:px-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[.13em] text-fitx-text-secondary">Elapsed training time</p>
        <p className="mt-1 font-mono text-2xl font-semibold tabular-nums tracking-tight sm:text-[28px]">{formatClock(elapsedSeconds)}</p>
      </div>
      {/* Not disabled while the pause or resume saves (Chrome would drop focus): togglePause ignores a press meanwhile. */}
      <button ref={clockButtonRef} type="button" onClick={() => void togglePause()} aria-disabled={clockSaving || undefined} className="fitx-button fitx-button-secondary min-h-11 px-4 aria-disabled:opacity-60 sm:col-start-3">{paused ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}{clockSaving ? "Saving…" : paused ? "Resume" : <span>Pause<span className="sr-only sm:not-sr-only"> session</span></span>}</button>
      <div className="col-span-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:row-start-1">
        <div className="flex items-baseline justify-between gap-3 text-xs text-fitx-text-secondary"><span><span className="font-semibold text-fitx-text">{progress.setsDone}</span> of {progress.setsTotal} sets done</span><span>{progress.setsLeft ? `${progress.setsLeft} to go` : progress.setsTotal ? "All sets done" : ""}</span></div>
        <div className="fitx-progress-track mt-2 h-2" role="progressbar" aria-label="Workout sets completed" aria-valuemin={0} aria-valuemax={Math.max(1, progress.setsTotal)} aria-valuenow={progress.setsDone}><div className="fitx-progress-fill motion-reduce:transition-none" style={{ width: `${progress.setsTotal ? Math.min(100, progress.setsDone / progress.setsTotal * 100) : 0}%` }} /></div>
      </div>
      {problem?.at === "clock" && <p role="alert" className={`col-span-2 sm:col-span-3 ${PROBLEM_CLASS}`}>{problem.message}</p>}
    </section>

    {/* The paused banner and, under it, why Resume workout did not work: one block, brought clear of the foot's bars. */}
    {paused && <div ref={pausedRef} className="space-y-4 sm:space-y-5">
      <section role="status" className="flex flex-col gap-3 rounded-lg border border-fitx-primary/30 bg-fitx-primary/[.06] p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold">Session paused</p><p className="mt-1 text-xs text-fitx-text-secondary">Your training timer and rest are held. Resume when you’re ready.</p></div><button type="button" onClick={() => void togglePause("banner")} aria-disabled={clockSaving || undefined} className="fitx-button min-h-11 aria-disabled:opacity-60">{clockSaving ? "Saving…" : "Resume workout"}<Play size={14} aria-hidden="true" /></button></section>
      {problem?.at === "banner" && <p role="alert" className={PROBLEM_CLASS}>{problem.message}</p>}
    </div>}

    {exercises.length > 0 && <nav ref={chipsRef} aria-label="Workout exercises" className="relative -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">{exercises.map((exercise, index) => {
      const chip = exerciseProgress(exercise);
      const complete = chip.total > 0 && chip.left === 0;
      return <button key={exercise.id} type="button" aria-current={currentExerciseIndex === index ? "step" : undefined} onClick={() => showExercise(index)} className={`flex min-h-11 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm transition-colors ${currentExerciseIndex === index ? "border-fitx-primary bg-fitx-primary/[.08] text-fitx-text" : "border-fitx-border text-fitx-text-secondary hover:border-fitx-primary/40"}`}>
        <span className="font-mono text-[11px] text-fitx-text-secondary">{String(index + 1).padStart(2, "0")}</span>
        <span className="max-w-36 truncate">{exercise.name}</span>
        <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${complete ? "bg-fitx-primary/10 text-fitx-primary-text" : "bg-fitx-surface-variant text-fitx-text-secondary"}`}>{complete ? <Check size={11} aria-hidden="true" className="inline" /> : null}{chip.done}/{chip.total}<span className="sr-only"> sets done</span></span>
      </button>;
    })}</nav>}

    {!exercises.length && <EmptyState headingLevel={2} title="No exercises in this session" description="This workout has no movements yet. Go back and start a saved plan with exercises." />}
    {currentExercise && currentProgress && <section aria-labelledby="current-exercise-title" className="fitx-panel overflow-hidden">
      <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-7">
        <div className="min-w-0"><ExerciseDemo exerciseId={survivor} name={currentExercise.name} /></div>
        <div className="min-w-0 space-y-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[.14em] text-fitx-primary-text">Exercise {currentExerciseIndex + 1} of {exercises.length}</p>
            <h2 id="current-exercise-title" className="mt-1 text-2xl font-bold tracking-tight sm:text-[28px]">{currentExercise.name}</h2>
            <p className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1"><span className="font-heading text-xl font-extrabold tabular-nums text-fitx-text">{setHeadline(currentProgress)}</span>{setsLeftLabel(currentProgress) && <span className="text-sm font-semibold text-fitx-text-secondary">{setsLeftLabel(currentProgress)}</span>}</p>
            <p className="mt-1.5 text-sm text-fitx-text-secondary">Plan: {currentExercise.target_sets} {currentExercise.target_sets === 1 ? "set" : "sets"} · {workTarget(currentExercise)}{targetsSupported && <> · {currentExercise.target_weight_kg == null ? "no target weight" : `${formatKg(currentExercise.target_weight_kg)} kg`}</>} · {formatRest(currentExercise.rest_seconds)} rest</p>
            {survivor && lastSession !== undefined && <p className="mt-2 flex items-start gap-1.5 text-sm"><History size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-fitx-text-secondary" />{previousReady?.failed
              ? <span className="text-fitx-text-secondary">Last time isn’t available right now.</span>
              : lastSession
                ? <span><span className="text-fitx-text-secondary">Last time · {readableDate(new Date(lastSession.startedAt), { weekday: "short", day: "numeric", month: "short" })}: </span><span className="font-semibold text-fitx-text">{summariseLastTime(lastSession)}</span></span>
                : <span className="text-fitx-text-secondary">No earlier sets logged for this exercise yet.</span>}</p>}
            {swapMissing.length > 0 && <p className="mt-2 text-xs text-fitx-warning">Needs {swapMissing.map(equipmentLabel).join(", ").toLowerCase()}, not on your {ownedContext} list. Swap it for something you can do.</p>}
          </div>
          {/* Swap's row and, under it, why Swap did not work: one block, brought clear of the foot's bars. */}
          <div ref={swapAreaRef} className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setSwapOpen(true)} disabled={!swapTarget || paused || currentExercise.sets.some((set) => Boolean(set.completed_at))} title={currentExercise.sets.some((set) => Boolean(set.completed_at)) ? "Swap before logging sets" : undefined} className="fitx-button fitx-button-quiet min-h-11 px-3 text-sm"><ArrowRightLeft size={14} aria-hidden="true" />Swap</button>
              {survivor && <Link href={`/exercises/${encodeURIComponent(survivor)}`} target="_blank" rel="noopener noreferrer" className="fitx-button fitx-button-quiet min-h-11 px-3 text-sm"><Info size={14} aria-hidden="true" />About<span className="sr-only"> {currentExercise.name} (opens in a new tab)</span></Link>}
              <span className="ml-auto flex items-center gap-2">
                {/* At the first or last exercise these stay focusable (aria-disabled): pressing Next onto the last exercise used to
                    disable the button in the member's hand, and Chrome then drops focus to the page (D5). */}
                <button type="button" onClick={() => { if (!atFirst) showExercise((index) => Math.max(0, index - 1)); }} aria-disabled={atFirst || undefined} aria-label="Previous exercise" className="grid h-11 w-11 place-items-center rounded-md border border-fitx-border aria-disabled:opacity-40"><ChevronLeft size={18} aria-hidden="true" /></button>
                <button type="button" onClick={() => { if (!atLast) showExercise((index) => Math.min(exercises.length - 1, index + 1)); }} aria-disabled={atLast || undefined} aria-label="Next exercise" className="grid h-11 w-11 place-items-center rounded-md border border-fitx-border aria-disabled:opacity-40"><ChevronRight size={18} aria-hidden="true" /></button>
              </span>
            </div>
            {swapProblem && <p role="alert" className={PROBLEM_CLASS}>{swapProblem}</p>}
          </div>
          <SessionRings target={target} setTimer={timerHere && setTimer ? { remaining: timerRemaining, total: setTimer.seconds } : null} rest={restRing} plannedRestSeconds={currentExercise.rest_seconds} setsDone={currentProgress.done} setsTotal={currentProgress.total} />
        </div>
      </div>
      <div className="grid gap-4 border-t border-fitx-divider p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start lg:gap-6">
        <SetList
          exercise={currentExercise}
          currentSetId={currentSet?.id ?? null}
          showDuration={showDuration}
          disabled={paused}
          currentTarget={target ? (target.kind === "reps" ? `Target ${target.value} ${target.value === 1 ? "rep" : "reps"}` : `Target ${target.value} s`) : null}
          lastFor={(set) => {
            const match = lastSession ? lastTimeForSet(lastSession, set.set_number) : null;
            return match && lastSession ? formatHistorySet(match, lastSession.timed) : null;
          }}
          cameraFor={(set) => {
            if (set.completed_at) return set.rep_source === "camera";
            const counted = cameraCounts.get(set.id);
            return Boolean(counted && Number(counted.kind === "reps" ? set.draftReps : set.draftDuration) === counted.value);
          }}
          problem={problem?.at === "set" ? problem : null}
          timer={showDuration && currentSet && currentExercise.target_duration_seconds != null ? {
            running: timerHere,
            text: timerHere && setTimer ? `Set ${setTimer.setNumber}: ${timerRemaining}s left` : `Set ${currentSet.set_number}: ${currentExercise.target_duration_seconds}s`,
            control: timerHere
              ? <button type="button" onClick={() => stopSetTimer()} className="fitx-button fitx-button-secondary min-h-11"><Square size={14} aria-hidden="true" />Stop</button>
              : <button type="button" disabled={paused || Boolean(setTimer)} onClick={() => startSetTimer(currentExercise.id, currentSet.id, currentSet.set_number, currentExercise.target_duration_seconds!)} className="fitx-button min-h-11"><Play size={14} aria-hidden="true" />Start timer</button>,
          } : null}
          onChange={(setId, field, value) => changeSet(currentExercise.id, setId, field, value)}
          onStep={(setId, field, delta) => stepSet(currentExercise.id, setId, field, delta)}
          onToggle={(set) => void saveSet(currentExercise.id, set, !set.completed_at)}
        />
        <div className="space-y-4">
        {/* Add set's row and, under it, why Add set did not work: one block, brought clear of the foot's bars. */}
        <div ref={addSetAreaRef} className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void addSet(currentExercise)} disabled={paused} className="fitx-button fitx-button-secondary min-h-11 px-3 text-sm"><Plus size={14} aria-hidden="true" />Add set</button>
            {currentSet && cameraRule && <CountWithCamera
              exercise={{ id: currentExercise.exercise_id, name: currentExercise.name }}
              target={cameraRule.motion.kind === "hold" ? currentExercise.target_duration_seconds : Math.round((currentExercise.reps_min + currentExercise.reps_max) / 2)}
              setLabel={`Set ${currentSet.set_number}`}
              disabled={paused}
              onUse={(result) => applyCameraCount(currentExercise.id, currentSet.id, result)}
            />}
          </div>
          {addSetProblem && <p role="alert" className={PROBLEM_CLASS}>{addSetProblem}</p>}
        </div>
        {upNext &&<UpNext title={upNext.title} detail={upNext.detail} finish={nextAfterSet.kind === "finish"} exercise={upNextExercise ? { id: upNextId, name: upNextExercise.name, sourceRef: upNextId ? catalog.find((item) => item.id === upNextId)?.source_ref ?? null : null } : null} />}
        </div>
      </div>
    </section>}

    {/* Finish and Abandon say why they did not work right above the buttons: on a phone directly above Finish; from
        640 px in a row of its own over the totals and the buttons (sm:order-first: the grid then places the totals and
        the buttons in the row under it). It used to take the row under the buttons there (round 3d re-check). */}
    <section ref={finishBarRef} className="fitx-panel grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <p className="flex items-center gap-2 text-sm text-fitx-text-secondary"><Trophy size={16} aria-hidden="true" className="shrink-0 text-fitx-primary" /><span>{tally}</span></p>
      {problem?.at === "finish" && <p role="alert" className={`sm:order-first sm:col-span-2 ${PROBLEM_CLASS}`}>{problem.message}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row"><button type="button" onClick={() => void abandonWorkout()} aria-disabled={saving || clockSaving || undefined} className="fitx-button fitx-button-quiet min-h-11 aria-disabled:opacity-60"><X size={14} aria-hidden="true" />Abandon</button><button type="button" disabled={paused} aria-disabled={saving || clockSaving || undefined} onClick={() => void finishWorkout()} className="fitx-button min-h-12 aria-disabled:opacity-60">{saving ? "Saving…" : "Finish workout"}<Check size={15} aria-hidden="true" /></button></div>
    </section>
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <button type="button" onClick={cues.toggleCues} aria-pressed={cues.cuesOn} className="fitx-button fitx-button-quiet min-h-11 px-3 text-sm">{cues.cuesOn ? <Volume2 size={14} aria-hidden="true" /> : <VolumeX size={14} aria-hidden="true" />}{cues.cuesOn ? "Rest alert on" : "Rest alert off"}</button>
      <button type="button" onClick={cues.toggleKeepAwake} aria-pressed={cues.keepAwake} className="fitx-button fitx-button-quiet min-h-11 px-3 text-sm"><Smartphone size={14} aria-hidden="true" />{cues.keepAwake ? "Keep screen on" : "Screen can sleep"}</button>
      {cues.keepAwake && wakeLock !== "off" && <span role="status" className="text-fitx-text-secondary">{wakeLock === "on" ? "The screen stays on while you train." : wakeLock === "unsupported" ? "This browser can’t keep the screen on." : "The screen couldn’t be kept on; battery saver can block it."}</span>}
    </div>

    {resting && <RestDock ref={restDockAttach} remaining={restLeft} total={Math.max(restTotal, restLeft)} upNext={afterRest ? [afterRest.title, afterRest.detail].filter(Boolean).join(" · ") : null} onAdjust={adjustRestBy} onSkip={skipRest} />}
    {/* Phones: Previous and Next at the window's foot, 8 px above the privacy banner while it is open (--fitx-inset-consent);
        RestDock rises with them. Both keep html's scroll padding clear of them while they show ("foot", above). */}
    <div ref={stepBarAttach} className="fixed inset-x-3 bottom-[max(calc(env(safe-area-inset-bottom)+.75rem),calc(var(--fitx-inset-consent,0px)+8px))] z-30 mx-auto grid max-w-md grid-cols-2 gap-2 sm:hidden"><button type="button" onClick={() => { if (!atFirst) showExercise((index) => Math.max(0, index - 1)); }} aria-disabled={atFirst || undefined} className="fitx-button fitx-button-secondary min-h-12 aria-disabled:opacity-60"><ArrowLeft size={15} aria-hidden="true" />Previous</button><button type="button" onClick={() => { if (!atLast) showExercise((index) => Math.min(exercises.length - 1, index + 1)); }} aria-disabled={atLast || undefined} className="fitx-button min-h-12 aria-disabled:opacity-60">Next exercise<ArrowRight size={15} aria-hidden="true" /></button></div>
    {swapOpen && swapTarget && <SwapSheet target={swapTarget} catalog={catalog} owned={owned} level={level} exclude={new Set(exercises.flatMap((exercise) => (exercise.exercise_id ? [exercise.exercise_id] : [])))} contextLabel={ownedContext} onPick={(exercise) => void swapExercise(exercise)} onClose={() => setSwapOpen(false)} />}
  </div>;
}
