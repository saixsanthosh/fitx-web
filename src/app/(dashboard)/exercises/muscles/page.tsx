"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, PersonStanding } from "lucide-react";
import { BodyMap } from "@/components/anatomy/BodyMap";
import { PageHeader } from "@/components/ui/PageHeader";
import { localDateKey } from "@/lib/domain/dates";
import { createClient } from "@/lib/supabase/client";
import { BODY_REGIONS, REGIONS, regionInView, type RegionKey } from "@/lib/training/anatomy";
import { equipmentFor, loadProgrammes } from "@/lib/training/data";
import { expandOwnedEquipment } from "@/lib/training/equipment";
import { loadMuscleHistory, summariseMusclePeriods, type MusclePeriod, type MuscleSummary } from "@/lib/training/muscle-history";
import type { Programme } from "@/lib/training/programmes";
import { DEFAULT_LIBRARY_STATE, readLibraryState, writeLibraryState } from "../_lib/library-state";
import { replaceSearch, useCatalogue, useLibraryAccount, useUrlSearch } from "../_lib/use-library";
import { MuscleDetail, type TrainingFigures, type WorkoutLists } from "./_components/MuscleDetail";
import { RegionList } from "./_components/RegionList";
import { exercisesForRegion, lastTrainedText, regionFromParam } from "./_lib/muscle-exercises";
import { loadSavedPlans, plansTraining, programmesTraining, type SavedPlan, type SavedPlanExercise } from "./_lib/muscle-workouts";

/** Newest completed sessions read for "Your training" (enough for this week, 4 weeks and "last trained"). */
const HISTORY_SESSIONS = 400;

type History = { status: "idle" | "loading" | "error" } | { status: "ready"; periods: Record<MusclePeriod, MuscleSummary>; truncated: boolean };
type Workouts = { status: "loading" | "error" } | { status: "ready"; plans: SavedPlan[]; exercises: SavedPlanExercise[]; plansFailed: boolean; programmes: Programme[] };

/**
 * Browse by muscle (/exercises/muscles): the FITX body map, front and back, with every muscle selectable on the
 * figure or from a list. A selected muscle shows its name, what it does, the exercises that train it (main muscle
 * first; what the member can do first, with ?have= or their saved list), the workouts that train it and the
 * member's own completed sets for it. The choice lives in the URL (?muscle=lats&view=back).
 */
