"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Compass, Dumbbell, Flame, Salad, Sparkles, TrendingUp } from "lucide-react";
import { useOptionalUserContext } from "@/components/app/UserContextProvider";
import { GoalsPanel, type GoalRequest } from "@/components/home/GoalsPanel";
import { CountUp } from "@/components/motion";
import { getSession } from "@/components/tasks/session";
import { Segmented } from "@/components/ui/Segmented";
import { InsightList } from "@/components/widgets/InsightList";
import { useGoalsData, useResource, useTodaySummary } from "@/components/widgets/useHomeData";
import { WidgetError } from "@/components/widgets/WidgetCard";
import { formatDurationWords } from "@/lib/activity/format";
import { firstTrackedDay, loadAllTimeTotals, loadBodyRows, loadProgressRows, loadRecentWorkouts, type BodyMetricRow } from "@/lib/data/progress";
import { addDays, keyToLocalDate } from "@/lib/domain/day-keys";
import { GOAL_TEMPLATES, type GoalTemplateKey } from "@/lib/domain/goals";
import { improveNext, proteinTargetFrom } from "@/lib/domain/insights";
import { todayTargets } from "@/lib/domain/today";
import { musclePeriodRange, summariseMuscles } from "@/lib/training/muscle-history";
import { BodySection } from "@/app/(dashboard)/progress/BodySection";
import { MuscleMapLink, RecordsSection } from "@/app/(dashboard)/progress/ProgressCards";
import {
  MAX_BACK, PERIOD_KINDS, PERIOD_LABELS, calendarDays, comparisonLabel, currentStreak, delta, highlights, indexDays, noHistory,
  nutritionSeries, periodFor, periodSummary, previousPeriod, previousSummary, strengthGains, trainingSeries, yearMonths,
  type Delta, type Period, type PeriodKind, type TrainingMetric,
} from "./period";
import { ConcentricRings, DayRing, type Ring } from "./Rings";
import { TrendBars } from "./TrendBars";
import { usePeriodRows } from "./usePeriodRows";
import styles from "./Progress.module.css";

const num = (value: number, digits = 0) => value.toLocaleString("en-GB", { maximumFractionDigits: digits });
/** Metres as kilometres to one decimal; unknown stays unknown. */
const km = (metres: number | null | undefined) => (metres === null || metres === undefined ? null : Math.round(metres / 100) / 10);
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
const METRIC_LABELS: Record<TrainingMetric, string> = { workouts: "Workouts", volume: "Volume", distance: "Distance" };
/** How many days the insights look back over (improveNext needs five weeks). */
const INSIGHT_DAYS = 41;

function goalTemplate(value: string | null): GoalTemplateKey | null {
  return GOAL_TEMPLATES.find((entry) => entry.key === value)?.key ?? null;
}

/**
 * Progress: one week, month or year at a time, from the member's own logs only. Rings and numbers for the period
 * (against the same days of the period before), the consistency calendar, training and nutrition trends, weight,
 * strength and records, goals and what to focus on next. Every chart glides to the new period's values.
 */
