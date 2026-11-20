"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { useReducedMotionSafe } from "@/components/motion";
import { Sheet } from "@/components/ui/Sheet";
import { GoalsPanel, type GoalRequest } from "@/components/home/GoalsPanel";
import { HomeHero } from "@/components/home/HomeHero";
import { TodoPanel } from "@/components/home/TodoPanel";
import { WeekPlanner } from "@/components/home/WeekPlanner";
import { PANEL_SECTION, readPanelRequest } from "@/components/home/home-panel";
import { CustomizePanel } from "@/components/widgets/CustomizePanel";
import { MacrosWidget, WaterWidget, WeekWidget, WeightWidget } from "@/components/widgets/HomeWidgets";
import { MusclesWidget } from "@/components/widgets/MusclesWidget";
import { NewWidgetsHint } from "@/components/widgets/NewWidgetsHint";
import { NextFocusWidget } from "@/components/widgets/NextFocusWidget";
import { TodayPlanWidget } from "@/components/widgets/TodayPlanWidget";
import {
  useDashboardLayout, useGoalsData, useRecentActivities, useRecentFood, useRefreshOnReturn, useToday, useTodayPlan, useTodaySummary,
  useTrainingHistory, useUnfinishedRecording,
} from "@/components/widgets/useHomeData";
import { homePanel } from "@/config/routes";
import { WIDE_WIDGETS, visibleIds, type WidgetId } from "@/lib/domain/dashboard-layout";
import { longDay } from "@/components/tasks/format";
import styles from "./Dashboard.module.css";

/**
 * Home: today's rings lead, with Customise in their corner; the To-Do list and Goals sit side by side under
 * them, then the widgets the member chose. `?panel=goals|todo|week` (where /goals, /planner and /tasks
 * redirect) scrolls to that panel or opens the week plan; `&new=<template>` opens the goal editor.
 */
export default function DashboardPage() {
  const today = useToday();
  // The server does not know the member's day; the browser fills Home in on the first render after hydration.
  if (!today) return <HomeSkeleton />;
  return <Suspense fallback={<HomeSkeleton />}><Home date={today} /></Suspense>;
}

