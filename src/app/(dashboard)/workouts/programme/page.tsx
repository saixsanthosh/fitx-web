"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Check, CircleDashed, Dumbbell, Minus, Moon } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatStrip } from "@/components/training/StatStrip";
import { PlanPreviewSheet } from "@/components/workouts/PlanPreviewSheet";
import { ProgrammeJourney, startedLabel } from "@/components/workouts/ProgrammeJourney";
import { programmeById } from "@/data/programmes";
import { programmeLengthLabel, programmeMeta } from "@/data/programmes/meta";
import { localDateKey } from "@/lib/domain/dates";
import { createClient } from "@/lib/supabase/client";
import type { CatalogExercise } from "@/lib/training/catalog";
import { equipmentFor, loadCatalog, loadEquipmentProfiles, loadProgrammes, type EquipmentProfiles } from "@/lib/training/data";
import { loadCurrentEnrolment, loadEnrolmentPlans, programmeShortTitle, type Enrolment, type ProgrammePlan } from "@/lib/training/enrolment";
import { expandOwnedEquipment } from "@/lib/training/equipment";
import { startFailureMessage, startPlanSession } from "@/lib/training/plans";
import { addDays, groupByWeek, mondayOf, programmeCalendar, programmeStatus, sessionsLeftToPlan, targetSessions } from "@/lib/training/programme-calendar";
import { replanMessage, replanUpcomingProgrammeDays } from "@/lib/training/programme-replan";
import type { Programme } from "@/lib/training/programmes";
import { loadRecentExerciseDays } from "@/lib/training/recent-days";
import { useRetryFocus, type ReloadPhase } from "@/lib/workouts/retry-focus";
import { addedIds, focusAfterShowMore } from "@/lib/workouts/show-more";
import { LEVELS, type Level, type TrainingContext } from "@/lib/training/taxonomy";

type Loaded = {
  userId: string;
  enrolment: Enrolment;
  programme: Programme;
  plans: ProgrammePlan[];
  /** The first day the plans were loaded from. */
  fromKey: string;
  catalog: CatalogExercise[];
  profiles: EquipmentProfiles;
  legacyEquipment: string[] | null;
  activeSession: { id: string; name: string } | null;
  /** What checking the days ahead against the member's equipment list changed (bug 17); "" when nothing. */
  replanNote: string;
};

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** The page's h1 in every state ("Programme", or the programme's own name), and the unavailable state's Try again. */
const PROGRAMME_FOCUS = { heading: "programme-page-title", retry: "programme-retry" };
/** Weeks loaded at a time, back from today. */
const WEEKS_BACK = 4;

function asLevel(value: string | null | undefined): Level {
  return (LEVELS as readonly string[]).includes(value ?? "") ? (value as Level) : "beginner";
}

/**
 * The programme the member follows, start to finish: every week from the day they started (four at a time back from
 * today), this week, and what comes next until the plan ends (two weeks ahead for an ongoing programme). Done days
 * come from completed workouts only; rest days are part of the plan; days not planned yet say so.
 */
