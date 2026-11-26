"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CalendarDays, ChevronDown, Copy, Info, Pencil, Plus, RotateCcw, Settings2, Sparkles, Trash2, X } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { EquipmentThumb } from "@/components/equipment/EquipmentTile";
import { Reveal } from "@/components/motion";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { MuscleRail } from "@/components/training/MuscleRail";
import { ActionNote } from "@/components/workouts/ActionNote";
import { ActionsMenu } from "@/components/workouts/ActionsMenu";
import { AreaLaunchRail } from "@/components/workouts/AreaLaunchRail";
import { HomeCollection } from "@/components/workouts/HomeCollection";
import { ModePanel, ModeTabs } from "@/components/workouts/ModeTabs";
import { WorkoutSetupFlow } from "@/components/workouts/WorkoutSetupFlow";
import { setupLaterKey } from "@/components/workouts/setup-steps";
import { BuilderRow } from "@/components/workouts/BuilderRow";
import { EquipmentPicker } from "@/components/workouts/EquipmentPicker";
import { ExerciseInfoSheet } from "@/components/workouts/ExerciseInfoSheet";
import { LibraryPicker } from "@/components/workouts/LibraryPicker";
import { PlanPreviewSheet } from "@/components/workouts/PlanPreviewSheet";
import { ScheduledWorkouts } from "@/components/workouts/ScheduledWorkouts";
import { ProgrammeBrowser } from "@/components/workouts/ProgrammeBrowser";
import { ProgrammeCard } from "@/components/workouts/ProgrammeCard";
import { Sheet } from "@/components/workouts/Sheet";
import { SwapSheet } from "@/components/workouts/SwapSheet";
import { TodayEmpty, TodayWorkout, type TodayWorkoutPlan } from "@/components/workouts/TodayWorkout";
import { programmeById } from "@/data/programmes";
import { programmeMeta } from "@/data/programmes/meta";
import { createClient } from "@/lib/supabase/client";
import { isUuidString } from "@/lib/security/body";
import { localDateKey, readableDate } from "@/lib/domain/dates";
import { notifyUserContextChanged } from "@/lib/domain/user-context";
import { columnList, hasValuesIn, isMissingColumnError, isMissingFunctionError, isMissingRelationshipError, payloadFor, withOptionalColumns } from "@/lib/domain/schema-fallback";
import { timedItemDay } from "@/lib/domain/todo";
import type { CatalogExercise } from "@/lib/training/catalog";
import { equipmentFor, loadCatalog, loadEquipmentProfiles, loadProgrammes, saveEquipmentProfile, type EquipmentProfiles } from "@/lib/training/data";
import { enrolInProgramme, finishProgramme, leaveProgramme, loadCurrentEnrolment, loadEnrolmentPlans, pauseProgramme, plansChangedByTopUp, programmeShortTitle, resumeProgramme, scheduleProgrammeDays, topUpProgrammeDays, topUpWindow, type Enrolment, type ProgrammePlan } from "@/lib/training/enrolment";
import { equipmentLabel, expandOwnedEquipment } from "@/lib/training/equipment";
import { bestSet, formatBestSet, loadExerciseHistory, previousPerformance } from "@/lib/training/exercise-history";
import { survivingExerciseId } from "@/lib/training/exercise-merges";
import { focusCounts, listFocusAreas, parseFocusParam, type FocusArea } from "@/lib/training/focus";
import { generateDay, generateFocusDay } from "@/lib/training/generator";
import { loadWorkoutSetup, modeForLocation, resolveDemoModel, type WorkoutSetup } from "@/lib/training/setup";
import { initialMode, modeDirection, readStoredMode, writeStoredMode, type WorkoutMode } from "@/lib/training/workout-mode";
import { contextForLocation, planSummary } from "@/lib/training/plan-summary";
import { splitProgrammeId, type Programme } from "@/lib/training/programmes";
import { readPlanExercises, startFailureMessage, startPlanSession, type PlanExerciseRow } from "@/lib/training/plans";
import { replanMessage, replanUpcomingProgrammeDays } from "@/lib/training/programme-replan";
import { loadRecentExerciseDays } from "@/lib/training/recent-days";
import { addedIds, focusAfterShowMore } from "@/lib/workouts/show-more";
import { stripRange, targetSessions } from "@/lib/training/programme-calendar";
import { plannerEventForStart, startLinkFrom, type StartLink } from "@/lib/training/start-link";
import { LEVELS, type Level, type TrainingContext } from "@/lib/training/taxonomy";
import { PLANNER_DAY_COLUMNS, PRESCRIPTION_TARGET_COLUMNS } from "./_lib/workout-columns";
import { BUILDER_FIELD_IDS, builderSaveProblem, type BuilderProblem } from "./_lib/builder-save";
import { builderSplit, profileSplitAnswer } from "./_lib/split-source";
import { MAX_PLAN_EXERCISES, focusAfterMove, focusAfterRemove, focusAfterSwap, moveNotice, moveRow, plannedFrom, removeNotice, removeRow, selectedIds, swapNotice, swapRow, toggleRow, type BuilderFocus, type PlannedExercise } from "./_lib/builder-rows";
import { focusAfterPlanDelete, historyNote, moreNote, planCardNote, plansLineNote, type ListNote } from "./_lib/list-notes";
import { deletePlanAndItsItem, itemLeftMessage } from "./_lib/plan-delete";
import { plannerEventsForPlan, plannerScheduleChange } from "./_lib/plan-schedule";
import { equipmentGapMessage, equipmentGaps, listChanged } from "./_lib/today-equipment";
import { pickToday } from "./_lib/today-pick";
import { fetchUpcomingScheduled, joinScheduledToPlans, type ScheduledItem } from "./_lib/scheduled";
import { FIRST_PLAN_PAGE, composePlanPage, mergePlansById, planCardStatus, planPageRequests, planSegmentSpec, type PlanPageCursor, type PlanSegmentRequest } from "./_lib/plan-list";
import styles from "./Workouts.module.css";

/** `last_done_key`: local day of the plan's latest finished session, or null when none is known. */
type PlanRow = { id: string; title: string; planned_for: string | null; status: string; split: string; workout_location: string | null; last_done_key: string | null };
type PlanListRow = Omit<PlanRow, "last_done_key"> & { workout_sessions?: Array<{ started_at: string }> | null };
/** A plan opened in the builder; `programme_enrolment_id` is read once the programme migrations are applied. */
type EditedPlanRow = { id: string; title: string; planned_for: string | null; status: string; split: string; notes: string | null; workout_location: string | null; programme_enrolment_id?: string | null };
type SupabaseBrowserClient = NonNullable<ReturnType<typeof createClient>>;
type SessionRow = { id: string; name: string; started_at: string; duration_seconds: number; total_volume: number; status: string; plan_id?: string | null };
type WorkoutPreferences = { workout_location?: string; equipment?: string[] | null; fitness_level?: string; session_duration_minutes?: number; workout_split?: string };
type WorkoutCounts = { completed: number | null; plans: number | null; exercises: number | null };
/** How a new workout is put together: from body areas, from the member's split (a programme day), or by hand. */
type BuilderMode = "focus" | "auto" | "custom";

const PLAN_PAGE_SIZE = 30;
const PLAN_LIST_STATUSES = ["draft", "scheduled"];
// workout_location: which equipment list the Today card checks a plan against (bug 17).
const PLAN_LIST_COLUMNS = "id,title,planned_for,status,split,workout_location";
// Each plan's latest finished session, for the "Done" label: one embedded row per plan.
const PLAN_LAST_DONE_EMBED = "workout_sessions(started_at)";
const HISTORY_LIMIT = 6;
/** Equipment icons shown in the Gym equipment card before "+N". */
const EQUIPMENT_SHOWN = 9;
const TARGETS_UNAVAILABLE_NOTICE = "Weight and time targets arrive with the next FITX update. Everything else saves.";
const SETUP_SAVED = "Setup saved. Workouts now follows your answers.";
const BUILDER_MODES: ReadonlyArray<[BuilderMode, string]> = [["focus", "Body areas"], ["auto", "Your split"], ["custom", "Blank"]];

/** "Done" in the success colour; the other statuses stay neutral. */
function PlanStatusChip({ status }: { status: ReturnType<typeof planCardStatus> }) {
  return <span className={status === "Done" ? styles.chipDone : styles.chip}>{status}</span>;
}

/** "Day 2 of 6 · Push, Pull, Legs", without the programme's name when the day's title already carries it. */
function programmeEyebrow(title: string, dayIndex: number | null, programme: Programme): string {
  const name = programmeShortTitle(programme);
  const parts = [dayIndex !== null ? `Day ${dayIndex + 1} of ${programme.days.length}` : null, title.includes(name) ? null : name].filter(Boolean);
  return parts.length ? parts.join(" · ") : name;
}

/** "Today", "Tomorrow" or "Thu 21 Nov" for a local day key. */
function whenLabel(key: string, todayKey: string): string {
  if (key === todayKey) return "Today";
  const date = new Date(`${key}T12:00:00`);
  const tomorrow = new Date(`${todayKey}T12:00:00`);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (localDateKey(tomorrow) === key) return "Tomorrow";
  return readableDate(date, { weekday: "short", day: "numeric", month: "short" });
}
function toPlannedExercise(row: PlanExerciseRow, exercise: CatalogExercise): PlannedExercise {
  return { exercise, sort_order: row.sort_order, target_sets: row.target_sets, reps_min: row.reps_min, reps_max: row.reps_max, rest_seconds: row.rest_seconds, target_weight_kg: row.target_weight_kg ?? null, target_duration_seconds: row.target_duration_seconds ?? null };
}
function toPlanRow(row: PlanListRow): PlanRow {
  const lastDone = row.workout_sessions?.[0]?.started_at;
  return { id: row.id, title: row.title, planned_for: row.planned_for, status: row.status, split: row.split, workout_location: row.workout_location ?? null, last_done_key: lastDone ? localDateKey(new Date(lastDone)) : null };
}
/**
 * Checks the followed programme's days ahead against the member's list for its place, re-planning those with
 * exercises the list no longer allows (bug 17), and reads the days again when any changed (`plans`: null otherwise).
 */
async function replanProgrammeDays(supabase: SupabaseBrowserClient, input: Parameters<typeof replanUpcomingProgrammeDays>[1] & { plansFrom: string }) {
  const { plansFrom, ...check } = input;
  const outcome = await replanUpcomingProgrammeDays(supabase, check);
  const fresh = outcome.replanned.length ? await loadEnrolmentPlans(supabase, check.userId, check.enrolment.id, plansFrom) : null;
  return { outcome, plans: fresh && !fresh.error ? fresh.plans : null };
}

function asLevel(value: string | undefined): Level {
  return (LEVELS as readonly string[]).includes(value ?? "") ? (value as Level) : "beginner";
}

