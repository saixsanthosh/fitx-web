"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { EquipmentIcon } from "@/components/equipment/EquipmentIcon";
import { ExerciseAlternatives } from "@/components/exercises/ExerciseAlternatives";
import { createClient } from "@/lib/supabase/client";
import type { CatalogExercise } from "@/lib/training/catalog";
import { equipmentFor, loadCatalog, ownedEquipmentSet } from "@/lib/training/data";
import { equipmentLabel, expandOwnedEquipment, missingEquipment } from "@/lib/training/equipment";
import type { EquipmentState } from "@/lib/training/exercise-detail";
import { groupAlternatives } from "@/lib/training/alternatives";
import { otherEquipmentOptions, substitutesWithout, type EquipmentOption } from "@/lib/training/other-equipment";
import { rankSubstitutes } from "@/lib/training/substitutions";
import { MUSCLE_GROUP_LABELS, type Level, type TrainingContext } from "@/lib/training/taxonomy";
import { libraryHref } from "./detail-text";
import { TextLink } from "./TextLink";

/** How many ranked substitutes to read for both lists (other equipment, then the grouped alternatives). */
const SUBSTITUTES = 60;
const PER_GROUP = 3;

type AlternativesSectionProps = {
  exercise: CatalogExercise;
  /** The member's Home and Gym lists; null while they load or when they are unknown (starting lists are used). */
  equipment: EquipmentState | null;
  /** The member's training level, for ranking; null when unknown (this exercise's level is used). */
  level: Level | null;
  /** Where the member usually trains, when known. */
  preferredContext: TrainingContext | null;
  /** Increments when another part of the page asks to bring this section into view. */
  focusRequest: number;
};

type CatalogState = { status: "loading" } | { status: "ready"; exercises: CatalogExercise[] } | { status: "error" };

const NO_PROFILES = { home: null, gym: null, available: false } as const;

/** The place to show alternatives for first: where this exercise cannot be done, else where the member trains. */
function defaultContext(exercise: CatalogExercise, equipment: EquipmentState | null, preferred: TrainingContext | null): TrainingContext {
  const profiles = equipment?.profiles ?? NO_PROFILES;
  const words = equipment?.legacyWords ?? [];
  const missingAt = (context: TrainingContext) => missingEquipment(exercise.required_equipment, expandOwnedEquipment(equipmentFor(profiles, context, words).keys)).length > 0;
  if (missingAt("home") && !missingAt("gym")) return "home";
  if (missingAt("gym") && !missingAt("home")) return "gym";
  return preferred ?? "gym";
}

/**
 * Alternatives to this exercise, loaded when the section first shows (the light catalogue is one request):
 * similar movements with other equipment, then ExerciseAlternatives' groups, for the member's Home or Gym list.
 */
