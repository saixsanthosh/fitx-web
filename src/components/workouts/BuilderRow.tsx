"use client";

import type { ReactNode } from "react";
import { ArrowDown, ArrowRightLeft, ArrowUp, Info, X } from "lucide-react";
import type { PlannedExercise } from "@/app/(dashboard)/workouts/_lib/builder-rows";
import { ExerciseThumb } from "@/components/exercises/ExerciseThumb";
import { equipmentLabel, missingEquipment } from "@/lib/training/equipment";
import { MUSCLE_GROUP_LABELS } from "@/lib/training/taxonomy";

export type RowField = "target_sets" | "reps_min" | "reps_max" | "rest_seconds";
export type TargetField = "target_weight_kg" | "target_duration_seconds";

/** A timed row: a target in seconds, or a movement the catalogue prescribes by time. */
export function isTimedPlanned(item: PlannedExercise): boolean {
  return item.target_duration_seconds != null || item.exercise.prescription_type === "time";
}

/** The move buttons: small to keep the row compact, with an invisible 44 × 44 px hit area (bug 77's rule). */
const MOVE_BUTTON = "relative grid h-8 w-9 place-items-center rounded border border-fitx-border before:absolute before:-inset-x-1 before:-inset-y-1.5 before:content-[''] aria-disabled:opacity-35";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid gap-1 text-[11px] text-fitx-text-secondary">{label}{children}</label>;
}

/**
 * One exercise in the workout builder: its position (move earlier or later), photo, name (opens its details),
 * muscle group and missing equipment, what the member did last time, and its sets, reps or time, rest and target
 * load. A timed movement asks for seconds instead of reps.
 */
