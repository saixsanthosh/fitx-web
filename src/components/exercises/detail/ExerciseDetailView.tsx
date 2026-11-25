"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { useOptionalUserContext } from "@/components/app/UserContextProvider";
import { PageHeader } from "@/components/ui/PageHeader";
import { Tabs, type TabItem } from "@/components/ui/Tabs";
import { rememberExercise, type SavedStore } from "@/lib/domain/exercise-preferences";
import { cameraRuleFor } from "@/lib/form-rules/catalog";
import { createClient, SUPABASE_URL } from "@/lib/supabase/client";
import { loadEquipmentState, loadExerciseDetail, type EquipmentState, type ExerciseDetail } from "@/lib/training/exercise-detail";
import { guideSteps, muscleSummary, shownDescription } from "@/lib/training/exercise-guide";
import { loadExerciseNote, type NoteLoad } from "@/lib/training/exercise-notes";
import { LEVELS, type Level, type TrainingContext } from "@/lib/training/taxonomy";
import { EXERCISE_TABS, EXERCISE_TAB_LABELS, isExerciseTab, searchWithTab, tabNeedsHistory, type ExerciseTab } from "./detail-tabs";
import { ExerciseHeader } from "./ExerciseHeader";
import { ExerciseNote } from "./ExerciseNote";
import { GuidePanel } from "./GuidePanel";
import { HistoryPanel } from "./HistoryPanel";
import { MusclesPanel } from "./MusclesPanel";
import { ProgressPanel } from "./ProgressPanel";
import { loadSavedState, setSavedExercise } from "./saved-exercise";
import { useExerciseHistory } from "./useExerciseHistory";

type Loaded = { id: string; detail: ExerciseDetail } | { id: string; detail: null; error: string };

const NOT_CONFIGURED = "Exercise information is unavailable in this environment.";
const LOAD_FAILED = "This exercise could not be loaded. Check your connection and try again.";
const NOT_FOUND = "This exercise is not in the library. It may have been removed or merged into a similar movement.";

function DetailSkeleton() {
  return (
    <div role="status" className="space-y-4">
      {/* No h1 while loading: the page's h1 is the exercise's own name (e2e flows wait for it), or "Exercise" when it
          cannot be shown. */}
      <div className="h-11 w-40 animate-pulse rounded-md bg-fitx-surface-variant motion-reduce:animate-none" />
      <div className="h-9 w-2/3 max-w-md animate-pulse rounded-md bg-fitx-surface-variant motion-reduce:animate-none" />
      <div className="h-7 w-1/2 max-w-sm animate-pulse rounded-md bg-fitx-surface-variant motion-reduce:animate-none" />
      <div className="h-11 w-full max-w-lg animate-pulse rounded-md bg-fitx-surface-variant motion-reduce:animate-none" />
      <div className="aspect-[4/3] max-h-80 w-full animate-pulse rounded-xl bg-fitx-surface-variant motion-reduce:animate-none sm:aspect-[16/7]" />
      <span className="sr-only">Loading exercise…</span>
    </div>
  );
}

/**
 * An exercise's page (/exercises/[id]): what it is, then four tabs (contract C6) — Guide (photos as a numbered
 * sequence, the catalogue's steps, the member's private note, suggested sets and equipment), Muscles (body map,
 * muscle lists, alternatives), History (completed sessions with their sets) and Progress (best set and trends from
 * logged sets). The open tab is kept in ?tab=. Data loads in the browser with the member's own session.
 */