export default function ProgrammeJourneyPage() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "none" | "error">("loading");
  const [message, setMessage] = useState("");
  const [todayKey] = useState(() => localDateKey());
  const [selected, setSelected] = useState<string | null>(() => localDateKey());
  const [preview, setPreview] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  // Why "Show earlier weeks" couldn't load them, beside it (D6); the page keeps what it shows.
  const [earlierError, setEarlierError] = useState("");
  // "Show earlier weeks" goes once the first week is shown: the earliest week it brought then takes focus (D5).
  const [weekFocus, setWeekFocus] = useState<{ shown: string[]; seq: number } | null>(null);
  const handledWeekFocus = useRef(0);

  // A load that fails says why in place of the page, with Try again. Earlier weeks (`backTo`) are different: the page
  // keeps what it shows and the reason goes beside "Show earlier weeks" (D6), so that button, and keyboard focus on
  // it, stay (D5). False when it failed.
  const load = useCallback(async (backTo?: string): Promise<boolean> => {
    const fail = (text: string, earlier = text) => {
      if (backTo) setEarlierError(earlier);
      else { setMessage(text); setState("error"); }
      return false;
    };
    const offline = "Earlier weeks couldn’t be loaded. Check your connection and try again.";
    const supabase = createClient();
    if (!supabase) return fail("FITX is not connected to Supabase in this environment.");
    const auth = await supabase.auth.getUser();
    const user = auth.data.user;
    if (!user) return fail("Sign in to see your programme.");
    const current = await loadCurrentEnrolment(supabase, user.id);
    if (current.error) return fail("Your programme couldn’t be loaded. Check your connection and try again.", offline);
    if (!current.enrolment) { setState("none"); return true; }
    const enrolment = current.enrolment;
    const earliest = mondayOf(enrolment.started_on);
    const wanted = backTo ?? mondayOf(addDays(todayKey, -7 * (WEEKS_BACK - 1)));
    const fromKey = wanted < earliest ? earliest : wanted;
    const [programmes, plans, catalog, profiles, preferences, active] = await Promise.all([
      loadProgrammes(supabase),
      loadEnrolmentPlans(supabase, user.id, enrolment.id, fromKey, { limit: 400 }),
      loadCatalog(supabase),
      loadEquipmentProfiles(supabase, user.id),
      supabase.from("user_preferences").select("equipment,fitness_level").eq("user_id", user.id).maybeSingle(),
      supabase.from("workout_sessions").select("id,name").eq("user_id", user.id).eq("status", "in_progress").limit(1).maybeSingle(),
    ]);
    const programme = programmes.programmes.find((item) => item.id === enrolment.programme_id) ?? programmeById(enrolment.programme_id);
    if (plans.error) return fail("Your programme days couldn’t be loaded. Check your connection and try again.", offline);
    if (!programme) return fail("The programme you follow is no longer available. Your finished workouts stay in your history.");
    const row = preferences.data as { equipment?: string[] | null; fitness_level?: string | null } | null;
    const words = row?.equipment;
    const legacyEquipment = Array.isArray(words) ? words : null;
    // A day can be begun here without opening Workouts, so days planned before the member's list was last saved (in the
    // library, Profile or on another device) are checked against it first (bug 17). A day saved since, the member's
    // own edit included, is left as it is.
    let dayPlans = plans.plans;
    let replanNote = "";
    if (enrolment.status === "active" && catalog.exercises.length && !profiles.error) {
      const checked = await replanUpcomingProgrammeDays(supabase, {
        userId: user.id, enrolment, programme, catalog: catalog.exercises,
        owned: expandOwnedEquipment(equipmentFor(profiles.profiles, enrolment.context, legacyEquipment).keys), level: asLevel(row?.fitness_level),
        recentDays: () => loadRecentExerciseDays(supabase, user.id), todayKey, includeTargets: true, mode: "visit", listSavedAt: profiles.savedAt[enrolment.context],
      });
      if (checked.replanned.length) {
        const fresh = await loadEnrolmentPlans(supabase, user.id, enrolment.id, fromKey, { limit: 400 });
        if (!fresh.error) dayPlans = fresh.plans;
      }
      replanNote = [replanMessage(checked, enrolment.context), checked.error ? "Some days ahead couldn’t be checked against your equipment list. Open Workouts to try again." : ""].filter(Boolean).join(" ");
    }
    setLoaded({
      userId: user.id, enrolment, programme, plans: dayPlans, fromKey, catalog: catalog.exercises, profiles: profiles.profiles,
      legacyEquipment, activeSession: (active.data as { id: string; name: string } | null) ?? null, replanNote,
    });
    setState("ready");
    return true;
  }, [todayKey]);

  useEffect(() => { void Promise.resolve().then(() => load()); }, [load]);

  const view = useMemo(() => {
    if (!loaded) return null;
    const { enrolment, programme, plans } = loaded;
    const meta = programmeMeta(programme.id);
    const target = targetSessions(enrolment.started_on, enrolment.weekdays, meta?.lengthDays);
    const left = sessionsLeftToPlan({ target, sessionsCompleted: enrolment.sessions_completed, plans, todayKey }) ?? 0;
    const perWeek = Math.max(1, new Set(enrolment.weekdays).size);
    // Through the plan's projected end for a programme with a length, else two weeks ahead.
    const ahead = target !== null ? Math.max(13, (Math.ceil(left / perWeek) + 1) * 7) : 13;
    const toKey = addDays(mondayOf(addDays(todayKey, ahead)), 6);
    const days = programmeCalendar({ enrolment, programme, plans, todayKey, fromKey: loaded.fromKey, toKey, target });
    // Weeks after the plan ends are left out.
    const weeks = groupByWeek(days).filter((week) => week.days.some((day) => day.kind !== "outside" || day.date <= todayKey));
    const status = programmeStatus({ enrolment, programme, days, todayKey, target });
    return { meta, target, days, weeks, status };
  }, [loaded, todayKey]);

  // After "Show earlier weeks" (once per press): the button keeps focus while there are earlier weeks; once it goes,
  // the earliest week it brought takes focus (its heading), where the member carries on reading.
  useEffect(() => {
    if (!weekFocus || weekFocus.seq === handledWeekFocus.current || !view || !loaded) return;
    handledWeekFocus.current = weekFocus.seq;
    const target = focusAfterShowMore({ more: loaded.fromKey > mondayOf(loaded.enrolment.started_on), shown: weekFocus.shown, added: addedIds(weekFocus.shown, view.weeks.map((week) => week.weekStart)) });
    const heading = target && target !== "button" ? document.querySelector<HTMLElement>(`[data-journey-week="${target}"] h2`) : null;
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus();
  }, [weekFocus, view, loaded]);
  // Try again replaces the unavailable state with loading, taking the button with it: once the load ends, the page's h1
  // takes focus, or the new Try again when it failed again (D5). The page was replaced, so it is shown from its h1.
  const reloadPhase: ReloadPhase = state === "loading" ? "loading" : state === "error" ? "failed" : "ready";
  const retrying = useRetryFocus(reloadPhase, PROGRAMME_FOCUS);

  async function begin(planId: string, title: string): Promise<string | null> {
    const supabase = createClient();
    if (!supabase || !loaded) return "FITX is not connected to Supabase.";
    if (loaded.activeSession) { window.location.assign(`/workouts/active?session=${loaded.activeSession.id}`); return null; }
    setStarting(true);
    const started = await startPlanSession(supabase, { userId: loaded.userId, planId, title });
    if ("sessionId" in started) { window.location.assign(`/workouts/active?session=${started.sessionId}`); return null; }
    setStarting(false);
    return startFailureMessage(started.failure);
  }

  async function showEarlier() {
    if (!loaded || loadingEarlier) return;
    const shown = view?.weeks.map((week) => week.weekStart) ?? [];
    setLoadingEarlier(true);
    setEarlierError("");
    const loadedEarlier = await load(mondayOf(addDays(loaded.fromKey, -7 * WEEKS_BACK)));
    setLoadingEarlier(false);
    // When it failed, the button stays with focus and its reason beside it.
    if (loadedEarlier) setWeekFocus((current) => ({ shown, seq: (current?.seq ?? 0) + 1 }));
  }

  const back = <Link href="/workouts" className="inline-flex min-h-11 items-center gap-2 text-sm text-fitx-text-secondary hover:text-fitx-text"><ArrowLeft size={15} aria-hidden="true" />Workouts</Link>;
  // Every state has one main heading (bug 94): "Programme" until the programme's own name can be shown.
  const heading = <PageHeader title="Programme" className="mb-0 sm:mb-0" titleId={PROGRAMME_FOCUS.heading} />;
  if (state === "loading") return <div className="space-y-4">{back}{heading}<div role="status" aria-label="Loading your programme" className="space-y-4"><div className="h-24 animate-pulse rounded-xl bg-fitx-surface motion-reduce:animate-none" /><div className="h-40 animate-pulse rounded-xl bg-fitx-surface motion-reduce:animate-none" /></div></div>;
  if (state === "error") return <div className="space-y-4">{back}{heading}<EmptyState headingLevel={2} title="Programme unavailable" description={message} descriptionId="programme-load-problem" action={<button id={PROGRAMME_FOCUS.retry} type="button" aria-describedby="programme-load-problem" className="fitx-button fitx-button-secondary" onClick={() => { retrying(); setState("loading"); void load(); }}>Try again</button>} /></div>;
  if (state === "none" || !loaded || !view) return <div className="space-y-4">{back}{heading}<EmptyState headingLevel={2} title="You’re not following a programme" description="Pick a programme on the Workouts page. FITX plans your training days on the weekdays you choose, with rest days in between." action={<Link href="/workouts" className="fitx-button">Choose a programme</Link>} /></div>;

  const { enrolment, programme } = loaded;
  const paused = enrolment.status === "paused";
  const ownedFor = (context: TrainingContext) => expandOwnedEquipment(equipmentFor(loaded.profiles, context, loaded.legacyEquipment).keys);
  const canGoBack = loaded.fromKey > mondayOf(enrolment.started_on);
  const weekdays = [1, 2, 3, 4, 5, 6, 0].filter((day) => enrolment.weekdays.includes(day)).map((day) => WEEKDAY_NAMES[day]).join(", ");

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {back}
      <PageHeader title={programme.title} meta={view.meta?.objective ?? programme.summary} titleId={PROGRAMME_FOCUS.heading} />
      {paused && <p role="status" className="fitx-alert">This programme is paused: no days are planned and your place is kept. Resume it from your programme card on the Workouts page.</p>}
      {/* Days ahead checked against the equipment list as the page opened (bug 17): what changed, above the days. */}
      <p role="status" className={loaded.replanNote ? "fitx-alert" : "sr-only"}>{loaded.replanNote}</p>
      <StatStrip label="Your programme" stats={[
        { label: "Sessions done", value: view.target ? `${view.status.sessionsCompleted} of ${view.target}` : view.status.sessionsCompleted, note: "Completed workouts only" },
        { label: "Plan", value: programmeLengthLabel(view.meta?.lengthDays), note: view.target ? "A missed day moves the end later" : `Repeats its ${programme.days.length} days` },
        { label: "Cycle position", value: `Day ${view.status.nextDayIndex + 1} of ${view.status.cycleLength}`, note: view.status.nextTitle ? `${paused ? "Resumes with" : "Next in the cycle"}: ${view.status.nextTitle}` : undefined },
        { label: "Training days", value: weekdays || "—", note: startedLabel(enrolment.started_on) },
      ]} />
      <Legend />
      {canGoBack && <button type="button" onClick={() => void showEarlier()} aria-disabled={loadingEarlier || undefined} aria-describedby={earlierError ? "programme-earlier-problem" : undefined} className="fitx-button fitx-button-secondary min-h-11 text-sm aria-disabled:opacity-60">{loadingEarlier ? "Loading…" : "Show earlier weeks"}</button>}
      {canGoBack && earlierError && <p id="programme-earlier-problem" role="alert" className="-mt-3 text-sm text-fitx-danger">{earlierError}</p>}
      <ProgrammeJourney weeks={view.weeks} startedOn={enrolment.started_on} selected={selected} onSelect={setSelected} busy={starting} onPreview={setPreview} nextTraining={view.status.nextTraining} />
      {view.target !== null && !view.status.complete && <p className="text-xs text-fitx-text-secondary">The plan ends after its {view.target} sessions. Days after the ones planned are not planned yet: FITX plans each training day about a week ahead when you open Workouts.</p>}
      <p className="text-xs text-fitx-text-secondary">{programme.sourceNotes}</p>
      {preview && <PlanPreviewSheet planId={preview} userId={loaded.userId} catalog={loaded.catalog} ownedFor={ownedFor} todayKey={todayKey}
        programme={{ enrolmentId: enrolment.id, title: programmeShortTitle(programme), dayCount: programme.days.length, dayTitles: programme.days.map((day) => day.title), paused }}
        activeSession={loaded.activeSession} starting={starting} includeTargets onBegin={begin} onClose={() => setPreview(null)} />}
    </div>
  );
}

function Legend() {
  const item = (icon: ReactNode, text: string) => <li className="inline-flex items-center gap-1.5">{icon}{text}</li>;
  return (
    <ul aria-label="Key" className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-fitx-text-secondary">
      {item(<Check size={14} aria-hidden="true" className="text-fitx-success" />, "Done")}
      {item(<Dumbbell size={14} aria-hidden="true" className="text-fitx-primary-text" />, "Planned")}
      {item(<CircleDashed size={14} aria-hidden="true" />, "Not planned yet")}
      {item(<Minus size={14} aria-hidden="true" />, "Not done")}
      {item(<Moon size={14} aria-hidden="true" />, "Rest day")}
    </ul>
  );
}
