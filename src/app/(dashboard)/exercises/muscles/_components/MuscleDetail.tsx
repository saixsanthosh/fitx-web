"use client";

import Link from "next/link";
import { ArrowRight, CalendarDays, Check, ClipboardList, Layers, TriangleAlert } from "lucide-react";
import { EquipmentIcon } from "@/components/equipment/EquipmentIcon";
import { needsText } from "@/components/exercises/discovery/ExerciseResultCard";
import { ExerciseThumb } from "@/components/exercises/ExerciseThumb";
import { Tabs } from "@/components/ui/Tabs";
import { REGIONS, type RegionKey } from "@/lib/training/anatomy";
import type { RankedExercise } from "@/lib/training/catalog-search";
import { equipmentLabel } from "@/lib/training/equipment";
import { FOCUS_AREA_INFO, focusAreasForRegion, focusLabel } from "@/lib/training/focus";
import { muscleNote } from "@/lib/training/muscle-notes";
import { MUSCLE_GROUP_LABELS } from "@/lib/training/taxonomy";
import { shortDate, type RegionExercises } from "../_lib/muscle-exercises";
import type { PlanMatch, ProgrammeMatch } from "../_lib/muscle-workouts";

export type TrainingFigures =
  | { status: "signed-out" | "loading" | "error" }
  | {
    status: "ready";
    week: { primary: number; secondary: number };
    fourWeeks: { primary: number; secondary: number };
    /** "Today", "3 days ago", a date; null when no counted set exists in what was read. */
    lastTrained: string | null;
    /** True when only the newest sessions were read (so "never" cannot be claimed). */
    truncated: boolean;
  };

export type WorkoutLists =
  | { status: "loading" | "error" }
  | { status: "ready"; plans: PlanMatch[]; programmes: ProgrammeMatch[]; plansFailed: boolean };

const SHOWN_PRIMARY = 8;
const SHOWN_ASSISTING = 5;
const SHOWN_PLANS = 5;
const capitalise = (value: string) => (value ? value[0].toUpperCase() + value.slice(1) : value);