function greeting(hour: number) {
  return hour < 5 ? "Good evening" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

function Home({ date }: { date: string }) {
  const params = useSearchParams();
  const search = params.toString();
  const request = readPanelRequest(search);
  const reduced = useReducedMotionSafe();

  const layout = useDashboardLayout();
  const shown = layout.status === "ready" ? visibleIds(layout.items) : null;
  const on = (...ids: WidgetId[]) => Boolean(shown && ids.some((id) => shown.includes(id)));

  const summary = useTodaySummary(date);
  const goals = useGoalsData(date);
  // Loaded only while a widget that needs them is on Home.
  const plan = useTodayPlan(date, on("plan"));
  const activities = useRecentActivities(date, on("plan", "next"));
  const training = useTrainingHistory(date, on("muscles", "next"));
  const food = useRecentFood(date, on("next"));
  const unfinished = useUnfinishedRecording(on("plan"));

  const [customizing, setCustomizing] = useState(false);
  const [weekOpen, setWeekOpen] = useState(request.panel === "week");
  const [goalRequest, setGoalRequest] = useState<GoalRequest | null>(request.template ? { template: request.template, key: 1 } : null);
  // A new address (a link to ?panel=week or &new=… while Home is open) acts once, as the first one did.
  const [seen, setSeen] = useState(search);
  if (seen !== search) {
    setSeen(search);
    if (request.panel === "week") setWeekOpen(true);
    if (request.template) setGoalRequest((current) => ({ template: request.template!, key: (current?.key ?? 0) + 1 }));
  }

  // A goal template is used once: the address keeps the panel but drops `new`, so a reload does not reopen it.
  useEffect(() => {
    if (request.template) window.history.replaceState(null, "", homePanel("goals"));
  }, [request.template]);

  // ?panel=goals|todo: bring that section into view once Home has its numbers (so nothing moves after).
  const settled = (summary.data !== null || summary.status === "error") && (goals.data !== null || goals.status === "error");
  const scrolled = useRef<string | null>(null);
  useEffect(() => {
    if (!settled || (request.panel !== "goals" && request.panel !== "todo") || scrolled.current === search) return;
    scrolled.current = search;
    const section = document.getElementById(PANEL_SECTION[request.panel]);
    section?.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
    section?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
  }, [settled, request.panel, search, reduced]);

  function closeWeek() {
    setWeekOpen(false);
    if (readPanelRequest(window.location.search).panel === "week") window.history.replaceState(null, "", "/dashboard");
  }

  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { reload: reloadSummary } = summary;
  const { reload: reloadGoals } = goals;
  const { reload: reloadPlan } = plan;
  const { reload: reloadActivities } = activities;
  const { reload: reloadTraining } = training;
  const { reload: reloadFood } = food;

  const refreshAll = useCallback(() => {
    reloadSummary(); reloadGoals(); reloadPlan(); reloadActivities(); reloadTraining(); reloadFood();
  }, [reloadSummary, reloadGoals, reloadPlan, reloadActivities, reloadTraining, reloadFood]);
  /** After a tick, a water tap or a weigh-in: refresh the numbers once things settle. */
  const refreshSoon = useCallback(() => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => { reloadSummary(); reloadGoals(); reloadPlan(); }, 500);
  }, [reloadSummary, reloadGoals, reloadPlan]);
  useEffect(() => () => { if (pending.current) clearTimeout(pending.current); }, []);
  // The week sheet keeps its own copy of the To-Dos: a change saved there reloads Home's To-Do list (behind the
  // sheet, so it is current on close) and the goals that count To-Dos.
  const [todoVersion, setTodoVersion] = useState(0);
  const weekChanged = useCallback(() => {
    setTodoVersion((version) => version + 1);
    refreshSoon();
  }, [refreshSoon]);
  useRefreshOnReturn(refreshAll);

  const name = summary.data?.summary.profile.name?.split(" ")[0] ?? null;

  function widget(id: WidgetId) {
    switch (id) {
      case "plan": return <TodayPlanWidget date={date} plan={plan} summary={summary} activities={activities} unfinished={unfinished} />;
      case "next": return <NextFocusWidget date={date} training={training} activities={activities} food={food} summary={summary} goals={goals} />;
      case "muscles": return <MusclesWidget date={date} training={training} />;
      case "weight": return <WeightWidget summary={summary} goals={goals} date={date} onLogged={refreshSoon} />;
      case "water": return <WaterWidget summary={summary} goals={goals} date={date} onLogged={refreshSoon} />;
      case "week": return <WeekWidget summary={summary} goals={goals} />;
      case "macros": return <MacrosWidget summary={summary} goals={goals} />;
    }
  }

  const customise = (
    <button type="button" className={styles.customize} onClick={() => setCustomizing(true)} disabled={layout.status !== "ready"} aria-haspopup="dialog">
      <SlidersHorizontal size={16} aria-hidden="true" /><span>Customise</span>
    </button>
  );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.date}>{longDay(date)}</p>
        <h1 className={styles.greeting}>{greeting(new Date().getHours())}{name ? `, ${name}` : ""}</h1>
      </header>

      <HomeHero summary={summary} goals={goals} corner={customise} />

      <div className={styles.panels}>
        <TodoPanel key={todoVersion} date={date} goals={goals} onChanged={refreshSoon} onOpenWeek={() => setWeekOpen(true)} />
        <GoalsPanel date={date} goals={goals} summary={summary} request={goalRequest} />
      </div>

      {layout.status === "ready" && layout.fresh.length > 0 && <NewWidgetsHint ids={layout.fresh} onAnswer={layout.answerFresh} />}

      {shown === null ? (
        <div className={styles.grid} aria-busy="true" aria-label="Loading your widgets">
          {[0, 1].map((index) => <div key={index} className={styles.placeholder} />)}
        </div>
      ) : shown.length ? (
        <div className={styles.grid}>
          {shown.map((id) => (
            <div key={id} className={`${styles.slot} ${WIDE_WIDGETS.has(id) || shown.length === 1 ? styles.wide : ""}`} data-widget={id}>{widget(id)}</div>
          ))}
        </div>
      ) : null}

      <CustomizePanel
        open={customizing}
        onClose={() => setCustomizing(false)}
        items={layout.items}
        dispatch={layout.dispatch}
        save={layout.save}
        canSave={layout.canSave}
        loadError={layout.loadError}
        onRetrySave={layout.retrySave}
      />

      <Sheet open={weekOpen} onClose={closeWeek} title="Week">
        <WeekPlanner today={date} onChanged={weekChanged} />
      </Sheet>
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className={styles.page} aria-busy="true" aria-label="Loading your Home">
      <div className={styles.header}><span className={styles.lineShort} /><span className={styles.lineLong} /></div>
      <div className={styles.heroPlaceholder} />
      <div className={styles.panels}><div className={styles.placeholder} /><div className={styles.placeholder} /></div>
    </div>
  );
}