export function ProgressAnalytics({ today }: { today: string }) {
  const context = useOptionalUserContext()?.data ?? null;
  const [kind, setKind] = useState<PeriodKind>("week");
  const [offset, setOffset] = useState(0);
  const [metric, setMetric] = useState<TrainingMetric>("workouts");
  const period = useMemo(() => periodFor(kind, today, offset), [kind, today, offset]);
  const previous = useMemo(() => previousPeriod(period), [period]);
  const rows = usePeriodRows(previous.from, period.to);

  const loadBody = useCallback(async () => { const { db, userId } = await getSession(); return loadBodyRows(db, userId); }, []);
  const loadTotals = useCallback(async () => { const { db, userId } = await getSession(); return loadAllTimeTotals(db, userId); }, []);
  const loadRecent = useCallback(async () => {
    const { db, userId } = await getSession();
    return loadProgressRows(db, userId, addDays(today, -INSIGHT_DAYS), today);
  }, [today]);
  const loadLatest = useCallback(async () => { const { db, userId } = await getSession(); return loadRecentWorkouts(db, userId, 3); }, []);
  const latest = useResource(loadLatest, "Your recent workouts could not be loaded.");
  const body = useResource<BodyMetricRow[]>(loadBody, "Your body measurements could not be loaded.");
  const totals = useResource(loadTotals, "Your totals could not be loaded.");
  const recent = useResource(loadRecent, "Your recent logs could not be loaded.");
  const summary = useTodaySummary(today);
  const goals = useGoalsData(today);

  // ?panel=goals[&new=<template>] (where /goals and Nutrition's goal links point): open the goal editor once and
  // bring Goals into view; the address keeps the panel and drops the template, so a reload does not reopen it.
  const [goalRequest, setGoalRequest] = useState<GoalRequest | null>(null);
  const [wantsGoals, setWantsGoals] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const template = goalTemplate(params.get("new"));
    if (params.get("panel") !== "goals" && !template) return;
    void Promise.resolve().then(() => {
      setWantsGoals(true);
      if (template) setGoalRequest({ template, key: 1 });
    });
    if (template) window.history.replaceState(null, "", "/progress?panel=goals");
  }, []);
  const scrolled = useRef(false);
  useEffect(() => {
    if (!wantsGoals || scrolled.current || !goals.data) return;
    scrolled.current = true;
    document.getElementById("home-goals")?.scrollIntoView({ block: "start" });
  }, [wantsGoals, goals.data]);

  const plan = context?.hasPreferences ? context.preferences.workouts_per_week : null;
  const joinedAt = context?.profile?.created_at ?? null;
  const targets = summary.data ? todayTargets(summary.data.summary, goals.data?.goals) : null;
  const calorieTarget = targets?.calories.target ?? null;
  const proteinTarget = targets?.protein.target ?? null;

  const view = useMemo(() => {
    const data = rows.data;
    if (!data) return null;
    const activitiesKnown = data.activitiesState === "ok";
    const index = indexDays(data.sessions, data.activities);
    const first = firstTrackedDay(joinedAt, { sessions: data.sessions, activities: data.activities, foodDays: data.foodDays });
    const current = periodSummary(period, index, data.foodDays, activitiesKnown);
    const before = previousSummary(period, index, data.foodDays, activitiesKnown, first);
    return {
      activitiesKnown,
      activitiesState: data.activitiesState,
      index,
      foodDays: data.foodDays,
      foodError: data.foodError,
      current,
      before,
      capped: data.sessionsCapped,
      calendar: calendarDays(period, index, data.foodDays, calorieTarget),
      months: period.kind === "year" ? yearMonths(period, index, data.foodDays) : [],
      training: trainingSeries(period, index, metric, activitiesKnown),
      calories: nutritionSeries(period, data.foodDays, "calories"),
      gains: strengthGains(data.sessions, period.from, period.end),
      highlights: highlights({ period, current, previous: before, proteinTarget, plan }),
    };
  }, [rows.data, period, metric, joinedAt, calorieTarget, proteinTarget, plan]);

  const recentView = useMemo(() => {
    if (!recent.data) return null;
    const index = indexDays(recent.data.sessions, recent.data.activities);
    const insights = summary.data || summary.status === "error"
      ? improveNext({
        today,
        sessions: recent.data.sessions,
        activityStarts: recent.data.activities ? recent.data.activities.map((activity) => activity.startedAt) : null,
        activitiesFailed: recent.data.activitiesState === "error",
        foodDays: recent.data.foodDays,
        proteinTarget: proteinTargetFrom(targets?.protein),
      })
      : null;
    return {
      streak: currentStreak(index, today),
      empty: noHistory(index, recent.data.foodDays, 0),
      insights,
      muscles: summariseMuscles(recent.data.sessions, musclePeriodRange("week", keyToLocalDate(today))),
    };
  }, [recent.data, summary.data, summary.status, targets?.protein, today]);

  // Nothing logged at all: no workout ever, no weigh-in, nothing in the last six weeks.
  const firstTime = totals.data?.workouts === 0 && body.data !== null && body.data.every((row) => row.weight === null) && recentView?.empty === true;

  function changeKind(next: PeriodKind) {
    setKind(next);
    setOffset(0);
  }

  const against = comparisonLabel(period);
  const loadError = rows.error && !rows.data ? <WidgetError message={rows.error} onRetry={rows.reload} /> : null;

  return (
    <div className={styles.page}>
      <div className={styles.periodBar} data-coach-avoid="">
        <Segmented<PeriodKind>
          label="Period"
          block
          className={styles.periodKinds}
          value={kind}
          onChange={changeKind}
          options={PERIOD_KINDS.map((value) => ({ value, label: PERIOD_LABELS[value] }))}
        />
        <div className={styles.periodNav}>
          <button type="button" className={styles.periodButton} onClick={() => setOffset((value) => value - 1)} disabled={offset <= -MAX_BACK[kind]} aria-label={`Previous ${kind}`}>
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <p className={styles.periodLabel} aria-live="polite">{period.label}{rows.loading ? <span className="sr-only"> (loading)</span> : null}</p>
          <button type="button" className={styles.periodButton} onClick={() => setOffset((value) => Math.min(0, value + 1))} disabled={offset >= 0} aria-label={`Next ${kind}`}>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      {firstTime ? <Welcome /> : null}

      {view ? (
        <section className={`${styles.card} ${styles.hero}`} aria-labelledby="overview-title" data-loading={rows.loading ? "" : undefined}>
          <h2 id="overview-title" className="sr-only">{period.label} overview</h2>
          <div className={styles.heroTop}>
            <ConcentricRings rings={heroRings(view.current, period, plan)} label={ringsLabel(view.current, plan, period)}>
              <span className={styles.ringNumber}><CountUp value={view.current.activeDays} /></span>
              <span className={styles.ringUnit}>{view.current.activeDays === 1 ? "active day" : "active days"}</span>
            </ConcentricRings>
            <ul className={styles.legend} aria-label="Rings">
              <li data-tone="train"><i /><span>Active</span><strong>{view.current.activeDays}<small>of {view.current.days} {view.current.days === 1 ? "day" : "days"}</small></strong></li>
              <li data-tone="food"><i /><span>Food logged</span><strong>{view.current.loggedDays}<small>{view.current.loggedDays === 1 ? "day" : "days"}</small></strong></li>
              {plan !== null ? <li data-tone="plan"><i /><span>Training days</span><strong>{view.current.trainingDays}<small>of {planTarget(plan, period)}</small></strong></li> : null}
            </ul>
          </div>
          <dl className={styles.stats}>
            <Stat label="Workouts" value={view.current.workouts} change={delta(view.current.workouts, view.before?.workouts)} against={against} good />
            <Stat label="Volume" value={view.current.volumeKg} unit="kg" change={delta(view.current.volumeKg, view.before?.volumeKg)} against={against} good />
            {view.activitiesKnown
              ? <Stat label="Distance" value={km(view.current.distanceM)} digits={1} unit="km" change={delta(km(view.current.distanceM), km(view.before?.distanceM))} against={against} good />
              : <Stat label="Distance" value={null} note={view.activitiesState === "unavailable" ? "Activity isn't set up yet" : "Couldn't load activities"} />}
            {view.current.kcalBurned !== null
              ? <Stat label="Burned" value={view.current.kcalBurned} unit="kcal" estimate note={`From ${view.current.kcalActivities} ${view.current.kcalActivities === 1 ? "activity" : "activities"}`} />
              : <Stat label="Moving time" text={view.current.movingSeconds ? formatDurationWords(view.current.movingSeconds) : view.activitiesKnown ? "0 min" : null} />}
          </dl>
          {view.highlights.length ? (
            <ul className={styles.highlights} aria-label="Highlights">
              {view.highlights.map((item) => <li key={item.id} data-tone={item.tone}>{item.text}</li>)}
            </ul>
          ) : null}
          {view.capped ? <p className={styles.cardNote}>Only your latest 600 workouts are counted.</p> : null}
        </section>
      ) : loadError ?? <div className={`${styles.loading} ${styles.loadingTall}`} aria-busy="true" aria-label="Loading your progress" />}

      <div className={styles.grid}>
        <div className={styles.stack}>
          <section className={styles.card} aria-labelledby="consistency-title">
            <div className={styles.cardHead}>
              <h2 id="consistency-title" className={styles.cardTitle}><Sparkles size={17} aria-hidden="true" />Consistency</h2>
              <div className={styles.calLegend} aria-hidden="true"><span><i className={styles.keyTrain} />Trained</span><span><i className={styles.keyFood} />Calories eaten</span></div>
            </div>
            {view ? (
              period.kind === "year" ? (
                <ol className={styles.months} aria-label={`Active days each month of ${period.label}`}>
                  {view.months.map((month) => {
                    const share = month.days ? month.activeDays / month.days : 0;
                    return (
                      <li key={month.key} className={styles.month} data-future={month.future ? "" : undefined}>
                        <span className={styles.monthRing} aria-label={month.future ? `${month.label}: ahead` : `${month.label}: ${month.activeDays} active of ${month.days} days`}>
                          <svg viewBox="0 0 36 36" aria-hidden="true" focusable="false">
                            <circle className={styles.dayTrack} cx="18" cy="18" r="15" />
                            <circle className={styles.dayTrain} cx="18" cy="18" r="15" pathLength={100} style={{ strokeDashoffset: 100 - share * 100, opacity: share > 0 ? 1 : 0 }} />
                          </svg>
                          <strong aria-hidden="true">{month.future ? "" : month.activeDays}</strong>
                        </span>
                        <span className={styles.monthLabel}>{month.label}</span>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <div className={period.kind === "week" ? styles.weekCalendar : undefined}>
                  <div className={styles.weekdays} aria-hidden="true">{WEEKDAYS.map((day, index) => <span key={index}>{day}</span>)}</div>
                  <ol className={styles.calendar} aria-label={`Days of ${period.label}`}>
                    {view.calendar.map((day, index) => day === null ? <li key={`pad-${index}`} aria-hidden="true" /> : (
                      <li key={day.key} className={styles.calDay} data-future={day.future ? "" : undefined} data-today={day.today ? "" : undefined}
                        aria-label={dayText(day)}>
                        <span className={styles.calNumber} aria-hidden="true">{day.day}</span>
                        <DayRing active={day.active} foodPercent={day.foodPercent} foodLogged={day.foodLogged} />
                      </li>
                    ))}
                  </ol>
                </div>
              )
            ) : <div className={styles.loading} aria-busy="true" aria-label="Loading your calendar" />}
            <dl className={styles.records}>
              <div><dt>Current streak</dt><dd>{recentView ? recentView.streak : "—"}</dd></div>
              <div><dt>Best run</dt><dd>{view ? view.current.longestStreak : "—"}</dd></div>
              <div><dt>All-time workouts</dt><dd>{totals.data ? num(totals.data.workouts) : "—"}</dd></div>
            </dl>
          </section>

          <section className={styles.card} aria-labelledby="training-title">
            <div className={styles.cardHead}>
              <h2 id="training-title" className={styles.cardTitle}><Dumbbell size={17} aria-hidden="true" />Training</h2>
              <Segmented<TrainingMetric> label="Training chart" value={metric} onChange={setMetric}
                options={(view?.activitiesKnown === false ? (["workouts", "volume"] as const) : (["workouts", "volume", "distance"] as const)).map((value) => ({ value, label: METRIC_LABELS[value] }))} />
            </div>
            {view ? (
              <TrendBars
                points={view.training}
                label={`${METRIC_LABELS[metric]} ${period.kind === "year" ? "each month" : "each day"}, ${period.label}`}
                format={(value) => metric === "workouts" ? `${num(value)} ${value === 1 ? "workout" : "workouts"}` : metric === "volume" ? `${num(value)} kg` : `${num(value, 1)} km`}
                emptyText={metric === "workouts" ? "No workouts in this period" : metric === "volume" ? "Nothing lifted in this period" : "No activities in this period"}
              />
            ) : <div className={styles.loading} aria-busy="true" aria-label="Loading your training" />}
            {latest.data?.length ? (
              <ul className={styles.recent} aria-label="Recent workouts">
                {latest.data.map((workout) => (
                  <li key={workout.id}>
                    <Link href={`/workouts/history/${workout.id}`} className={styles.recentRow}>
                      <span className={styles.recentText}>
                        <strong>{workout.name}</strong>
                        <span>{new Date(workout.startedAt).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}{workout.trainingSeconds !== null ? ` · ${workout.trainingSeconds < 60 ? "under 1 min" : formatDurationWords(workout.trainingSeconds)}` : ""}</span>
                      </span>
                      <span className={styles.recentVolume}>{workout.volumeKg === null ? <span aria-label="No weighted sets">—</span> : `${num(workout.volumeKg)} kg`}</span>
                      <ChevronRight size={16} aria-hidden="true" className={styles.muted} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
            <Link href="/workouts/history" className={styles.link}>Workout history<ChevronRight size={15} aria-hidden="true" /></Link>
          </section>

          <section className={styles.card} aria-labelledby="strength-title">
            <div className={styles.cardHead}>
              <h2 id="strength-title" className={styles.cardTitle}><TrendingUp size={17} aria-hidden="true" />Strength</h2>
            </div>
            {view && view.gains.length ? (
              <div className="grid gap-1">
                <h3 className={styles.subTitle}>Improved this {period.kind}</h3>
                <ul className={styles.gains}>
                  {view.gains.map((gain) => (
                    <li key={gain.key}>
                      <span className={styles.gainName}>{gain.name}</span>
                      <span className={styles.gainMeta}>1RM ≈ {num(gain.firstKg, 1)} → {num(gain.lastKg, 1)} kg · {gain.sessions} sessions<span className="sr-only"> (estimates)</span></span>
                      <span className={styles.gainValue} data-flat={gain.changeKg <= 0 ? "" : undefined}>{gain.changeKg > 0 ? "+" : gain.changeKg < 0 ? "−" : "±"}{num(Math.abs(gain.changeKg), 1)} kg</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <RecordsSection />
          </section>
        </div>

        <div className={styles.stack}>
          <BodySection rows={body.data} error={body.status === "error" && !body.data ? body.error : ""} onReload={body.reload} period={period} />

          <section className={styles.card} aria-labelledby="food-title">
            <div className={styles.cardHead}>
              <h2 id="food-title" className={styles.cardTitle}><Salad size={17} aria-hidden="true" />Nutrition</h2>
              <Link href="/nutrition" className={styles.link}>Open<ChevronRight size={15} aria-hidden="true" /></Link>
            </div>
            {view ? view.foodError ? <p role="alert" className="fitx-alert fitx-alert-danger">Your food log could not be loaded. <button type="button" className="fitx-alert-action" onClick={rows.reload}>Try again</button></p> : (
              <>
                <dl className={styles.pair}>
                  <FoodAverage label="Calories" unit="kcal" average={view.current.calories.average} target={calorieTarget} days={view.current.calories.days} tone="food" />
                  <FoodAverage label="Protein" unit="g" average={view.current.protein.average} target={proteinTarget} days={view.current.protein.days} tone="protein" />
                </dl>
                <TrendBars
                  points={view.calories}
                  tone="food"
                  label={`Calories eaten a logged day, ${period.label}`}
                  format={(value) => `${num(value)} kcal`}
                  target={calorieTarget}
                  targetLabel={calorieTarget ? `${num(calorieTarget)}` : undefined}
                  emptyText="No food logged in this period"
                  height={120}
                />
                <p className={styles.cardNote}>
                  {view.current.loggedDays} of {view.current.days} {view.current.days === 1 ? "day" : "days"} logged. Averages count logged days only{view.current.calories.missingEntries + view.current.protein.missingEntries > 0 ? "; foods without a value are left out" : ""}.
                </p>
              </>
            ) : <div className={styles.loading} aria-busy="true" aria-label="Loading your nutrition" />}
          </section>

          <GoalsPanel date={today} goals={goals} summary={summary} request={goalRequest} />

          <section id="focus-next" className={styles.card} aria-labelledby="focus-title">
            <div className={styles.cardHead}>
              <h2 id="focus-title" className={styles.cardTitle}><Compass size={17} aria-hidden="true" />Focus next</h2>
              <span className={styles.cardNote}>Last 5 weeks · not medical advice</span>
            </div>
            {recentView?.insights ? <InsightList insights={recentView.insights.insights} status={recentView.insights.status} />
              : recent.status === "error" ? <p role="alert" className="fitx-alert fitx-alert-danger">{recent.error} <button type="button" className="fitx-alert-action" onClick={recent.reload}>Try again</button></p>
                : <div className={styles.loading} aria-busy="true" aria-label="Looking at your recent logs" />}
          </section>

          <MuscleMapLink summary={recentView?.muscles ?? null} />
        </div>
      </div>
    </div>
  );
}

function planTarget(plan: number, period: Period): number {
  const weeks = period.kind === "week" ? 1 : (Math.max(0, Math.round((keyToLocalDate(period.end).getTime() - keyToLocalDate(period.from).getTime()) / 86_400_000)) + 1) / 7;
  return Math.max(1, Math.round(plan * weeks));
}

function heroRings(current: ReturnType<typeof periodSummary>, period: Period, plan: number | null): Ring[] {
  const days = Math.max(1, current.days);
  const rings: Ring[] = [
    { value: current.activeDays, max: days, tone: "train" },
    { value: current.loggedDays, max: days, tone: "food" },
  ];
  if (plan !== null) rings.push({ value: current.trainingDays, max: planTarget(plan, period), tone: "plan" });
  return rings;
}

function ringsLabel(current: ReturnType<typeof periodSummary>, plan: number | null, period: Period): string {
  const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
  const parts = [`${current.activeDays} active of ${days(current.days)}`, `food logged on ${days(current.loggedDays)}`];
  if (plan !== null) parts.push(`${current.trainingDays} training days of ${planTarget(plan, period)} planned`);
  return parts.join(", ");
}

function dayText(day: { key: string; future: boolean; active: boolean; workouts: number; activities: number; foodPercent: number | null; foodLogged: boolean }): string {
  const date = keyToLocalDate(day.key).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  if (day.future) return `${date}: ahead`;
  const parts: string[] = [];
  if (day.workouts) parts.push(`${day.workouts} ${day.workouts === 1 ? "workout" : "workouts"}`);
  if (day.activities) parts.push(`${day.activities} ${day.activities === 1 ? "activity" : "activities"}`);
  if (!parts.length) parts.push(day.active ? "trained" : "no training");
  parts.push(day.foodPercent !== null ? `${day.foodPercent}% of calorie target eaten` : day.foodLogged ? "food logged" : "no food logged");
  return `${date}: ${parts.join(", ")}`;
}

function Stat({ label, value, text, unit, digits = 0, change, against, good = false, estimate = false, note }: {
  label: string;
  value?: number | null;
  /** A ready-made value (a duration); null is unknown. */
  text?: string | null;
  unit?: string;
  digits?: number;
  change?: Delta | null;
  against?: string;
  good?: boolean;
  estimate?: boolean;
  note?: string;
}) {
  const known = text !== undefined ? text !== null : value !== null && value !== undefined;
  return (
    <div className={styles.stat}>
      <dt>{label}</dt>
      <dd>
        <span className={styles.statValue}>
          {text !== undefined ? (text ?? <><span aria-hidden="true">—</span><span className="sr-only">Not known</span></>)
            : <CountUp value={value ?? null} format={(number) => num(number, digits)} />}
          {known && unit ? <span className={styles.statUnit}>{unit}</span> : null}
          {known && estimate ? <span className={styles.statEstimate}>est.</span> : null}
        </span>
        {change && against ? (
          <span className={styles.delta} data-direction={good ? change.direction : "same"}>
            {change.direction === "same" ? `Same as ${against}` : `${change.difference > 0 ? "+" : "−"}${num(Math.abs(change.difference), digits)} vs ${against}`}
          </span>
        ) : note ? <span className={styles.delta}>{note}</span> : null}
      </dd>
    </div>
  );
}

function FoodAverage({ label, unit, average, target, days, tone }: { label: string; unit: string; average: number | null; target: number | null; days: number; tone: "food" | "protein" }) {
  const share = average !== null && target ? Math.min(1, average / target) : 0;
  return (
    <div>
      <dt>{label}</dt>
      <dd>{average === null ? <><span aria-hidden="true">—</span><span className="sr-only">Not known</span></> : <>{num(average)}<small>{unit} a day</small></>}</dd>
      {target ? <span className={styles.meter} data-tone={tone} role="img" aria-label={average === null ? `No ${label.toLowerCase()} logged` : `${Math.round((average / target) * 100)}% of your ${num(target)} ${unit} target`}><span style={{ transform: `scaleX(${share})` }} /></span> : null}
      <p>{average === null ? "Nothing logged" : `${days} logged ${days === 1 ? "day" : "days"}${target ? ` · target ${num(target)} ${unit}` : ""}`}</p>
    </div>
  );
}

/** Nobody logged anything yet: what Progress will show, and the three ways to start. */
function Welcome() {
  return (
    <section className={styles.welcome} aria-labelledby="welcome-title">
      <div className={styles.welcomeArt} aria-hidden="true">
        <svg viewBox="0 0 100 100" focusable="false">
          <circle cx="50" cy="50" r="44" strokeWidth="7" pathLength={100} style={{ strokeDashoffset: 28 }} />
          <circle cx="50" cy="50" r="34" strokeWidth="7" pathLength={100} style={{ strokeDashoffset: 46 }} />
          <circle cx="50" cy="50" r="24" strokeWidth="7" pathLength={100} style={{ strokeDashoffset: 62 }} />
        </svg>
      </div>
      <h2 id="welcome-title" className={styles.welcomeTitle}>Your progress starts with one log</h2>
      <p className={styles.welcomeText}>Workouts, food and weigh-ins fill these rings, charts and records. Only what you log is shown.</p>
      <div className={styles.welcomeActions}>
        <Link href="/workouts" className={styles.welcomeAction} data-primary=""><Dumbbell size={16} aria-hidden="true" />Start a workout</Link>
        <Link href="/nutrition" className={styles.welcomeAction}><Salad size={16} aria-hidden="true" />Log food</Link>
        <Link href="/activity" className={styles.welcomeAction}><Flame size={16} aria-hidden="true" />Record an activity</Link>
      </div>
    </section>
  );
}
