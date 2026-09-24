"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Dumbbell, Search } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { PageHeading } from "@/components/app/PageHeading";
import { createClient } from "@/lib/supabase/client";
import type { ExerciseRecord } from "@/lib/domain/workout";

type Exercise = ExerciseRecord & { description: string };

export default function ExerciseLibraryPage() {
  const [items, setItems] = useState<Exercise[]>([]);
  const [search, setSearch] = useState("");
  const [muscle, setMuscle] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialQuery = params.get("q") || "";
    const queryTimer = window.setTimeout(() => setSearch(initialQuery), 0);
    let active = true;
    void (async () => {
      const supabase = createClient();
      if (!supabase) { setLoading(false); setError("The exercise library is not connected to Supabase."); return; }
      const result = await supabase.from("exercise_library").select("id,name,description,primary_muscle,secondary_muscles,equipment,locations,difficulty,movement_pattern,recommended_sets,reps_min,reps_max,rest_seconds,alternatives").eq("is_active", true).order("name").limit(300);
      if (!active) return;
      if (result.error) setError("The exercise library could not be loaded."); else setItems((result.data || []) as Exercise[]);
      setLoading(false);
    })();
    return () => { active = false; window.clearTimeout(queryTimer); };
  }, []);
  const muscles = useMemo(() => [...new Set(items.map((item) => item.primary_muscle))].sort(), [items]);
  const filtered = useMemo(() => {
    const value = search.trim().toLowerCase();
    return items.filter((item) => (muscle === "all" || item.primary_muscle === muscle) && (!value || [item.name, item.description, item.primary_muscle, ...item.secondary_muscles].some((part) => part.toLowerCase().includes(value))));
  }, [items, search, muscle]);
  return <div className="space-y-5"><PageHeading title="Exercise library" description={`${items.length} movements with instructions, equipment, and suggested sets.`} actions={<Link href="/workouts" className="fitx-button fitx-button-secondary">Workout plans<ArrowRight size={15}/></Link>}/>
    {error && <p role="alert" className="rounded-lg border border-red-400/25 bg-red-400/5 px-4 py-3 text-sm text-red-200">{error}</p>}
    <div className="fitx-panel flex flex-col gap-3 p-3 sm:flex-row"><label className="relative min-w-0 flex-1"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fitx-text-disabled"/><input className="fitx-field pl-10" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search movements or muscles" aria-label="Search exercises"/></label><select className="fitx-field sm:max-w-56" value={muscle} onChange={(event) => setMuscle(event.target.value)} aria-label="Filter by muscle"><option value="all">All muscle groups</option>{muscles.map((name) => <option key={name} value={name} className="capitalize">{name.replaceAll("_", " ")}</option>)}</select></div>
    {loading ? <p className="py-10 text-center text-sm text-fitx-text-secondary">Loading exercise library…</p> : filtered.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{filtered.map((item) => <Link key={item.id} href={`/exercises/${item.id}`} className="fitx-panel block p-4 transition-colors hover:border-fitx-primary/30"><div className="mb-3 flex items-start justify-between gap-3"><span className="grid h-10 w-10 place-items-center rounded-lg bg-fitx-primary/10 text-fitx-primary"><Dumbbell size={18}/></span><span className="rounded-full border border-fitx-border px-2 py-1 text-[10px] capitalize text-fitx-text-secondary">{item.difficulty}</span></div><h2 className="font-medium">{item.name}</h2><p className="mt-1 line-clamp-2 text-xs leading-5 text-fitx-text-secondary">{item.description}</p><div className="mt-3 flex flex-wrap gap-1.5"><span className="rounded bg-fitx-surface px-2 py-1 text-[10px] capitalize text-fitx-primary">{item.primary_muscle.replaceAll("_", " ")}</span>{item.equipment.slice(0, 2).map((equipment) => <span key={equipment} className="rounded bg-fitx-surface px-2 py-1 text-[10px] capitalize text-fitx-text-disabled">{equipment.replaceAll("_", " ")}</span>)}</div><p className="mt-3 text-xs text-fitx-text-disabled">{item.recommended_sets} sets · {item.reps_min}–{item.reps_max} reps · {item.rest_seconds}s rest</p></Link>)}</div> : <EmptyState title="No matching exercises" description={loading ? "The exercise library is loading." : "Try another search or choose a different muscle group."}/ >}
  </div>;
}
