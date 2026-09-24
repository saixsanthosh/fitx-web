"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Check, Plus, X } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { PageHeading } from "@/components/app/PageHeading";
import { createClient } from "@/lib/supabase/client";
import { localDateKey, weekStart } from "@/lib/domain/dates";

type Event = { id: string; event_type: string; title: string; description: string | null; starts_at: string; ends_at: string | null; status: string; workout_plan_id: string | null };

export default function PlannerPage() {
  const [week, setWeek] = useState(() => weekStart(new Date()));
  const [events, setEvents] = useState<Event[]>([]);
  const [form, setForm] = useState({ title: "", event_type: "workout", date: localDateKey(), time: "18:00", description: "" });
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const endWeek = useMemo(() => new Date(week.getFullYear(), week.getMonth(), week.getDate() + 7), [week]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => new Date(week.getFullYear(), week.getMonth(), week.getDate() + index)), [week]);

  const load = useCallback(async () => {
    const supabase = createClient(); if (!supabase) { setLoading(false); return setError("Planner is not connected to Supabase."); }
    const { data: auth } = await supabase.auth.getUser(); if (!auth.user) { setLoading(false); return setError("Sign in to manage your planner."); }
    const [start, end] = [week.toISOString(), endWeek.toISOString()];
    const result = await supabase.from("planner_events").select("id,event_type,title,description,starts_at,ends_at,status,workout_plan_id").eq("user_id", auth.user.id).neq("status", "cancelled").gte("starts_at", start).lt("starts_at", end).order("starts_at");
    if (result.error) setError("Planner events could not be loaded."); else { setEvents((result.data || []) as Event[]); setError(""); }
    setLoading(false);
  }, [endWeek, week]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  async function createEvent(event: FormEvent) {
    event.preventDefault(); const supabase = createClient(); if (!supabase) return;
    const { data: auth } = await supabase.auth.getUser(); if (!auth.user) return setError("Sign in to schedule an event.");
    const starts = new Date(`${form.date}T${form.time}:00`);
    if (!form.title.trim() || Number.isNaN(starts.getTime())) return setError("Enter a title and a valid date and time.");
    const result = await supabase.from("planner_events").insert({ user_id: auth.user.id, event_type: form.event_type, title: form.title.trim(), description: form.description.trim() || null, starts_at: starts.toISOString(), ends_at: new Date(starts.getTime() + 3600000).toISOString() });
    if (result.error) setError("That event could not be saved."); else { setShowForm(false); setForm((old) => ({ ...old, title: "", description: "" })); await load(); }
  }

  async function updateEvent(item: Event, status: "completed" | "cancelled") {
    const supabase = createClient(); if (!supabase) return;
    const { data: auth } = await supabase.auth.getUser(); if (!auth.user) return;
    const result = await supabase.from("planner_events").update({ status }).eq("id", item.id).eq("user_id", auth.user.id);
    if (result.error) setError("That planner event could not be updated."); else await load();
  }

  function shiftWeek(offset: number) { setWeek((current) => new Date(current.getFullYear(), current.getMonth(), current.getDate() + offset * 7)); }

  return <div className="mx-auto max-w-5xl space-y-5"><PageHeading title="Planner" description="Schedule training and personal events in your week." actions={<button onClick={() => { setForm((old) => ({ ...old, date: localDateKey() })); setShowForm((value) => !value); }} className="fitx-button"><Plus size={15}/>Add event</button>}/>
    {error && <p role="alert" className="rounded-lg border border-red-400/25 bg-red-400/5 px-4 py-3 text-sm text-red-200">{error}</p>}
    {showForm && <form onSubmit={(event) => void createEvent(event)} className="fitx-panel grid gap-3 p-4 sm:grid-cols-2"><h2 className="font-medium sm:col-span-2">Schedule an event</h2><label className="text-xs text-fitx-text-secondary">Event name<input className="fitx-field mt-1.5" maxLength={120} required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Workout, rest day, appointment"/></label><label className="text-xs text-fitx-text-secondary">Type<select className="fitx-field mt-1.5" value={form.event_type} onChange={(e) => setForm({ ...form, event_type: e.target.value })}>{[["workout", "Workout"], ["meal", "Meal"], ["rest", "Rest"], ["goal", "Goal"], ["other", "Other"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-xs text-fitx-text-secondary">Date<input className="fitx-field mt-1.5" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}/></label><label className="text-xs text-fitx-text-secondary">Time<input className="fitx-field mt-1.5" type="time" required value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })}/></label><label className="text-xs text-fitx-text-secondary sm:col-span-2">Notes<input className="fitx-field mt-1.5" maxLength={500} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}/></label><div className="flex justify-end gap-2 sm:col-span-2"><button type="button" onClick={() => setShowForm(false)} className="fitx-button fitx-button-secondary">Cancel</button><button className="fitx-button"><CalendarDays size={15}/>Save event</button></div></form>}
    <div className="fitx-panel p-4 sm:p-5"><div className="mb-4 flex items-center justify-between"><button onClick={() => shiftWeek(-1)} aria-label="Previous week" className="grid h-9 w-9 place-items-center rounded-lg border border-fitx-border text-fitx-text-secondary hover:text-fitx-text"><ArrowLeft size={16}/></button><div className="text-center"><h2 className="font-medium">{week.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – {new Date(endWeek.getTime() - 86400000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</h2><button onClick={() => setWeek(weekStart(new Date()))} className="mt-1 text-xs text-fitx-primary">This week</button></div><button onClick={() => shiftWeek(1)} aria-label="Next week" className="grid h-9 w-9 place-items-center rounded-lg border border-fitx-border text-fitx-text-secondary hover:text-fitx-text"><ArrowRight size={16}/></button></div>
      {loading ? <p className="py-8 text-center text-sm text-fitx-text-secondary">Loading your week…</p> : <div className="space-y-3">{days.map((day) => { const key = localDateKey(day); const daily = events.filter((item) => localDateKey(new Date(item.starts_at)) === key); return <section key={key} className="rounded-lg border border-fitx-border bg-fitx-surface p-3"><div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-medium">{day.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</h3><span className="text-xs text-fitx-text-disabled">{daily.length} event{daily.length === 1 ? "" : "s"}</span></div>{daily.length ? <div className="space-y-2">{daily.map((item) => <div key={item.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-fitx-border bg-[#0b1112] px-3 py-2.5"><span className="w-14 shrink-0 text-xs text-fitx-primary">{new Date(item.starts_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span><div className="min-w-0 flex-1"><p className={`truncate text-sm ${item.status === "completed" ? "text-fitx-text-disabled line-through" : ""}`}>{item.title}</p><p className="text-[11px] capitalize text-fitx-text-disabled">{item.event_type}{item.description ? ` · ${item.description}` : ""}</p></div>{item.status === "scheduled" && <><button onClick={() => void updateEvent(item, "completed")} aria-label="Mark event complete" className="grid h-8 w-8 place-items-center rounded text-fitx-primary hover:bg-fitx-primary/10"><Check size={15}/></button><button onClick={() => void updateEvent(item, "cancelled")} aria-label="Cancel event" className="grid h-8 w-8 place-items-center rounded text-fitx-text-disabled hover:text-red-300"><X size={15}/></button></>}</div>)}</div> : <button onClick={() => { setForm((old) => ({ ...old, date: key })); setShowForm(true); }} className="rounded px-1 py-1 text-xs text-fitx-text-disabled hover:text-fitx-primary">+ Add something</button>}</section>; })}</div>}
      {!loading && events.length === 0 && <div className="mt-4"><EmptyState title="Nothing planned this week" description="Add a workout, meal, rest day, or personal event to start shaping your week." action={<button onClick={() => setShowForm(true)} className="text-sm text-fitx-primary">Add your first event</button>}/></div>}
    </div>
  </div>;
}
