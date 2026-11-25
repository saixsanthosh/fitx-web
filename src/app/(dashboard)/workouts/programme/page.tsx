"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Check, CircleDashed, Dumbbell, Minus, Moon } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { PageHeading } from "@/components/app/PageHeading";
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
import type { Programme } from "@/lib/training/programmes";
import type { TrainingContext } from "@/lib/training/taxonomy";

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
};

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Weeks loaded at a time, back from today. */
const WEEKS_BACK = 4;

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

  const load = useCallback(async (backTo?: string) => {
    const supabase = createClient();
    if (!supabase) { setMessage("FITX is not connected to Supabase in this environment."); setState("error"); return; }
    const auth = await supabase.auth.getUser();
    const user = auth.data.user;
    if (!user) { setMessage("Sign in to see your programme."); setState("error"); return; }
    const current = await loadCurrentEnrolment(supabase, user.id);
    if (current.error) { setMessage("Your programme couldn’t be loaded. Check your connection and try again."); setState("error"); return; }
    if (!current.enrolment) { setState("none"); return; }
    const enrolment = current.enrolment;
    const earliest = mondayOf(enrolment.started_on);
    const wanted = backTo ?? mondayOf(addDays(todayKey, -7 * (WEEKS_BACK - 1)));
    const fromKey = wanted < earliest ? earliest : wanted;
    const [programmes, plans, catalog, profiles, preferences, active] = await Promise.all([
      loadProgrammes(supabase),
      loadEnrolmentPlans(supabase, user.id, enrolment.id, fromKey, { limit: 400 }),
      loadCatalog(supabase),
      loadEquipmentProfiles(supabase, user.id),
      supabase.from("user_preferences").select("equipment").eq("user_id", user.id).maybeSingle(),
      supabase.from("workout_sessions").select("id,name").eq("user_id", user.id).eq("status", "in_progress").limit(1).maybeSingle(),
    ]);
    const programme = programmes.programmes.find((item) => item.id === enrolment.programme_id) ?? programmeById(enrolment.programme_id);
    if (plans.error) { setMessage("Your programme days couldn’t be loaded. Check your connection and try again."); setState("error"); return; }
    if (!programme) { setMessage("The programme you follow is no longer available. Your finished workouts stay in your history."); setState("error"); return; }
    const words = (preferences.data as { equipment?: string[] | null } | null)?.equipment;
    setLoaded({
      userId: user.id, enrolment, programme, plans: plans.plans, fromKey, catalog: catalog.exercises, profiles: profiles.profiles,
      legacyEquipment: Array.isArray(words) ? words : null, activeSession: (active.data as { id: string; name: string } | null) ?? null,
    });
    setState("ready");
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
    if (!loaded) return;
    setLoadingEarlier(true);
    await load(mondayOf(addDays(loaded.fromKey, -7 * WEEKS_BACK)));
    setLoadingEarlier(false);
  }

  const back = <Link href="/workouts" className="inline-flex min-h-11 items-center gap-2 text-sm text-fitx-text-secondary hover:text-fitx-text"><ArrowLeft size={15} aria-hidden="true" />Workouts</Link>;
  // Every state has one main heading (bug 94): "Programme" until the programme's own name can be shown.
  const heading = <PageHeader title="Programme" className="mb-0 sm:mb-0" />;
  if (state === "loading") return <div className="space-y-4">{back}{heading}<div role="status" aria-label="Loading your programme" className="space-y-4"><div className="h-24 animate-pulse rounded-xl bg-fitx-surface motion-reduce:animate-none" /><div className="h-40 animate-pulse rounded-xl bg-fitx-surface motion-reduce:animate-none" /></div></div>;
  if (state === "error") return <div className="space-y-4">{back}{heading}<EmptyState headingLevel={2} title="Programme unavailable" description={message} action={<button type="button" className="fitx-button fitx-button-secondary" onClick={() => { setState("loading"); void load(); }}>Try again</button>} /></div>;
  if (state === "none" || !loaded || !view) return <div className="space-y-4">{back}{heading}<EmptyState headingLevel={2} title="You’re not following a programme" description="Pick a programme on the Workouts page. FITX plans your training days on the weekdays you choose, with rest days in between." action={<Link href="/workouts" className="fitx-button">Choose a programme</Link>} /></div>;

  const { enrolment, programme } = loaded;
  const paused = enrolment.status === "paused";
  const ownedFor = (context: TrainingContext) => expandOwnedEquipment(equipmentFor(loaded.profiles, context, loaded.legacyEquipment).keys);
  const canGoBack = loaded.fromKey > mondayOf(enrolment.started_on);
  const weekdays = [1, 2, 3, 4, 5, 6, 0].filter((day) => enrolment.weekdays.includes(day)).map((day) => WEEKDAY_NAMES[day]).join(", ");

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {back}
      <PageHeading title={programme.title} description={view.meta?.objective ?? programme.summary} />
      {paused && <p role="status" className="fitx-alert">This programme is paused: no days are planned and your place is kept. Resume it from your programme card on the Workouts page.</p>}
      <StatStrip label="Your programme" stats={[
        { label: "Sessions done", value: view.target ? `${view.status.sessionsCompleted} of ${view.target}` : view.status.sessionsCompleted, note: "Completed workouts only" },
        { label: "Plan", value: programmeLengthLabel(view.meta?.lengthDays), note: view.target ? "A missed day moves the end later" : `Repeats its ${programme.days.length} days` },
        { label: "Cycle position", value: `Day ${view.status.nextDayIndex + 1} of ${view.status.cycleLength}`, note: view.status.nextTitle ? `${paused ? "Resumes with" : "Next in the cycle"}: ${view.status.nextTitle}` : undefined },
        { label: "Training days", value: weekdays || "—", note: startedLabel(enrolment.started_on) },
      ]} />
      <Legend />
      {canGoBack && <button type="button" onClick={() => void showEarlier()} disabled={loadingEarlier} className="fitx-button fitx-button-secondary min-h-11 text-sm">{loadingEarlier ? "Loading…" : "Show earlier weeks"}</button>}
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