function programmeNotice(created: number, unfilled: readonly string[], error: unknown, skippedDays: readonly string[] = []) {
  if (error && !created) return "The programme days couldn’t be planned. Use “Plan the next 7 days” to try again.";
  const planned = created ? `Planned ${created} workout${created === 1 ? "" : "s"} for the next 7 days.` : skippedDays.length ? "No workouts were planned." : "None of your training days fall in the next 7 days.";
  const skipped = skippedDays.length ? ` ${[...new Set(skippedDays)].join(", ")}: nothing fits your equipment, so not planned.` : "";
  const gaps = unfilled.length ? ` Left out for your equipment: ${unfilled.join(", ").toLowerCase()}.` : "";
  return planned + skipped + gaps + (error ? " Some days couldn’t be planned; try “Plan the next 7 days” again." : "");
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
  const [builderMode, setBuilderMode] = useState<BuilderMode>("auto");
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  // The edited plan's date when it was opened: its own planner event is the one on that day.
  const [editingPlannedFor, setEditingPlannedFor] = useState<string | null>(null);
  // The edited plan is a programme day: its date stays (a programme day without one, or moved past the week, would
  // drop out of the programme and its planning).
  const [editingProgrammeDay, setEditingProgrammeDay] = useState(false);
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
  // What a plan card's or a History row's action did, beside that control (D6, workouts-r5); and, after a plan is
  // deleted, the plan whose Start takes focus (null: the empty list's Build a workout).
  const [listNote, setListNote] = useState<ListNote | null>(null);
  const [planFocus, setPlanFocus] = useState<{ planId: string | null; seq: number } | null>(null);
  useEffect(() => {
    if (!planFocus) return;
    const card = planFocus.planId ? document.querySelector<HTMLElement>(`[id="workout-plan-${planFocus.planId}"] [data-plan-start]`) : null;
    (card ?? document.querySelector<HTMLElement>("[data-plan-start]") ?? document.getElementById("plans-build-first"))?.focus();
  }, [planFocus]);
  // The plan list is paged; `listDayKey` is the "today" its segments and labels were built with.
  const [planCursor, setPlanCursor] = useState<PlanPageCursor | null>(null);
  const [loadingMorePlans, setLoadingMorePlans] = useState(false);
  const [listDayKey, setListDayKey] = useState("");
  // Home and Gym (phase 7): the Gym mode keeps plans, programmes and history; Home lists the home exercises.
  const context: TrainingContext = "gym";
  const [mode, setMode] = useState<WorkoutMode>("gym");
  const [modeMove, setModeMove] = useState<1 | -1 | 0>(0);
  const modeChosen = useRef(false);
  // The first-time setup (brief 3.4): null until loaded or when it could not be read.
  const [setup, setSetup] = useState<WorkoutSetup | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupLater, setSetupLater] = useState(false);
  const [profiles, setProfiles] = useState<EquipmentProfiles>({ home: null, gym: null, available: false });
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [enrolAvailable, setEnrolAvailable] = useState(false);
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [programmePlans, setProgrammePlans] = useState<ProgrammePlan[]>([]);
  const [recentDays, setRecentDays] = useState<Map<string, number>>(() => new Map());
  const [programmeBusy, setProgrammeBusy] = useState(false);
  // Leaving or finishing replaces the programme card, and the control that held focus with it: focus moves to the
  // section's heading, under which the result is said (D5).
  const [programmeFocus, setProgrammeFocus] = useState(0);
  useEffect(() => {
    const heading = programmeFocus ? document.getElementById("programme-title") : null;
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus();
  }, [programmeFocus]);
  // The next programme days are being planned in the background (see topUpProgrammeDays).
  const [planningAhead, setPlanningAhead] = useState(false);
  // A list that failed to load is not shown as empty: saving the equipment list, following a programme
  // and planning its next week wait for a load that worked, so nothing saved is overwritten or doubled.
  const [equipmentLoadFailed, setEquipmentLoadFailed] = useState(false);
  const [programmeLoadFailed, setProgrammeLoadFailed] = useState(false);
  const [equipmentEditor, setEquipmentEditor] = useState<{ context: TrainingContext; keys: string[] } | null>(null);
  const [equipmentSaving, setEquipmentSaving] = useState(false);
  // Why the list could not be saved, inside its sheet (D6); and, on the card, what saving it did to the programme.
  const [equipmentError, setEquipmentError] = useState("");
  const [equipmentNote, setEquipmentNote] = useState<{ context: TrainingContext; text: string } | null>(null);
  // The programme card's own line (D6): days re-planned for a changed equipment list (bug 17), or what a programme
  // action did or why it did not work, beside the card's buttons rather than at the top of the page.
  const [programmeNote, setProgrammeNote] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  // The Today card's "Re-plan this day": the day, whether it runs, and how it went.
  const [todayReplan, setTodayReplan] = useState<{ planId: string; busy: boolean; note: string } | null>(null);
  const [swapIndex, setSwapIndex] = useState<number | null>(null);
  // After a swap or a remove takes the focused button away, the control that takes focus (seq: once per action), and
  // what the builder's live region says about it (bug 14).
  const [builderFocus, setBuilderFocus] = useState<{ target: BuilderFocus; seq: number } | null>(null);
  const [builderNotice, setBuilderNotice] = useState("");
  // Why the builder could not save or add, beside the control it is about (bug 85); a field problem focuses that field.
  const [builderProblem, setBuilderProblem] = useState<BuilderProblem | null>(null);
  const [builderFieldFocus, setBuilderFieldFocus] = useState<{ id: string; seq: number } | null>(null);
  useEffect(() => { if (builderFieldFocus) document.getElementById(builderFieldFocus.id)?.focus(); }, [builderFieldFocus]);
  const [autoDay, setAutoDay] = useState(0);
  const [autoSeed, setAutoSeed] = useState(0);
  const [autoNote, setAutoNote] = useState("");
  const [focusAreas, setFocusAreas] = useState<FocusArea[]>([]);
  // The builder's anatomy tiles: open while choosing, folded into one line after.
  const [focusPickerOpen, setFocusPickerOpen] = useState(true);
  // The plan whose preview is open (where every plan and programme day begins), and an exercise's details.
  const [previewPlanId, setPreviewPlanId] = useState<string | null>(null);
  const [infoExercise, setInfoExercise] = useState<CatalogExercise | null>(null);
  // "Last time" lines for the builder's exercises, by exercise id (null: nothing completed yet).
  const [lastTimes, setLastTimes] = useState<ReadonlyMap<string, string | null>>(() => new Map());
  const lastTimeRequested = useRef(new Set<string>());
  // Today's workout: its exercises (null while loading), and why Start failed.
  const [todayRows, setTodayRows] = useState<{ planId: string; rows: PlanExerciseRow[] | null; failed: boolean } | null>(null);
  const [todayStartError, setTodayStartError] = useState("");
  // Bumped by every load, so today's exercises are read again after a save or an edit.
  const [loadVersion, setLoadVersion] = useState(0);
  // A ?plan= link opens that plan's preview once, on the first load that finds it.
  const deepLinkHandled = useRef(false);
  // A planner item's Start link (/workouts?plan=<plan>&event=<item>): starting that plan here keeps the item on
  // the session, so finishing ticks it off. Read when the page opens, before the address is reset to /workouts.
  const startLink = useRef<StartLink | null>(null);
  useEffect(() => { startLink.current = startLinkFrom(window.location.search); }, []);
  // Upcoming scheduled workouts (planner items); read again whenever the plans change (a save, a delete, a reload).
  const [scheduled, setScheduled] = useState<ScheduledItem[]>([]);
  useEffect(() => {
    const supabase = createClient();
    if (!supabase || !userId || !listDayKey) return;
    let live = true;
    void fetchUpcomingScheduled(supabase, userId, listDayKey).then((items) => { if (live) setScheduled(items); });
    return () => { live = false; };
  }, [userId, listDayKey, plans]);
  const plansWithScheduled = useMemo(() => joinScheduledToPlans(scheduled, plans), [scheduled, plans]);
  /** Start on a scheduled workout: open its plan, and keep the planner item on the session it starts. */
  function startScheduled(planId: string, plannerEventId: string) {
    startLink.current = { planId, plannerEventId };
    setPreviewPlanId(planId);
  }

  const load = useCallback(async () => {
    const supabase = createClient();
    if (!supabase) { setError("FITX is not connected to Supabase in this environment."); setLoading(false); return; }
    const auth = await supabase.auth.getUser();
    if (!auth.data.user) { setError("Sign in to manage your workouts."); setLoading(false); return; }
    const uid = auth.data.user.id;
    const todayKey = localDateKey();
    // The dashboard links to /workouts?plan=<id>; that plan is fetched on its own in case it is not on the first page.
    // A malformed id (a link cut short) names no plan: it is not sent to the database (bug 49's rule).
    const requestedPlan = new URLSearchParams(window.location.search).get("plan");
    const linkedPlanId = isUuidString(requestedPlan) ? requestedPlan : null;
    // A GET (one row at most) rather than HEAD: a HEAD error has no body, so a missing column could not be recognised.
    const planCountQuery = (onlyOwnPlans: boolean) => {
      const query = supabase.from("workout_plans").select("id", { count: "exact" }).eq("user_id", uid).in("status", PLAN_LIST_STATUSES);
      return (onlyOwnPlans ? query.is("programme_enrolment_id", null) : query).limit(1);
    };
    const [catalogResult, preferencesResult, planPage, historyResult, activeResult, completedCount, planCount, exerciseCount, targetsProbe, linkedPlan, profileResult, programmeResult, enrolmentResult, recent, setupResult] = await Promise.all([
      loadCatalog(supabase),
      supabase.from("user_preferences").select("workout_location,equipment,fitness_level,session_duration_minutes,workout_split").eq("user_id", uid).maybeSingle(),
      fetchPlanPage(supabase, uid, todayKey, FIRST_PLAN_PAGE),
      supabase.from("workout_sessions").select("id,name,started_at,duration_seconds,total_volume,status,plan_id").eq("user_id", uid).eq("status", "completed").order("started_at", { ascending: false }).limit(HISTORY_LIMIT),
      // With its plan, so a card can tell its own workout in progress from another one (bug 30).
      supabase.from("workout_sessions").select("id,name,started_at,duration_seconds,total_volume,status,plan_id").eq("user_id", uid).eq("status", "in_progress").order("started_at", { ascending: false }).limit(1).maybeSingle(),
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
      loadRecentExerciseDays(supabase, uid),
      loadWorkoutSetup(supabase, uid),
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
    setSetup(setupResult.setup);
    // The mode opens once: the address (?mode=), else the one used last on this device, else where they train.
    if (!modeChosen.current) {
      modeChosen.current = true;
      setMode(initialMode({ requested: new URLSearchParams(window.location.search).get("mode"), stored: readStoredMode(), location: setupResult.setup?.location ?? prefs.workout_location }));
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
    setLoadVersion((value) => value + 1);
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
    const programmeOwned = expandOwnedEquipment(equipmentFor(profileResult.profiles, currentEnrolment.context, prefs.equipment).keys);
    // The list may have changed where no check ran (Profile, another device): days saved before it was last saved are
    // checked against it (bug 17). A day saved since, the member's own edit included, is left as it is ("visit").
    const checked = await replanProgrammeDays(supabase, {
      userId: uid, enrolment: currentEnrolment, programme: followed, catalog: catalogResult.exercises, owned: programmeOwned,
      level: asLevel(prefs.fitness_level), recentDays: recent, todayKey, includeTargets: !targetsMissing, plansFrom,
      mode: "visit", listSavedAt: profileResult.savedAt[currentEnrolment.context],
    });
    if (checked.plans) { setProgrammePlans(checked.plans); setLoadVersion((value) => value + 1); }
    const replanned = replanMessage(checked.outcome, currentEnrolment.context);
    if (replanned) setProgrammeNote({ tone: "info", text: replanned });
    const target = targetSessions(currentEnrolment.started_on, currentEnrolment.weekdays, programmeMeta(followed.id)?.lengthDays);
    if (!topUpWindow({ enrolment: currentEnrolment, plans: enrolmentPlans.plans, todayKey, target, dayCount: followed.days.length })) return;
    setPlanningAhead(true);
    const planned = await topUpProgrammeDays(supabase, {
      userId: uid, enrolment: currentEnrolment, programme: followed, catalog: catalogResult.exercises,
      owned: programmeOwned,
      level: asLevel(prefs.fitness_level), recentDays: recent, includeTargets: !targetsMissing, plans: enrolmentPlans.plans, todayKey, target,
    });
    setPlanningAhead(false);
    // Also when another tab planned the days meanwhile: this page's copy still shows them unplanned.
    if (!plansChangedByTopUp(planned)) return;
    const fresh = await loadEnrolmentPlans(supabase, uid, currentEnrolment.id, plansFrom);
    if (!fresh.error) setProgrammePlans(fresh.plans);
    if (planned.created > 0) setNotice(`Planned ${planned.created} more programme day${planned.created === 1 ? "" : "s"}, so your next 7 days are ready.`);
    else if (planned.error) setNotice("Your next programme days couldn’t be planned. Use “Plan the next 7 days” to try again.");
  }, []);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  // "Later" on the first-time setup holds on this device until the member opens the setup themselves.
  useEffect(() => {
    if (!userId) return;
    void Promise.resolve().then(() => {
      try { setSetupLater(window.localStorage.getItem(setupLaterKey(userId)) === "1"); } catch { setSetupLater(false); }
    });
  }, [userId]);

  function changeMode(next: WorkoutMode) {
    if (next === mode) return;
    setModeMove(modeDirection(mode, next));
    setMode(next);
    writeStoredMode(next);
    const params = new URLSearchParams(window.location.search);
    params.set("mode", next);
    window.history.replaceState(null, "", `/workouts?${params.toString()}`);
  }

  function laterSetup() {
    setSetupLater(true);
    try { window.localStorage.setItem(setupLaterKey(userId), "1"); } catch { /* storage unavailable: hidden for this visit */ }
  }

  function setupSaved(next: WorkoutSetup) {
    const firstTime = !setup?.done;
    // The list the followed programme's days were planned with, before this save (a starting list until one is saved).
    const programmeList = enrolment ? equipmentFor(profiles, enrolment.context, preferences.equipment).keys : null;
    setSetup(next);
    setProfiles(next.profiles);
    setPreferences((current) => ({ ...current, workout_location: next.location, fitness_level: next.level, equipment: next.profiles.home ?? current.equipment }));
    setSetupOpen(false);
    setNotice(SETUP_SAVED);
    // Profile, Progress and the coach read the answers from the shared context: it reloads now, not on the next visit.
    notifyUserContextChanged();
    if (firstTime) changeMode(modeForLocation(next.location));
    const keys = enrolment ? next.profiles[enrolment.context] : null;
    if (programmeList && listChanged(programmeList, keys)) void replanAfterSetup(next, keys!);
  }

  /** Setup saved a new list for the followed programme's place: its days ahead follow it (bug 17), as after Save list. */
  async function replanAfterSetup(next: WorkoutSetup, keys: readonly string[]) {
    const supabase = createClient();
    const programme = followedProgramme(programmes, enrolment);
    if (!supabase || !userId || !enrolment || enrolment.status !== "active" || !programme || !catalog.length || programmeLoadFailed) return;
    const todayKey = localDateKey();
    const checked = await replanProgrammeDays(supabase, {
      userId, enrolment, programme, catalog, owned: expandOwnedEquipment(keys), level: asLevel(next.level), recentDays, todayKey,
      includeTargets: targetsSupported !== false, plansFrom: stripRange(todayKey, enrolment.started_on).fromKey, mode: "list-saved",
    });
    if (checked.plans) { setProgrammePlans(checked.plans); setLoadVersion((value) => value + 1); }
    // Said with the setup's own line, under the Workout setup button that opened it (D6).
    const said = checked.outcome.error
      ? "Your programme’s days ahead couldn’t be checked against your new list. Reload Workouts to try again."
      : replanMessage(checked.outcome, enrolment.context);
    if (said) setNotice((current) => (current === SETUP_SAVED ? `${SETUP_SAVED} ${said}` : current));
  }

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("exercise");
    // A link to a merged duplicate adds the exercise it was merged into.
    const exerciseId = requested ? survivingExerciseId(requested) : null;
    if (!exerciseId || !catalog.length || loading) return;
    void Promise.resolve().then(() => {
      const exercise = catalog.find((item) => item.id === exerciseId);
      if (!exercise) return;
      setBuilderMode("custom"); setEditingPlanId(null); setEditingProgrammeDay(false); setTitle("Custom workout"); setPlanNotes(""); setSplit(preferences.workout_split || "full_body"); setPlanLocation(preferences.workout_location || "gym");
      setPlannedFor(localDateKey());
      setPreview([plannedFrom(exercise, 0)]); setAutoNote("");
      setBuilderNotice(""); setBuilderProblem(null); setCreatorOpen(true);
      window.history.replaceState(null, "", "/workouts");
    });
  }, [catalog, loading, preferences.workout_split, preferences.workout_location]);

  // /workouts?equipment=home|gym (linked from the exercise library) opens that equipment list. The home list is
  // still edited here until Home workout has its own.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("equipment");
    if (loading || (requested !== "home" && requested !== "gym")) return;
    void Promise.resolve().then(() => {
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
      // Focus outside the builder (the page body, after its control went away): Tab brings it back in, never behind.
      if (!dialog!.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", keepFocusInside);
    return () => { document.removeEventListener("keydown", keepFocusInside); previousFocus?.focus(); };
  }, [creatorOpen]);

  // A swap rebuilds its row and a remove deletes one: the sensible control in the builder takes focus (bug 14).
  useEffect(() => {
    const dialog = builderRef.current;
    if (!builderFocus || !dialog) return;
    const target = "heading" in builderFocus.target
      ? dialog.querySelector<HTMLElement>("#builder-order-title")
      : dialog.querySelector<HTMLElement>(`[data-builder-row="${builderFocus.target.row}"] [data-builder-control="${builderFocus.target.control}"]`);
    target?.focus();
  }, [builderFocus]);

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

  // Today's workout (else the next one) leads the page; its exercises are read for the card.
  const todayKey = listDayKey || localDateKey();
  const today = useMemo(() => pickToday(todayKey, programmePlans, plans), [todayKey, programmePlans, plans]);
  const todayPlanId = today.kind === "none" ? null : today.plan.id;
  const catalogById = useMemo(() => new Map(catalog.map((exercise) => [exercise.id, exercise])), [catalog]);
  const targetsRef = useRef(targetsSupported);
  useEffect(() => { targetsRef.current = targetsSupported; }, [targetsSupported]);
  useEffect(() => {
    const supabase = createClient();
    if (!todayPlanId || !userId || !supabase) return;
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setTodayRows((current) => current?.planId === todayPlanId && current.rows ? current : { planId: todayPlanId, rows: null, failed: false });
      const outcome = await readPlanExercises(supabase, userId, todayPlanId, targetsRef.current !== false);
      if (active) setTodayRows({ planId: todayPlanId, rows: outcome.error ? null : outcome.rows, failed: Boolean(outcome.error) });
    });
    return () => { active = false; };
  }, [todayPlanId, userId, loadVersion]);

  const level = asLevel(preferences.fitness_level);
  const catalogReady = catalog.length > 0;
  /** The user's equipment for a context, including what their items also serve as. */
  const ownedFor = useCallback((target: TrainingContext) => expandOwnedEquipment(equipmentFor(profiles, target, preferences.equipment).keys), [profiles, preferences.equipment]);
  // The builder's equipment and the anatomy tiles' counts, worked out again only when their inputs change.
  const builderContext = contextForLocation(planLocation);
  const builderOwned = useMemo(() => ownedFor(builderContext), [ownedFor, builderContext]);
  const focusDetails = useMemo(() => {
    if (!creatorOpen || builderMode !== "focus") return undefined;
    const details: Partial<Record<FocusArea, string>> = {};
    // An unknown count shows no line rather than a 0.
    for (const [area, count] of Object.entries(focusCounts(catalog, builderOwned)) as Array<[FocusArea, { doable: number | null }]>) if (count.doable !== null) details[area] = `${count.doable.toLocaleString()} you can do`;
    return details;
  }, [creatorOpen, builderMode, catalog, builderOwned]);

  /**
   * Where "Your split" takes its days from (bug 51): the programme the member follows when it is for this place, else
   * the Profile's training split at the gym, a home track at home (see _lib/split-source.ts).
   */
  function autoSplit(target: TrainingContext) {
    const followed = followedProgramme(programmes, enrolment);
    // The Profile's training split at the gym (a home track at home), for when no programme is followed for this place.
    const splitId = splitProgrammeId(preferences.workout_split, target, ownedFor(target).has("dumbbell"));
    return builderSplit({
      target, followed: followed && enrolment ? { programme: followed, nextDayIndex: enrolment.next_day_index } : null,
      // Called the member's split only when Profile shows it as theirs, not FITX's starting assumption (bug 26).
      split: profileSplitAnswer(Boolean(setup?.done), preferences), splitId, programmes,
    });
  }
  function autoProgramme(target: TrainingContext): Programme | undefined {
    return autoSplit(target)?.programme;
  }

  function generateAuto(target: TrainingContext, dayIndex: number, seed: number) {
    const programme = autoProgramme(target);
    if (!programme?.days.length) return { rows: [] as PlannedExercise[], note: "", programme, title: "Personalised workout" };
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
    return { rows, note, programme, title: target === "home" ? `${day.title} · Home` : day.title };
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
    setTitle((target === "home" ? `${listFocusAreas(areas)} · Home` : listFocusAreas(areas)).slice(0, 120));
    setSplit(areas.length === 1 && areas[0] === "full_body" ? "full_body" : "custom");
  }

  /** Opens the builder with its live region quiet (nothing from an earlier visit is read out again). */
  function showBuilder() {
    setBuilderNotice("");
    setBuilderProblem(null);
    setCreatorOpen(true);
  }

  function openCreator(nextMode: BuilderMode, target: TrainingContext = context, areas: readonly FocusArea[] = []) {
    setBuilderMode(nextMode);
    setEditingPlanId(null); setEditingProgrammeDay(false);
    setTitle(nextMode === "auto" ? "Personalised workout" : "Custom workout");
    setPlanNotes("");
    setSplit(preferences.workout_split || "full_body");
    setPlanLocation(target === "home" ? "home" : "gym");
    setPlannedFor(localDateKey());
    setTime("18:00");
    // A followed programme opens on the day the member is on.
    const startDay = nextMode === "auto" ? autoSplit(target)?.startDay ?? 0 : 0;
    setAutoDay(startDay); setAutoSeed(0); setAutoNote("");
    setFocusAreas([...areas]);
    setFocusPickerOpen(areas.length === 0);
    if (nextMode === "auto") applyAuto(target, startDay, 0);
    else if (nextMode === "focus") applyFocus(target, areas, 0);
    else setPreview([]);
    showBuilder();
    setError("");
    setNotice("");
  }

  /** Switching how a new workout starts: a split regenerates; body areas regenerate once chosen; Blank keeps the rows. */
  function switchMode(next: BuilderMode) {
    if (next === builderMode) return;
    setBuilderMode(next);
    const target = contextForLocation(planLocation);
    if (next === "auto") {
      // A followed programme opens on the day the member is on (bug 51); otherwise the day chosen before, if any.
      const split = autoSplit(target);
      const day = split?.source === "programme" ? split.startDay : autoDay;
      setAutoDay(day);
      applyAuto(target, day, autoSeed);
    }
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
    if (!supabase || !userId || saving) return;
    setNotice(""); setListNote(null); setSaving(true);
    const outcome = await withOptionalColumns(PRESCRIPTION_TARGET_COLUMNS, (include) =>
      supabase.from("workout_session_exercises").select(columnList(["id", "exercise_id", "exercise_name", "sort_order", "target_sets", "reps_min", "reps_max", "rest_seconds"], PRESCRIPTION_TARGET_COLUMNS, include)).eq("session_id", session.id).eq("user_id", userId).order("sort_order"),
    { includeOptional: targetsSupported !== false });
    setSaving(false);
    // A problem is said in the workout's own History row, beside its Repeat button (D6).
    const problem = (text: string) => setListNote({ at: "history", sessionId: session.id, text });
    if (outcome.result.error) return problem("That workout couldn’t be loaded to repeat. Check your connection and try again.");
    const rows = (outcome.result.data || []) as unknown as PlanExerciseRow[];
    const nextPreview = rows.flatMap((row) => {
      const exercise = row.exercise_id ? catalog.find((item) => item.id === survivingExerciseId(row.exercise_id!)) : undefined;
      return exercise ? [toPlannedExercise(row, exercise)] : [];
    }).map((row, sort_order) => ({ ...row, sort_order }));
    if (!nextPreview.length) return problem("The movements from that workout are no longer in the library.");
    setBuilderMode("custom"); setEditingPlanId(null); setEditingProgrammeDay(false); setTitle(session.name); setPlanNotes(""); setSplit(preferences.workout_split || "custom");
    setPlanLocation("gym"); setPlannedFor(localDateKey()); setTime("18:00");
    setPreview(nextPreview); showBuilder();
    // What was left out is said inside the builder, which now covers the page (D6), not behind it.
    const missing = rows.length - nextPreview.length;
    setAutoNote(missing > 0 ? `${missing} movement${missing === 1 ? " is" : "s are"} no longer in the library and ${missing === 1 ? "was" : "were"} left out.` : "");
  }

  /** Keeps the user's sets and rest; reps or time follow the new movement when its type differs (see swapRow). */
  function swapPreview(index: number, replacement: CatalogExercise) {
    const from = preview[index]?.exercise.name;
    setPreview((rows) => swapRow(rows, index, replacement));
    setSwapIndex(null);
    if (from) setBuilderNotice(swapNotice(from, replacement.name));
    setBuilderFocus((current) => ({ target: focusAfterSwap(index), seq: (current?.seq ?? 0) + 1 }));
  }

  /** Removes a row; focus moves to the row that takes its place (or the list's heading), and the change is announced. */
  function removePreview(index: number, item: PlannedExercise) {
    setPreview((rows) => removeRow(rows, item.exercise.id));
    setBuilderNotice(removeNotice(item.exercise.name, preview.length - 1));
    setBuilderFocus((current) => ({ target: focusAfterRemove(preview.length, index), seq: (current?.seq ?? 0) + 1 }));
  }

  async function saveEquipment() {
    const supabase = createClient();
    if (!supabase || !userId || !equipmentEditor || equipmentLoadFailed || equipmentSaving) return;
    const saved = equipmentEditor;
    setEquipmentSaving(true); setEquipmentError(""); setEquipmentNote(null);
    const result = await saveEquipmentProfile(supabase, userId, saved.context, saved.keys);
    if (result.error) { setEquipmentSaving(false); return setEquipmentError("Your equipment list couldn’t be saved. Check your connection and try again."); }
    // Profile shows the lists (and counts a saved one as setup done) from the shared context: it reloads now.
    notifyUserContextChanged();
    setProfiles((current) => ({ ...current, [saved.context]: saved.keys }));
    // A saved list counts as setup done (brief 3.4), so the first-visit setup steps aside.
    setSetup((current) => current ? { ...current, profiles: { ...current.profiles, [saved.context]: saved.keys }, done: true } : current);
    // The followed programme's days ahead follow the new list (bug 17): what that changed is said on the list's card.
    const programme = followedProgramme(programmes, enrolment);
    let note = "List saved.";
    if (enrolment && enrolment.status === "active" && enrolment.context === saved.context && programme && catalog.length && !programmeLoadFailed) {
      const todayKey = localDateKey();
      const checked = await replanProgrammeDays(supabase, {
        userId, enrolment, programme, catalog, owned: expandOwnedEquipment(saved.keys), level, recentDays, todayKey,
        includeTargets: targetsSupported !== false, plansFrom: stripRange(todayKey, enrolment.started_on).fromKey, mode: "list-saved",
      });
      if (checked.plans) { setProgrammePlans(checked.plans); setLoadVersion((value) => value + 1); }
      note = checked.outcome.error
        ? "List saved, but your programme’s days ahead couldn’t be checked against it. Reload Workouts to try again."
        : [note, replanMessage(checked.outcome, saved.context)].filter(Boolean).join(" ");
    }
    setEquipmentSaving(false);
    setEquipmentNote({ context: saved.context, text: note });
    setEquipmentEditor(null);
  }

  /** The Today card's "Re-plan this day": the planner's rules again, for this day and the member's current list. */
  async function replanToday(planId: string) {
    const supabase = createClient();
    const programme = followedProgramme(programmes, enrolment);
    if (!supabase || !userId || !enrolment || !programme || todayReplan?.busy) return;
    setTodayReplan({ planId, busy: true, note: "" });
    const todayKey = localDateKey();
    const checked = await replanProgrammeDays(supabase, {
      userId, enrolment, programme, catalog, owned: ownedFor(enrolment.context), level, recentDays, todayKey,
      includeTargets: targetsSupported !== false, plansFrom: stripRange(todayKey, enrolment.started_on).fromKey, onlyPlanId: planId, mode: "asked",
    });
    if (checked.plans) { setProgrammePlans(checked.plans); setLoadVersion((value) => value + 1); }
    setTodayReplan({
      planId, busy: false,
      note: checked.outcome.error ? "This day couldn’t be re-planned. Check your connection and try again." : replanMessage(checked.outcome, enrolment.context) || "Nothing to change: this day has started, or every exercise fits your list.",
    });
  }

  async function enrol(programme: Programme, weekdays: number[], startTime: string): Promise<string | null> {
    const supabase = createClient();
    if (!supabase || !userId) return "FITX is not connected to Supabase.";
    setProgrammeBusy(true);
    const result = await enrolInProgramme(supabase, { userId, programme, context: programme.context, weekdays, time: startTime, todayKey: localDateKey() });
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
    await load();
    // Said on the new programme card, where the Follow sheet closed (D6).
    setProgrammeNote({ tone: scheduled.error && !scheduled.created ? "error" : "info", text: programmeNotice(scheduled.created, scheduled.unfilledSlots, scheduled.error, scheduled.skippedDays) });
    return null;
  }

  /** "Plan the next 7 days": plans the training days after the last planned one, never a date twice. */
  async function planAhead() {
    const supabase = createClient();
    const programme = followedProgramme(programmes, enrolment);
    if (!supabase || !userId || !enrolment || !programme || programmeLoadFailed) return;
    setProgrammeBusy(true); setError(""); setNotice(""); setProgrammeNote(null);
    const todayKey = localDateKey();
    const scheduled = await topUpProgrammeDays(supabase, {
      userId, enrolment, programme, catalog, owned: ownedFor(enrolment.context), level, recentDays, includeTargets: targetsSupported !== false,
      plans: programmePlans, todayKey, target: targetSessions(enrolment.started_on, enrolment.weekdays, programmeMeta(programme.id)?.lengthDays),
    });
    setProgrammeBusy(false);
    await load();
    setProgrammeNote({ tone: scheduled.ran && scheduled.error && !scheduled.created ? "error" : "info", text: scheduled.ran ? programmeNotice(scheduled.created, scheduled.unfilledSlots, scheduled.error, scheduled.skippedDays)
      : scheduled.skipped === "busy" ? "Your next days are being planned in another tab. Check again in a moment."
      : "Your next 7 days are already planned." });
  }

  async function leave() {
    const supabase = createClient();
    const programme = followedProgramme(programmes, enrolment);
    // Not while the next days are being planned: they would be created after the removal (see topUpProgrammeDays).
    if (!supabase || !userId || !enrolment || planningAhead || programmeBusy) return;
    if (!window.confirm(`Stop following ${programme?.title ?? "this programme"}? Its upcoming days are removed from your plans and planner. Finished workouts stay in your history.`)) return;
    // The last status line was about this programme (for example days just planned): it goes with it.
    setProgrammeBusy(true); setError(""); setNotice(""); setProgrammeNote(null);
    const result = await leaveProgramme(supabase, { userId, enrolmentId: enrolment.id, todayKey: localDateKey() });
    setProgrammeBusy(false);
    if (result.error) return setProgrammeNote({ tone: "error", text: "The programme couldn’t be left. Check your connection and try again." });
    await load();
    // Said in the Programme section, where the card was (D6), and focus goes there (D5).
    setProgrammeNote({ tone: "info", text: `You no longer follow ${programme ? programmeShortTitle(programme) : "the programme"}. Its upcoming days are removed; finished workouts stay in your history.` });
    setProgrammeFocus((value) => value + 1);
  }

  async function pause() {
    const supabase = createClient();
    const programme = followedProgramme(programmes, enrolment);
    if (!supabase || !userId || !enrolment || activeSession || planningAhead) return;
    if (!window.confirm(`Pause ${programme?.title ?? "this programme"}? Its upcoming days are removed from your plans and planner until you resume. Your place in the programme is kept.`)) return;
    setProgrammeBusy(true); setError(""); setNotice(""); setProgrammeNote(null);
    const result = await pauseProgramme(supabase, { userId, enrolmentId: enrolment.id, todayKey: localDateKey() });
    setProgrammeBusy(false);
    if (result.error) return setProgrammeNote({ tone: "error", text: "The programme couldn’t be paused. Check your connection and try again." });
    await load();
    setProgrammeNote({ tone: "info", text: "Programme paused. Resume it whenever you’re ready; it picks up at the day you’re on." });
  }

  async function resume() {
    const supabase = createClient();
    if (!supabase || !userId || !enrolment) return;
    setProgrammeBusy(true); setError(""); setNotice(""); setProgrammeNote(null);
    const result = await resumeProgramme(supabase, { userId, enrolmentId: enrolment.id });
    setProgrammeBusy(false);
    if (result.alreadyActive) return setProgrammeNote({ tone: "error", text: "You follow another programme now. Leave it to resume this one." });
    if (result.error) return setProgrammeNote({ tone: "error", text: "The programme couldn’t be resumed. Check your connection and try again." });
    // Loading again plans the next 7 days from today, at the day the member is on.
    await load();
  }

  async function finish() {
    const supabase = createClient();
    if (!supabase || !userId || !enrolment || planningAhead) return;
    setProgrammeBusy(true); setError(""); setProgrammeNote(null);
    const result = await finishProgramme(supabase, { userId, enrolmentId: enrolment.id, todayKey: localDateKey() });
    setProgrammeBusy(false);
    if (result.error) return setProgrammeNote({ tone: "error", text: "The programme couldn’t be finished. Check your connection and try again." });
    await load();
    setProgrammeNote({ tone: "info", text: "Programme finished. Choose your next one below; your workouts stay in your history." });
    setProgrammeFocus((value) => value + 1);
  }

  /** Start on the Today card: straight into the session (its exercises are on the card already). */
  async function startToday(planId: string) {
    setTodayStartError("");
    const message = await startWorkout(planId);
    if (message) setTodayStartError(message);
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
    if (!next) { setBuilderProblem({ at: "picker", message: `A workout can contain up to ${MAX_PLAN_EXERCISES} exercises.` }); return; }
    setBuilderProblem((current) => (current?.at === "picker" ? null : current));
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

  /** Moves a row; focus follows it to its new place (the page moves the row, which drops focus), and the place is said. */
  function movePreview(index: number, direction: -1 | 1) {
    const moved = preview[index];
    if (!moved || index + direction < 0 || index + direction >= preview.length) return;
    setPreview((rows) => moveRow(rows, index, direction));
    setBuilderNotice(moveNotice(moved.exercise.name, index + direction + 1, preview.length));
    setBuilderFocus((current) => ({ target: focusAfterMove(index, direction, preview.length), seq: (current?.seq ?? 0) + 1 }));
  }

  /**
   * Opens a plan in the builder. Resolves with why it could not, for the caller to say where it was asked: in the
   * plan's card, or in the plan preview (D6). `beforeOpen` runs as the builder opens (the preview closes then).
   */
  async function editPlan(planId: string, beforeOpen?: () => void): Promise<string | null> {
    const supabase = createClient();
    if (!supabase || !userId) return "FITX is not connected to Supabase.";
    if (saving) return null;
    setNotice(""); setListNote(null); setSaving(true);
    const [planResult, exercisesResult, eventResult] = await Promise.all([
      withOptionalColumns(PROGRAMME_PLAN_COLUMNS, (include) =>
        supabase.from("workout_plans").select(columnList(["id", "title", "planned_for", "status", "split", "notes", "workout_location"], PROGRAMME_PLAN_COLUMNS, include)).eq("id", planId).eq("user_id", userId).maybeSingle()),
      readPlanRows(planId),
      // The plan's own event gives the start time (see below); "scheduled" sorts before "completed".
      supabase.from("planner_events").select("status,starts_at").eq("workout_plan_id", planId).eq("user_id", userId).eq("event_type", "workout").neq("status", "cancelled").not("starts_at", "is", null).order("status", { ascending: false }).order("starts_at", { ascending: true }).limit(20),
    ]);
    const planRow = planResult.result.data as unknown as EditedPlanRow | null;
    if (planResult.result.error || !planRow || exercisesResult.error) {
      setSaving(false); return "This workout could not be opened for editing. Check your connection and try again.";
    }
    const rows = exercisesResult.rows;
    const nextPreview = rows.flatMap((row) => {
      const exercise = row.exercise_id ? catalog.find((item) => item.id === survivingExerciseId(row.exercise_id!)) : undefined;
      return exercise ? [toPlannedExercise(row, exercise)] : [];
    });
    if (rows.length && !nextPreview.length) {
      setSaving(false); return "The saved movements are no longer available in the active library.";
    }
    beforeOpen?.();
    setBuilderMode("custom"); setEditingPlanId(planId); setEditingPlannedFor(planRow.planned_for || null); setTitle(planRow.title); setPlanNotes(planRow.notes || ""); setSplit(planRow.split); setPlanLocation(planRow.workout_location || "gym");
    setEditingProgrammeDay(Boolean(planRow.programme_enrolment_id && planRow.planned_for));
    // A To-Do workout linked to the plan has its own time: prefer the scheduled event on the plan's day.
    const planDay = planRow.planned_for;
    const timedEvents = (eventResult.data || []) as Array<{ status: string; starts_at: string }>;
    const ownEvent = timedEvents.find((event) => event.status === "scheduled" && localDateKey(new Date(event.starts_at)) === planDay) ?? timedEvents[0];
    setPlannedFor(planRow.planned_for || ""); setTime(ownEvent ? new Date(ownEvent.starts_at).toTimeString().slice(0, 5) : "18:00");
    setAutoNote(""); setPreview(nextPreview); showBuilder(); setSaving(false);
    return null;
  }

  /** Opens a copy of a plan in the builder; resolves with why it could not (said in the plan's card). */
  async function duplicatePlan(plan: PlanRow): Promise<string | null> {
    const supabase = createClient();
    if (!supabase || !userId) return "FITX is not connected to Supabase.";
    if (saving) return null;
    setNotice(""); setListNote(null); setSaving(true);
    const [planResult, exercisesResult] = await Promise.all([
      supabase.from("workout_plans").select("title,split,notes,workout_location").eq("id", plan.id).eq("user_id", userId).maybeSingle(),
      readPlanRows(plan.id),
    ]);
    if (planResult.error || !planResult.data || exercisesResult.error) { setSaving(false); return "This workout could not be copied. Check your connection and try again."; }
    if (!exercisesResult.rows.length) { setSaving(false); return "This plan has no exercises to copy yet. Edit it to add some first."; }
    const nextPreview = exercisesResult.rows.flatMap((row) => {
      const exercise = row.exercise_id ? catalog.find((item) => item.id === survivingExerciseId(row.exercise_id!)) : undefined;
      return exercise ? [toPlannedExercise(row, exercise)] : [];
    });
    if (!nextPreview.length) { setSaving(false); return "The saved movements are no longer available in the active library."; }
    setBuilderMode("custom"); setEditingPlanId(null); setEditingProgrammeDay(false); setTitle(`${planResult.data.title} copy`); setPlanNotes(planResult.data.notes || ""); setSplit(planResult.data.split); setPlanLocation(planResult.data.workout_location || "gym"); setPlannedFor(""); setTime("18:00");
    setAutoNote(""); setPreview(nextPreview); showBuilder(); setSaving(false);
    return null;
  }

  /** A plan card's menu action said what went wrong in that card (D6). */
  function sayOnPlan(planId: string, message: string | null) {
    if (message) setListNote({ at: "plan", planId, tone: "error", text: message });
  }

  async function loadMorePlans() {
    const supabase = createClient();
    if (!supabase || !userId || !planCursor || loadingMorePlans) return;
    setLoadingMorePlans(true); setListNote((current) => (current?.at === "more" ? null : current));
    const page = await fetchPlanPage(supabase, userId, listDayKey, planCursor);
    setLoadingMorePlans(false);
    // Said beside the button, at the bottom of the list (D6).
    if (page.error) return setListNote({ at: "more", text: "More plans couldn’t be loaded. Check your connection and try again." });
    setPlans((current) => mergePlansById(current, page.rows));
    setPlanCursor(page.next);
    // The button keeps focus while there are more; once it goes, the first plan it brought takes focus (D5).
    const shown = plans.map((plan) => plan.id);
    const target = focusAfterShowMore({ more: Boolean(page.next), shown, added: addedIds(shown, page.rows.map((plan) => plan.id)) });
    if (target !== "button") setPlanFocus((current) => ({ planId: target, seq: (current?.seq ?? 0) + 1 }));
  }

  async function deletePlan(plan: PlanRow) {
    if (!window.confirm(`Delete “${plan.title}” and its saved exercise order? Completed workout sessions will remain in your history.`)) return;
    const supabase = createClient();
    if (!supabase || !userId) return;
    setListNote(null);
    // The planner item FITX scheduled for the plan's date goes with it, once the plan is gone (bug 48, Also seen; a
    // failed delete leaves both as they were). A To-Do item the member linked to the plan stays, unlinked.
    const outcome = await deletePlanAndItsItem(supabase, userId, plan);
    if (outcome.status === "failed") return setListNote({ at: "plan", planId: plan.id, tone: "error", text: "That workout could not be deleted. Check your connection and try again." });
    // Its card goes, and the menu that held focus with it: the next plan's Start takes focus (D5); the list's line says why.
    const next = focusAfterPlanDelete(plans, plan.id);
    await load();
    setListNote({ at: "plans", tone: "info", text: outcome.status === "deleted-item-left" ? itemLeftMessage(plan.title) : `Deleted “${plan.title}”.` });
    setPlanFocus((current) => ({ planId: next, seq: (current?.seq ?? 0) + 1 }));
  }

  async function savePlan(thenStart = false) {
    // Not disabled while saving (Chrome would drop focus from the pressed button): a second press is ignored.
    if (saving) return;
    setError(""); setNotice(""); setBuilderProblem(null);
    const problem = builderSaveProblem({ title, exerciseCount: preview.length, programmeDay: editingProgrammeDay, plannedFor, originalPlannedFor: editingPlannedFor });
    if (problem) {
      setBuilderProblem(problem);
      if (problem.at === "name" || problem.at === "date") setBuilderFieldFocus((current) => ({ id: BUILDER_FIELD_IDS[problem.at as "name" | "date"].field, seq: (current?.seq ?? 0) + 1 }));
      return;
    }
    const saveProblem = (message: string) => { setBuilderProblem({ at: "save", message }); };
    const supabase = createClient();
    if (!userId || !supabase) return saveProblem("FITX is not connected to Supabase.");
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
      return saveProblem(editingPlanId ? "The workout could not be updated. Your saved plan is unchanged." : "The workout could not be saved. Please try again.");
    }

    if (editingPlanId) {
      const [currentPlan, currentExercises] = await Promise.all([
        supabase.from("workout_plans").select("title,split,workout_location,planned_for,status,notes").eq("id", editingPlanId).eq("user_id", userId).maybeSingle(),
        readPlanRows(editingPlanId),
      ]);
      if (currentPlan.error || !currentPlan.data || currentExercises.error) {
        setSaving(false); return saveProblem("The saved workout could not be prepared for an update. Check your connection and try again.");
      }
      originalPlan = currentPlan.data;
      originalRows = currentExercises.rows;
      if (!currentExercises.includedTargets) includeTargets = false;
      const updated = await supabase.from("workout_plans").update(patch).eq("id", editingPlanId).eq("user_id", userId);
      if (updated.error) { setSaving(false); return saveProblem("The workout details could not be updated."); }
      const removed = await supabase.from("workout_plan_exercises").delete().eq("plan_id", editingPlanId).eq("user_id", userId);
      if (removed.error) {
        await supabase.from("workout_plans").update(originalPlan).eq("id", editingPlanId).eq("user_id", userId);
        setSaving(false); return saveProblem("The workout exercises could not be updated. Your previous plan was restored.");
      }
    } else {
      const inserted = await supabase.from("workout_plans").insert({ user_id: userId, ...patch }).select("id").single();
      if (inserted.error || !inserted.data) { setSaving(false); return saveProblem("The workout could not be saved. Please try again."); }
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
      return saveProblem(restored ? "The workout exercises could not be saved. Your previous plan was restored." : "The workout update was interrupted. Reload this page and check the saved exercise list.");
    }
    // Only possible when the builder showed target fields before the database said it lacks them.
    const droppedTargets = !savedExercises.includedOptional && hasValuesIn(rows, PRESCRIPTION_TARGET_COLUMNS);
    if (!planId) { setSaving(false); return saveProblem("The workout could not be saved. Please try again."); }
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
    // The builder closes: what happened next is said with the saved plan, in its card in Your plans, or on the
    // programme card for a programme day (D6), not at the top of the page.
    const sayOnSaved = (tone: "info" | "error", text: string) => (editingProgrammeDay ? setProgrammeNote({ tone, text }) : setListNote({ at: "plan", planId, tone, text }));
    setSaving(false);
    setCreatorOpen(false);
    if (thenStart) {
      const message = await startWorkout(planId, savedTitle);
      if (message) { await load(); sayOnSaved("error", message); }
      return;
    }
    await load();
    const saved = [scheduleWarning, droppedTargets ? "Workout saved. Weight and time targets aren’t available yet while FITX finishes an update, so those values weren’t stored. Everything else in the plan is saved." : ""].filter(Boolean).join(" ");
    if (saved) sayOnSaved(scheduleWarning ? "error" : "info", saved);
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

  // The page's h1 is there in every state (bug 94), loading and unavailable included.
  if (loading) return (
    <div className={styles.page}>
      <PageHeader title="Workouts" />
      <div className={styles.topGrid} aria-busy="true" aria-label="Loading workouts"><div className={`${styles.skeleton} h-96`} /><div className={`${styles.skeleton} hidden h-96 lg:block`} /></div>
    </div>
  );
  if (error && !userId) return <div className={styles.page}><PageHeader title="Workouts" /><EmptyState headingLevel={2} title="Workouts unavailable" description={error} action={<button className="fitx-button fitx-button-secondary" onClick={() => { setLoading(true); void load(); }}>Try again</button>} /></div>;
  // Hidden only once the database has said it lacks the target columns, so nothing typed is lost on save.
  const showTargets = targetsSupported !== false;
  const gymEquipment = equipmentFor(profiles, "gym", preferences.equipment);
  const gymProgrammes = programmes.filter((programme) => programme.context === "gym");
  const enrolledProgramme = followedProgramme(programmes, enrolment);
  const builderSplitSource = builderMode === "auto" && !editingPlanId ? autoSplit(builderContext) : null;
  const builderProgramme = builderSplitSource?.programme;
  const rowToSwap = swapIndex !== null ? preview[swapIndex] : undefined;
  const builderSummary = planSummary(preview);
  const previewProgramme = enrolment && enrolledProgramme
    ? { enrolmentId: enrolment.id, title: programmeShortTitle(enrolledProgramme), dayCount: enrolledProgramme.days.length, dayTitles: enrolledProgramme.days.map((day) => day.title), paused: enrolment.status === "paused" }
    : null;
  const todayCard: TodayWorkoutPlan | null = today.kind === "none" ? null : {
    id: today.plan.id,
    title: today.plan.title,
    when: whenLabel(today.plan.planned_for ?? todayKey, todayKey),
    programme: today.programme && enrolledProgramme ? programmeEyebrow(today.plan.title, today.plan.programme_day_index ?? null, enrolledProgramme) : null,
  };
  const loadedToday = todayCard && todayRows?.planId === todayCard.id ? todayRows : null;
  // The card checks its exercises against the list for where the workout happens (bug 17): a programme day its
  // programme's place, the member's own plan its own. A programme day the list rules out can be re-planned here.
  const todayContext: TrainingContext = today.kind !== "none" && today.programme && enrolment ? enrolment.context : contextForLocation(today.kind === "none" ? null : today.plan.workout_location);
  const todayGaps = todayCard && loadedToday?.rows ? equipmentGaps(loadedToday.rows, catalogById, ownedFor(todayContext)) : null;
  const todayReplanHere = todayCard && todayReplan?.planId === todayCard.id ? todayReplan : null;
  const todayGap = todayCard && (todayGaps?.count || todayReplanHere?.note) ? {
    message: todayGaps?.count ? equipmentGapMessage(todayGaps, todayContext, equipmentLabel) : "",
    onReplan: todayGaps?.count && today.kind !== "none" && today.programme && enrolment?.status === "active" ? () => void replanToday(todayCard.id) : null,
    replanning: Boolean(todayReplanHere?.busy),
    note: todayReplanHere?.note ?? "",
  } : null;
  const doneToday = sessions.find((session) => localDateKey(new Date(session.started_at)) === todayKey) ?? null;
  const hiddenEquipment = Math.max(0, gymEquipment.keys.length - EQUIPMENT_SHOWN);
  const homeEquipment = equipmentFor(profiles, "home", preferences.equipment);
  const homeOwned = expandOwnedEquipment(homeEquipment.keys);
  const demoModel = setup ? resolveDemoModel(setup.demoModel, setup.gender) : null;

  return (
    <div className={styles.page}>
      <div className={styles.stack}>
      <PageHeader title="Workouts"
        meta={counts.completed !== null && counts.completed > 0 ? `${counts.completed.toLocaleString()} workout${counts.completed === 1 ? "" : "s"} done` : undefined}
        actions={<>
          {setup && <button type="button" className={`fitx-button fitx-button-secondary ${styles.headerAction}`} onClick={() => setSetupOpen(true)} aria-haspopup="dialog"><Settings2 size={17} aria-hidden="true" />Workout setup</button>}
          <button type="button" className={`fitx-button ${styles.headerAction}`} onClick={() => openCreator("focus", mode)}><Plus size={18} aria-hidden="true" />New workout</button>
        </>} />
      {error && <p role="alert" className="fitx-alert fitx-alert-danger px-3 py-2 text-sm">{error}</p>}
      {notice && <p role="status" className={styles.notice}><Info size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-fitx-info"/><span>{notice}</span></p>}
      {(equipmentLoadFailed || programmeLoadFailed) && <p role="status" className="fitx-alert">
        {equipmentLoadFailed && programmeLoadFailed ? "Your equipment and programme couldn’t be loaded. Saving and planning wait until they do."
          : equipmentLoadFailed ? "Your saved equipment couldn’t be loaded. Saving a list waits until it does."
          : "Your programme couldn’t be loaded. Planning waits until it does, so no week is planned twice."}
        <button type="button" onClick={() => { setLoading(true); void load(); }} className="fitx-alert-action">Try again</button>
      </p>}
      {activeSession && <div className={styles.activeSession}><span className={styles.livePulse} aria-hidden="true" /><div className="min-w-0 flex-1"><p className="text-sm font-semibold">Workout in progress</p><p className="truncate text-xs text-fitx-text-secondary">{activeSession.name} · started {readableDate(new Date(activeSession.started_at), { hour: "numeric", minute: "2-digit" })}</p></div><Link className="fitx-button min-h-11 shrink-0" href={"/workouts/active?session=" + activeSession.id}>Continue<ArrowRight size={16} aria-hidden="true"/></Link></div>}

      {setup && !setup.done && !setupLater && !setupOpen && (
        <WorkoutSetupFlow setup={{ ...setup, profiles }} userId={userId} legacyWords={preferences.equipment} variant="inline" onSaved={setupSaved} onLater={laterSetup} />
      )}

      <ModeTabs mode={mode} onChange={changeMode} panelId="workouts-mode-panel" idPrefix="workouts" />

      <ModePanel mode={mode} direction={modeMove} id="workouts-mode-panel" labelledBy={`workouts-tab-${mode}`} className={styles.modePanel}>
      {mode === "home" ? (
        <>
          {todayCard && today.kind !== "none" && (
            <div className={styles.homeToday}>
              <span className="min-w-0 flex-1"><span className={styles.homeTodayWhen}>{todayCard.when}</span><span className={styles.itemTitle}>{todayCard.title}</span></span>
              <button type="button" aria-haspopup="dialog" className={`fitx-button ${styles.planStart}`} onClick={() => setPreviewPlanId(todayCard.id)}>Start<ArrowRight size={15} aria-hidden="true" /></button>
            </div>
          )}
          <ScheduledWorkouts items={scheduled} dayLabel={(day) => whenLabel(day, listDayKey || localDateKey())} onStart={startScheduled} headingLevel={2} starting={Boolean(starting)} />
          <HomeCollection catalog={catalog} owned={homeOwned} level={level} model={demoModel}
            onPlan={(area) => openCreator(area ? "focus" : "auto", "home", area ? [area] : [])}
            equipmentSummary={homeEquipment.keys.length ? homeEquipment.keys.map(equipmentLabel).join(", ") : "No equipment"}
            onEditEquipment={() => setEquipmentEditor({ context: "home", keys: homeEquipment.keys })} />
        </>
      ) : (
      <>
      <div className={styles.topGrid}>
        <Section title={today.kind === "next" ? "Up next" : "Today"} id="today" className={styles.todaySection}>
          {todayCard
            ? <TodayWorkout plan={todayCard} rows={loadedToday?.rows ?? null} failed={Boolean(loadedToday?.failed)} catalog={catalogById} starting={starting === todayCard.id} startError={todayStartError} active={activeSession ? { id: activeSession.id, name: activeSession.name, planId: activeSession.plan_id ?? null } : null} gap={todayGap}
                onStart={() => void startToday(todayCard.id)} onDetails={() => setPreviewPlanId(todayCard.id)} onInfo={setInfoExercise} onRetry={() => setLoadVersion((value) => value + 1)} />
            : <TodayEmpty title={doneToday ? "Done for today" : "Nothing planned today"} record={doneToday ? { id: doneToday.id, name: doneToday.name } : null}>
                <button type="button" className="fitx-button" onClick={() => openCreator("auto")}><Sparkles size={16} aria-hidden="true" />Plan today</button>
                <button type="button" className="fitx-button fitx-button-secondary" onClick={() => openCreator("custom")}>Blank workout</button>
              </TodayEmpty>}
        </Section>

        <Section title="History" id="history" className={styles.historySection}
          action={<Link href="/workouts/history" className={styles.textLink}>All<ArrowRight size={14} aria-hidden="true" /></Link>}>
          {sessions.length ? (
            <ol className={styles.historyList}>
              {sessions.map((session) => {
                const date = new Date(session.started_at);
                const seconds = Number(session.duration_seconds);
                const duration = Number.isFinite(seconds) && seconds > 0 ? seconds < 60 ? "Under 1 min" : `${Math.round(seconds / 60)} min` : null;
                const volume = Number(session.total_volume) > 0 ? Math.round(Number(session.total_volume)) : null;
                return (
                  <li key={session.id} className={styles.historyItem}>
                    <Link href={`/workouts/history/${session.id}`} className={styles.historyLink}>
                      <span className={styles.dateTile} aria-hidden="true"><span className={styles.dateDay}>{date.getDate()}</span><span className={styles.dateMonth}>{readableDate(date, { month: "short" })}</span></span>
                      <span className="min-w-0 flex-1">
                        <span className={styles.itemTitle}>{session.name}</span>
                        <span className={styles.itemMeta}>
                          <span className="sr-only">{readableDate(date, { weekday: "long", day: "numeric", month: "long" })}</span>
                          {[duration, volume !== null ? `${volume.toLocaleString()} kg` : null].filter(Boolean).join(" · ") || readableDate(date, { weekday: "short" })}
                        </span>
                      </span>
                    </Link>
                    <button type="button" aria-disabled={saving || undefined} onClick={() => void repeatSession(session)} aria-label={`Repeat ${session.name}`} title="Repeat" className={styles.iconButton}><RotateCcw size={16} aria-hidden="true" /></button>
                    {/* Why Repeat did not work, in this row beside the button (D6). */}
                    {historyNote(listNote, session.id) && <p role="alert" className={styles.rowNote}>{historyNote(listNote, session.id)}</p>}
                  </li>
                );
              })}
            </ol>
          ) : <div className={styles.quietEmpty}><p className="font-medium">No workouts yet</p><p className="text-sm text-fitx-text-secondary">Finished sessions show here.</p></div>}
        </Section>
      </div>

      <Reveal amount={0.12}>
        <Section title="Train by area" id="areas" action={<Link href="/exercises" className={styles.textLink}>Library<ArrowRight size={14} aria-hidden="true" /></Link>}>
          <AreaLaunchRail label="Train by area" onLaunch={(area) => openCreator("focus", "gym", [area])} />
        </Section>
      </Reveal>

      {/* With no programme published (and none followed) the section goes, heading and all: no empty "Programme". */}
      {(enrolment || gymProgrammes.length > 0) && (
      <Reveal amount={0.12}>
        <Section title="Programme" id="programme">
          {enrolment
            ? enrolledProgramme
              ? <ProgrammeCard programme={enrolledProgramme} enrolment={enrolment} plans={programmePlans} plansFailed={programmeLoadFailed} todayKey={todayKey} busy={programmeBusy || Boolean(starting)} planning={planningAhead} activeSession={Boolean(activeSession)} note={programmeNote}
                  onPreview={(planId) => setPreviewPlanId(planId)} onPlanAhead={() => void planAhead()} onLeave={() => void leave()} onPause={() => void pause()} onResume={() => void resume()} onFinish={() => void finish()} />
              : <section aria-label="Your programme" className={styles.quietEmpty}>
                  <p className="font-medium">This programme is no longer available</p>
                  <p className="text-sm text-fitx-text-secondary">Your workouts stay in your history.</p>
                  <button type="button" onClick={() => void leave()} aria-disabled={programmeBusy || undefined} className="fitx-button fitx-button-secondary mt-2 min-h-11 self-start text-sm aria-disabled:opacity-60">Leave programme</button>
                  {/* Why Leave did not work, beside it (D6): ProgrammeCard shows the same note for a programme it can show. */}
                  <ActionNote note={programmeNote} live className="mt-2" />
                </section>
            : <>
                {/* What leaving or finishing did, where the card was (D6). */}
                <ActionNote note={programmeNote} live />
                <ProgrammeBrowser programmes={gymProgrammes} enrolAvailable={enrolAvailable && !programmeLoadFailed} busy={programmeBusy} onEnrol={enrol}
                  disabledNote={programmeLoadFailed ? "Following waits until your programme has loaded." : !enrolAvailable ? "Following a programme arrives with the next FITX update." : undefined} />
              </>}
        </Section>
      </Reveal>
      )}

      <div className={styles.bottomGrid}>
        {/* No "Week" link: the To-Do week view is gone and its address now opens this page (brief 3.7). */}
        <Section title="Your plans" id="plans">
          {/* Each plan once: its scheduled item joins its row (time, and today's Start keeps the planner item). */}
          <ScheduledWorkouts items={plansWithScheduled.rest} dayLabel={(day) => whenLabel(day, listDayKey || localDateKey())} onStart={startScheduled} starting={Boolean(starting)} />
          {/* The list's own line (D6): a deleted plan, or a message for a plan that is not on the list. */}
          <ActionNote note={plansLineNote(listNote, plans)} live />
          {plans.length ? (
            <div className={styles.planList}>
              {plans.map((plan) => {
                const event = plansWithScheduled.byPlan.get(plan.id);
                const time = event?.startsAt ? readableDate(new Date(event.startsAt), { hour: "numeric", minute: "2-digit" }) : null;
                // What this card's Edit, Duplicate or Delete did, right under it (D6).
                const cardNote = planCardNote(listNote, plan.id);
                return (
                <Fragment key={plan.id}>
                <article id={`workout-plan-${plan.id}`} className={styles.planRow}>
                  <div className="min-w-0 flex-1">
                    <h3 className={styles.itemTitle}>{plan.title}</h3>
                    <p className={styles.itemMeta}><CalendarDays size={13} aria-hidden="true" />{plan.planned_for ? whenLabel(plan.planned_for, todayKey) : "No date"}{time ? `, ${time}` : ""}<PlanStatusChip status={planCardStatus(plan.planned_for, todayKey, plan.last_done_key)} /></p>
                  </div>
                  <button type="button" data-plan-start aria-haspopup="dialog" aria-disabled={Boolean(starting) || undefined} className={`fitx-button ${styles.planStart} aria-disabled:opacity-60`}
                    onClick={() => { if (starting) return; if (event?.startHref) startScheduled(plan.id, event.id); else setPreviewPlanId(plan.id); }}>{starting === plan.id ? "Starting…" : "Start"}<ArrowRight size={15} aria-hidden="true" /></button>
                  {/* One visible action per row (phase 7.4); editing, copying and deleting sit in its menu. */}
                  <ActionsMenu label={`More actions for ${plan.title}`} items={[
                    { label: "Edit", name: `Edit ${plan.title}`, icon: Pencil, onSelect: () => void editPlan(plan.id).then((message) => sayOnPlan(plan.id, message)), disabled: saving },
                    { label: "Duplicate", name: `Duplicate ${plan.title}`, icon: Copy, onSelect: () => void duplicatePlan(plan).then((message) => sayOnPlan(plan.id, message)), disabled: saving },
                    { label: "Delete", name: `Delete ${plan.title}`, icon: Trash2, onSelect: () => void deletePlan(plan), tone: "danger" },
                  ]} />
                </article>
                {cardNote && <ActionNote note={cardNote} />}
                </Fragment>
                );
              })}
              {(planCursor || (counts.plans !== null && counts.plans > plans.length)) && (
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <p className="text-xs text-fitx-text-secondary">{plans.length.toLocaleString()}{counts.plans !== null && counts.plans >= plans.length ? ` of ${counts.plans.toLocaleString()}` : ""} plans</p>
                  {planCursor && <button type="button" onClick={() => void loadMorePlans()} aria-disabled={loadingMorePlans || undefined} className="fitx-button fitx-button-secondary min-h-11 px-4 text-sm aria-disabled:opacity-60">{loadingMorePlans ? "Loading…" : "Show more plans"}</button>}
                  {/* Why more plans did not load, beside the button at the bottom of the list (D6). */}
                  {moreNote(listNote) && <p role="alert" className="m-0 basis-full text-sm text-fitx-danger">{moreNote(listNote)}</p>}
                </div>
              )}
            </div>
          ) : (
            <div className={styles.quietEmpty}>
              <p className="font-medium">No saved plans</p>
              <button type="button" id="plans-build-first" className="fitx-button fitx-button-secondary mt-2 min-h-11 self-start" onClick={() => openCreator("focus")}><Plus size={16} aria-hidden="true" />Build a workout</button>
            </div>
          )}
        </Section>

        <Section title="Gym equipment" id="equipment">
          <div className={styles.equipmentCard}>
            <ul className={styles.equipmentGrid} aria-label={`${gymEquipment.keys.length} items on your gym list`}>
              {gymEquipment.keys.length === 0 && <li className={styles.equipmentItem}><EquipmentThumb equipmentKey="none" size={52} /><span>Body weight</span></li>}
              {gymEquipment.keys.slice(0, EQUIPMENT_SHOWN).map((key) => <li key={key} className={styles.equipmentItem}><EquipmentThumb equipmentKey={key} size={52} /><span>{equipmentLabel(key)}</span></li>)}
              {hiddenEquipment > 0 && <li className={`${styles.equipmentItem} ${styles.equipmentMore}`}><span className={styles.equipmentCount}>+{hiddenEquipment}</span><span>more</span></li>}
            </ul>
            <div className={styles.equipmentFoot}>
              <p className="text-xs text-fitx-text-secondary">{gymEquipment.saved ? `${gymEquipment.keys.length} items` : "A full gym until you edit it"}{!catalogCurated ? " · matching is approximate" : ""}</p>
              <button type="button" className="fitx-button fitx-button-secondary min-h-11 px-3 text-sm" onClick={() => setEquipmentEditor({ context: "gym", keys: gymEquipment.keys })}><Pencil size={14} aria-hidden="true" />Edit equipment</button>
            </div>
            {/* What saving the list did, beside the button that opened it (D6): the programme's days ahead follow it (bug 17). */}
            <p role="status" className={equipmentNote?.context === "gym" ? "m-0 mt-3 text-xs text-fitx-text-secondary" : "sr-only"}>{equipmentNote?.context === "gym" ? equipmentNote.text : ""}</p>
          </div>
        </Section>
      </div>
      </>
      )}
      </ModePanel>
      <p className={styles.credit}>Exercise photos: Free Exercise DB (public domain).</p>
      </div>

      {creatorOpen && <div className="fixed inset-0 z-50 flex items-end justify-center bg-fitx-scrim/55 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="builder-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreatorOpen(false); }}><div ref={builderRef} className="max-h-[94dvh] w-full max-w-4xl overflow-y-auto rounded-t-[22px] border border-fitx-border bg-fitx-elevated shadow-2xl sm:max-h-[90dvh] sm:rounded-[22px]">
        <div className="p-4 sm:p-6">
          <div className="mb-5 flex items-start justify-between gap-3"><div className="min-w-0"><h2 id="builder-title" className="font-heading text-2xl font-bold tracking-[-.03em]">{editingPlanId ? "Edit workout plan" : builderMode === "auto" ? "Build from your split" : builderMode === "focus" ? "Build by body area" : "Create a workout"}</h2>{builderSplitSource && <p className="mt-1 text-sm text-fitx-text-secondary">{builderSplitSource.label}</p>}</div><button type="button" onClick={() => setCreatorOpen(false)} aria-label="Close workout builder" className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-fitx-border text-fitx-text-secondary hover:text-fitx-text"><X size={18} aria-hidden="true"/></button></div>
          {!editingPlanId && <div role="group" aria-label="Start from" className="mb-5 grid grid-cols-3 gap-1 rounded-xl border border-fitx-border bg-fitx-surface-variant p-1 sm:inline-grid">
            {BUILDER_MODES.map(([value, label]) => <button key={value} type="button" aria-pressed={builderMode === value} onClick={() => switchMode(value)} className={`min-h-11 rounded-lg px-3 text-sm font-semibold ${builderMode === value ? "bg-fitx-surface text-fitx-text shadow-sm" : "text-fitx-text-secondary hover:text-fitx-text"}`}>{label}</button>)}
          </div>}
          {builderMode === "focus" && !editingPlanId && <div className="mb-5">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">{focusAreas.length ? `Training: ${listFocusAreas(focusAreas)}` : "What to train"}</p>
              {focusAreas.length > 0 && <button type="button" aria-expanded={focusPickerOpen} onClick={() => setFocusPickerOpen((open) => !open)} className="inline-flex min-h-11 items-center text-sm font-semibold text-fitx-primary-text">{focusPickerOpen ? "Done choosing" : "Change areas"}</button>}
            </div>
            {(focusPickerOpen || !focusAreas.length) && <div id="builder-focus-tiles"><MuscleRail bleed={false} value={focusAreas} label="Body areas to train" details={focusDetails} onChange={(areas) => { setFocusAreas(areas); applyFocus(builderContext, areas, autoSeed); }} /></div>}
          </div>}
          <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            {/* A problem with the name or date shows right under the field, which is marked invalid and takes focus (bug 85). */}
            <div className="grid content-start gap-1.5">
              <label htmlFor={BUILDER_FIELD_IDS.name.field} className="text-xs text-fitx-text-secondary">Workout name</label>
              <input id={BUILDER_FIELD_IDS.name.field} className="fitx-field aria-invalid:border-fitx-danger!" maxLength={120} value={title}
                aria-invalid={builderProblem?.at === "name" || undefined} aria-describedby={builderProblem?.at === "name" ? BUILDER_FIELD_IDS.name.message : undefined}
                onChange={(event) => { setTitle(event.target.value); setBuilderProblem((current) => (current?.at === "name" ? null : current)); }} />
              {builderProblem?.at === "name" && <p id={BUILDER_FIELD_IDS.name.message} role="alert" className="m-0 text-xs font-medium text-fitx-danger">{builderProblem.message}</p>}
            </div>
            <div className="grid content-start gap-1.5">
              <label htmlFor={BUILDER_FIELD_IDS.date.field} className="text-xs text-fitx-text-secondary">Date</label>
              <input id={BUILDER_FIELD_IDS.date.field} className="fitx-field aria-invalid:border-fitx-danger!" type="date" value={plannedFor} disabled={editingProgrammeDay}
                aria-invalid={builderProblem?.at === "date" || undefined}
                aria-describedby={[editingProgrammeDay ? "programme-day-date-note" : "", builderProblem?.at === "date" ? BUILDER_FIELD_IDS.date.message : ""].filter(Boolean).join(" ") || undefined}
                onChange={(event) => { setPlannedFor(event.target.value); setBuilderProblem((current) => (current?.at === "date" ? null : current)); }} />
              {editingProgrammeDay && <span id="programme-day-date-note" className="text-xs text-fitx-text-secondary">A programme day keeps its date.</span>}
              {builderProblem?.at === "date" && <p id={BUILDER_FIELD_IDS.date.message} role="alert" className="m-0 text-xs font-medium text-fitx-danger">{builderProblem.message}</p>}
            </div>
            <label className="grid gap-1.5 text-xs text-fitx-text-secondary">Start time<input className="fitx-field" type="time" value={time} onChange={(event) => setTime(event.target.value)} disabled={!plannedFor} /></label>
            {builderProgramme && <label className="grid gap-1.5 text-xs text-fitx-text-secondary">Day<select className="fitx-field" value={autoDay % builderProgramme.days.length} onChange={(event) => { const day = Number(event.target.value); setAutoDay(day); applyAuto(builderContext, day, autoSeed); }}>{builderProgramme.days.map((day, index) => <option key={day.key} value={index}>{day.title}</option>)}</select></label>}
          </div>
          <details className="group mt-3 rounded-xl border border-fitx-border">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-medium text-fitx-text-secondary [&::-webkit-details-marker]:hidden">More options<ChevronDown size={16} aria-hidden="true" className="transition-transform group-open:rotate-180 motion-reduce:transition-none" /></summary>
            <div className="grid gap-3 border-t border-fitx-divider p-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-xs text-fitx-text-secondary">Training split<select className="fitx-field" value={split} onChange={(event) => setSplit(event.target.value)}><option value="full_body">Full body</option><option value="upper_lower">Upper / lower</option><option value="push_pull_legs">Push / pull / legs</option><option value="bro_split">Bro split</option>{split.startsWith("home_") && <><option value="home_bodyweight">Home bodyweight</option><option value="home_dumbbell">Home dumbbells</option></>}<option value="custom">Custom</option></select></label>
              <label className="grid gap-1.5 text-xs text-fitx-text-secondary">Notes<input className="fitx-field" maxLength={500} value={planNotes} onChange={(event) => setPlanNotes(event.target.value)} placeholder="Optional" /></label>
              {/* New workouts are for the gym; an older home plan keeps its place until it is moved here. */}
              {planLocation !== "gym" && <label className="grid gap-1.5 text-xs text-fitx-text-secondary">Where<select className="fitx-field" value={planLocation} onChange={(event) => { setPlanLocation(event.target.value); const target = contextForLocation(event.target.value); if (!editingPlanId && builderMode === "auto") applyAuto(target, autoDay, autoSeed); if (!editingPlanId && builderMode === "focus" && focusAreas.length) applyFocus(target, focusAreas, autoSeed); }}><option value="gym">Gym</option><option value="home">Home</option><option value="outdoor">Outdoor</option><option value="both">Home or gym</option></select></label>}
            </div>
          </details>
          <div className="mt-5">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 id="builder-order-title" tabIndex={-1} className="text-sm font-semibold">Exercise order <span className="font-normal text-fitx-text-secondary">· {preview.length}</span></h3>
              {((builderProgramme) || (builderMode === "focus" && !editingPlanId && focusAreas.length > 0)) && <button type="button" onClick={() => { const seed = autoSeed + 1; setAutoSeed(seed); if (builderMode === "focus") applyFocus(builderContext, focusAreas, seed); else applyAuto(builderContext, autoDay, seed); }} className="inline-flex min-h-11 items-center text-sm font-semibold text-fitx-primary-text">Regenerate plan</button>}
            </div>
            {preview.length > 0 && <p className="mb-3 text-xs text-fitx-text-secondary" aria-live="polite">{builderSummary.exercises} exercise{builderSummary.exercises === 1 ? "" : "s"} · {builderSummary.totalSets} sets{builderSummary.estimateMinutes ? ` · ≈ ${builderSummary.estimateMinutes} min (estimate)` : ""}</p>}
            <p role="status" className="sr-only">{builderNotice}</p>
            {autoNote && <p role="status" className="mb-3 flex items-start gap-2 rounded-lg border border-fitx-border bg-fitx-surface-variant px-3 py-2 text-xs text-fitx-text-secondary"><Info size={14} aria-hidden="true" className="mt-px shrink-0 text-fitx-info"/><span>{autoNote}</span></p>}
            {!showTargets && <p role="status" className="mb-3 flex items-start gap-2 rounded-lg border border-fitx-border bg-fitx-surface-variant px-3 py-2 text-xs text-fitx-text-secondary"><Info size={14} aria-hidden="true" className="mt-px shrink-0 text-fitx-info"/><span>{TARGETS_UNAVAILABLE_NOTICE}</span></p>}
            {preview.length ? <ol className="space-y-2">{preview.map((item, index) => (
              <BuilderRow key={item.exercise.id} item={item} index={index} count={preview.length} owned={builderOwned} listName={builderContext} showTargets={showTargets} lastTime={lastTimes.get(item.exercise.id)}
                onMove={(direction) => movePreview(index, direction)} onUpdate={(field, value) => updatePreview(index, field, value)} onUpdateTarget={(field, raw) => updateOptionalTarget(index, field, raw)}
                onSwap={() => setSwapIndex(index)} onRemove={() => removePreview(index, item)} onInfo={() => setInfoExercise(item.exercise)} />
            ))}</ol> : <p className="rounded-xl border border-dashed border-fitx-border px-4 py-5 text-sm text-fitx-text-secondary">{builderMode === "focus" && !editingPlanId && !focusAreas.length ? "Pick an area above or add exercises below." : "Add exercises below."}</p>}
          </div>
          <LibraryPicker catalog={catalog} selectedIds={selected} owned={builderOwned} listName={builderContext} full={preview.length >= MAX_PLAN_EXERCISES} onToggle={toggleSelected} onInfo={setInfoExercise} />
          {builderProblem?.at === "picker" && <p role="alert" className="fitx-alert fitx-alert-danger mt-4 px-3 py-2 text-sm">{builderProblem.message}</p>}
        </div>
        <div className="sticky bottom-0 grid grid-cols-2 gap-2 border-t border-fitx-divider bg-fitx-elevated p-3 sm:flex sm:flex-wrap sm:justify-end sm:px-6 sm:py-4">
          {/* A save that did not work says so here, beside the buttons (D6); the buttons keep focus while saving. */}
          {builderProblem?.at === "save" && <p role="alert" className="fitx-alert fitx-alert-danger col-span-2 m-0 px-3 py-2 text-sm sm:basis-full">{builderProblem.message}</p>}
          <button disabled={!preview.length} aria-disabled={saving || undefined} onClick={() => void savePlan()} className={`fitx-button aria-disabled:opacity-60 ${activeSession ? "col-span-2" : "fitx-button-secondary"}`}>{saving ? "Saving…" : editingPlanId ? "Save changes" : "Save workout"}<CalendarDays size={16}/></button>
          {!activeSession && <button disabled={!preview.length} aria-disabled={saving || Boolean(starting) || undefined} onClick={() => { if (!starting) void savePlan(true); }} className="fitx-button aria-disabled:opacity-60">{starting ? "Starting…" : "Save and start"}<ArrowRight size={16}/></button>}
        </div>
      </div></div>}

      {rowToSwap && <SwapSheet target={rowToSwap.exercise} catalog={catalog} owned={builderOwned} level={level} exclude={new Set(preview.map((row) => row.exercise.id))} contextLabel={builderContext} onPick={(exercise) => swapPreview(swapIndex!, exercise)} onClose={() => setSwapIndex(null)} />}
      {infoExercise && <ExerciseInfoSheet exerciseId={infoExercise.id} name={infoExercise.name} owned={builderOwned} listName={builderContext} fullPageLink={false} onClose={() => setInfoExercise(null)} />}
      {previewPlanId && userId && <PlanPreviewSheet planId={previewPlanId} userId={userId} catalog={catalog} ownedFor={ownedFor} todayKey={listDayKey || localDateKey()} programme={previewProgramme}
        activeSession={activeSession ? { id: activeSession.id, name: activeSession.name } : null} starting={starting === previewPlanId} includeTargets={targetsSupported !== false}
        onBegin={startWorkout} onEdit={(planId) => editPlan(planId, () => setPreviewPlanId(null))} onClose={() => setPreviewPlanId(null)} />}
      {setupOpen && setup && <Sheet title="Workout setup" size="lg" onClose={() => setSetupOpen(false)}>
        <WorkoutSetupFlow setup={{ ...setup, profiles }} userId={userId} legacyWords={preferences.equipment} variant="sheet" onSaved={setupSaved} />
      </Sheet>}
      {equipmentEditor && <Sheet title={equipmentEditor.context === "home" ? "Your home equipment" : "Your gym equipment"} size="lg" onClose={() => { setEquipmentEditor(null); setEquipmentError(""); }}
        description={equipmentEditor.context === "home" ? "Workouts and swaps use only what you pick." : "Remove anything your gym lacks."}
        footer={<>
          <button type="button" onClick={() => { setEquipmentEditor(null); setEquipmentError(""); }} className="fitx-button fitx-button-quiet">Cancel</button>
          {/* Busy without being disabled, so focus stays on it; a failed save says why right here, above the buttons (D6). */}
          <button type="button" disabled={!profiles.available || equipmentLoadFailed} aria-disabled={equipmentSaving || undefined} onClick={() => void saveEquipment()} className="fitx-button aria-disabled:opacity-60">{equipmentSaving ? "Saving…" : "Save list"}</button>
          {equipmentError && <p role="alert" className="fitx-alert fitx-alert-danger m-0 px-3 py-2 text-sm sm:order-first sm:basis-full">{equipmentError}</p>}
        </>}>
        {!profiles.available && <p role="status" className="mb-4 rounded-lg border border-fitx-border bg-fitx-surface-variant p-3 text-xs text-fitx-text-secondary">Saving lists arrives with the next FITX update.</p>}
        {profiles.available && equipmentLoadFailed && <p role="status" className="mb-4 rounded-lg border border-fitx-border bg-fitx-surface-variant p-3 text-xs text-fitx-text-secondary">Your saved list couldn’t be loaded, so saving is off. Close this and choose Try again.</p>}
        <EquipmentPicker value={equipmentEditor.keys} context={equipmentEditor.context} onChange={(keys) => setEquipmentEditor({ context: equipmentEditor.context, keys })} />
      </Sheet>}
    </div>
  );
}
