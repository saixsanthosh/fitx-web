"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { ArrowRight, CalendarDays, ChevronRight, Pencil } from "lucide-react";
import { BodyMap } from "@/components/anatomy/BodyMap";
import { EquipmentIcon } from "@/components/equipment/EquipmentIcon";
import { ExerciseThumb } from "@/components/exercises/ExerciseThumb";
import { StatStrip } from "@/components/training/StatStrip";
import { readableDate } from "@/lib/domain/dates";
import { createClient } from "@/lib/supabase/client";
import { exerciseRegions, listRegions, type RegionKey } from "@/lib/training/anatomy";
import type { CatalogExercise } from "@/lib/training/catalog";
import { equipmentLabel, missingEquipment } from "@/lib/training/equipment";
import { survivingExerciseId } from "@/lib/training/exercise-merges";
import { FREE_EXERCISE_DB_ATTRIBUTION, FREE_EXERCISE_DB_LICENSE, freeExerciseDbRef } from "@/lib/training/media";
import { contextForLocation, planEquipment, planSummary, restLabel, rowPrescription } from "@/lib/training/plan-summary";
import { loadPlanPreview, type PlanDetails, type PlanExerciseRow, type PlanLastSession } from "@/lib/training/plans";
import type { TrainingContext } from "@/lib/training/taxonomy";
import { ExerciseInfoSheet } from "./ExerciseInfoSheet";
import { Sheet } from "./Sheet";

/** The plan preview's data: loading, failed, gone, or the plan with its exercises and latest completed session. */
export type PlanPreviewLoaded =
  | { status: "loading" }
  | { status: "error" }
  | { status: "missing" }
  | { status: "ready"; plan: PlanDetails; rows: PlanExerciseRow[]; lastSession: PlanLastSession | null };

/** The programme a plan belongs to, when it is the one the member follows. */
export type PreviewProgramme = { enrolmentId: string; title: string; dayCount: number; dayTitles: readonly string[]; paused: boolean };

function dayLabel(key: string | null, todayKey: string): string {
  if (!key) return "No date set";
  if (key === todayKey) return "Today";
  return readableDate(new Date(`${key}T12:00:00`), { weekday: "long", month: "short", day: "numeric" });
}

/**
 * A planned workout before it starts: its heading (name, programme day, date), a summary (exercises, sets and an
 * estimated time), what it needs, every exercise in order with its photo, sets × reps or time, target load, rest
 * and equipment, and a Begin workout button. Each exercise opens its details. Used for the member's own plans and
 * for programme days; Home, the week view and To-Do links open it first.
 */
export function PlanPreviewSheet({ planId, userId, includeTargets, ...view }: Omit<PlanPreviewProps, "loaded" | "onRetry"> & {
  planId: string;
  userId: string;
  includeTargets: boolean;
}) {
  const [loaded, setLoaded] = useState<PlanPreviewLoaded>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    void (async () => {
      if (!supabase) { if (active) setLoaded({ status: "error" }); return; }
      const result = await loadPlanPreview(supabase, userId, planId, includeTargets);
      if (!active) return;
      if (result.error) setLoaded({ status: "error" });
      else if (!result.plan) setLoaded({ status: "missing" });
      else setLoaded({ status: "ready", plan: result.plan, rows: result.rows, lastSession: result.lastSession });
    })();
    return () => { active = false; };
  }, [planId, userId, includeTargets, attempt]);

  return <PlanPreview {...view} loaded={loaded} onRetry={() => { setLoaded({ status: "loading" }); setAttempt((value) => value + 1); }} />;
}

type PlanPreviewProps = {
  loaded: PlanPreviewLoaded;
  /** Loads the plan again after a failure. */
  onRetry: () => void;
  catalog: readonly CatalogExercise[];
  /** The member's equipment for a context, expanded. */
  ownedFor: (context: TrainingContext) => ReadonlySet<string>;
  todayKey: string;
  /** The followed programme, to name a programme day; null for other plans. */
  programme: PreviewProgramme | null;
  activeSession: { id: string; name: string } | null;
  starting: boolean;
  /** Starts the workout; resolves with a message when it could not. */
  onBegin: (planId: string, title: string) => Promise<string | null>;
  /** Opens the plan in the builder. */
  onEdit?: (planId: string) => void;
  onClose: () => void;
};