function joinWords(words: readonly string[]): string {
  return words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

function setsText(figures: { primary: number; secondary: number }): string {
  if (!figures.primary && !figures.secondary) return "No sets";
  const direct = `${figures.primary} direct ${figures.primary === 1 ? "set" : "sets"}`;
  return figures.secondary ? `${direct} · ${figures.secondary} assisting` : direct;
}

function ExerciseRow({ item }: { item: RankedExercise }) {
  const { exercise, doable, missing } = item;
  const equipment = exercise.required_equipment;
  return (
    <li>
      <Link href={`/exercises/${encodeURIComponent(exercise.id)}`}
        className="flex min-h-14 items-center gap-3 rounded-xl border border-fitx-border bg-fitx-card p-2 pr-3 transition-colors hover:bg-fitx-hover motion-reduce:transition-none">
        <ExerciseThumb exerciseId={exercise.id} name={exercise.name} sourceRef={exercise.source_ref} equipment={equipment} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-fitx-text">{exercise.name}</span>
          {doable === false ? (
            <span className="mt-0.5 flex items-center gap-1 text-xs text-fitx-warning"><TriangleAlert size={12} aria-hidden="true" className="shrink-0" /><span className="truncate">Needs: {needsText(missing)}</span></span>
          ) : (
            <span className="mt-0.5 block truncate text-xs text-fitx-text-secondary">{capitalise(exercise.difficulty)} · {equipment.length ? equipment.map(equipmentLabel).join(", ") : "No equipment"}</span>
          )}
        </span>
        {doable === true && <span className="flex shrink-0 items-center gap-1 text-xs text-fitx-success"><Check size={13} aria-hidden="true" /><span className="hidden sm:inline">You can do this</span><span className="sr-only sm:hidden">You can do this</span></span>}
        {equipment[0] && doable !== true && <EquipmentIcon name={equipment[0]} size={20} className="shrink-0 text-fitx-text-secondary" />}
      </Link>
    </li>
  );
}

function ExerciseLists({ region, exercises, libraryHref }: { region: RegionKey; exercises: RegionExercises | null; libraryHref: string }) {
  if (!exercises) return <p className="m-0 text-sm text-fitx-text-secondary" role="status">Loading exercises…</p>;
  const label = REGIONS[region].label.toLowerCase();
  if (!exercises.primary.length && !exercises.assisting.length) {
    return <p className="m-0 text-sm text-fitx-text-secondary">No exercise in the library lists the {label} yet.</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-5">
      <section aria-labelledby="region-primary">
        <h3 id="region-primary" className="m-0 text-sm font-semibold">Main muscle <span className="font-normal text-fitx-text-secondary">· {exercises.primary.length}</span></h3>
        {exercises.primary.length ? (
          <ul className="m-0 mt-2 grid list-none grid-cols-1 gap-2 p-0">{exercises.primary.slice(0, SHOWN_PRIMARY).map((item) => <ExerciseRow key={item.exercise.id} item={item} />)}</ul>
        ) : <p className="m-0 mt-1.5 text-sm text-fitx-text-secondary">No exercise lists the {label} as its main muscle.</p>}
        {exercises.primary.length > 0 && (
          <Link href={libraryHref} className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-fitx-primary-text">
            See all {exercises.primary.length} in the library<ArrowRight size={14} aria-hidden="true" />
          </Link>
        )}
      </section>
      {exercises.assisting.length > 0 && (
        <section aria-labelledby="region-assisting">
          <h3 id="region-assisting" className="m-0 text-sm font-semibold">Also works it <span className="font-normal text-fitx-text-secondary">· {exercises.assisting.length}</span></h3>
          <p className="m-0 mt-0.5 text-xs text-fitx-text-secondary">The {label} assist the main muscle in these.</p>
          <ul className="m-0 mt-2 grid list-none grid-cols-1 gap-2 p-0">{exercises.assisting.slice(0, SHOWN_ASSISTING).map((item) => <ExerciseRow key={item.exercise.id} item={item} />)}</ul>
        </section>
      )}
    </div>
  );
}

function WorkoutListsPanel({ region, workouts }: { region: RegionKey; workouts: WorkoutLists }) {
  if (workouts.status !== "ready") {
    return workouts.status === "loading"
      ? <p className="m-0 text-sm text-fitx-text-secondary" role="status">Loading workouts…</p>
      : <p className="m-0 text-sm text-fitx-text-secondary">Workouts could not be loaded. Check your connection and try again.</p>;
  }
  const area = focusAreasForRegion(region)[0] ?? null;
  const label = REGIONS[region].label.toLowerCase();
  return (
    <div className="grid grid-cols-1 gap-5">
      <section aria-labelledby="region-plans">
        <h3 id="region-plans" className="m-0 flex items-center gap-1.5 text-sm font-semibold"><ClipboardList size={15} aria-hidden="true" />Your plans</h3>
        {workouts.plansFailed ? (
          <p className="m-0 mt-1.5 text-sm text-fitx-text-secondary">Your plans could not be loaded right now.</p>
        ) : workouts.plans.length ? (
          <ul className="m-0 mt-2 grid list-none grid-cols-1 gap-2 p-0">
            {workouts.plans.slice(0, SHOWN_PLANS).map((match) => (
              <li key={match.plan.id}>
                <Link href={`/workouts?plan=${encodeURIComponent(match.plan.id)}`} className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-fitx-border bg-fitx-card px-3 py-2 transition-colors hover:bg-fitx-hover motion-reduce:transition-none">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-fitx-text">{match.plan.title}</span>
                    <span className="mt-0.5 block truncate text-xs text-fitx-text-secondary">
                      {match.primary.length ? `${joinWords(match.primary.slice(0, 2))}${match.primary.length > 2 ? ` and ${match.primary.length - 2} more` : ""}` : `Assisting: ${joinWords(match.assisting.slice(0, 2))}`}
                    </span>
                  </span>
                  {match.plan.planned_for && <span className="flex shrink-0 items-center gap-1 text-xs text-fitx-text-secondary"><CalendarDays size={12} aria-hidden="true" />{shortDate(match.plan.planned_for)}</span>}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 mt-1.5 text-sm text-fitx-text-secondary">None of your saved plans works the {label} yet.</p>
        )}
        {area && (
          <Link href={`/workouts?focus=${area}`} className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-fitx-primary-text">
            Build a {focusLabel(area).toLowerCase()} workout<ArrowRight size={14} aria-hidden="true" />
          </Link>
        )}
      </section>
      <section aria-labelledby="region-programmes">
        <h3 id="region-programmes" className="m-0 flex items-center gap-1.5 text-sm font-semibold"><Layers size={15} aria-hidden="true" />FITX programmes</h3>
        {workouts.programmes.length ? (
          <ul className="m-0 mt-2 grid list-none grid-cols-1 gap-2 p-0">
            {workouts.programmes.map((match) => (
              <li key={match.programme.id} className="rounded-xl border border-fitx-border bg-fitx-card px-3 py-2.5">
                <p className="m-0 text-sm font-semibold text-fitx-text">{match.programme.title}</p>
                <ul className="m-0 mt-1 grid list-none gap-0.5 p-0 text-xs text-fitx-text-secondary">
                  {match.days.map((day) => (
                    <li key={day.key}><span className="font-medium text-fitx-text">{day.title}</span>{day.direct ? ` · ${day.slots.join(", ")}` : ` · trains your ${MUSCLE_GROUP_LABELS[REGIONS[region].group].toLowerCase()}`}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 mt-1.5 text-sm text-fitx-text-secondary">No FITX programme has a day for the {label}.</p>
        )}
        {workouts.programmes.length > 0 && (
          <Link href="/workouts" className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-fitx-primary-text">See programmes on Workouts<ArrowRight size={14} aria-hidden="true" /></Link>
        )}
      </section>
    </div>
  );
}

/** Everything about one muscle: what it is and does, the member's training of it, exercises and workouts. */
export function MuscleDetail({ region, training, exercises, workouts, libraryHref }: {
  region: RegionKey;
  training: TrainingFigures;
  exercises: RegionExercises | null;
  workouts: WorkoutLists;
  libraryHref: string;
}) {
  const info = REGIONS[region];
  const note = muscleNote(region);
  const areas = focusAreasForRegion(region);
  return (
    <div className="grid min-w-0 grid-cols-1 gap-5">
      <div className="min-w-0">
        <p className="m-0 text-xs font-semibold uppercase tracking-[.13em] text-fitx-primary-text">{areas.length ? `Part of ${joinWords(areas.map((area) => FOCUS_AREA_INFO[area].label.toLowerCase()))}` : MUSCLE_GROUP_LABELS[info.group]}</p>
        <h2 id="muscle-detail-title" tabIndex={-1} className="m-0 mt-1 text-2xl font-bold tracking-tight text-fitx-text outline-none">{info.label}</h2>
        <p className="m-0 mt-0.5 text-sm italic text-fitx-text-secondary">{note.anatomy}</p>
        <p className="m-0 mt-3 text-[15px] leading-6 text-fitx-text">{note.role}</p>
      </div>

      <section aria-labelledby="your-training" className="rounded-xl border border-fitx-border bg-fitx-surface p-3.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="your-training" className="m-0 text-sm font-semibold">Your training</h3>
          <Link href="/progress/muscles" className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-fitx-primary-text">All muscles in Progress<ArrowRight size={13} aria-hidden="true" /></Link>
        </div>
        {training.status === "signed-out" && <p className="m-0 text-sm text-fitx-text-secondary">Sign in to see the sets you have done for it.</p>}
        {training.status === "loading" && <p className="m-0 text-sm text-fitx-text-secondary" role="status">Loading your training…</p>}
        {training.status === "error" && <p className="m-0 text-sm text-fitx-text-secondary">Your training could not be loaded. Check your connection and try again.</p>}
        {training.status === "ready" && (training.week.primary + training.week.secondary + training.fourWeeks.primary + training.fourWeeks.secondary > 0 || training.lastTrained ? (
          <dl className="m-0 grid gap-x-4 gap-y-2 sm:grid-cols-3">
            <div><dt className="text-xs text-fitx-text-secondary">This week</dt><dd className="m-0 text-sm font-semibold tabular-nums">{setsText(training.week)}</dd></div>
            <div><dt className="text-xs text-fitx-text-secondary">Last 4 weeks</dt><dd className="m-0 text-sm font-semibold tabular-nums">{setsText(training.fourWeeks)}</dd></div>
            <div><dt className="text-xs text-fitx-text-secondary">Last trained</dt><dd className="m-0 text-sm font-semibold">{training.lastTrained ?? (training.truncated ? "Not in your recent workouts" : "Not yet")}</dd></div>
          </dl>
        ) : (
          <p className="m-0 text-sm text-fitx-text-secondary">No completed sets for the {info.label.toLowerCase()} yet. Sets you tick off in a finished workout count here.</p>
        ))}
        {training.status === "ready" && <p className="m-0 mt-2 text-[11px] leading-4 text-fitx-text-secondary">From sets you completed in finished FITX workouts. A direct set has this as the exercise’s main muscle; an assisting set works it as a secondary muscle.</p>}
      </section>

      <Tabs
        label={`${info.label}: exercises and workouts`}
        tabs={[
          { id: "exercises", label: "Exercises", badge: exercises ? exercises.primary.length : undefined, content: <ExerciseLists region={region} exercises={exercises} libraryHref={libraryHref} /> },
          { id: "workouts", label: "Workouts", content: <WorkoutListsPanel region={region} workouts={workouts} /> },
        ]}
      />
    </div>
  );
}