export function AlternativesSection({ exercise, equipment, level, preferredContext, focusRequest }: AlternativesSectionProps) {
  const [catalog, setCatalog] = useState<CatalogState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [chosen, setChosen] = useState<TrainingContext | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const supabase = createClient();
      const result = supabase ? await loadCatalog(supabase) : { error: new Error("unavailable"), exercises: [] as CatalogExercise[] };
      if (!active) return;
      setCatalog(result.error ? { status: "error" } : { status: "ready", exercises: result.exercises });
    })();
    return () => { active = false; };
  }, [attempt]);

  useEffect(() => {
    if (focusRequest <= 0 || !heading.current) return;
    heading.current.scrollIntoView({ block: "start" });
    heading.current.focus({ preventScroll: true });
  }, [focusRequest]);

  const context = chosen ?? defaultContext(exercise, equipment, preferredContext);
  const owned = ownedEquipmentSet(equipment?.profiles ?? NO_PROFILES, context, equipment?.legacyWords ?? []);
  const substitutes = catalog.status === "ready"
    ? rankSubstitutes(exercise, catalog.exercises, { owned, level: level ?? exercise.difficulty, doableOnly: false, limit: SUBSTITUTES })
    : [];
  const options = otherEquipmentOptions(exercise, substitutes);
  const rest = substitutesWithout(substitutes, options);
  // ExerciseAlternatives says when it has nothing; that is only true when there is no other equipment either.
  const showGroups = groupAlternatives(exercise, rest, PER_GROUP).length > 0 || options.length === 0;
  const group = MUSCLE_GROUP_LABELS[exercise.muscle_group];

  return (
    <section aria-labelledby="exercise-alternatives-heading" className="border-t border-fitx-divider pt-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 ref={heading} id="exercise-alternatives-heading" tabIndex={-1} className="text-base font-semibold text-fitx-text focus:outline-none">Alternatives</h2>
          <p className="mt-1 text-sm text-fitx-text-secondary">Other exercises for the same muscles, checked against your {context === "home" ? "home" : "gym"} equipment.</p>
        </div>
        <div role="group" aria-label="Equipment list to check against" className="inline-flex rounded-lg border border-fitx-border bg-fitx-surface-variant p-0.5">
          {(["home", "gym"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={context === value}
              onClick={() => setChosen(value)}
              className={`min-h-11 rounded-md px-4 text-sm font-semibold transition-colors motion-reduce:transition-none ${context === value ? "bg-fitx-card text-fitx-text shadow-sm" : "text-fitx-text-secondary hover:text-fitx-text"}`}
            >
              {value === "home" ? "Home" : "Gym"}
            </button>
          ))}
        </div>
      </div>

      {catalog.status === "loading" && (
        <div role="status" className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {[0, 1, 2, 3].map((index) => <div key={index} className="h-20 animate-pulse rounded-xl bg-fitx-surface-variant motion-reduce:animate-none" />)}
          <span className="sr-only">Finding alternatives</span>
        </div>
      )}

      {catalog.status === "error" && (
        <div className="mt-4 rounded-xl border border-fitx-border p-4 text-sm text-fitx-text-secondary">
          <p className="m-0">Alternatives couldn’t be loaded. Check your connection and try again.</p>
          <button type="button" onClick={() => { setCatalog({ status: "loading" }); setAttempt((value) => value + 1); }} className="mt-1 inline-flex min-h-11 items-center rounded-md px-1 font-semibold text-fitx-primary-text hover:underline">Try again</button>
        </div>
      )}

      {catalog.status === "ready" && (
        <div className="mt-4 space-y-6">
          {options.length > 0 && <OtherEquipment options={options} context={context} />}
          {/* grid-cols-1 (minmax(0, 1fr)) keeps long names truncating inside the lists instead of widening the page. */}
          {showGroups && <ExerciseAlternatives target={exercise} substitutes={rest} perGroup={PER_GROUP} className="grid-cols-1 sm:grid-cols-2 sm:gap-x-4 [&_ul]:grid-cols-1" />}
          <TextLink href={libraryHref(exercise.muscle_group, context)}>
            {context === "home" ? `${group} exercises you can do at home` : `All ${group.toLowerCase()} exercises`}<ArrowRight size={15} aria-hidden="true" />
          </TextLink>
        </div>
      )}
    </section>
  );
}

/** Similar movements for the same muscle, one per other piece of equipment. */
function OtherEquipment({ options, context }: { options: readonly EquipmentOption[]; context: TrainingContext }) {
  return (
    <section aria-labelledby="exercise-other-equipment-heading">
      <h3 id="exercise-other-equipment-heading" className="m-0 text-sm font-bold text-fitx-text">Other equipment</h3>
      <p className="m-0 mt-1 text-xs text-fitx-text-secondary">Similar movements for the same muscle with different equipment. They are not the same movement.</p>
      <ul className="m-0 mt-2 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2">
        {options.map((option) => (
          <li key={option.signature}>
            <Link
              href={`/exercises/${encodeURIComponent(option.exercise.id)}`}
              className="flex min-h-11 items-center gap-3 rounded-xl border border-fitx-border bg-fitx-card p-2 pr-3 transition-colors hover:bg-fitx-hover motion-reduce:transition-none"
            >
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-fitx-surface-variant text-fitx-text"><EquipmentIcon name={option.icon} size={30} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-fitx-text">{option.label}</span>
                <span className="mt-0.5 block truncate text-xs text-fitx-text-secondary">{option.exercise.name}</span>
                <span className="mt-0.5 block text-xs text-fitx-text-secondary">
                  {option.missing.length ? `Needs ${option.missing.map(equipmentLabel).join(", ").toLowerCase()}` : `You have this ${context === "home" ? "at home" : "at your gym"}`}
                </span>
              </span>
              <ArrowRight size={15} aria-hidden="true" className="shrink-0 text-fitx-text-secondary" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