export function BuilderRow({ item, index, count, owned, listName, showTargets, lastTime, onMove, onUpdate, onUpdateTarget, onSwap, onRemove, onInfo }: {
  item: PlannedExercise;
  index: number;
  count: number;
  owned: ReadonlySet<string>;
  listName: string;
  /** The database can store weight and time targets. */
  showTargets: boolean;
  /** "Last time (12 Nov): best 60 kg × 8", from the member's completed sessions; null when there are none. */
  lastTime?: string | null;
  onMove: (direction: -1 | 1) => void;
  onUpdate: (field: RowField, value: number) => void;
  onUpdateTarget: (field: TargetField, raw: string) => void;
  onSwap: () => void;
  onRemove: () => void;
  onInfo: () => void;
}) {
  const name = item.exercise.name;
  const missing = missingEquipment(item.exercise.required_equipment, owned);
  const timed = isTimedPlanned(item);
  const input = "fitx-field min-h-11 px-2 text-center tabular-nums";
  return (
    <li data-builder-row={index} className="rounded-xl border border-fitx-border bg-fitx-surface p-3">
      <div className="flex items-start gap-3">
        <div className="flex shrink-0 flex-col items-center gap-1">
          {/* 32 × 36 px drawn, 44 × 44 px to touch: the ::before reaches past the edges into the gap and the number. At the
              top or the bottom they stay focusable (aria-disabled): a move there used to disable the pressed button (D5). */}
          <button type="button" onClick={() => { if (index > 0) onMove(-1); }} aria-disabled={index === 0 || undefined} data-builder-control="earlier" aria-label={`Move ${name} earlier`} className={MOVE_BUTTON}><ArrowUp size={14} aria-hidden="true" /></button>
          <span className="text-xs font-semibold tabular-nums text-fitx-text-secondary">{String(index + 1).padStart(2, "0")}</span>
          <button type="button" onClick={() => { if (index < count - 1) onMove(1); }} aria-disabled={index === count - 1 || undefined} data-builder-control="later" aria-label={`Move ${name} later`} className={MOVE_BUTTON}><ArrowDown size={14} aria-hidden="true" /></button>
        </div>
        {/* The photo opens the details too; the name button is the one keyboard stop for it. */}
        <button type="button" onClick={onInfo} tabIndex={-1} aria-hidden="true" className="shrink-0 rounded-xl">
          <ExerciseThumb exerciseId={item.exercise.id} name={name} sourceRef={item.exercise.source_ref} equipment={item.exercise.required_equipment} size="md" />
        </button>
        <div className="min-w-0 flex-1">
          <button type="button" onClick={onInfo} className="inline-flex max-w-full items-start gap-1.5 text-left text-sm font-semibold leading-5 hover:text-fitx-primary-text">
            <span className="min-w-0 break-words">{name}</span><Info size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-fitx-text-secondary" />
          </button>
          <p className="text-xs text-fitx-text-secondary">{MUSCLE_GROUP_LABELS[item.exercise.muscle_group]}{timed ? " · timed" : ""}{item.exercise.required_equipment.length ? ` · ${item.exercise.required_equipment.map(equipmentLabel).join(", ")}` : " · body weight"}</p>
          {missing.length > 0 && <p className="mt-0.5 text-xs text-fitx-warning">Needs {missing.map(equipmentLabel).join(", ").toLowerCase()}, not on your {listName} list</p>}
          {lastTime && <p className="mt-0.5 text-xs text-fitx-text-secondary">{lastTime}</p>}
        </div>
        <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row">
          <button type="button" onClick={onSwap} data-builder-control="swap" aria-label={`Swap ${name}`} className={`grid h-11 w-11 place-items-center rounded border ${missing.length ? "border-fitx-warning/50 text-fitx-warning" : "border-fitx-border text-fitx-text-secondary"} hover:text-fitx-primary`}><ArrowRightLeft size={15} aria-hidden="true" /></button>
          <button type="button" onClick={onRemove} data-builder-control="remove" aria-label={`Remove ${name}`} className="grid h-11 w-11 place-items-center rounded border border-fitx-border text-fitx-text-secondary hover:text-fitx-primary"><X size={15} aria-hidden="true" /></button>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field label="Sets"><input aria-label={`${name} target sets`} className={input} type="number" inputMode="numeric" min="1" max="10" value={item.target_sets} onChange={(event) => onUpdate("target_sets", Number(event.target.value))} /></Field>
        {timed
          ? showTargets && <Field label="Seconds per set"><input aria-label={`${name} target duration in seconds`} className={input} type="number" inputMode="numeric" min="1" max="7200" step="5" value={item.target_duration_seconds ?? ""} onChange={(event) => onUpdateTarget("target_duration_seconds", event.target.value)} placeholder="—" /></Field>
          : <div role="group" aria-label={`${name} reps per set`} className="grid gap-1 text-[11px] text-fitx-text-secondary">
            <span aria-hidden="true">Reps (min – max)</span>
            <div className="flex items-center gap-1">
              <input aria-label={`${name} minimum reps`} className={`${input} w-full min-w-0`} type="number" inputMode="numeric" min="1" max="100" value={item.reps_min} onChange={(event) => onUpdate("reps_min", Number(event.target.value))} />
              <span aria-hidden="true">–</span>
              <input aria-label={`${name} maximum reps`} className={`${input} w-full min-w-0`} type="number" inputMode="numeric" min="1" max="100" value={item.reps_max} onChange={(event) => onUpdate("reps_max", Number(event.target.value))} />
            </div>
          </div>}
        <Field label="Rest (sec)"><input aria-label={`${name} rest seconds`} className={input} type="number" inputMode="numeric" min="15" max="600" step="15" value={item.rest_seconds} onChange={(event) => onUpdate("rest_seconds", Number(event.target.value))} /></Field>
        {showTargets && <Field label="Target kg"><input aria-label={`${name} target weight in kilograms`} className={input} type="number" inputMode="decimal" min="0" max="2000" step="0.5" value={item.target_weight_kg ?? ""} onChange={(event) => onUpdateTarget("target_weight_kg", event.target.value)} placeholder="—" /></Field>}
      </div>
    </li>
  );
}