/** The preview itself, from loaded data (PlanPreviewSheet loads it). */
export function PlanPreview({ loaded, onRetry, catalog, ownedFor, todayKey, programme, activeSession, starting, onBegin, onEdit, onClose }: PlanPreviewProps) {
  const ids = useId();
  const [info, setInfo] = useState<CatalogExercise | null>(null);
  const [beginError, setBeginError] = useState("");

  const byId = useMemo(() => new Map(catalog.map((exercise) => [exercise.id, exercise])), [catalog]);
  const ready = loaded.status === "ready" ? loaded : null;
  const plan = ready?.plan ?? null;
  const context = contextForLocation(plan?.workout_location);
  const owned = ownedFor(context);
  const rows = ready?.rows ?? [];
  const exercises = rows.map((row) => (row.exercise_id ? byId.get(survivingExerciseId(row.exercise_id)) ?? null : null));
  const summary = planSummary(rows);
  const equipment = planEquipment(exercises, owned);
  const muscles = workoutMuscles(exercises);

  // A programme day is single-use: once a session of it is completed it is done. A plan of the member's own can be repeated.
  const programmeDay = plan?.programme_enrolment_id != null;
  const ownProgramme = programmeDay && programme && plan?.programme_enrolment_id === programme.enrolmentId ? programme : null;
  const done = programmeDay && Boolean(ready?.lastSession);
  const pausedDay = Boolean(ownProgramme?.paused);
  const dayIndex = plan?.programme_day_index ?? null;
  const eyebrow = !plan ? "Workout" : programmeDay
    ? dayIndex === null ? "Programme day" : ownProgramme ? `Day ${dayIndex + 1} of ${ownProgramme.dayCount} · ${ownProgramme.title}` : `Programme day ${dayIndex + 1}`
    : "Your plan";
  const photos = exercises.some((exercise) => exercise && freeExerciseDbRef(exercise.id, exercise.source_ref));

  async function begin() {
    if (!plan) return;
    setBeginError("");
    const message = await onBegin(plan.id, plan.title);
    if (message) setBeginError(message);
  }

  const footer = !ready ? undefined : (
    <div className="w-full space-y-2">
      {beginError && <p role="alert" className="fitx-alert fitx-alert-danger">{beginError}</p>}
      {activeSession
        ? <p className="text-xs text-fitx-text-secondary">You have a workout in progress ({activeSession.name}). Finish it before you begin another.</p>
        : done ? <p className="text-xs text-fitx-text-secondary">{ready.lastSession ? `You did this day ${doneLabel(localKey(ready.lastSession.started_at), todayKey)}.` : "You did this day."} Each programme day counts once; the next one is on your programme card.</p>
          : pausedDay ? <p className="text-xs text-fitx-text-secondary">Your programme is paused. Resume it to train its days.</p> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onEdit && !done && !activeSession && <button type="button" onClick={() => onEdit(ready.plan.id)} className="fitx-button fitx-button-secondary min-h-11"><Pencil size={15} aria-hidden="true" />Edit plan</button>}
        {done && ready.lastSession && <Link href={`/workouts/history/${ready.lastSession.id}`} className="fitx-button fitx-button-secondary min-h-11">View workout record<ArrowRight size={15} aria-hidden="true" /></Link>}
        {activeSession
          ? <Link href={`/workouts/active?session=${activeSession.id}`} className="fitx-button min-h-12 sm:min-w-56">Continue current workout<ArrowRight size={16} aria-hidden="true" /></Link>
          : !done && <button type="button" onClick={() => void begin()} disabled={starting || pausedDay || !rows.length} className="fitx-button min-h-12 text-base sm:min-w-56">{starting ? "Starting…" : "Begin workout"}<ArrowRight size={17} aria-hidden="true" /></button>}
      </div>
    </div>
  );

  return (
    <>
      <Sheet title={plan?.title ?? "Workout"} size="lg" placement="side" onClose={onClose} eyebrow={eyebrow}
        description={plan ? <span className="inline-flex items-center gap-1.5"><CalendarDays size={14} aria-hidden="true" />{dayLabel(plan.planned_for, todayKey)} · {context === "home" ? "Home" : "Gym"}</span> : undefined}
        footer={footer}>
        {loaded.status === "loading" && <PreviewSkeleton />}
        {loaded.status === "error" && <p role="alert" className="fitx-alert">This workout couldn’t be loaded. Check your connection and try again.<button type="button" className="fitx-alert-action" onClick={onRetry}>Try again</button></p>}
        {loaded.status === "missing" && <p className="text-sm text-fitx-text-secondary">This plan is no longer in your list. It may have been deleted, or the programme it belonged to was left.</p>}
        {ready && (
          <div className="space-y-5">
            <StatStrip label="This workout" stats={[
              { label: "Exercises", value: summary.exercises },
              { label: "Sets", value: summary.totalSets, note: "Planned" },
              { label: "Time", value: summary.estimateMinutes, unit: "min", estimate: true },
            ]} estimateNote="≈ estimate: worked out from the sets, reps, time and rest in this plan, not measured." />

            {rows.length > 0 && (
              <section aria-labelledby={`${ids}-needs`}>
                <h3 id={`${ids}-needs`} className="text-sm font-semibold">You’ll need</h3>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {equipment.bodyWeightOnly && <li className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-fitx-border px-2.5 text-sm text-fitx-text-secondary"><EquipmentIcon name="none" size={18} />Body weight only</li>}
                  {equipment.keys.map((key) => {
                    const missing = equipment.missing.includes(key);
                    return <li key={key} className={`inline-flex min-h-9 items-center gap-2 rounded-lg border px-2.5 text-sm ${missing ? "border-fitx-warning/50 text-fitx-text" : "border-fitx-border text-fitx-text-secondary"}`}><EquipmentIcon name={key} size={18} />{equipmentLabel(key)}{missing && <span className="text-xs text-fitx-warning">Not on your {context} list</span>}</li>;
                  })}
                </ul>
                {equipment.unknown > 0 && <p className="mt-2 text-xs text-fitx-text-secondary">{equipment.unknown === 1 ? "One exercise is" : `${equipment.unknown} exercises are`} no longer in the library, so {equipment.unknown === 1 ? "its" : "their"} equipment isn’t listed.</p>}
              </section>
            )}

            <section aria-labelledby={`${ids}-order`}>
              <h3 id={`${ids}-order`} className="text-sm font-semibold">Exercises <span className="font-normal text-fitx-text-secondary">· in order</span></h3>
              {rows.length ? (
                <ol className="mt-2 space-y-2">
                  {rows.map((row, index) => {
                    const exercise = exercises[index];
                    const rest = restLabel(row.rest_seconds);
                    const missing = exercise ? missingEquipment(exercise.required_equipment, owned) : [];
                    const body = (
                      <>
                        <span className="w-6 shrink-0 text-center text-xs font-semibold tabular-nums text-fitx-text-secondary">{index + 1}</span>
                        <ExerciseThumb exerciseId={exercise?.id ?? row.exercise_id ?? row.id} name={exercise?.name ?? row.exercise_name} sourceRef={exercise?.source_ref ?? null} equipment={exercise?.required_equipment ?? []} size="md" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold leading-5">{exercise?.name ?? row.exercise_name}</span>
                          <span className="mt-0.5 block text-sm tabular-nums text-fitx-text">{rowPrescription(row)}</span>
                          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fitx-text-secondary">
                            {rest && <span>{rest}</span>}
                            {exercise && <span className="inline-flex items-center gap-1">{exercise.required_equipment.length ? exercise.required_equipment.map((key) => <EquipmentIcon key={key} name={key} size={16} title={equipmentLabel(key)} />) : <EquipmentIcon name="none" size={16} title="Body weight" />}</span>}
                            {!exercise && <span>No longer in the library</span>}
                          </span>
                          {missing.length > 0 && <span className="mt-1 block text-xs text-fitx-warning">Needs {missing.map(equipmentLabel).join(", ").toLowerCase()}, not on your {context} list</span>}
                        </span>
                      </>
                    );
                    return (
                      <li key={row.id}>
                        {exercise
                          ? <button type="button" onClick={() => setInfo(exercise)} className="flex w-full items-center gap-3 rounded-xl border border-fitx-border bg-fitx-surface p-2.5 text-left transition-colors hover:border-fitx-primary/40 motion-reduce:transition-none">{body}<ChevronRight size={16} aria-hidden="true" className="shrink-0 text-fitx-text-secondary" /></button>
                          : <div className="flex items-center gap-3 rounded-xl border border-fitx-border bg-fitx-surface p-2.5">{body}</div>}
                      </li>
                    );
                  })}
                </ol>
              ) : <p className="mt-2 rounded-lg border border-dashed border-fitx-border px-3 py-3 text-sm text-fitx-text-secondary">This plan has no exercises yet.{onEdit ? " Edit it to add some." : ""}</p>}
            </section>

            {(muscles.primary.length > 0 || muscles.secondary.length > 0) && (
              <section aria-labelledby={`${ids}-muscles`} className="grid items-center gap-3 rounded-xl border border-fitx-border p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div>
                  <h3 id={`${ids}-muscles`} className="text-sm font-semibold">Muscles this workout trains</h3>
                  <p className="mt-1 text-sm text-fitx-text-secondary">{muscles.primary.length ? `Mainly ${listRegions(muscles.primary).toLowerCase()}.` : ""}{muscles.secondary.length ? ` Also ${listRegions(muscles.secondary).toLowerCase()}.` : ""}</p>
                  <p className="mt-1 text-xs text-fitx-text-secondary">From the exercises’ catalogue muscles. Your training record counts only the sets you complete.</p>
                </div>
                <BodyMap title="Muscles this workout trains" primary={muscles.primary} secondary={muscles.secondary} size="sm" legend />
              </section>
            )}
            {photos && <p className="text-[11px] leading-5 text-fitx-text-secondary">Photos: {FREE_EXERCISE_DB_ATTRIBUTION}. Licence: {FREE_EXERCISE_DB_LICENSE}.</p>}
          </div>
        )}
      </Sheet>
      {info && <ExerciseInfoSheet exerciseId={info.id} name={info.name} owned={owned} listName={context} onClose={() => setInfo(null)} />}
    </>
  );
}

/** The regions the exercises train: their primary muscles, and the secondary ones that are not primary anywhere. */
function workoutMuscles(exercises: ReadonlyArray<CatalogExercise | null>): { primary: RegionKey[]; secondary: RegionKey[] } {
  const primary = new Set<RegionKey>();
  const secondary = new Set<RegionKey>();
  for (const exercise of exercises) {
    if (!exercise) continue;
    const regions = exerciseRegions(exercise.primary_muscle, exercise.secondary_muscles);
    regions.primary.forEach((region) => primary.add(region));
    regions.secondary.forEach((region) => secondary.add(region));
  }
  return { primary: [...primary], secondary: [...secondary].filter((region) => !primary.has(region)) };
}

function doneLabel(key: string, todayKey: string): string {
  return key === todayKey ? "today" : `on ${readableDate(new Date(`${key}T12:00:00`), { weekday: "long", month: "short", day: "numeric" })}`;
}

function localKey(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function PreviewSkeleton() {
  return (
    <div role="status" aria-label="Loading the workout" className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{[0, 1, 2].map((item) => <div key={item} className="h-20 animate-pulse rounded-xl bg-fitx-surface-variant motion-reduce:animate-none" />)}</div>
      {[0, 1, 2, 3].map((item) => <div key={item} className="flex items-center gap-3 rounded-xl border border-fitx-border p-2.5"><div className="h-16 w-16 animate-pulse rounded-xl bg-fitx-surface-variant motion-reduce:animate-none" /><div className="flex-1 space-y-2"><div className="h-3 w-1/2 animate-pulse rounded bg-fitx-surface-variant motion-reduce:animate-none" /><div className="h-3 w-1/3 animate-pulse rounded bg-fitx-surface-variant motion-reduce:animate-none" /></div></div>)}
    </div>
  );
}
