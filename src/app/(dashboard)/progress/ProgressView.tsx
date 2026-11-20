"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { BicepsFlexed, Compass } from "lucide-react";
import { useOptionalUserContext } from "@/components/app/UserContextProvider";
import { getSession } from "@/components/tasks/session";
import { PageHeader } from "@/components/ui/PageHeader";
import { InsightList } from "@/components/widgets/InsightList";
import { useGoalsData, useResource, useToday, useTodaySummary } from "@/components/widgets/useHomeData";
import { WidgetError } from "@/components/widgets/WidgetCard";
import { loadAllTimeTotals, loadRecentWorkouts, loadTrendRows, trainingConsistency, TREND_WEEKS } from "@/lib/data/progress";
import { keyToLocalDate } from "@/lib/domain/day-keys";
import { improveNext, proteinTargetFrom } from "@/lib/domain/insights";
import { todayTargets } from "@/lib/domain/today";
import { weekSoFar, weeklyTrends } from "@/lib/domain/trends";
import { musclePeriodRange, summariseMuscles } from "@/lib/training/muscle-history";
import { BodySection } from "./BodySection";
import { MuscleMapLink, RecordsSection } from "./ProgressCards";
import { TrainingPanel, WeekBand } from "./TrendSections";
import styles from "./Progress.module.css";

/**
 * Progress, kept to what answers "How am I progressing?": this week against last, what to focus on next,
 * training consistency and volume, weight and measurements, personal records and the muscle map.
 */
export function ProgressView() {
  const today = useToday();
  return (
    <div className={styles.page}>
      <PageHeader
        title="Progress"
        actions={<Link href="/progress/muscles" className={styles.headerLink}><BicepsFlexed size={16} aria-hidden="true" />Muscle map</Link>}
      />
      {today ? <ProgressContent today={today} /> : <div className={`${styles.loading} ${styles.loadingTall}`} aria-busy="true" aria-label="Loading your progress" />}
    </div>
  );
}

function ProgressContent({ today }: { today: string }) {
  const plan = useOptionalUserContext()?.data;
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
    return loadRecentWorkouts(db, userId, 3);
  }, []);
  const trends = useResource(loadTrends, "Your trends could not be loaded.");
  const totals = useResource(loadTotals, "Your totals could not be loaded.");
  const recent = useResource(loadRecent, "Your recent workouts could not be loaded.");
  const summary = useTodaySummary(today);
  const goals = useGoalsData(today);
  // The days-a-week answer from setup, only when the member has saved one.
  const weeklyPlan = plan?.hasPreferences ? plan.preferences.workouts_per_week : null;

  const derived = useMemo(() => {
    if (!trends.data) return null;
    const data = { sessions: trends.data.sessions, activities: trends.data.activities, foodDays: trends.data.foodDays };
    const weeks = weeklyTrends(data, today, TREND_WEEKS);
    return {
      week: weekSoFar(data, today),
      weeks,
      consistency: trainingConsistency(weeks, weeklyPlan),
      muscles: summariseMuscles(trends.data.sessions, musclePeriodRange("week", keyToLocalDate(today))),
    };
  }, [trends.data, today, weeklyPlan]);

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

  // Home's "Focus next" links to /progress#focus-next; the section only exists once the browser knows the day,
  // so the jump is made here, once, when its content is in.
  const jumped = useRef(false);
  useEffect(() => {
    if (jumped.current || !insights || window.location.hash !== "#focus-next") return;
    jumped.current = true;
    document.getElementById("focus-next")?.scrollIntoView({ block: "start" });
  }, [insights]);

  const trendError = trends.status === "error" && !trends.data ? <WidgetError message={trends.error} onRetry={trends.reload} /> : null;

  return (
    <div className={styles.sections}>
      <section aria-labelledby="week-title">
        <div className={styles.sectionHead}>
          <h2 id="week-title" className={styles.sectionTitle}>This week so far</h2>
          <p className={styles.sectionNote}>Against the same days last week</p>
        </div>
        {derived ? (
          <>
            <WeekBand week={derived.week} activities={trends.data?.activitiesState ?? "ok"} />
            {trends.data?.sessionsCapped && <p className={`${styles.sectionNote} mt-2`}>Only your latest 600 workouts are counted.</p>}
          </>
        ) : trendError ?? <div className={styles.loading} aria-busy="true" aria-label="Loading this week" />}
      </section>

      <section id="focus-next" aria-labelledby="focus-title" className={`${styles.panel} ${styles.focus}`}>
        <div className={styles.panelHead}>
          <h2 id="focus-title" className={styles.panelTitle}><Compass size={17} aria-hidden="true" />Focus next</h2>
          <span className={styles.panelNote}>From your last 5 weeks · not medical advice</span>
        </div>
        {insights ? <InsightList insights={insights.insights} status={insights.status} />
          : trendError ?? <div className={styles.loading} aria-busy="true" aria-label="Looking at your recent logs" />}
      </section>

      <div className={styles.columns}>
        <div className="min-w-0">
          {derived ? (
            <TrainingPanel
              weeks={derived.weeks}
              consistency={derived.consistency}
              recent={recent.data}
              recentError={recent.status === "error" && !recent.data ? recent.error : ""}
              totals={totals.data}
            />
          ) : trendError ?? <div className={`${styles.loading} ${styles.loadingTall}`} aria-busy="true" aria-label="Loading your training" />}
        </div>
        <div className={styles.sections}>
          <BodySection />
          <MuscleMapLink summary={derived?.muscles ?? null} />
        </div>
      </div>

      <RecordsSection />
    </div>
  );
}
