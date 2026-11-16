"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Check, Plus, X } from "lucide-react";
import { PageHeading } from "@/components/app/PageHeading";
import { createClient } from "@/lib/supabase/client";
import { localDateKey, weekStart } from "@/lib/domain/dates";
import styles from "./Planner.module.css";

type Event = { id: string; event_type: string; title: string; description: string | null; starts_at: string; ends_at: string | null; status: string; workout_plan_id: string | null };

function PlannerDayCard({ day, daily, selected, today, onSelect, onAdd, onUpdate }: { day: Date; daily: Event[]; selected: boolean; today: boolean; onSelect: () => void; onAdd: () => void; onUpdate: (item: Event, status: "completed" | "cancelled") => void }) {
  return <article className={`${styles.dayCard} ${selected ? styles.selectedDay : ""} ${today ? styles.todayDay : ""}`}>
    <button type="button" className={styles.dayHeader} aria-pressed={selected} onClick={onSelect}>
      <span className={styles.dayName}>{day.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase()}</span>
      <strong className={styles.dayDate}>{day.toLocaleDateString(undefined, { day: "2-digit" })}</strong>
      <span className={styles.dayMeta}>{today ? "Today" : day.toLocaleDateString(undefined, { month: "short" })}</span>
    </button>
    <div className={styles.eventRows}>
      {daily.length ? daily.map((item) => <div key={item.id} className={`${styles.eventRow} ${item.status === "completed" ? styles.completedEvent : ""}`}>
        <span className={styles.eventTime}>{new Date(item.starts_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
        <span className={styles.eventMarker} aria-hidden="true"/>
        <span className={styles.eventCopy}><strong>{item.title}</strong><small>{item.event_type}{item.description ? ` · ${item.description}` : ""}</small></span>
        {item.status === "scheduled" && <span className={styles.eventActions}><button type="button" onClick={() => onUpdate(item, "completed")} aria-label={`Mark ${item.title} complete`}><Check size={14}/></button><button type="button" onClick={() => onUpdate(item, "cancelled")} aria-label={`Cancel ${item.title}`}><X size={14}/></button></span>}
      </div>) : <p className={styles.emptyDay}>No events</p>}
    </div>
    <button type="button" className={styles.addInline} onClick={onAdd}>+ Add something</button>
  </article>;
}

export default function PlannerPage() {
  const [week, setWeek] = useState(() => weekStart(new Date()));
  const [events, setEvents] = useState<Event[]>([]);
  const [selectedDayKey, setSelectedDayKey] = useState(() => localDateKey());
  const [form, setForm] = useState({ title: "", event_type: "workout", date: localDateKey(), time: "18:00", description: "" });
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const endWeek = useMemo(() => new Date(week.getFullYear(), week.getMonth(), week.getDate() + 7), [week]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => new Date(week.getFullYear(), week.getMonth(), week.getDate() + index)), [week]);
  const selectedDay = days.find((day) => localDateKey(day) === selectedDayKey) ?? days[0];
  const todayKey = localDateKey();
  const eventsByDate = useMemo(() => {
    const grouped = new Map<string, Event[]>();
    for (const item of events) {
      const key = localDateKey(new Date(item.starts_at));
      const existing = grouped.get(key);
      if (existing) existing.push(item); else grouped.set(key, [item]);
    }
    return grouped;
  }, [events]);
  const plannedDays = new Set(events.map((item) => localDateKey(new Date(item.starts_at)))).size;
  const workoutEvents = events.filter((item) => item.event_type === "workout").length;
  const mealEvents = events.filter((item) => item.event_type === "meal").length;

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

  function shiftWeek(offset: number) { const next = new Date(week.getFullYear(), week.getMonth(), week.getDate() + offset * 7); setWeek(next); setSelectedDayKey(localDateKey(next)); }

  return (
    <div className={styles.page + " mx-auto max-w-6xl space-y-5"}>
      <PageHeading title="Planner" description="Schedule training and personal events in your week." actions={<button onClick={() => { setForm((old) => ({ ...old, date: localDateKey(selectedDay) })); setShowForm((value) => !value); }} className="fitx-button"><Plus size={15}/>Add event</button>}/>
      {error && <p role="alert" className="fitx-alert fitx-alert-danger">{error}</p>}
      {showForm && <form onSubmit={(event) => void createEvent(event)} className={styles.eventForm + " fitx-panel grid gap-3 p-4 sm:grid-cols-2"}>
        <div className={styles.formHeading}><span>Plan ahead</span><h2>Schedule an event</h2></div>
        <label className={`${styles.fieldWide} text-xs text-fitx-text-secondary`}>Event name<input className="fitx-field mt-1.5" maxLength={120} required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Workout, rest day, appointment"/></label>
        <label className={`${styles.fieldWide} text-xs text-fitx-text-secondary`}>Type<select className="fitx-field mt-1.5" value={form.event_type} onChange={(e) => setForm({ ...form, event_type: e.target.value })}>{[["workout", "Workout"], ["meal", "Meal"], ["rest", "Rest"], ["goal", "Goal"], ["other", "Other"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="text-xs text-fitx-text-secondary">Date<input className="fitx-field mt-1.5" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}/></label>
        <label className="text-xs text-fitx-text-secondary">Time<input className="fitx-field mt-1.5" type="time" required value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })}/></label>
        <label className={`${styles.fieldWide} text-xs text-fitx-text-secondary sm:col-span-2`}>Notes<input className="fitx-field mt-1.5" maxLength={500} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}/></label>
        <div className={styles.formActions}><button type="button" onClick={() => setShowForm(false)} className="fitx-button fitx-button-secondary">Cancel</button><button className="fitx-button"><CalendarDays size={15}/>Save event</button></div>
      </form>}
      <section className={styles.weekSection} aria-label="Weekly planner">
        <div className={styles.weekHeader}>
          <button onClick={() => shiftWeek(-1)} aria-label="Previous week" className={styles.weekArrow}><ArrowLeft size={16}/></button>
          <div className={styles.weekTitle}>
            <p>YOUR TRAINING WEEK</p>
            <h2>{week.toLocaleDateString(undefined, { month: "short", day: "numeric" })} <span>—</span> {new Date(endWeek.getTime() - 86400000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</h2>
            <button onClick={() => { const today = weekStart(new Date()); setWeek(today); setSelectedDayKey(localDateKey()); }} className={styles.thisWeek}>This week</button>
          </div>
          <button onClick={() => shiftWeek(1)} aria-label="Next week" className={styles.weekArrow}><ArrowRight size={16}/></button>
        </div>
        {!loading && events.length > 0 && <div className={styles.weekOverview} aria-label="Week overview"><div><span>Events</span><strong>{events.length}</strong></div><div><span>Workouts</span><strong>{workoutEvents}</strong></div><div><span>Meals</span><strong>{mealEvents}</strong></div><div><span>Days planned</span><strong>{plannedDays}</strong></div></div>}
        {loading ? <p className={styles.loadingWeek}>Loading your week…</p> : <>
          <div className={styles.desktopWeek}>
            {days.map((day) => {
              const key = localDateKey(day);
              return <PlannerDayCard key={key} day={day} daily={eventsByDate.get(key) ?? []} selected={key === selectedDayKey} today={key === todayKey} onSelect={() => setSelectedDayKey(key)} onAdd={() => { setForm((old) => ({ ...old, date: key })); setShowForm(true); }} onUpdate={(item, status) => void updateEvent(item, status)}/>;
            })}
          </div>
          <div className={styles.mobilePlanner}>
            <div className={styles.daySelector} role="group" aria-label="Choose a day">
              {days.map((day) => {
                const key = localDateKey(day);
                const stateClass = (key === localDateKey(selectedDay) ? " " + styles.dayChoiceSelected : "") + (key === todayKey ? " " + styles.dayChoiceToday : "");
                return <button key={key} type="button" aria-pressed={key === localDateKey(selectedDay)} aria-label={day.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} className={styles.dayChoice + stateClass} onClick={() => setSelectedDayKey(key)}><span>{day.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase()}</span><strong>{day.toLocaleDateString(undefined, { day: "numeric" })}</strong></button>;
              })}
            </div>
            <PlannerDayCard day={selectedDay} daily={eventsByDate.get(localDateKey(selectedDay)) ?? []} selected={true} today={localDateKey(selectedDay) === todayKey} onSelect={() => undefined} onAdd={() => { setForm((old) => ({ ...old, date: localDateKey(selectedDay) })); setShowForm(true); }} onUpdate={(item, status) => void updateEvent(item, status)}/>
          </div>
        </>}
        {!loading && events.length === 0 && <div className={styles.weekEmpty}><span className={styles.emptyMarker} aria-hidden="true"/><div><strong>Nothing planned this week</strong><p>Start shaping your week with a workout, meal, rest day, or personal event.</p></div><button onClick={() => { setForm((old) => ({ ...old, date: localDateKey(selectedDay) })); setShowForm(true); }} className="fitx-button fitx-button-secondary">Add your first event<ArrowRight size={15}/></button></div>}
      </section>
    </div>
  );
}
