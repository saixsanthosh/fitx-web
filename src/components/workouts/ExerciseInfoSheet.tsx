"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { ArrowRight } from "lucide-react";
import { BodyMap } from "@/components/anatomy/BodyMap";
import { EquipmentIcon } from "@/components/equipment/EquipmentIcon";
import { ExerciseDemoPlayer, ExerciseDemoSkeleton } from "@/components/exercises/ExerciseDemoPlayer";
import { createClient, SUPABASE_URL } from "@/lib/supabase/client";
import { exerciseRegions, listRegions } from "@/lib/training/anatomy";
import { equipmentLabel, missingEquipment } from "@/lib/training/equipment";
import { loadExerciseDetail, type ExerciseDetail } from "@/lib/training/exercise-detail";
import { CATEGORY_LABELS, MUSCLE_GROUP_LABELS } from "@/lib/training/taxonomy";
import { Sheet } from "./Sheet";

type Loaded = { status: "found"; detail: ExerciseDetail } | { status: "missing" } | { status: "error" };

/**
 * An exercise's essentials without leaving the plan or the builder: its demonstration, the muscles it trains, the
 * equipment it needs (and what is missing from the member's list), and its written steps as catalogued. The full
 * page is one link away. Text and media come from the exercise library only.
 */
export function ExerciseInfoSheet({ exerciseId, name, owned, listName, fullPageLink = true, onClose }: {
  exerciseId: string;
  /** Offer the exercise's own page (off in the builder, where leaving would lose an unsaved workout). */
  fullPageLink?: boolean;
  /** Shown while the exercise loads. */
  name: string;
  /** The member's equipment where they train (expanded), to flag what is missing; omit to skip the check. */
  owned?: ReadonlySet<string> | null;
  /** "home" or "gym": which list `owned` is. */
  listName?: string;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  const ids = useId();

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    if (!supabase) { void Promise.resolve().then(() => { if (active) setLoaded({ status: "error" }); }); return () => { active = false; }; }
    void loadExerciseDetail(supabase, exerciseId, SUPABASE_URL).then((result) => {
      if (!active) return;
      setLoaded(result.status === "found" ? { status: "found", detail: result.detail } : result.status === "missing" ? { status: "missing" } : { status: "error" });
    });
    return () => { active = false; };
  }, [exerciseId, attempt]);

  const detail = loaded?.status === "found" ? loaded.detail : null;
  const exercise = detail?.exercise;
  const regions = exercise ? exerciseRegions(exercise.primary_muscle, exercise.secondary_muscles) : null;
  const missing = exercise && owned ? missingEquipment(exercise.required_equipment, owned) : [];

  return (
    <Sheet title={exercise?.name ?? name} size="lg" placement="side" onClose={onClose}
      eyebrow="Exercise"
      description={exercise ? `${MUSCLE_GROUP_LABELS[exercise.muscle_group]} · ${CATEGORY_LABELS[exercise.category]} · ${exercise.difficulty[0].toUpperCase()}${exercise.difficulty.slice(1)}` : undefined}
      footer={<>
        <button type="button" onClick={onClose} className="fitx-button fitx-button-quiet min-h-11">Back</button>
        {fullPageLink && <Link href={`/exercises/${encodeURIComponent(exerciseId)}`} className="fitx-button fitx-button-secondary min-h-11">Open full exercise page<ArrowRight size={15} aria-hidden="true" /></Link>}
      </>}>
      {!loaded && <div role="status" aria-label={`Loading ${name}`} className="space-y-4"><ExerciseDemoSkeleton /><div className="h-24 animate-pulse rounded-lg bg-fitx-surface-variant motion-reduce:animate-none" /></div>}
      {loaded?.status === "missing" && <p className="text-sm text-fitx-text-secondary">This exercise is no longer in the library. It may have been removed or merged into a similar movement.</p>}
      {loaded?.status === "error" && <p role="alert" className="fitx-alert">This exercise couldn’t be loaded. Check your connection and try again.<button type="button" className="fitx-alert-action" onClick={() => { setLoaded(null); setAttempt((value) => value + 1); }}>Try again</button></p>}
      {detail && exercise && regions && (
        <div className="space-y-5">
          <ExerciseDemoPlayer key={exercise.id} media={detail.media} name={exercise.name} />
          {detail.description && <p className="text-sm leading-6 text-fitx-text-secondary">{detail.description}</p>}

          <section aria-labelledby={`${ids}-muscles`} className="grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div>
              <h3 id={`${ids}-muscles`} className="text-sm font-semibold">Muscles</h3>
              <p className="mt-1 text-sm text-fitx-text-secondary">{regions.primary.length ? `Mainly ${listRegions(regions.primary).toLowerCase()}` : "Main muscle not mapped on the body map"}{regions.secondary.length ? `; also ${listRegions(regions.secondary).toLowerCase()}.` : "."}</p>
            </div>
            <BodyMap title={`Muscles ${exercise.name} trains`} primary={regions.primary} secondary={regions.secondary} size="sm" legend />
          </section>

          <section aria-labelledby={`${ids}-equipment`}>
            <h3 id={`${ids}-equipment`} className="text-sm font-semibold">Equipment</h3>
            <ul className="mt-2 flex flex-wrap gap-2">
              {exercise.required_equipment.length ? exercise.required_equipment.map((key) => (
                <li key={key} className={`inline-flex min-h-9 items-center gap-2 rounded-lg border px-2.5 text-sm ${missing.includes(key) ? "border-fitx-warning/50 text-fitx-text" : "border-fitx-border text-fitx-text-secondary"}`}>
                  <EquipmentIcon name={key} size={18} />{equipmentLabel(key)}{missing.includes(key) && <span className="text-xs text-fitx-warning">Not on your {listName ?? ""} list</span>}
                </li>
              )) : <li className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-fitx-border px-2.5 text-sm text-fitx-text-secondary"><EquipmentIcon name="none" size={18} />Body weight only</li>}
            </ul>
          </section>

          <section aria-labelledby={`${ids}-steps`}>
            <h3 id={`${ids}-steps`} className="text-sm font-semibold">How to do it</h3>
            {detail.instructions.length
              ? <ol className="mt-3 space-y-3">{detail.instructions.map((step, index) => <li key={`${index}-${step}`} className="flex gap-3 text-sm leading-6 text-fitx-text-secondary"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-sm bg-fitx-surface-variant text-[11px] font-semibold text-fitx-primary-text">{String(index + 1).padStart(2, "0")}</span><span>{step}</span></li>)}</ol>
              : <p className="mt-2 rounded-lg border border-dashed border-fitx-border px-3 py-3 text-sm leading-6 text-fitx-text-secondary">No written steps are recorded for this exercise yet. If the movement is new to you, start light or choose a related movement you know.</p>}
          </section>
          {detail.attribution && <p className="text-[11px] leading-5 text-fitx-text-secondary">Exercise text source: {detail.attribution}.</p>}
        </div>
      )}
    </Sheet>
  );
}
