"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Check, Plus, Target, X } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { PageHeading } from "@/components/app/PageHeading";
import { createClient } from "@/lib/supabase/client";
import { goalPercent } from "@/lib/domain/nutrition";
import { localDateKey } from "@/lib/domain/dates";
import styles from "./Goals.module.css";

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

  const activeCount = items.filter((item) => item.status === "active").length;
  const completedCount = items.filter((item) => item.status === "completed").length;
  const upcomingCount = items.filter((item) => item.status === "active" && item.due_on !== null && item.due_on >= localDateKey()).length;

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

  return <div className={`${styles.page} mx-auto max-w-5xl space-y-5`}><PageHeading title="Goals" description="Set measurable targets and record progress as you go." actions={<span className={styles.activeStatus}><Target size={16} aria-hidden="true"/>{activeCount} active</span>}/>
    {error && <p role="alert" className="fitx-alert fitx-alert-danger">{error}</p>}
    <section className={styles.overview} aria-label="Goal overview"><div><span>Active goals</span><strong>{activeCount}</strong></div><div><span>Completed</span><strong>{completedCount}</strong></div><div><span>Upcoming targets</span><strong>{upcomingCount}</strong></div></section>
    <form onSubmit={createGoal} className={`${styles.goalBuilder} fitx-panel grid gap-3 p-4 sm:grid-cols-2 sm:p-5`}><div className={styles.builderHeading}><span className={styles.eyebrow}>Define your next target</span><h2 className="font-semibold">Create a goal</h2><p>Make the next milestone measurable and personal.</p></div><label className={`${styles.fieldWide} text-xs text-fitx-text-secondary`}>Goal name<input className="fitx-field mt-1.5" required maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="For example, reach a target weight"/></label><label className={`${styles.fieldWide} text-xs text-fitx-text-secondary`}>Category<select className="fitx-field mt-1.5" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{[["fitness", "Fitness"], ["nutrition", "Nutrition"], ["body", "Body"], ["consistency", "Consistency"], ["personal", "Personal"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-xs text-fitx-text-secondary">Target<input className="fitx-field mt-1.5" type="number" min="0.01" step="any" required value={form.target_value} onChange={(e) => setForm({ ...form, target_value: e.target.value })} placeholder="12"/></label><label className="text-xs text-fitx-text-secondary">Unit<input className="fitx-field mt-1.5" maxLength={24} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="workouts, kg, minutes"/></label><label className="text-xs text-fitx-text-secondary">Target date<input className="fitx-field mt-1.5" type="date" min={localDateKey()} value={form.due_on} onChange={(e) => setForm({ ...form, due_on: e.target.value })}/></label><label className="text-xs text-fitx-text-secondary">Starting progress<input className="fitx-field mt-1.5" disabled value="0"/></label><label className={`${styles.fieldWide} text-xs text-fitx-text-secondary sm:col-span-2`}>Notes<textarea className="fitx-field mt-1.5 min-h-20" maxLength={1000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}/></label><div className={`${styles.builderActions} flex justify-end sm:col-span-2`}><button disabled={busy} className="fitx-button"><Plus size={15}/>{busy ? "Saving…" : "Save goal"}</button></div></form>
    <section className={styles.goalSection}><h2 className="mb-3 font-semibold">Your goals</h2>{loading ? <p className="text-sm text-fitx-text-secondary">Loading goals…</p> : items.length ? <div className={styles.goalList}>{items.map((goal) => <article key={goal.id} className={`${styles.goalCard} fitx-panel p-4 sm:p-5`}><div className={styles.goalHeader}><div><p className={styles.goalCategory}>{goal.category}</p><h3 className={styles.goalTitle}>{goal.title}</h3><p className="mt-1 text-xs text-fitx-text-secondary">{goal.due_on ? `Due ${new Date(goal.due_on + "T12:00:00").toLocaleDateString()}` : "No target date"}</p></div><span className={`${styles.status} ${goal.status === "completed" ? styles.completed : ""}`}>{goal.status === "completed" && <Check size={12}/>} {goal.status}</span></div><div className={styles.progressSummary}><span><strong>{Number(goal.current_value).toLocaleString()}</strong><small> / {Number(goal.target_value).toLocaleString()} {goal.unit}</small></span><strong>{goalPercent(Number(goal.current_value), Number(goal.target_value))}%</strong></div><div className={styles.progressTrack} role="progressbar" aria-label={`Progress for ${goal.title}`} aria-valuemin={0} aria-valuemax={Number(goal.target_value)} aria-valuenow={Math.min(Number(goal.current_value), Number(goal.target_value))}><div style={{ width: `${goalPercent(Number(goal.current_value), Number(goal.target_value))}%` }}/></div>{goal.status !== "completed" && <div className={styles.goalActions}><input className="fitx-field h-11 min-w-0 flex-1 sm:max-w-48" type="number" min="0.01" step="any" value={progress[goal.id] || ""} onChange={(e) => setProgress((old) => ({ ...old, [goal.id]: e.target.value }))} placeholder={`Add ${goal.unit || "progress"}`} aria-label={`Progress amount for ${goal.title}`}/><button disabled={busy} onClick={() => void addProgress(goal)} className="fitx-button fitx-button-secondary"><Check size={14}/>Log progress</button><button onClick={() => void changeStatus(goal, goal.status === "paused" ? "active" : "paused")} className="fitx-button fitx-button-secondary">{goal.status === "paused" ? "Resume" : "Pause"}</button><button onClick={() => void changeStatus(goal, "cancelled")} aria-label={`Cancel ${goal.title}`} className="fitx-button fitx-button-quiet"><X size={15}/></button></div>}</article>)}</div> : <EmptyState title="No goals set yet" description="Choose a meaningful target and start building toward your next milestone."/>}</section>
  </div>;
}
