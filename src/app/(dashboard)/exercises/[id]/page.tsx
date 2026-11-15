"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Info } from "lucide-react";
import { useParams } from "next/navigation";
import { EmptyState } from "@/components/app/EmptyState";
import { PageHeading } from "@/components/app/PageHeading";
import { ExerciseMovementFrames } from "@/components/exercises/ExerciseMedia";
import { rememberExercise } from "@/lib/domain/exercise-preferences";
import { createClient } from "@/lib/supabase/client";

type Exercise = { id: string; name: string; description: string; primary_muscle: string; secondary_muscles: string[]; equipment: string[]; locations: string[]; difficulty: string; movement_pattern: string; instructions: string[]; recommended_sets: number; reps_min: number; reps_max: number; rest_seconds: number; alternatives: string[]; attribution: string | null };
type Alternative = { id: string; name: string; primary_muscle: string };
type ExerciseHistory = { id: string; started_at: string; completedSets: number; topSet: string };
const readable = (value: string) => value.replaceAll("_", " ");

export default function ExerciseDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [item, setItem] = useState<Exercise | null>(null);
  const [alternatives, setAlternatives] = useState<Alternative[]>([]);
  const [history, setHistory] = useState<ExerciseHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      const supabase = createClient();
      if (!supabase) { setLoading(false); setError("Exercise information is unavailable in this environment."); return; }
      const [auth, result] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from("exercise_library").select("id,name,description,primary_muscle,secondary_muscles,equipment,locations,difficulty,movement_pattern,instructions,recommended_sets,reps_min,reps_max,rest_seconds,alternatives,attribution").eq("id", id).eq("is_active", true).maybeSingle(),
      ]);
      if (!active) return;
      if (result.error || !result.data) { setError("This exercise could not be found."); setLoading(false); return; }
      const exercise = result.data as Exercise;
      setItem(exercise);
      setHistory([]);
      if (auth.data.user) {
        const userId = auth.data.user.id;
        rememberExercise(userId, exercise.id);
        const sessionExerciseResult = await supabase.from("workout_session_exercises").select("id,session_id,created_at").eq("user_id", userId).eq("exercise_id", exercise.id).order("created_at", { ascending: false }).limit(12);
        if (active && !sessionExerciseResult.error && sessionExerciseResult.data?.length) {
          const loggedRows = sessionExerciseResult.data as Array<{ id: string; session_id: string; created_at: string }>;
          const sessionsResult = await supabase.from("workout_sessions").select("id,started_at").eq("user_id", userId).eq("status", "completed").in("id", [...new Set(loggedRows.map((row) => row.session_id))]).order("started_at", { ascending: false }).limit(8);
          if (active && !sessionsResult.error && sessionsResult.data?.length) {
            const completedSessions = sessionsResult.data as Array<{ id: string; started_at: string }>;
            const completedExerciseRows = loggedRows.filter((row) => completedSessions.some((session) => session.id === row.session_id));
            const setResult = await supabase.from("workout_sets").select("session_exercise_id,reps,weight_kg,duration_seconds,completed_at").eq("user_id", userId).in("session_exercise_id", completedExerciseRows.map((row) => row.id)).not("completed_at", "is", null);
            if (active && !setResult.error) {
              const loggedSets = (setResult.data || []) as Array<{ session_exercise_id: string; reps: number | null; weight_kg: number; duration_seconds: number | null; completed_at: string | null }>;
              setHistory(completedSessions.flatMap((session) => {
                const movementIds = completedExerciseRows.filter((row) => row.session_id === session.id).map((row) => row.id);
                const sets = loggedSets.filter((set) => movementIds.includes(set.session_exercise_id) && (Number(set.reps) > 0 || Number(set.duration_seconds) > 0));
                if (!sets.length) return [];
                const lifted = sets.filter((set) => Number(set.reps) > 0);
                if (lifted.length) {
                  const best = lifted.reduce((winner, set) => Number(set.weight_kg) > Number(winner.weight_kg) || (Number(set.weight_kg) === Number(winner.weight_kg) && Number(set.reps) > Number(winner.reps)) ? set : winner);
                  return [{ id: session.id, started_at: session.started_at, completedSets: sets.length, topSet: Number(best.weight_kg) > 0 ? `${Number(best.weight_kg)} kg × ${best.reps}` : `${best.reps} reps` }];
                }
                const maxDuration = Math.max(...sets.map((set) => Number(set.duration_seconds || 0)));
                return [{ id: session.id, started_at: session.started_at, completedSets: sets.length, topSet: `${maxDuration}s timed` }];
              }));
            }
          }
        }
      }
      if (exercise.alternatives?.length) {
        const related = await supabase.from("exercise_library").select("id,name,primary_muscle").in("id", exercise.alternatives).eq("is_active", true).limit(8);
        if (active) setAlternatives((related.data || []) as Alternative[]);
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [id]);

  if (loading) return <div className="fitx-panel animate-pulse p-8 text-sm text-fitx-text-secondary">Loading exercise…</div>;
  if (error || !item) return <EmptyState title="Exercise unavailable" description={error} action={<Link href="/exercises" className="fitx-button fitx-button-secondary"><ArrowLeft size={15} />Exercise library</Link>} />;

  return (
    <div className="mx-auto max-w-6xl space-y-5 sm:space-y-6">
      <Link href="/exercises" className="inline-flex min-h-10 items-center gap-2 text-sm text-fitx-text-secondary hover:text-fitx-text"><ArrowLeft size={15} />Exercise library</Link>
      <PageHeading title={item.name} description={item.description} actions={<Link href={`/workouts?exercise=${encodeURIComponent(item.id)}`} className="fitx-button">Add to a workout<ArrowRight size={15} /></Link>} />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,.85fr)] lg:gap-5">
        <ExerciseMovementFrames exerciseId={item.id} name={item.name} />
        <section className="fitx-panel p-4 sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-[.14em] text-fitx-primary">Exercise profile</p>
          <p className="mt-2 capitalize text-sm font-medium">{readable(item.primary_muscle)}</p>
          {item.secondary_muscles.length > 0 && <p className="mt-1 text-xs capitalize text-fitx-text-secondary">Also involved: {item.secondary_muscles.map(readable).join(", ")}</p>}
          <div className="mt-4 flex flex-wrap gap-1.5">{[item.difficulty, readable(item.movement_pattern), ...item.locations.map(readable)].filter(Boolean).map((value) => <span key={value} className="rounded-sm border border-fitx-border px-2 py-1 text-[10px] capitalize text-fitx-text-secondary">{value}</span>)}</div>
          <div className="mt-5 grid grid-cols-2 gap-2 border-y border-fitx-divider py-3">
            <div><p className="text-[10px] uppercase tracking-[.1em] text-fitx-text-disabled">Suggested sets</p><p className="mt-1 text-sm font-medium">{item.recommended_sets} sets</p></div>
            <div><p className="text-[10px] uppercase tracking-[.1em] text-fitx-text-disabled">Rep range</p><p className="mt-1 text-sm font-medium">{item.reps_min}–{item.reps_max}</p></div>
            <div><p className="text-[10px] uppercase tracking-[.1em] text-fitx-text-disabled">Rest guide</p><p className="mt-1 text-sm font-medium">{item.rest_seconds} sec</p></div>
            <div><p className="text-[10px] uppercase tracking-[.1em] text-fitx-text-disabled">Equipment</p><p className="mt-1 text-sm font-medium capitalize">{item.equipment.length ? item.equipment.map(readable).join(", ") : "Not specified"}</p></div>
          </div>
          <div className="mt-4"><h2 className="text-sm font-semibold">Movement instructions</h2><ol className="mt-3 space-y-3">{item.instructions.map((instruction, index) => <li key={`${index}-${instruction}`} className="flex gap-3 text-sm leading-6 text-fitx-text-secondary"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-sm bg-fitx-surface-variant text-[11px] font-semibold text-fitx-primary">{String(index + 1).padStart(2, "0")}</span><span>{instruction}</span></li>)}</ol></div>
          <div className="mt-4 flex items-start gap-2 border-t border-fitx-divider pt-3 text-xs leading-5 text-fitx-text-disabled"><Info size={14} className="mt-0.5 shrink-0 text-fitx-primary" />General guidance only. Use a controlled range of motion, adjust the load to your experience, and stop if movement causes pain.</div>
        </section>
      </div>

      {alternatives.length > 0 && <section className="border-t border-fitx-divider pt-4"><div className="mb-3"><h2 className="text-sm font-semibold">Related movements</h2><p className="mt-1 text-xs text-fitx-text-secondary">Other exercises linked in this catalog record.</p></div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{alternatives.map((alternative) => <Link key={alternative.id} href={`/exercises/${alternative.id}`} className="fitx-panel flex min-h-14 items-center justify-between gap-3 px-3 py-3 text-sm hover:border-fitx-primary/35"><span className="min-w-0"><span className="block truncate font-medium">{alternative.name}</span><span className="mt-1 block capitalize text-[11px] text-fitx-text-disabled">{readable(alternative.primary_muscle)}</span></span><ArrowRight size={15} className="shrink-0 text-fitx-primary" /></Link>)}</div></section>}
      <section className="border-t border-fitx-divider pt-4"><div className="mb-3"><h2 className="text-sm font-semibold">Your recent sessions</h2><p className="mt-1 text-xs text-fitx-text-secondary">Completed workout records for this movement.</p></div>{history.length ? <div className="fitx-panel divide-y divide-fitx-divider px-4">{history.map((row) => <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><div><p className="font-medium">{new Date(row.started_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</p><p className="mt-1 text-xs text-fitx-text-disabled">{row.completedSets} completed sets</p></div><span className="text-xs font-semibold tabular-nums text-fitx-primary">Top set · {row.topSet}</span></div>)}</div> : <p className="rounded-lg border border-fitx-border px-4 py-4 text-sm text-fitx-text-secondary">No completed sets for this movement yet. Your history will appear here after you log one.</p>}</section>
      {item.attribution && <p className="text-[10px] leading-5 text-fitx-text-disabled">Source: {item.attribution}. Exercise imagery is attributed to the pinned Free Exercise DB source listed above.</p>}
    </div>
  );
}
