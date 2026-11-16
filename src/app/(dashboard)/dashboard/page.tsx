"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarDays, Droplets, Dumbbell, Plus, Scale, Utensils } from "lucide-react";
import { PageHeading } from "@/components/app/PageHeading";
import { EmptyState } from "@/components/app/EmptyState";
import { ProgressRing } from "@/components/app/ProgressRing";
import { createClient } from "@/lib/supabase/client";
import { estimateNutritionTargets, sumMacros } from "@/lib/domain/nutrition";
import { localDateKey, localDayRange, readableDate, weekStart } from "@/lib/domain/dates";
import styles from "./Dashboard.module.css";

type DashboardData = {
  name: string;
  workouts: Array<{ id: string; name: string; started_at: string; total_volume: number }>;
  meals: Array<{ id: string; calories: number; protein: number; carbs: number; fat: number }>;
  water: Array<{ amount_ml: number }>;
  todayEvents: Array<{ id: string; title: string; event_type: string; starts_at: string; workout_plan_id: string | null }>;
  weight: number | null;
  targetWorkouts: number;
  waterTarget: number;
  nutritionTarget: ReturnType<typeof estimateNutritionTargets>;
};

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingWater, setSavingWater] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const supabase = createClient();
    if (!supabase) { setError("FITX is not connected to Supabase in this environment."); setLoading(false); return; }
    const { data: auth } = await supabase.auth.getUser();
    const user = auth.user;
    if (!user) { setError("Sign in to view your fitness dashboard."); setLoading(false); return; }
    const current = new Date();
    const today = localDateKey(current);
    const todayRange = localDayRange(current);
    const from = weekStart(current).toISOString();
    const [profileRes, prefRes, workoutsRes, mealsRes, waterRes, eventsRes, metricRes] = await Promise.all([
      supabase.from("profiles").select("name, age, gender, height, weight, avatar, onboarded").eq("id", user.id).maybeSingle(),
      supabase.from("user_preferences").select("workouts_per_week, daily_water_goal_ml, activity_level, primary_goal").eq("user_id", user.id).maybeSingle(),
      supabase.from("workout_sessions").select("id, name, started_at, total_volume").eq("user_id", user.id).eq("status", "completed").gte("started_at", from).lte("started_at", current.toISOString()).order("started_at", { ascending: false }).limit(40),
      supabase.from("meals").select("id, calories, protein, carbs, fat").eq("user_id", user.id).eq("date", today).order("created_at", { ascending: false }).limit(50),
      supabase.from("water_logs").select("amount_ml").eq("user_id", user.id).eq("local_date", today).limit(50),
      supabase.from("planner_events").select("id, title, event_type, starts_at, workout_plan_id").eq("user_id", user.id).eq("event_type", "workout").eq("status", "scheduled").gte("starts_at", todayRange.start).lt("starts_at", todayRange.end).order("starts_at", { ascending: true }).limit(10),
      supabase.from("body_metrics").select("weight").eq("user_id", user.id).not("weight", "is", null).order("date", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const failed = [profileRes.error, prefRes.error, workoutsRes.error, mealsRes.error, waterRes.error, eventsRes.error, metricRes.error].find(Boolean);
    if (failed) { setError("Your dashboard could not load. Check your connection and try again."); setLoading(false); return; }
    const profile = profileRes.data;
    const prefs = prefRes.data;
    setData({
      name: profile?.name || user.user_metadata?.name || user.email?.split("@")[0] || "there",
      workouts: workoutsRes.data ?? [], meals: mealsRes.data ?? [], water: waterRes.data ?? [], todayEvents: eventsRes.data ?? [],
      weight: metricRes.data?.weight ?? profile?.weight ?? null,
      targetWorkouts: prefs?.workouts_per_week ?? 3,
      waterTarget: prefs?.daily_water_goal_ml ?? 2500,
      nutritionTarget: estimateNutritionTargets(profile ?? {}, prefs?.activity_level, prefs?.primary_goal),
    });
    setNow(current);
    setLoading(false);
    setError("");
  }

  useEffect(() => { void Promise.resolve().then(load); }, []);

  const mealsTotal = useMemo(() => sumMacros(data?.meals ?? []), [data?.meals]);
  const waterTotal = useMemo(() => (data?.water ?? []).reduce((sum, row) => sum + Number(row.amount_ml || 0), 0), [data?.water]);
  const weekDays = useMemo(() => {
    if (!now || !data) return [];
    const start = weekStart(now);
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
      const key = localDateKey(day);
      const count = data.workouts.filter((workout) => localDateKey(new Date(workout.started_at)) === key).length;
      return { date: day, key, count };
    });
  }, [now, data]);

  async function addWater() {
    const supabase = createClient();
    if (!supabase || savingWater) return;
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    setSavingWater(true);
    const { error: insertError } = await supabase.from("water_logs").insert({ user_id: auth.user.id, amount_ml: 250, local_date: localDateKey() });
    setSavingWater(false);
    if (insertError) setError("Water could not be saved. Try again.");
    else await load();
  }

  if (loading) return <div className="animate-pulse space-y-5" aria-label="Loading dashboard"><div className="h-12 w-1/3 rounded-lg bg-fitx-surface-variant"/><div className="grid gap-4 lg:grid-cols-2"><div className="h-64 rounded-2xl bg-fitx-surface"/><div className="h-64 rounded-2xl bg-fitx-surface"/></div><div className="h-56 rounded-2xl bg-fitx-surface"/></div>;
  if (error && !data) return <EmptyState title="Dashboard unavailable" description={error} action={<button className="fitx-button fitx-button-secondary" onClick={() => { setLoading(true); void load(); }}>Try again</button>} />;
  if (!data || !now) return null;

  const workoutCount = data.workouts.length;
  const caloriesTarget = data.nutritionTarget?.calories ?? 0;
  const upcoming = data.todayEvents[0];
  const maxWorkouts = Math.max(1, ...weekDays.map((day) => day.count));

  return (
    <div className={`${styles.page} space-y-5 sm:space-y-6`}>
      <PageHeading
        title={<span className={styles.greeting}><span>Good {now.getHours() < 12 ? "morning" : now.getHours() < 18 ? "afternoon" : "evening"},</span><strong>{data.name}</strong></span>}
        description="Your progress today, based on what you’ve logged."
        actions={<div className="flex items-center gap-2 rounded-lg border border-fitx-border bg-fitx-surface px-3 py-2 text-sm text-fitx-text-secondary"><CalendarDays size={16}/>{readableDate(now)}</div>}
      />

      {error && <p role="status" className="fitx-alert fitx-alert-danger">{error}</p>}
      {!data && null}

      <section className={`${styles.topGrid} grid gap-4 xl:grid-cols-[1.08fr_.92fr]`}>
        <article className={`${styles.workout} relative isolate flex min-h-[250px] flex-col justify-between overflow-hidden rounded-[20px] border p-5 sm:min-h-[280px] sm:p-7`}>
          <div aria-hidden="true" className={styles.workoutGlow} />
          <div>
            <div className="flex items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.16em] text-fitx-primary-text"><Dumbbell size={15} aria-hidden="true"/>Today&apos;s workout</p>
              {upcoming && <p className="rounded-md border border-fitx-border bg-fitx-surface px-2.5 py-1.5 text-xs text-fitx-text-secondary">{new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(upcoming.starts_at))}</p>}
            </div>
            <h2 className="mt-5 max-w-xl text-[26px] font-semibold leading-tight tracking-tight sm:text-3xl">{upcoming?.title ?? "Nothing planned today"}</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-fitx-text-secondary">{upcoming ? "Your session is on the planner. Open it to review the plan and start when you’re ready." : "Your training plan is yours to shape. Build a session around the time and equipment you have."}</p>
          </div>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link href={upcoming?.workout_plan_id ? `/workouts?plan=${upcoming.workout_plan_id}` : "/workouts"} className="fitx-button min-h-12 w-full sm:w-auto"><Dumbbell size={17} aria-hidden="true"/>{upcoming ? "Open workout plan" : "Plan a workout"}</Link>
            {upcoming && <span className="text-xs text-fitx-text-disabled">Scheduled for today</span>}
          </div>
        </article>

        <article className={`${styles.progressPanel} fitx-panel p-5 sm:p-6`}>
          <div className="mb-5 flex items-center justify-between"><div><h2 className="font-semibold">Today&apos;s progress</h2><p className="mt-1 text-xs text-fitx-text-secondary">{readableDate(now)}</p></div><Link href="/progress" className="grid min-h-11 min-w-11 place-items-center rounded-lg text-fitx-text-disabled hover:bg-fitx-hover hover:text-fitx-primary" aria-label="View progress"><ArrowRight size={18}/></Link></div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-[auto_1fr] sm:items-center">
            <div className="flex flex-col items-center gap-2">
              <ProgressRing value={mealsTotal.calories} target={caloriesTarget} label="calories" size={132} description={caloriesTarget > 0 ? `${Math.round(mealsTotal.calories)} calories logged of an estimated ${caloriesTarget} calorie target` : `${Math.round(mealsTotal.calories)} calories logged`} />
              <p className="max-w-[11rem] text-center text-[11px] leading-4 text-fitx-text-secondary">{caloriesTarget > 0 ? `Estimated target: ${caloriesTarget.toLocaleString()} kcal` : "Add age, height and weight in Profile to estimate a target"}</p>
            </div>
            <div className={styles.progressMetrics}>
              <div className="rounded-xl bg-fitx-surface-variant p-3"><Dumbbell size={17} className="mb-2 text-fitx-primary"/><p className="text-lg font-semibold tabular-nums">{data.workouts.filter((item) => localDateKey(new Date(item.started_at)) === localDateKey(now)).length}</p><p className="text-[11px] text-fitx-text-secondary">Workouts</p></div>
              <div className="rounded-xl bg-fitx-surface-variant p-3"><Utensils size={17} className="mb-2 text-fitx-primary"/><p className="text-lg font-semibold tabular-nums">{Math.round(mealsTotal.calories)}</p><p className="text-[11px] text-fitx-text-secondary">kcal logged</p></div>
              <div className="rounded-xl bg-fitx-surface-variant p-3"><Droplets size={17} className="mb-2 text-fitx-info"/><p className="text-lg font-semibold tabular-nums">{(waterTotal / 1000).toFixed(1)} L</p><p className="text-[11px] text-fitx-text-secondary">Water</p></div>
            </div>
          </div>
          <div className={`${styles.macroStrip} mt-5 grid grid-cols-3 gap-3 border-t border-fitx-divider pt-4 text-xs text-fitx-text-secondary`}>
            <span>Protein <b className="ml-1 font-medium text-fitx-text">{Math.round(mealsTotal.protein)} g</b></span>
            <span>Carbs <b className="ml-1 font-medium text-fitx-text">{Math.round(mealsTotal.carbs)} g</b></span>
            <span>Fat <b className="ml-1 font-medium text-fitx-text">{Math.round(mealsTotal.fat)} g</b></span>
          </div>
        </article>
      </section>

      <div className={styles.analyticsGrid}>
      <section aria-label="Weekly activity chart" className={`${styles.weekly} fitx-panel p-5 sm:p-6`}>
        <div className="mb-5 flex items-center justify-between"><div><h2 className="font-semibold">Weekly activity</h2><p className="mt-1 text-xs text-fitx-text-secondary">Completed workouts by day</p></div><Link href="/progress" className="grid min-h-11 place-items-center rounded-lg px-3 text-xs font-medium text-fitx-primary-text hover:bg-fitx-hover">View progress</Link></div>
        <div className={styles.activityChart}>
          {weekDays.map(({ date, key, count }) => <div key={key} className={styles.activityDay} data-today={key === localDateKey(now) || undefined} title={`${count} completed ${count === 1 ? "workout" : "workouts"}`}><span className={styles.activityCount}>{count || "0"}</span><div className={styles.activityTrack}><div className={styles.activityBar} style={{ height: count ? `${Math.max(12, (count / maxWorkouts) * 100)}%` : "3px" }}/></div><span className={styles.activityLabel}>{new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date)}</span></div>)}
        </div>
      </section>

      <section className={`${styles.stats} grid gap-4 md:grid-cols-3`} aria-label="Key statistics">
        <article className={`${styles.stat} fitx-panel p-5`}>
          <div className="mb-4 flex items-center justify-between"><h2 className="font-medium">Workouts this week</h2><Dumbbell size={17} className="text-fitx-primary"/></div>
          <p className="text-3xl font-semibold tabular-nums">{workoutCount}<span className="ml-1 text-base font-normal text-fitx-text-secondary">/ {data.targetWorkouts}</span></p>
          <div className="fitx-progress-track mt-4 h-2"><div className="fitx-progress-fill" style={{ width: `${Math.min(100, (workoutCount / Math.max(data.targetWorkouts, 1)) * 100)}%` }}/></div>
          <p className="mt-2 text-xs text-fitx-text-secondary">Completed sessions since Monday</p>
        </article>
        <article className={`${styles.stat} fitx-panel p-5`}>
          <div className="mb-4 flex items-center justify-between"><h2 className="font-medium">Water intake</h2><Droplets size={17} className="text-fitx-info"/></div>
          <p className="text-3xl font-semibold tabular-nums">{(waterTotal / 1000).toFixed(1)}<span className="ml-1 text-base font-normal text-fitx-text-secondary">/ {(data.waterTarget / 1000).toFixed(1)} L</span></p>
          <div className="fitx-progress-track mt-4 h-2"><div className="fitx-progress-fill" style={{ width: `${Math.min(100, (waterTotal / Math.max(data.waterTarget, 1)) * 100)}%`, background: "var(--fitx-info)" }}/></div>
          <button disabled={savingWater} onClick={() => void addWater()} className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-fitx-border px-3 text-sm font-medium text-fitx-primary transition-colors hover:border-fitx-primary/40 hover:text-fitx-primary-bright"><Plus size={14}/>{savingWater ? "Saving…" : "Add 250 ml"}</button>
        </article>
        <article className={`${styles.stat} fitx-panel p-5`}>
          <div className="mb-4 flex items-center justify-between"><h2 className="font-medium">Latest weight</h2><Scale size={17} className="text-fitx-primary"/></div>
          {data.weight !== null ? <><p className="text-3xl font-semibold tabular-nums">{Number(data.weight).toFixed(1)}<span className="ml-1 text-base font-normal text-fitx-text-secondary">kg</span></p><Link href="/progress" className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-fitx-primary">View progress <ArrowRight size={14}/></Link></> : <><p className="text-sm text-fitx-text-secondary">No weight logged yet.</p><Link href="/progress" className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-fitx-primary">Record weight <ArrowRight size={14}/></Link></>}
        </article>
      </section>
      </div>

      <section aria-label="Quick actions" className={styles.quickActions}>
        <article className="fitx-panel p-5 sm:p-6">
          <div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">Quick actions</h2><Plus size={17} className="text-fitx-primary"/></div>
          <div className={styles.actionGrid}>
            {[["/workouts", "Log workout", Dumbbell], ["/nutrition", "Log a meal", Utensils], ["/nutrition", "Log water", Droplets], ["/progress", "Update weight", Scale]].map(([href, label, Icon]) => {
              const ActionIcon = Icon as typeof Dumbbell;
              return <Link key={label as string} href={href as string} className={styles.action}><span className={styles.actionLabel}><ActionIcon size={17} aria-hidden="true"/>{label as string}</span><ArrowRight size={15} aria-hidden="true"/></Link>;
            })}
          </div>
        </article>
      </section>

      {data.workouts.length > 0 ? <section className={`${styles.recent} fitx-panel p-5 sm:p-6`}><div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">Recent workouts</h2><Link href="/workouts" className="text-xs font-medium text-fitx-primary">Workout history</Link></div><div className="divide-y divide-fitx-divider">{data.workouts.slice(0, 3).map((workout) => <div key={workout.id} className="flex items-center justify-between gap-4 py-3"><div><p className="text-sm font-medium">{workout.name}</p><p className="mt-1 text-xs text-fitx-text-secondary">{readableDate(new Date(workout.started_at), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p></div><span className="text-xs text-fitx-text-secondary">{Math.round(Number(workout.total_volume || 0)).toLocaleString()} kg</span></div>)}</div></section> : <section><EmptyState title="Your activity will show here" description="Finish your first workout and FITX will begin building your training history." action={<Link href="/workouts" className="fitx-button fitx-button-secondary">Browse workouts</Link>}/></section>}
    </div>
  );
}
