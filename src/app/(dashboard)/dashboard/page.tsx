"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LayoutGrid } from "lucide-react";
import { CustomizePanel } from "@/components/widgets/CustomizePanel";
import { GoalsWidget, MacrosWidget, TodayWidget, TodoWidget, WaterWidget, WeekWidget, WeightWidget } from "@/components/widgets/HomeWidgets";
import { MusclesWidget } from "@/components/widgets/MusclesWidget";
import { NewWidgetsHint } from "@/components/widgets/NewWidgetsHint";
import { NextFocusWidget } from "@/components/widgets/NextFocusWidget";
import { TodayPlanWidget } from "@/components/widgets/TodayPlanWidget";
import {
  useDashboardLayout, useGoalsData, useRecentActivities, useRecentFood, useRefreshOnReturn, useToday, useTodayPlan, useTodaySummary,
  useTrainingHistory, useUnfinishedRecording,
} from "@/components/widgets/useHomeData";
import { WIDE_WIDGETS, visibleIds, type WidgetId } from "@/lib/domain/dashboard-layout";
import { longDay } from "@/components/tasks/format";
import styles from "./Dashboard.module.css";

/** Home: today's essentials as widgets the user can show, hide and arrange. */
export default function DashboardPage() {
  const today = useToday();
  // The server does not know the user's day; the browser fills Home in on the first render after hydration.
  if (!today) return <HomeSkeleton />;
  return <Home date={today} />;
}

function greeting(hour: number) {
  return hour < 5 ? "Good evening" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

function Home({ date }: { date: string }) {
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
  useRefreshOnReturn(refreshAll);

  const name = summary.data?.summary.profile.name?.split(" ")[0] ?? null;

  function widget(id: WidgetId) {
    switch (id) {
      case "plan": return <TodayPlanWidget date={date} plan={plan} summary={summary} activities={activities} unfinished={unfinished} />;
      case "today": return <TodayWidget summary={summary} goals={goals} />;
      case "next": return <NextFocusWidget date={date} training={training} activities={activities} food={food} summary={summary} goals={goals} />;
      case "muscles": return <MusclesWidget date={date} training={training} />;
      case "todo": return <TodoWidget date={date} goals={goals} onChanged={refreshSoon} />;
      case "goals": return <GoalsWidget goals={goals} date={date} />;
      case "weight": return <WeightWidget summary={summary} goals={goals} date={date} onLogged={refreshSoon} />;
      case "water": return <WaterWidget summary={summary} goals={goals} date={date} onLogged={refreshSoon} />;
      case "week": return <WeekWidget summary={summary} goals={goals} />;
      case "macros": return <MacrosWidget summary={summary} goals={goals} />;
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className="min-w-0">
          <p className={styles.date}>{longDay(date)}</p>
          <h1 className={styles.greeting}>{greeting(new Date().getHours())}{name ? <>, <span>{name}</span></> : null}</h1>
        </div>
        <button type="button" className={styles.customize} onClick={() => setCustomizing(true)} disabled={layout.status !== "ready"} aria-haspopup="dialog">
          <LayoutGrid size={16} aria-hidden="true" /><span>Customize</span>
        </button>
      </header>

      {layout.status === "ready" && layout.fresh.length > 0 && <NewWidgetsHint ids={layout.fresh} onAnswer={layout.answerFresh} />}

      {shown === null ? (
        <div className={styles.grid} aria-busy="true" aria-label="Loading your Home">
          {[0, 1, 2, 3].map((index) => <div key={index} className={styles.placeholder} />)}
        </div>
      ) : shown.length ? (
        <div className={styles.grid}>
          {shown.map((id) => <div key={id} className={`${styles.slot} ${WIDE_WIDGETS.has(id) ? styles.wide : ""}`} data-widget={id}>{widget(id)}</div>)}
        </div>
      ) : (
        <div className={styles.emptyHome}>
          <p>Your Home has no widgets.</p>
          <button type="button" className="fitx-button" onClick={() => setCustomizing(true)}><LayoutGrid size={16} aria-hidden="true" />Add widgets</button>
        </div>
      )}

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
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className={styles.page} aria-busy="true" aria-label="Loading your Home">
      <div className={styles.header}>
        <div className="grid gap-2"><span className={styles.lineShort} /><span className={styles.lineLong} /></div>
      </div>
      <div className={styles.grid}>{[0, 1, 2, 3].map((index) => <div key={index} className={styles.placeholder} />)}</div>
    </div>
  );
}
