"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Check, Plus, Target, X } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { PageHeading } from "@/components/app/PageHeading";
import { createClient } from "@/lib/supabase/client";
import { goalPercent } from "@/lib/domain/nutrition";
import { localDateKey } from "@/lib/domain/dates";

type Goal = { id: string; title: string; category: string; metric: string; target_value: number; current_value: number; unit: string; due_on: string | null; status: string; notes: string | null };
const blank = { title: "", category: "fitness", metric: "manual", target_value: "", unit: "", due_on: "", notes: "" };

export default function GoalsPage() {
  const [items, setItems] = useState<Goal[]>([]);
  const [form, setForm] = useState(blank);
  const [progress, setProgress] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const supabase = createClient();
    if (!supabase) { setLoading(false); return setError("Goals are not connected to Supabase."); }
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setLoading(false); return setError("Sign in to manage goals."); }
    const result = await supabase.from("goals").select("id,title,category,metric,target_value,current_value,unit,due_on,status,notes").eq("user_id", auth.user.id).in("status", ["active", "paused", "completed"]).order("created_at", { ascending: false });
    if (result.error) setError("Your goals could not be loaded."); else { setItems((result.data || []) as Goal[]); setError(""); }
    setLoading(false);
  }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  async function createGoal(event: FormEvent) {
    event.preventDefault(); const supabase = createClient(); if (!supabase) return;
    const { data: auth } = await supabase.auth.getUser(); if (!auth.user) return setError("Sign in to create a goal.");
    if (!form.title.trim() || Number(form.target_value) <= 0) return setError("Enter a goal name and a target greater than zero.");
    setBusy(true); setError("");
    const result = await supabase.from("goals").insert({ user_id: auth.user.id, ...form, title: form.title.trim(), target_value: Number(form.target_value), current_value: 0, due_on: form.due_on || null, notes: form.notes || null, starts_on: localDateKey() });
    if (result.error) setError("Your goal could not be saved."); else { setForm(blank); await load(); }
    setBusy(false);
  }

  async function addProgress(goal: Goal) {
    const amount = Number(progress[goal.id]);
    if (!Number.isFinite(amount) || amount <= 0) return setError("Enter a progress amount greater than zero.");
    const supabase = createClient(); if (!supabase) return;
    const { data: auth } = await supabase.auth.getUser(); if (!auth.user) return setError("Sign in to update this goal.");
    setBusy(true); setError("");
    const total = Number(goal.current_value) + amount;
    const logged = await supabase.from("goal_progress_entries").insert({ user_id: auth.user.id, goal_id: goal.id, amount });
    if (!logged.error) {
      const updated = await supabase.from("goals").update({ current_value: total, status: total >= Number(goal.target_value) ? "completed" : goal.status, updated_at: new Date().toISOString() }).eq("id", goal.id).eq("user_id", auth.user.id);
      if (updated.error) setError("Progress was recorded, but the goal total did not update. Refresh the page.");
      else setProgress((old) => ({ ...old, [goal.id]: "" }));
    } else setError("Progress could not be saved.");
    await load(); setBusy(false);
  }

  async function changeStatus(goal: Goal, status: string) {
    const supabase = createClient(); if (!supabase) return;
    const { data: auth } = await supabase.auth.getUser(); if (!auth.user) return;
    const result = await supabase.from("goals").update({ status, updated_at: new Date().toISOString() }).eq("id", goal.id).eq("user_id", auth.user.id);
    if (result.error) setError("That goal could not be updated."); else await load();
  }

  return <div className="mx-auto max-w-4xl space-y-5"><PageHeading title="Goals" description="Set measurable targets and record progress as you go." actions={<span className="flex items-center gap-2 text-xs text-fitx-text-secondary"><Target size={16} className="text-fitx-primary"/>{items.filter((item) => item.status === "active").length} active</span>}/>
    {error && <p role="alert" className="rounded-lg border border-red-400/25 bg-red-400/5 px-4 py-3 text-sm text-red-200">{error}</p>}
    <form onSubmit={createGoal} className="fitx-panel grid gap-3 p-4 sm:grid-cols-2 sm:p-5"><h2 className="font-medium sm:col-span-2">Create a goal</h2><label className="text-xs text-fitx-text-secondary">Goal name<input className="fitx-field mt-1.5" required maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="For example, reach a target weight"/></label><label className="text-xs text-fitx-text-secondary">Category<select className="fitx-field mt-1.5" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{[["fitness", "Fitness"], ["nutrition", "Nutrition"], ["body", "Body"], ["consistency", "Consistency"], ["personal", "Personal"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-xs text-fitx-text-secondary">Target<input className="fitx-field mt-1.5" type="number" min="0.01" step="any" required value={form.target_value} onChange={(e) => setForm({ ...form, target_value: e.target.value })} placeholder="12"/></label><label className="text-xs text-fitx-text-secondary">Unit<input className="fitx-field mt-1.5" maxLength={24} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="workouts, kg, minutes"/></label><label className="text-xs text-fitx-text-secondary">Target date<input className="fitx-field mt-1.5" type="date" min={localDateKey()} value={form.due_on} onChange={(e) => setForm({ ...form, due_on: e.target.value })}/></label><label className="text-xs text-fitx-text-secondary">Starting progress<input className="fitx-field mt-1.5" disabled value="0"/></label><label className="text-xs text-fitx-text-secondary sm:col-span-2">Notes<textarea className="fitx-field mt-1.5 min-h-20" maxLength={1000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}/></label><div className="flex justify-end sm:col-span-2"><button disabled={busy} className="fitx-button"><Plus size={15}/>{busy ? "Saving…" : "Save goal"}</button></div></form>
    <section className="space-y-3"><h2 className="font-medium">Your goals</h2>{loading ? <p className="text-sm text-fitx-text-secondary">Loading goals…</p> : items.length ? items.map((goal) => <article key={goal.id} className="fitx-panel p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium">{goal.title}</p><p className="mt-1 text-xs capitalize text-fitx-text-secondary">{goal.category}{goal.due_on ? ` · Due ${new Date(goal.due_on + "T12:00:00").toLocaleDateString()}` : ""}</p></div><span className={`rounded-full px-2.5 py-1 text-[11px] capitalize ${goal.status === "completed" ? "bg-fitx-primary/10 text-fitx-primary" : "bg-fitx-surface text-fitx-text-secondary"}`}>{goal.status}</span></div><div className="mt-4 flex items-end justify-between gap-2 text-xs"><span>{Number(goal.current_value).toLocaleString()} / {Number(goal.target_value).toLocaleString()} {goal.unit}</span><span className="text-fitx-text-secondary">{goalPercent(Number(goal.current_value), Number(goal.target_value))}%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-[#253032]"><div className="h-full rounded-full bg-fitx-primary" style={{ width: `${goalPercent(Number(goal.current_value), Number(goal.target_value))}%` }}/></div>{goal.status !== "completed" && <div className="mt-4 flex flex-wrap gap-2"><input className="fitx-field h-10 max-w-40" type="number" min="0.01" step="any" value={progress[goal.id] || ""} onChange={(e) => setProgress((old) => ({ ...old, [goal.id]: e.target.value }))} placeholder={`Add ${goal.unit || "progress"}`}/><button disabled={busy} onClick={() => void addProgress(goal)} className="fitx-button fitx-button-secondary"><Check size={14}/>Log progress</button><button onClick={() => void changeStatus(goal, goal.status === "paused" ? "active" : "paused")} className="fitx-button fitx-button-secondary">{goal.status === "paused" ? "Resume" : "Pause"}</button><button onClick={() => void changeStatus(goal, "cancelled")} aria-label="Cancel goal" className="fitx-button fitx-button-quiet"><X size={15}/></button></div>}</article>) : <EmptyState title="No goals set yet" description="Create a goal above to keep track of a target that matters to you."/>}</section>
  </div>;
}