export function ExerciseDetailView({ id, initialTab }: { id: string; initialTab: ExerciseTab }) {
  const [tab, setTab] = useState<ExerciseTab>(initialTab);
  const [historyWanted, setHistoryWanted] = useState(() => tabNeedsHistory(initialTab));
  const [alternativesFocus, setAlternativesFocus] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  /** undefined until known; null when signed out. */
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const [equipment, setEquipment] = useState<EquipmentState | null>(null);
  const [note, setNote] = useState<NoteLoad | null>(null);
  const [noteAttempt, setNoteAttempt] = useState(0);
  const [saved, setSaved] = useState<boolean | null>(null);
  const [savedStore, setSavedStore] = useState<SavedStore>("device");
  const [savedError, setSavedError] = useState("");
  const userContext = useOptionalUserContext();

  useEffect(() => {
    let active = true;
    void (async () => {
      const supabase = createClient();
      if (!supabase) {
        setLoaded({ id, detail: null, error: NOT_CONFIGURED });
        return;
      }
      const [auth, result] = await Promise.all([supabase.auth.getUser(), loadExerciseDetail(supabase, id, SUPABASE_URL)]);
      if (!active) return;
      if (result.status !== "found") {
        setLoaded({ id, detail: null, error: result.status === "error" ? LOAD_FAILED : NOT_FOUND });
        return;
      }
      const exerciseId = result.detail.exercise.id;
      const user = auth.data.user;
      setLoaded({ id, detail: result.detail });
      setUserId(user?.id ?? null);
      if (!user) return;
      rememberExercise(user.id, exerciseId);
      const [savedState, lists] = await Promise.all([loadSavedState(supabase, user.id, exerciseId).catch(() => null), loadEquipmentState(supabase, user.id)]);
      if (!active) return;
      if (savedState) { setSaved(savedState.saved); setSavedStore(savedState.store); }
      setEquipment(lists);
    })();
    return () => { active = false; };
  }, [id]);

  const exerciseId = loaded?.detail?.exercise.id ?? null;
  useEffect(() => {
    if (!userId || !exerciseId) return;
    let active = true;
    void (async () => {
      const supabase = createClient();
      if (!supabase) return;
      const result = await loadExerciseNote(supabase, userId, exerciseId);
      if (active) setNote(result);
    })();
    return () => { active = false; };
  }, [userId, exerciseId, noteAttempt]);

  const history = useExerciseHistory(historyWanted, userId, exerciseId ?? id);

  function selectTab(next: string) {
    if (!isExerciseTab(next)) return;
    setTab(next);
    if (tabNeedsHistory(next)) setHistoryWanted(true);
    window.history.replaceState(null, "", `${window.location.pathname}${searchWithTab(window.location.search, next)}`);
  }

  function showAlternatives() {
    selectTab("muscles");
    setAlternativesFocus((value) => value + 1);
  }

  if (!loaded || loaded.id !== id) return <DetailSkeleton />;
  if (!loaded.detail) {
    return (
      <div className="mx-auto max-w-6xl">
        <PageHeader title="Exercise" />
        <EmptyState
          headingLevel={2}
          title="Exercise unavailable"
          description={loaded.error}
          action={<Link href="/exercises" className="fitx-button fitx-button-secondary"><ArrowLeft size={15} aria-hidden="true" />Exercise library</Link>}
        />
      </div>
    );
  }

  const detail = loaded.detail;
  const { exercise } = detail;
  const steps = guideSteps(detail.instructions);
  const summary = shownDescription(detail.description, detail.instructions) ?? muscleSummary(exercise.primary_muscle, exercise.secondary_muscles);
  // The camera form coach counts six body-weight movements; this one may be one of them.
  const cameraRule = cameraRuleFor({ id: exercise.id, name: exercise.name });
  const preferences = userContext?.data?.preferences;
  const level: Level | null = preferences && (LEVELS as readonly string[]).includes(preferences.fitness_level) ? preferences.fitness_level : null;
  const preferredContext: TrainingContext | null = preferences?.workout_location === "home" ? "home" : preferences?.workout_location === "gym" ? "gym" : null;

  const noteBox = userId ? (
    <ExerciseNote
      key={exercise.id}
      userId={userId}
      exerciseId={exercise.id}
      exerciseName={exercise.name}
      load={note}
      onChange={setNote}
      onRetry={() => { setNote(null); setNoteAttempt((value) => value + 1); }}
    />
  ) : null;

  const panels: Record<ExerciseTab, TabItem["content"]> = {
    guide: <GuidePanel detail={detail} steps={steps} equipment={equipment} signedIn={Boolean(userId)} note={noteBox} onShowAlternatives={showAlternatives} />,
    muscles: <MusclesPanel exercise={exercise} equipment={equipment} level={level} preferredContext={preferredContext} alternativesFocus={alternativesFocus} />,
    history: <HistoryPanel history={history} exerciseId={exercise.id} exerciseName={exercise.name} />,
    progress: <ProgressPanel history={history} exerciseId={exercise.id} exerciseName={exercise.name} />,
  };
  const tabs: TabItem[] = EXERCISE_TABS.map((key) => ({ id: key, label: EXERCISE_TAB_LABELS[key], content: panels[key] }));

  return (
    <div className="mx-auto max-w-6xl space-y-4 sm:space-y-5">
      <ExerciseHeader
        exercise={exercise}
        summary={summary}
        cameraRuleId={cameraRule?.id ?? null}
        saved={userId ? saved ?? false : null}
        onToggleSaved={() => {
          if (!userId || saved === null) return;
          const next = !saved;
          setSaved(next);
          setSavedError("");
          void setSavedExercise(createClient(), userId, savedStore, exercise.id, next).then(({ error }) => {
            if (!error) return;
            setSaved(!next);
            setSavedError("Your saved exercises could not be updated. Please try again.");
          });
        }}
      />
      {savedError && <p role="alert" className="m-0 text-xs text-fitx-danger">{savedError}</p>}
      <Tabs tabs={tabs} value={tab} onChange={selectTab} label={`${exercise.name}: sections`} />
    </div>
  );
}
