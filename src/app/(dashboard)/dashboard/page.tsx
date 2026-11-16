"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LayoutGrid } from "lucide-react";
import { CustomizePanel } from "@/components/widgets/CustomizePanel";
import { GoalsWidget, MacrosWidget, TodayWidget, TodoWidget, WaterWidget, WeekWidget, WeightWidget, WorkoutWidget } from "@/components/widgets/HomeWidgets";
import { useDashboardLayout, useGoalsData, useRefreshOnReturn, useToday, useTodaySummary } from "@/components/widgets/useHomeData";
import { visibleIds, type WidgetId } from "@/lib/domain/dashboard-layout";
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
  const summary = useTodaySummary(date);
  const goals = useGoalsData(date);
  const layout = useDashboardLayout();
  const [customizing, setCustomizing] = useState(false);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reloadSummary = summary.reload;
  const reloadGoals = goals.reload;

  const refreshAll = useCallback(() => { reloadSummary(); reloadGoals(); }, [reloadSummary, reloadGoals]);
  /** After a tick, a water tap or a weigh-in: refresh the numbers once things settle. */
  const refreshSoon = useCallback(() => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(refreshAll, 500);
  }, [refreshAll]);
  useEffect(() => () => { if (pending.current) clearTimeout(pending.current); }, []);
  useRefreshOnReturn(refreshAll);

  const name = summary.data?.summary.profile.name?.split(" ")[0] ?? null;
  const shown = layout.status === "ready" ? visibleIds(layout.items) : null;

  function widget(id: WidgetId) {
    switch (id) {
      case "today": return <TodayWidget summary={summary} goals={goals} />;
      case "todo": return <TodoWidget date={date} goals={goals} onChanged={refreshSoon} />;
      case "goals": return <GoalsWidget goals={goals} date={date} />;
      case "weight": return <WeightWidget summary={summary} goals={goals} date={date} onLogged={refreshSoon} />;
      case "water": return <WaterWidget summary={summary} goals={goals} date={date} onLogged={refreshSoon} />;
      case "workout": return <WorkoutWidget summary={summary} />;
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

      {shown === null ? (
        <div className={styles.grid} aria-busy="true" aria-label="Loading your Home">
          {[0, 1, 2, 3].map((index) => <div key={index} className={styles.placeholder} />)}
        </div>
      ) : shown.length ? (
        <div className={styles.grid}>
          {shown.map((id) => <div key={id} className={styles.slot} data-widget={id}>{widget(id)}</div>)}
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