export default function BrowseByMusclePage() {
  const search = useUrlSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const region = regionFromParam(params.get("muscle"));
  const library = useMemo(() => readLibraryState(search), [search]);
  const requestedView = params.get("view");
  const view: "front" | "back" = requestedView === "back" || requestedView === "front" ? requestedView : region && !regionInView(region, "front") ? "back" : "front";
  const { catalogue, retry } = useCatalogue();
  const { account } = useLibraryAccount();
  const userId = account.status === "ready" ? account.userId : "";
  const [history, setHistory] = useState<History>({ status: "idle" });
  const [workouts, setWorkouts] = useState<Workouts>({ status: "loading" });

  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    if (!supabase) return;
    let active = true;
    void Promise.resolve().then(() => { if (active) setHistory({ status: "loading" }); });
    void loadMuscleHistory(supabase, userId, { maxSessions: HISTORY_SESSIONS }).then((result) => {
      if (!active) return;
      setHistory(result.error ? { status: "error" } : { status: "ready", periods: summariseMusclePeriods(result.sessions), truncated: result.truncated });
    });
    return () => { active = false; };
  }, [userId]);

  useEffect(() => {
    if (account.status === "loading") return;
    const supabase = createClient();
    let active = true;
    if (!supabase) {
      void Promise.resolve().then(() => { if (active) setWorkouts({ status: "error" }); });
      return () => { active = false; };
    }
    void Promise.all([
      userId ? loadSavedPlans(supabase, userId) : Promise.resolve({ error: null, plans: [] as SavedPlan[], exercises: [] as SavedPlanExercise[] }),
      loadProgrammes(supabase),
    ]).then(([plans, programmes]) => {
      if (!active) return;
      setWorkouts({ status: "ready", plans: plans.plans, exercises: plans.exercises, plansFailed: Boolean(plans.error), programmes: programmes.programmes });
    });
    return () => { active = false; };
  }, [account.status, userId]);

  const setParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(search);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    replaceSearch(next.toString());
  };
  const select = (next: RegionKey) => {
    const off = next === region;
    setParams({ muscle: off ? null : next });
    if (off || typeof window === "undefined" || !window.matchMedia("(max-width: 1023px)").matches) return;
    // On phones and tablets the details sit under the map: bring them into view.
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.requestAnimationFrame(() => document.getElementById("muscle-details")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }));
  };

  // What the member has: ?have= from the library, else their saved list for the context.
  const list = account.status === "ready" ? equipmentFor(account.profiles, library.context, account.legacyWords) : null;
  const haveKeys = library.have ?? list?.keys ?? null;
  const haveKey = haveKeys ? haveKeys.join(",") : null;
  const owned = useMemo(() => (haveKey === null ? null : expandOwnedEquipment(haveKey ? haveKey.split(",") : [])), [haveKey]);
  const level = account.status === "ready" ? account.level : null;
  const exercises = catalogue.status === "ready" ? catalogue.exercises : null;
  const catalogById = useMemo(() => new Map((exercises ?? []).map((exercise) => [exercise.id, exercise])), [exercises]);
  const regionExercises = useMemo(
    () => (region && exercises ? exercisesForRegion(exercises, region, { owned, level, environment: library.context }) : null),
    [region, exercises, owned, level, library.context],
  );

  const today = localDateKey();
  const weekSets = history.status === "ready"
    ? Object.fromEntries(BODY_REGIONS.map((key) => [key, history.periods.week.regions[key].primarySets]))
    : undefined;
  const training: TrainingFigures = account.status === "signed-out" || account.status === "unavailable"
    ? { status: "signed-out" }
    : account.status === "error" || history.status === "error" ? { status: "error" }
      : history.status !== "ready" || !region ? { status: "loading" }
        : {
          status: "ready",
          week: { primary: history.periods.week.regions[region].primarySets, secondary: history.periods.week.regions[region].secondarySets },
          fourWeeks: { primary: history.periods.four_weeks.regions[region].primarySets, secondary: history.periods.four_weeks.regions[region].secondarySets },
          lastTrained: history.periods.all.regions[region].lastTrainedOn ? lastTrainedText(history.periods.all.regions[region].lastTrainedOn!, today) : null,
          truncated: history.truncated,
        };
  // Plans are read through the catalogue's muscles, so they wait for it.
  const workoutLists: WorkoutLists = workouts.status !== "ready" || !region || catalogue.status === "loading"
    ? { status: workouts.status === "error" ? "error" : "loading" }
    : {
      status: "ready",
      // Without the account check the member's plans were not read at all.
      plansFailed: workouts.plansFailed || catalogue.status === "error" || account.status === "error",
      plans: exercises ? plansTraining(workouts.plans, workouts.exercises, catalogById, region, today) : [],
      programmes: programmesTraining(workouts.programmes, region),
    };
  const libraryHref = region ? `/exercises?${writeLibraryState({ ...DEFAULT_LIBRARY_STATE, muscles: [region], context: library.context, have: library.have })}` : "/exercises";
  const backHref = `/exercises${library.context === "home" || library.have ? `?${writeLibraryState({ ...DEFAULT_LIBRARY_STATE, context: library.context, have: library.have })}` : ""}`;

  return (
    <div className="space-y-5">
      <Link href={backHref} className="inline-flex min-h-11 items-center gap-2 text-sm text-fitx-text-secondary hover:text-fitx-text"><ArrowLeft size={15} aria-hidden="true" />Exercise library</Link>
      <PageHeader title="Browse by muscle" className="mb-0 sm:mb-2" />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:grid-rows-[auto_1fr] lg:items-start">
        <section aria-labelledby="map-title" className="fitx-panel grid min-w-0 gap-3 p-4 sm:p-5 lg:col-start-1 lg:row-start-1">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="map-title" className="m-0 text-base font-semibold">Body map</h2>
            <div role="group" aria-label="Side of the body" className="grid grid-cols-2 gap-1 rounded-lg border border-fitx-border bg-fitx-surface-variant p-1 md:hidden">
              {(["front", "back"] as const).map((side) => (
                <button key={side} type="button" aria-pressed={view === side} onClick={() => setParams({ view: side })}
                  className={`min-h-10 rounded-md px-4 text-sm font-medium transition-colors motion-reduce:transition-none ${view === side ? "bg-fitx-card text-fitx-text shadow-sm" : "text-fitx-text-secondary hover:text-fitx-text"}`}>
                  {side === "front" ? "Front" : "Back"}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-center md:hidden">
            <BodyMap title={`Muscle map, ${view} of the body`} view={view} selected={region} onSelect={select} size="lg" reveal />
          </div>
          <div className="hidden justify-center md:flex">
            <BodyMap title="Muscle map, front and back" view="both" selected={region} onSelect={select} size="lg" reveal />
          </div>
        </section>

        <section id="muscle-details" aria-label={region ? `${REGIONS[region].label}: details` : "Muscle details"} className="fitx-panel min-w-0 scroll-mt-24 p-4 sm:p-5 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          {region ? (
            <MuscleDetail region={region} training={training} exercises={catalogue.status === "error" ? { primary: [], assisting: [] } : regionExercises} workouts={workoutLists} libraryHref={libraryHref} />
          ) : (
            <div className="grid justify-items-center gap-2 py-10 text-center">
              <PersonStanding size={28} aria-hidden="true" className="text-fitx-text-secondary" />
              <h2 className="m-0 text-base font-semibold">Choose a muscle</h2>
              <p className="m-0 max-w-sm text-sm leading-6 text-fitx-text-secondary">Tap the map or the list.</p>
            </div>
          )}
          {catalogue.status === "error" && (
            <p role="alert" className="fitx-alert fitx-alert-danger mt-4">The exercise library could not be loaded.<button type="button" className="fitx-alert-action" onClick={retry}>Try again</button></p>
          )}
        </section>

        <section aria-labelledby="list-title" className="fitx-panel grid min-w-0 gap-3 p-4 sm:p-5 lg:col-start-1 lg:row-start-2">
          <h2 id="list-title" className="m-0 text-base font-semibold">All muscles</h2>
          <RegionList selected={region} onSelect={select} sets={weekSets} />
          {weekSets && <p className="m-0 text-xs text-fitx-text-secondary">Your direct sets this week</p>}
        </section>
      </div>
      <p className="sr-only" role="status" aria-live="polite">{region ? `${REGIONS[region].label} selected` : ""}</p>
    </div>
  );
}
