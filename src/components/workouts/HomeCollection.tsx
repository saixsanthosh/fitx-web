"use client";

/**
 * Workouts' Home mode (phase 7): the home exercises the member can do with their home equipment, by body area,
 * as compact photo cards (name, target muscles, equipment). A card opens the exercise's demonstration, muscles
 * and steps in a side sheet, with the AI Form Check entry beside the demonstration. Hovering a card blends to the
 * movement's second photo, so the card previews the movement (opacity only).
 */
import Image from "next/image";
import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { EquipmentIcon } from "@/components/equipment/EquipmentIcon";
import { FormCheckEntry } from "@/components/form-check/FormCheckEntry";
import { MuscleRail } from "@/components/training/MuscleRail";
import { SUPABASE_URL } from "@/lib/supabase/client";
import type { CatalogExercise } from "@/lib/training/catalog";
import { equipmentLabel } from "@/lib/training/equipment";
import { muscleWords } from "@/lib/training/exercise-guide";
import { FOCUS_AREA_INFO, type FocusArea } from "@/lib/training/focus";
import { homeAreaCounts, homeCollection } from "@/lib/training/home-collection";
import { isOptimizableImageUrl, resolveExerciseMedia, type DemoModelKey } from "@/lib/training/media";
import type { Level } from "@/lib/training/taxonomy";
import { cn } from "@/lib/utils";
import { ExerciseInfoSheet } from "./ExerciseInfoSheet";
import styles from "./HomeCollection.module.css";

const PAGE = 12;
const HOME_AREAS: readonly FocusArea[] = ["full_body", "chest", "back", "shoulders", "arms", "abs", "legs", "glutes"];

function musclesLine(exercise: CatalogExercise): string {
  const words = [exercise.primary_muscle, ...exercise.secondary_muscles].map(muscleWords).filter(Boolean);
  const unique = [...new Set(words)];
  return unique.slice(0, 3).map((word) => word[0].toUpperCase() + word.slice(1)).join(" · ");
}

function HomeCard({ exercise, onOpen, index }: { exercise: CatalogExercise; onOpen: () => void; index: number }) {
  const stills = useMemo(() => resolveExerciseMedia({ exerciseId: exercise.id, name: exercise.name, sourceRef: exercise.source_ref, rows: null }).stills, [exercise]);
  const [failed, setFailed] = useState<readonly string[]>([]);
  const shown = stills.filter((still) => !failed.includes(still.url)).slice(0, 2);
  return (
    <li className={styles.cardItem} style={{ "--rise-delay": `${Math.min(index, 8) * 40}ms` } as React.CSSProperties}>
      <button type="button" onClick={onOpen} aria-haspopup="dialog" className={styles.card}>
        <span className={styles.cover} aria-hidden="true">
          {shown.length ? shown.map((still, position) => (
            <Image key={still.url} src={still.url} alt="" fill sizes="(min-width: 1024px) 240px, (min-width: 640px) 30vw, 46vw"
              unoptimized={!isOptimizableImageUrl(still.url, SUPABASE_URL)} className={cn(styles.photo, position === 1 && styles.second)}
              onError={() => setFailed((current) => [...current, still.url])} />
          )) : <span className={styles.noPhoto}><EquipmentIcon name={exercise.required_equipment[0] ?? "none"} size={30} /></span>}
        </span>
        <span className={styles.body}>
          <span className={styles.name}>{exercise.name}</span>
          <span className={styles.muscles}>{musclesLine(exercise)}</span>
          <span className={styles.kit}>
            {exercise.required_equipment.length
              ? exercise.required_equipment.map((key) => <span key={key} className={styles.kitItem}><EquipmentIcon name={key} size={14} />{equipmentLabel(key)}</span>)
              : <span className={styles.kitItem}><EquipmentIcon name="none" size={14} />No equipment</span>}
          </span>
        </span>
      </button>
    </li>
  );
}

export function HomeCollection({ catalog, owned, level, model, onPlan, equipmentSummary, onEditEquipment }: {
  catalog: readonly CatalogExercise[];
  /** The member's home equipment, expanded (expandOwnedEquipment). */
  owned: ReadonlySet<string>;
  level: Level;
  model: DemoModelKey | null;
  /** Builds a home workout (from the chosen area when there is one). */
  onPlan: (area: FocusArea | null) => void;
  /** "Dumbbells, bands" or "No equipment": the list the collection follows. */
  equipmentSummary: string;
  onEditEquipment: () => void;
}) {
  const [area, setArea] = useState<FocusArea | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<CatalogExercise | null>(null);
  const counts = useMemo(() => homeAreaCounts(catalog, owned), [catalog, owned]);
  const items = useMemo(() => homeCollection(catalog, { owned, area, level }), [catalog, owned, area, level]);
  const details = Object.fromEntries(HOME_AREAS.map((key) => [key, `${counts[key].toLocaleString()}`])) as Partial<Record<FocusArea, string>>;
  const shown = items.slice(0, limit);

  return (
    <div className={styles.wrap}>
      <div className={styles.lead}>
        <button type="button" onClick={() => onPlan(area)} className={cn("fitx-button min-h-11", styles.plan)}>
          <Sparkles size={16} aria-hidden="true" />{area ? `Plan a ${FOCUS_AREA_INFO[area].label.toLowerCase()} workout` : "Plan a home workout"}
        </button>
        <FormCheckEntry variant="card" />
      </div>

      <section aria-labelledby="home-areas-title" className="grid grid-cols-1 gap-3">
        <div className="flex min-w-0 items-end justify-between gap-3">
          <h2 id="home-areas-title" className={styles.heading}>Target muscles</h2>
          <button type="button" onClick={onEditEquipment} className={styles.kitLink}>
            <span className="truncate">{equipmentSummary}</span><span className="shrink-0 font-semibold text-fitx-primary-text">Edit</span>
          </button>
        </div>
        <MuscleRail mode="single" bleed={false} label="Home body areas" areas={HOME_AREAS} value={area ? [area] : []} details={details}
          onChange={(next) => { setArea(next[0] ?? null); setLimit(PAGE); }} />
      </section>

      <section aria-labelledby="home-collection-title" className="grid grid-cols-1 gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="home-collection-title" className={styles.heading}>{area ? FOCUS_AREA_INFO[area].label : "Home exercises"}</h2>
          <p className="m-0 text-xs tabular-nums text-fitx-text-secondary" aria-live="polite">{items.length.toLocaleString()} you can do</p>
        </div>
        {items.length ? (
          <ul key={area ?? "all"} className={styles.grid}>
            {shown.map((exercise, index) => <HomeCard key={exercise.id} exercise={exercise} index={index} onOpen={() => setOpen(exercise)} />)}
          </ul>
        ) : (
          <p className={styles.empty}>Nothing for this area fits your home equipment yet. Add equipment, or try another area.</p>
        )}
        {shown.length < items.length && (
          <button type="button" onClick={() => setLimit((value) => value + PAGE)} className="fitx-button fitx-button-secondary min-h-11 justify-self-center">Show more</button>
        )}
      </section>

      {open && (
        <ExerciseInfoSheet exerciseId={open.id} name={open.name} owned={owned} listName="home" model={model}
          extra={<FormCheckEntry variant="inline" exerciseId={open.id} exerciseName={open.name} />} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}
