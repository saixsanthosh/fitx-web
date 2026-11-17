"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { BicepsFlexed, Compass } from "lucide-react";
import { PageHeading } from "@/components/app/PageHeading";
import { getSession } from "@/components/tasks/session";
import { InsightList } from "@/components/widgets/InsightList";
import { useGoalsData, useResource, useToday, useTodaySummary } from "@/components/widgets/useHomeData";
import { WidgetError } from "@/components/widgets/WidgetCard";
import { loadAllTimeTotals, loadRecentWorkouts, loadTrendRows, TREND_WEEKS } from "@/lib/data/progress";
import { keyToLocalDate } from "@/lib/domain/day-keys";
import { improveNext, proteinTargetFrom } from "@/lib/domain/insights";
import { todayTargets } from "@/lib/domain/today";
import { trendsEmpty, weekSoFar, weeklyTrends } from "@/lib/domain/trends";
import { musclePeriodRange, summariseMuscles } from "@/lib/training/muscle-history";
import { BodySection } from "./BodySection";
import { AllTimeCard, MuscleCard, RecentWorkouts, RecordsSection } from "./ProgressCards";
import { TrendCharts, WeekBand } from "./TrendSections";
import styles from "./Progress.module.css";

/** Progress: "How am I progressing?" and "What should I improve next?", from what the member logged. */
export function ProgressView() {
  const today = useToday();
  return (
    <div className={styles.page}>
      <PageHeading
        title="Progress"
        description="Your training, activity, food and body over time, worked out from what you log."
        actions={<Link href="/progress/muscles" className="fitx-button fitx-button-secondary"><BicepsFlexed size={16} aria-hidden="true" />Muscles</Link>}
      />
      {today ? <ProgressContent today={today} /> : <div className={styles.loadingBlock} aria-busy="true" aria-label="Loading your progress" />}
    </div>
  );
}

function ProgressContent({ today }: { today: string }) {
  const loadTrends = useCallback(async () => {
    const { db, userId } = await getSession();
    return loadTrendRows(db, userId, today, TREND_WEEKS);
  }, [today]);
  const loadTotals = useCallback(async () => {
    const { db, userId } = await getSession();
    return loadAllTimeTotals(db, userId);
  }, []);
  const loadRecent = useCallback(async () => {
    const { db, userId } = await getSession();
    return loadRecentWorkouts(db, userId);
  }, []);
  const trends = useResource(loadTrends, "Your trends could not be loaded.");
  const totals = useResource(loadTotals, "Your totals could not be loaded.");
  const recent = useResource(loadRecent, "Your recent workouts could not be loaded.");
  const summary = useTodaySummary(today);
  const goals = useGoalsData(today);

  const derived = useMemo(() => {
    if (!trends.data) return null;
    const data = { sessions: trends.data.sessions, activities: trends.data.activities, foodDays: trends.data.foodDays };
    return {
      week: weekSoFar(data, today),
      weeks: weeklyTrends(data, today, TREND_WEEKS),
      muscles: summariseMuscles(trends.data.sessions, musclePeriodRange("week", keyToLocalDate(today))),
    };
  }, [trends.data, today]);

  const insights = useMemo(() => {
    if (!trends.data || (!summary.data && summary.status !== "error")) return null;
    const target = summary.data ? todayTargets(summary.data.summary, goals.data?.goals).protein : null;
    return improveNext({
      today,
      sessions: trends.data.sessions,
      activityStarts: trends.data.activities ? trends.data.activities.map((activity) => activity.startedAt) : null,
      activitiesFailed: trends.data.activitiesState === "error",
      foodDays: trends.data.foodDays,
      proteinTarget: proteinTargetFrom(target),
    });
  }, [trends.data, summary.data, summary.status, goals.data, today]);

  const activities = trends.data?.activitiesState ?? "ok";
  const foodError = trends.data?.foodError ?? false;

  // Home's "Focus next" links to /progress#focus-next; the section only exists once the browser knows the day,
  // so the jump is made here, once, when its content is in.
  const jumped = useRef(false);
  useEffect(() => {
    if (jumped.current || !insights || window.location.hash !== "#focus-next") return;
    jumped.current = true;
    document.getElementById("focus-next")?.scrollIntoView({ block: "start" });
  }, [insights]);

  return (
    <div className={styles.sections}>
      <section aria-labelledby="week-title" className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 id="week-title" className={styles.sectionTitle}>This week so far</h2>
          <p className={styles.sectionNote}>Monday to today, next to the same days of last week</p>
        </div>
        {derived ? (
          <>
            <WeekBand week={derived.week} activities={activities} foodError={foodError} />
            {trends.data?.sessionsCapped && <p className={styles.sectionNote}>Only your latest 600 workouts are counted here.</p>}
          </>
        ) : trends.status === "error" ? <WidgetError message={trends.error} onRetry={trends.reload} /> : <div className={styles.loadingBand} aria-busy="true" aria-label="Loading this week" />}
      </section>

      <section id="focus-next" aria-labelledby="focus-title" className={`fitx-panel ${styles.panel} ${styles.focusPanel}`}>
        <div className={styles.panelHead}>
          <div>
            <h2 id="focus-title" className={styles.panelTitle}><Compass size={16} aria-hidden="true" />Focus next</h2>
            <p className={styles.panelNote}>What your last five weeks of logs suggest. Observations, not medical advice.</p>
          </div>
        </div>
        {insights ? <InsightList insights={insights.insights} status={insights.status} />
          : trends.status === "error" ? <WidgetError message={trends.error} onRetry={trends.reload} />
            : <div className={styles.loadingBlock} aria-busy="true" aria-label="Looking at your recent logs" />}
      </section>

      <section aria-labelledby="trends-title" className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 id="trends-title" className={styles.sectionTitle}>The last {TREND_WEEKS} weeks</h2>
          <p className={styles.sectionNote}>Each bar is a Monday-to-Sunday week; this week, still running, is lighter.</p>
        </div>
        {derived ? (
          trendsEmpty(derived.weeks)
            ? <div className={styles.firstRun}><p>Log a workout, record a walk or log a meal and your weekly trends start here.</p><div className={styles.firstRunLinks}><Link href="/workouts">Workouts</Link><Link href="/activity">Activity</Link><Link href="/nutrition">Nutrition</Link></div></div>
            : <TrendCharts weeks={derived.weeks} activities={activities} foodError={foodError} />
        ) : trends.status === "error" ? <WidgetError message={trends.error} onRetry={trends.reload} /> : <div className={styles.loadingBand} aria-busy="true" aria-label="Loading your trends" />}
      </section>

      <div className={styles.twoUp}>
        {derived ? <MuscleCard summary={derived.muscles} /> : <div className={styles.loadingBlock} aria-busy="true" aria-label="Loading this week's muscles" />}
        <AllTimeCard totals={totals.data} error={totals.status === "error" && !totals.data ? totals.error : ""} onRetry={totals.reload} />
      </div>

      <div className={styles.twoUp}>
        <RecentWorkouts workouts={recent.data} error={recent.status === "error" && !recent.data ? recent.error : ""} onRetry={recent.reload} />
        <RecordsSection />
      </div>

      <BodySection />
    </div>
  );
}
