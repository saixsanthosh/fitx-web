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
      supabase.from("planner_events").select("id, title, event_type, starts_at, workout_plan_id").eq("user_id", user.id).eq("status", "scheduled").gte("starts_at", todayRange.start).lt("starts_at", todayRange.end).order("starts_at", { ascending: true }).limit(10),
      supabase.from("body_metrics").select("weight").eq("user_id", user.id).not("weight", "is", null).order("date", { ascending: false }).limit(1).maybeSingle(),
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
    <div className="space-y-5 sm:space-y-6">
      <PageHeading
        title={<span>Good {now.getHours() < 12 ? "morning" : now.getHours() < 18 ? "afternoon" : "evening"}, {data.name}</span>}
        description="Your progress today, based on what you’ve logged."
        actions={<div className="flex items-center gap-2 rounded-lg border border-fitx-border bg-fitx-surface px-3 py-2 text-sm text-fitx-text-secondary"><CalendarDays size={16}/>{readableDate(now)}</div>}
      />

      {error && <p role="status" className="rounded-lg border border-red-300/20 bg-red-300/5 px-3 py-2 text-sm text-red-200">{error}</p>}
      {!data && null}

      <section className="grid gap-4 xl:grid-cols-[1.05fr_.95fr]">
        <article className="fitx-panel p-5 sm:p-6">
          <div className="mb-5 flex items-center justify-between"><div><h2 className="font-semibold">Today&apos;s progress</h2><p className="mt-1 text-xs text-fitx-text-secondary">{readableDate(now)}</p></div><Link href="/progress" className="text-fitx-text-disabled hover:text-fitx-primary" aria-label="View progress"><ArrowRight size={18}/></Link></div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-[auto_1fr] sm:items-center">
            <ProgressRing value={mealsTotal.calories} target={caloriesTarget} label="calories" size={132} />
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              <div className="rounded-xl bg-fitx-surface p-3"><Dumbbell size={17} className="mb-2 text-fitx-primary"/><p className="text-lg font-semibold tabular-nums">{data.workouts.filter((item) => localDateKey(new Date(item.started_at)) === localDateKey(now)).length}</p><p className="text-[11px] text-fitx-text-secondary">Workouts</p></div>
              <div className="rounded-xl bg-fitx-surface p-3"><Utensils size={17} className="mb-2 text-fitx-primary"/><p className="text-lg font-semibold tabular-nums">{Math.round(mealsTotal.calories)}</p><p className="text-[11px] text-fitx-text-secondary">kcal logged</p></div>
              <div className="rounded-xl bg-fitx-surface p-3"><Droplets size={17} className="mb-2 text-fitx-info"/><p className="text-lg font-semibold tabular-nums">{(waterTotal / 1000).toFixed(1)} L</p><p className="text-[11px] text-fitx-text-secondary">Water</p></div>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-3 gap-3 border-t border-fitx-divider pt-4 text-xs text-fitx-text-secondary">
            <span>Protein <b className="ml-1 font-medium text-fitx-text">{Math.round(mealsTotal.protein)} g</b></span>
            <span>Carbs <b className="ml-1 font-medium text-fitx-text">{Math.round(mealsTotal.carbs)} g</b></span>
            <span>Fat <b className="ml-1 font-medium text-fitx-text">{Math.round(mealsTotal.fat)} g</b></span>
          </div>
        </article>

        <article className="fitx-panel flex flex-col justify-between p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4"><div><p className="text-sm text-fitx-text-secondary">Today&apos;s workout</p><h2 className="mt-2 text-xl font-semibold">{upcoming?.title ?? "Nothing planned today"}</h2>{upcoming && <p className="mt-2 text-sm text-fitx-text-secondary">{new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(upcoming.starts_at))}</p>}</div><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-fitx-primary/10 text-fitx-primary"><Dumbbell size={20}/></span></div>
          <div className="mt-6">
            {upcoming ? <Link href={upcoming.workout_plan_id ? `/workouts?plan=${upcoming.workout_plan_id}` : "/workouts"} className="fitx-button w-full sm:w-auto"><Dumbbell size={17}/>Start workout</Link> : <EmptyState title="No workout recorded or scheduled" description="Plan a session or start a workout when you’re ready." action={<Link href="/workouts" className="fitx-button fitx-button-secondary"><Plus size={16}/>Plan a workout</Link>} />}
          </div>
        </article>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <article className="fitx-panel p-5">
          <div className="mb-4 flex items-center justify-between"><h2 className="font-medium">Workouts this week</h2><Dumbbell size={17} className="text-fitx-primary"/></div>
          <p className="text-3xl font-semibold tabular-nums">{workoutCount}<span className="ml-1 text-base font-normal text-fitx-text-secondary">/ {data.targetWorkouts}</span></p>
          <div className="fitx-progress-track mt-4 h-2"><div className="fitx-progress-fill" style={{ width: `${Math.min(100, (workoutCount / Math.max(data.targetWorkouts, 1)) * 100)}%` }}/></div>
          <p className="mt-2 text-xs text-fitx-text-secondary">Completed sessions since Monday</p>
        </article>
        <article className="fitx-panel p-5">
          <div className="mb-4 flex items-center justify-between"><h2 className="font-medium">Water intake</h2><Droplets size={17} className="text-fitx-info"/></div>
          <p className="text-3xl font-semibold tabular-nums">{(waterTotal / 1000).toFixed(1)}<span className="ml-1 text-base font-normal text-fitx-text-secondary">/ {(data.waterTarget / 1000).toFixed(1)} L</span></p>
          <div className="fitx-progress-track mt-4 h-2"><div className="fitx-progress-fill bg-[#69bdf4]" style={{ width: `${Math.min(100, (waterTotal / Math.max(data.waterTarget, 1)) * 100)}%` }}/></div>
          <button disabled={savingWater} onClick={() => void addWater()} className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-fitx-primary hover:text-fitx-primary-bright"><Plus size={14}/>{savingWater ? "Saving…" : "Add 250 ml"}</button>
        </article>
        <article className="fitx-panel p-5">
          <div className="mb-4 flex items-center justify-between"><h2 className="font-medium">Latest weight</h2><Scale size={17} className="text-fitx-primary"/></div>
          {data.weight !== null ? <><p className="text-3xl font-semibold tabular-nums">{Number(data.weight).toFixed(1)}<span className="ml-1 text-base font-normal text-fitx-text-secondary">kg</span></p><Link href="/progress" className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-fitx-primary">View progress <ArrowRight size={14}/></Link></> : <><p className="text-sm text-fitx-text-secondary">No weight logged yet.</p><Link href="/progress" className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-fitx-primary">Record weight <ArrowRight size={14}/></Link></>}
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.3fr_.7fr]">
        <article className="fitx-panel p-5 sm:p-6">
          <div className="mb-5 flex items-center justify-between"><div><h2 className="font-semibold">Weekly activity</h2><p className="mt-1 text-xs text-fitx-text-secondary">Completed workouts by day</p></div><Link href="/progress" className="text-xs font-medium text-fitx-primary">View progress</Link></div>
          <div className="grid h-36 grid-cols-7 gap-2 sm:gap-4">
            {weekDays.map(({ date, key, count }) => <div key={key} className="flex flex-col items-center justify-end gap-2"><span className="text-[11px] tabular-nums text-fitx-text-secondary">{count || ""}</span><div className="flex h-24 w-full max-w-12 items-end rounded-md bg-fitx-surface"><div className="w-full rounded-md bg-fitx-primary/80" style={{ height: count ? `${Math.max(12, (count / maxWorkouts) * 100)}%` : "3px" }}/></div><span className="text-[10px] text-fitx-text-disabled">{new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date)}</span></div>)}
          </div>
        </article>
        <article className="fitx-panel p-5 sm:p-6">
          <div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">Quick actions</h2><Plus size={17} className="text-fitx-primary"/></div>
          <div className="space-y-2">
            {[["/workouts", "Log workout", Dumbbell], ["/nutrition", "Log a meal", Utensils], ["/nutrition", "Log water", Droplets], ["/progress", "Update weight", Scale]].map(([href, label, Icon]) => {
              const ActionIcon = Icon as typeof Dumbbell;
              return <Link key={label as string} href={href as string} className="flex items-center justify-between rounded-lg border border-fitx-border bg-fitx-surface px-3 py-3 text-sm text-fitx-text-secondary hover:border-fitx-primary/40 hover:text-fitx-text"><span className="flex items-center gap-2.5"><ActionIcon size={16} className="text-fitx-primary"/>{label as string}</span><ArrowRight size={15}/></Link>;
            })}
          </div>
        </article>
      </section>

      {data.workouts.length > 0 ? <section className="fitx-panel p-5 sm:p-6"><div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">Recent workouts</h2><Link href="/workouts" className="text-xs font-medium text-fitx-primary">Workout history</Link></div><div className="divide-y divide-fitx-divider">{data.workouts.slice(0, 3).map((workout) => <div key={workout.id} className="flex items-center justify-between gap-4 py-3"><div><p className="text-sm font-medium">{workout.name}</p><p className="mt-1 text-xs text-fitx-text-secondary">{readableDate(new Date(workout.started_at), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p></div><span className="text-xs text-fitx-text-secondary">{Math.round(Number(workout.total_volume || 0)).toLocaleString()} kg</span></div>)}</div></section> : <section><EmptyState title="Your activity will show here" description="Finish your first workout and FITX will begin building your training history." action={<Link href="/workouts" className="fitx-button fitx-button-secondary">Browse workouts</Link>}/></section>}
    </div>
  );
}
