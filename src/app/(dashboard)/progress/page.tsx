"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Activity, CalendarDays, Dumbbell, Scale, Trophy } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { PageHeading } from "@/components/app/PageHeading";
import { createClient } from "@/lib/supabase/client";
import { localDateKey, weekStart } from "@/lib/domain/dates";

type Session = { id: string; name: string; started_at: string; completed_at: string | null; duration_seconds: number; total_volume: number };
type Metric = { id: string; date: string; weight: number | null; body_fat: number | null; measurements: Record<string, number> };
type RecordRow = { id: string; exercise_name: string; best_weight_kg: number; best_reps: number; estimated_one_rep_max: number; achieved_at: string };

export default function ProgressPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [weight, setWeight] = useState(""); const [bodyFat, setBodyFat] = useState("");
  const [measurementName, setMeasurementName] = useState("waist"); const [measurement, setMeasurement] = useState("");
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const [range, setRange] = useState(90);
  const [today] = useState(() => new Date());
  const load = useCallback(async () => {
    const supabase = createClient(); if (!supabase) { setLoading(false); return setError("Progress is not connected to Supabase."); }
    const { data: auth } = await supabase.auth.getUser(); if (!auth.user) { setLoading(false); return setError("Sign in to view your progress."); }
    const [sessionResult, metricResult, recordResult] = await Promise.all([
      supabase.from("workout_sessions").select("id,name,started_at,completed_at,duration_seconds,total_volume").eq("user_id", auth.user.id).eq("status", "completed").order("started_at", { ascending: false }).limit(100),
      supabase.from("body_metrics").select("id,date,weight,body_fat,measurements").eq("user_id", auth.user.id).order("date", { ascending: false }).limit(365),
      supabase.from("personal_records").select("id,exercise_name,best_weight_kg,best_reps,estimated_one_rep_max,achieved_at").eq("user_id", auth.user.id).order("estimated_one_rep_max", { ascending: false }).limit(100),
    ]);
    const failed = [sessionResult.error, metricResult.error, recordResult.error].find(Boolean);
    if (failed) setError("Progress data could not be loaded."); else {
      setSessions((sessionResult.data || []) as Session[]); setMetrics((metricResult.data || []) as Metric[]); setRecords((recordResult.data || []) as RecordRow[]);
      const latest = ((metricResult.data || []) as Metric[]).find((row) => row.weight !== null);
      setWeight(latest?.weight == null ? "" : String(latest.weight)); setBodyFat(latest?.body_fat == null ? "" : String(latest.body_fat));
      setError("");
    }
    setLoading(false);
  }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  const thisWeek = useMemo(() => { const start = weekStart(new Date()); return sessions.filter((row) => new Date(row.started_at) >= start); }, [sessions]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => { const date = new Date(weekStart(new Date()).getTime() + i * 86400000); return { key: localDateKey(date), date, count: thisWeek.filter((item) => localDateKey(new Date(item.started_at)) === localDateKey(date)).length }; }), [thisWeek]);
  const filteredMetrics = useMemo(() => range === 0 ? metrics.slice().reverse() : metrics.filter((item) => (today.getTime() - new Date(item.date + "T12:00:00").getTime()) / 86400000 <= range).slice().reverse(), [metrics, range, today]);
  const visibleBodyMetrics = useMemo(() => filteredMetrics.filter((item) => item.weight !== null || item.body_fat !== null || Object.keys(item.measurements || {}).length > 0), [filteredMetrics]);
  const allVolume = sessions.reduce((sum, row) => sum + Number(row.total_volume || 0), 0);
  const avgDuration = sessions.length ? Math.round(sessions.reduce((sum, row) => sum + Number(row.duration_seconds || 0), 0) / sessions.length / 60) : 0;

  async function saveMeasurement(event: FormEvent) {
    event.preventDefault(); const supabase = createClient(); if (!supabase) return;
    const { data: auth } = await supabase.auth.getUser(); if (!auth.user) return setError("Sign in to log your measurements.");
    const parsedWeight = weight.trim() ? Number(weight) : null; const parsedFat = bodyFat.trim() ? Number(bodyFat) : null; const parsedMeasurement = measurement.trim() ? Number(measurement) : null;
    if (parsedWeight !== null && (parsedWeight < 30 || parsedWeight > 500) || parsedFat !== null && (parsedFat < 2 || parsedFat > 80) || parsedMeasurement !== null && (parsedMeasurement < 10 || parsedMeasurement > 300)) return setError("Check your measurement values and try again.");
    if (parsedWeight === null && parsedFat === null && parsedMeasurement === null) return setError("Enter at least one measurement to save.");
    setSaving(true); setError("");
    const values: Record<string, number> = {};
    if (parsedMeasurement !== null) values[measurementName] = parsedMeasurement;
    const result = await supabase.from("body_metrics").insert({ user_id: auth.user.id, date: localDateKey(), weight: parsedWeight, body_fat: parsedFat, measurements: values });
    if (result.error) setError("Your measurement could not be saved."); else { setMeasurement(""); await load(); }
    setSaving(false);
  }

  const visibleSessions = sessions.slice(0, 8);
  return <div className="space-y-5"><PageHeading title="Progress" description="A record of the workouts, body measurements, and personal bests you have logged."/>
    {error && <p role="alert" className="rounded-lg border border-red-400/25 bg-red-400/5 px-4 py-3 text-sm text-red-200">{error}</p>}
    {loading ? <div className="fitx-panel animate-pulse p-8 text-sm text-fitx-text-secondary">Loading your progress…</div> : <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[["Completed workouts", sessions.length, Dumbbell], ["This week", thisWeek.length, CalendarDays], ["Logged volume", `${Math.round(allVolume).toLocaleString()} kg`, Activity], ["Average duration", `${avgDuration} min`, Scale]].map(([label, value, Icon]) => { const StatIcon = Icon as typeof Dumbbell; return <div key={label as string} className="fitx-panel p-4"><StatIcon size={18} className="mb-3 text-fitx-primary"/><p className="text-xl font-semibold">{value as string | number}</p><p className="mt-1 text-xs text-fitx-text-secondary">{label as string}</p></div>; })}</div>
      <section className="fitx-panel p-4 sm:p-5"><div className="mb-4"><h2 className="font-medium">Training frequency</h2><p className="mt-1 text-xs text-fitx-text-secondary">Completed sessions since Monday</p></div><div className="grid h-32 grid-cols-7 gap-2 sm:gap-4">{days.map((day) => { const max = Math.max(1, ...days.map((item) => item.count)); return <div key={day.key} className="flex flex-col items-center justify-end gap-2"><span className="text-[11px] text-fitx-text-secondary">{day.count || ""}</span><div className="flex h-20 w-full max-w-12 items-end rounded-md bg-fitx-surface"><div className="w-full rounded-md bg-fitx-primary/80" style={{ height: day.count ? `${Math.max(12, day.count / max * 100)}%` : "3px" }}/></div><span className="text-[10px] text-fitx-text-disabled">{day.date.toLocaleDateString(undefined, { weekday: "short" })}</span></div>; })}</div></section>
      <div className="grid items-start gap-4 xl:grid-cols-[1fr_1fr]"><section className="fitx-panel p-4 sm:p-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-medium">Body measurements</h2><p className="mt-1 text-xs text-fitx-text-secondary">Values you have added over time</p></div><div className="flex gap-1">{[[30,"30 days"],[90,"90 days"],[365,"1 year"],[0,"All"]].map(([value,label]) => <button key={value} onClick={() => setRange(Number(value))} className={`rounded px-2 py-1 text-[10px] ${range === value ? "bg-fitx-primary/10 text-fitx-primary" : "text-fitx-text-disabled"}`}>{label}</button>)}</div></div>{visibleBodyMetrics.length ? <div className="space-y-2">{visibleBodyMetrics.map((item) => { const values = [item.weight !== null ? `${Number(item.weight).toFixed(1)} kg` : null, item.body_fat !== null ? `${Number(item.body_fat).toFixed(1)}% body fat` : null, ...Object.entries(item.measurements || {}).map(([name, value]) => `${name.replaceAll("_", " ")} ${value} cm`)].filter(Boolean); return <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-fitx-border bg-fitx-surface px-3 py-2.5"><span className="text-xs text-fitx-text-secondary">{new Date(item.date + "T12:00:00").toLocaleDateString()}</span><span className="text-right text-sm capitalize">{values.join(" · ")}</span></div>; })}</div> : <EmptyState title="No body measurements" description="Your weight, body fat, and tape measurements will appear here after you record them."/>}</section>
      <form onSubmit={(event) => void saveMeasurement(event)} className="fitx-panel grid gap-3 p-4 sm:grid-cols-2 sm:p-5"><h2 className="font-medium sm:col-span-2">Log a measurement</h2><label className="text-xs text-fitx-text-secondary">Weight (kg)<input className="fitx-field mt-1.5" type="number" min="30" max="500" step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="Optional"/></label><label className="text-xs text-fitx-text-secondary">Body fat (%)<input className="fitx-field mt-1.5" type="number" min="2" max="80" step="0.1" value={bodyFat} onChange={(e) => setBodyFat(e.target.value)} placeholder="Optional"/></label><label className="text-xs text-fitx-text-secondary">Measurement<select className="fitx-field mt-1.5" value={measurementName} onChange={(e) => setMeasurementName(e.target.value)}>{["waist", "chest", "hips", "arm", "thigh", "neck"].map((name) => <option key={name} value={name} className="capitalize">{name[0].toUpperCase() + name.slice(1)} (cm)</option>)}</select></label><label className="text-xs text-fitx-text-secondary">Size (cm)<input className="fitx-field mt-1.5" type="number" min="10" max="300" step="0.1" value={measurement} onChange={(e) => setMeasurement(e.target.value)} placeholder="Optional"/></label><button disabled={saving} className="fitx-button sm:col-span-2">{saving ? "Saving…" : "Save measurement"}</button></form></div>
      <section className="fitx-panel p-4 sm:p-5"><div className="mb-4 flex items-center gap-2"><Trophy size={17} className="text-fitx-primary"/><div><h2 className="font-medium">Personal records</h2><p className="mt-1 text-xs text-fitx-text-secondary">Best sets recorded from completed workouts</p></div></div>{records.length ? <div className="grid gap-2 sm:grid-cols-2">{records.map((record) => <div key={record.id} className="rounded-lg border border-fitx-border bg-fitx-surface p-3"><p className="text-sm font-medium">{record.exercise_name}</p><p className="mt-1 text-xs text-fitx-text-secondary">{Number(record.best_weight_kg)} kg × {record.best_reps} reps · estimated 1RM {Number(record.estimated_one_rep_max)} kg</p><p className="mt-1 text-[10px] text-fitx-text-disabled">{new Date(record.achieved_at).toLocaleDateString()}</p></div>)}</div> : <EmptyState title="No personal records yet" description="Complete a workout with logged weights and reps to begin building your records."/>}</section>
      <section className="fitx-panel p-4 sm:p-5"><h2 className="mb-3 font-medium">Recent workouts</h2>{visibleSessions.length ? <div className="divide-y divide-fitx-divider">{visibleSessions.map((session) => <div key={session.id} className="flex items-center justify-between gap-4 py-3"><div><p className="text-sm font-medium">{session.name}</p><p className="mt-1 text-xs text-fitx-text-secondary">{new Date(session.started_at).toLocaleDateString()} · {Math.round(session.duration_seconds / 60)} minutes</p></div><span className="shrink-0 text-xs text-fitx-text-secondary">{Math.round(session.total_volume).toLocaleString()} kg</span></div>)}</div> : <EmptyState title="No completed workouts" description="Your completed session history will appear here."/>}</section>
    </>}
  </div>;
}
