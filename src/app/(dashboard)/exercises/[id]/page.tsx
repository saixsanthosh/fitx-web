"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Dumbbell, Info } from "lucide-react";
import { useParams } from "next/navigation";
import { EmptyState } from "@/components/app/EmptyState";
import { PageHeading } from "@/components/app/PageHeading";
import { createClient } from "@/lib/supabase/client";

type Exercise = { id: string; name: string; description: string; primary_muscle: string; secondary_muscles: string[]; equipment: string[]; locations: string[]; difficulty: string; movement_pattern: string; instructions: string[]; recommended_sets: number; reps_min: number; reps_max: number; rest_seconds: number; alternatives: string[]; attribution: string };

export default function ExerciseDetailPage() {
  const params = useParams<{ id: string }>(); const id = params.id;
  const [item, setItem] = useState<Exercise | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void (async () => {
      const supabase = createClient();
      if (!supabase) { setLoading(false); setError("Exercise information is unavailable."); return; }
      const result = await supabase.from("exercise_library").select("id,name,description,primary_muscle,secondary_muscles,equipment,locations,difficulty,movement_pattern,instructions,recommended_sets,reps_min,reps_max,rest_seconds,alternatives,attribution").eq("id", id).maybeSingle();
      if (!active) return;
      if (result.error || !result.data) setError("This exercise could not be found."); else setItem(result.data as Exercise);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [id]);
  if (loading) return <div className="fitx-panel animate-pulse p-8 text-sm text-fitx-text-secondary">Loading exercise…</div>;
  if (error || !item) return <EmptyState title="Exercise unavailable" description={error} action={<Link href="/exercises" className="fitx-button fitx-button-secondary"><ArrowLeft size={15}/>Exercise library</Link>}/>;
  return <div className="mx-auto max-w-3xl space-y-5"><Link href="/exercises" className="inline-flex items-center gap-2 text-sm text-fitx-text-secondary hover:text-fitx-text"><ArrowLeft size={15}/>Exercise library</Link><PageHeading title={item.name} description={item.description}/>
    <section className="fitx-panel p-4 sm:p-6"><div className="mb-5 flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-fitx-primary/10 text-fitx-primary"><Dumbbell size={20}/></span><div><p className="capitalize text-sm">{item.primary_muscle.replaceAll("_", " ")}{item.secondary_muscles.length ? ` · ${item.secondary_muscles.map((value) => value.replaceAll("_", " ")).join(", ")}` : ""}</p><p className="mt-1 text-xs capitalize text-fitx-text-secondary">{item.difficulty} · {item.movement_pattern.replaceAll("_", " ")}</p></div></div><div className="grid grid-cols-2 gap-3"><div className="rounded-lg bg-fitx-surface p-3"><p className="text-xs text-fitx-text-disabled">Suggested sets</p><p className="mt-1 text-sm">{item.recommended_sets} · {item.reps_min}–{item.reps_max} reps</p></div><div className="rounded-lg bg-fitx-surface p-3"><p className="text-xs text-fitx-text-disabled">Rest</p><p className="mt-1 text-sm">{item.rest_seconds} seconds</p></div><div className="rounded-lg bg-fitx-surface p-3"><p className="text-xs text-fitx-text-disabled">Equipment</p><p className="mt-1 text-sm capitalize">{item.equipment.length ? item.equipment.join(", ").replaceAll("_", " ") : "None"}</p></div><div className="rounded-lg bg-fitx-surface p-3"><p className="text-xs text-fitx-text-disabled">Suitable location</p><p className="mt-1 text-sm capitalize">{item.locations.join(", ")}</p></div></div><h2 className="mb-3 mt-6 font-medium">Instructions</h2><ol className="space-y-3">{item.instructions.map((instruction, index) => <li key={index} className="flex gap-3 text-sm leading-6 text-fitx-text-secondary"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-fitx-primary/10 text-xs text-fitx-primary">{index + 1}</span>{instruction}</li>)}</ol><div className="mt-5 flex items-start gap-2 rounded-lg border border-fitx-border p-3 text-xs leading-5 text-fitx-text-disabled"><Info size={14} className="mt-0.5 shrink-0"/>Movement guidance is general. Use a range of motion you can control and adjust equipment to your experience.</div>{item.alternatives.length > 0 && <div className="mt-5"><h2 className="mb-2 font-medium">Alternatives in the library</h2><div className="flex flex-wrap gap-2">{item.alternatives.map((alternative) => <Link key={alternative} href={`/exercises/${alternative}`} className="rounded-lg border border-fitx-border px-3 py-2 text-xs text-fitx-text-secondary hover:border-fitx-primary/35 hover:text-fitx-text">{alternative.replaceAll("_", " ")}</Link>)}</div></div>}</section>
    <Link href="/workouts" className="fitx-button">Add this to a workout plan</Link>
  </div>;
}
